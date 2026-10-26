// Package ledger 逐语义复刻 server/src/payment_store.js 的 changeBalance 与事务骨架。
// 任何语义偏差都会导致双写不一致，修改前必须先对照 Node 原版。
package ledger

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"openelf-admin-bff/internal/model"
)

// Wallet 钱包合并视图（user_wallets/apple_iap_sandbox_wallets + payment_wallet_meta）。
type Wallet struct {
	Diamonds       int64 `json:"diamonds"`
	TotalRecharged int64 `json:"total_recharged"`
	TotalSpent     int64 `json:"total_spent"`
	RefundDebt     int64 `json:"refund_debt"`
	EarningsFen    int64 `json:"earnings_fen"`
	Version        int64 `json:"version"`
}

// Change 一次余额变更的参数（对应 Node changeBalance 的第三个参数）。
type Change struct {
	EventID  string
	Type     string
	Amount   int64 // 有符号：正额入账，负额扣减
	Note     string
	Recharge bool // amount>0 且记 total_recharged
	Spend    bool // amount<0 的消费语义：有欠额或余额不足时拒绝
}

// Store 支付存储，包一层 *sql.DB。
type Store struct {
	DB *sql.DB
}

// New 构造 Store。
func New(db *sql.DB) *Store { return &Store{DB: db} }

// walletTable 对应 Node tables()：Production→user_wallets，Sandbox→apple_iap_sandbox_wallets。
// 表名只允许这两个白名单值，防止拼接注入。
func walletTable(environment string) (string, error) {
	switch environment {
	case model.EnvSandbox:
		return "apple_iap_sandbox_wallets", nil
	case model.EnvProduction:
		return "user_wallets", nil
	}
	return "", errors.New("Invalid payment environment")
}

// isRetryable 对应 Node 的 ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT。
func isRetryable(err error) bool {
	var me *mysqldriver.MySQLError
	if errors.As(err, &me) {
		// 1213 = ER_LOCK_DEADLOCK, 1205 = ER_LOCK_WAIT_TIMEOUT
		return me.Number == 1213 || me.Number == 1205
	}
	return false
}

// nowISO 对应 Node new Date().toISOString()（UTC 毫秒精度 ISO 串）。
func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// lockWallet 对应 tx.lockWallet：INSERT IGNORE 兜底建行 + 双行 FOR UPDATE。
func lockWallet(ctx context.Context, tx *sql.Tx, table, environment, userID string) (*Wallet, error) {
	if _, err := tx.ExecContext(ctx,
		fmt.Sprintf("INSERT IGNORE INTO %s (user_id, diamonds, total_recharged, updated_at) VALUES (?, 0, 0, ?)", table),
		userID, nowISO()); err != nil {
		return nil, err
	}
	w := &Wallet{}
	if err := tx.QueryRowContext(ctx,
		fmt.Sprintf("SELECT diamonds, total_recharged FROM %s WHERE user_id = ? FOR UPDATE", table),
		userID).Scan(&w.Diamonds, &w.TotalRecharged); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT IGNORE INTO payment_wallet_meta (environment, user_id) VALUES (?, ?)",
		environment, userID); err != nil {
		return nil, err
	}
	if err := tx.QueryRowContext(ctx,
		"SELECT total_spent, refund_debt, earnings_fen, version FROM payment_wallet_meta WHERE environment = ? AND user_id = ? FOR UPDATE",
		environment, userID).Scan(&w.TotalSpent, &w.RefundDebt, &w.EarningsFen, &w.Version); err != nil {
		return nil, err
	}
	return w, nil
}

// saveWallet 对应 tx.saveWallet：回写钱包行与 meta 行。
func saveWallet(ctx context.Context, tx *sql.Tx, table, environment, userID string, w *Wallet) error {
	if _, err := tx.ExecContext(ctx,
		fmt.Sprintf("UPDATE %s SET diamonds = ?, total_recharged = ?, updated_at = ? WHERE user_id = ?", table),
		w.Diamonds, w.TotalRecharged, nowISO(), userID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx,
		"UPDATE payment_wallet_meta SET total_spent = ?, refund_debt = ?, earnings_fen = ?, version = ? WHERE environment = ? AND user_id = ?",
		w.TotalSpent, w.RefundDebt, w.EarningsFen, w.Version, environment, userID)
	return err
}

// logExists 对应 tx.logExists：event_id 幂等检查。
func logExists(ctx context.Context, tx *sql.Tx, environment, userID, eventID string) (bool, error) {
	var one int
	err := tx.QueryRowContext(ctx,
		"SELECT 1 FROM payment_ledger WHERE environment = ? AND user_id = ? AND event_id = ?",
		environment, userID, eventID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// writeLog 对应 tx.log：追加账本行，balance_after/debt_after 取变更后值。
func writeLog(ctx context.Context, tx *sql.Tx, environment, userID string, ch Change, w *Wallet) error {
	note := []rune(ch.Note)
	if len(note) > 255 {
		note = note[:255]
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO payment_ledger (environment, user_id, event_id, type, amount, balance_after, debt_after, note, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		environment, userID, ch.EventID, ch.Type, ch.Amount, w.Diamonds, w.RefundDebt, string(note), nowISO())
	return err
}

// apply 是 Node changeBalance 的纯计算部分（不含 IO），逐语义复刻：
// 正额先还 refund_debt 再入 diamonds；负额先扣 diamonds 不足记 refund_debt；version++。
func apply(w *Wallet, ch Change) {
	if ch.Amount >= 0 {
		repayment := min(w.RefundDebt, ch.Amount)
		w.RefundDebt -= repayment
		w.Diamonds += ch.Amount - repayment
	} else {
		deduction := min(w.Diamonds, -ch.Amount)
		w.Diamonds -= deduction
		w.RefundDebt += -ch.Amount - deduction
	}
	if ch.Recharge {
		w.TotalRecharged += ch.Amount
	}
	if ch.Spend {
		w.TotalSpent -= ch.Amount
	}
	w.Version++
}

// ChangeBalance 在事务内执行一次余额变更；死锁/锁超时最多重试 3 次（Node: attempt < 2 时重试）。
// 返回 (最终钱包, duplicated=event_id 已存在未重复记账, 错误)。
func (s *Store) ChangeBalance(ctx context.Context, environment, userID string, ch Change) (*Wallet, bool, error) {
	table, err := walletTable(environment)
	if err != nil {
		return nil, false, err
	}

	for attempt := 0; ; attempt++ {
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return nil, false, err
		}
		w, duplicated, err := s.work(ctx, tx, table, environment, userID, ch)
		if err != nil {
			_ = tx.Rollback()
			if isRetryable(err) && attempt < 2 {
				continue
			}
			return nil, false, err
		}
		if err := tx.Commit(); err != nil {
			if isRetryable(err) && attempt < 2 {
				continue
			}
			return nil, false, err
		}
		return w, duplicated, nil
	}
}

func (s *Store) work(ctx context.Context, tx *sql.Tx, table, environment, userID string, ch Change) (*Wallet, bool, error) {
	w, err := lockWallet(ctx, tx, table, environment, userID)
	if err != nil {
		return nil, false, err
	}
	// 幂等：event_id 已存在即返回当前钱包，不重复记账。
	exists, err := logExists(ctx, tx, environment, userID, ch.EventID)
	if err != nil {
		return nil, false, err
	}
	if exists {
		return w, true, nil
	}
	// Node: spend 且有欠额或余额不足时拒绝
	if ch.Spend && (w.RefundDebt > 0 || w.Diamonds < -ch.Amount) {
		if w.RefundDebt > 0 {
			return nil, false, &FailError{StatusCode: 409, Code: "REFUND_DEBT", Message: "请先补足退款欠额后再消费"}
		}
		return nil, false, &FailError{StatusCode: 409, Code: "INSUFFICIENT_BALANCE", Message: "钻石余额不足"}
	}
	apply(w, ch)
	if err := saveWallet(ctx, tx, table, environment, userID, w); err != nil {
		return nil, false, err
	}
	if err := writeLog(ctx, tx, environment, userID, ch, w); err != nil {
		return nil, false, err
	}
	return w, false, nil
}

// ReadWallet 只读合并视图（无锁），供查询接口使用。
func (s *Store) ReadWallet(ctx context.Context, environment, userID string) (*Wallet, error) {
	table, err := walletTable(environment)
	if err != nil {
		return nil, err
	}
	w := &Wallet{}
	err = s.DB.QueryRowContext(ctx,
		fmt.Sprintf("SELECT diamonds, total_recharged FROM %s WHERE user_id = ?", table), userID).
		Scan(&w.Diamonds, &w.TotalRecharged)
	if errors.Is(err, sql.ErrNoRows) {
		// 未开户：全零视图（Node lockWallet 的 INSERT IGNORE 语义）
	} else if err != nil {
		return nil, err
	}
	err = s.DB.QueryRowContext(ctx,
		"SELECT total_spent, refund_debt, earnings_fen, version FROM payment_wallet_meta WHERE environment = ? AND user_id = ?",
		environment, userID).Scan(&w.TotalSpent, &w.RefundDebt, &w.EarningsFen, &w.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return w, nil
	}
	return w, err
}

// FailError 对应 Node fail()：带 HTTP 状态码与机器可读错误码。
type FailError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *FailError) Error() string { return e.Message }
