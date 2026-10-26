package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/ledger"
	"openelf-admin-bff/internal/middleware"
	"openelf-admin-bff/internal/model"
)

// GetWallet GET /api/v1/wallets/:userId?env=
// 该环境钱包 + payment_wallet_meta 合并视图。
func (d Deps) GetWallet(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	userID := c.Param("userId")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// 先确认用户存在，避免把"未开户"与"用户不存在"混淆
	var id string
	err := d.DB.QueryRowContext(ctx, "SELECT id FROM users WHERE id = ?", userID).Scan(&id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "用户不存在"})
		return
	}

	w, err := d.Ledger.ReadWallet(ctx, env, userID)
	if err != nil {
		d.internalError(c, "read wallet failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user_id": userID, "environment": env, "wallet": w})
}

// ListLedger GET /api/v1/ledger?user_id=&env=&type=&page=
func (d Deps) ListLedger(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	page, pageSize, offset := pageParams(c, 20, 100)

	where := []string{"environment = ?"}
	args := []any{env}
	if userID := strings.TrimSpace(c.Query("user_id")); userID != "" {
		where = append(where, "user_id = ?")
		args = append(args, userID)
	}
	if typ := strings.TrimSpace(c.Query("type")); typ != "" {
		where = append(where, "type = ?")
		args = append(args, typ)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM payment_ledger WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count ledger failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT user_id, event_id, type, amount, balance_after, debt_after, note, created_at
		 FROM payment_ledger WHERE `+cond+`
		 ORDER BY created_at DESC, event_id DESC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list ledger failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var userID, eventID, typ, note, createdAt string
		var amount, balanceAfter, debtAfter int64
		if err := rows.Scan(&userID, &eventID, &typ, &amount, &balanceAfter, &debtAfter, &note, &createdAt); err != nil {
			d.internalError(c, "scan ledger failed", err)
			return
		}
		items = append(items, gin.H{
			"user_id": userID, "event_id": eventID, "type": typ, "amount": amount,
			"balance_after": balanceAfter, "debt_after": debtAfter, "note": note, "created_at": createdAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

type walletAdjustRequest struct {
	UserID      string `json:"user_id" binding:"required"`
	Environment string `json:"environment" binding:"required"`
	Amount      int64  `json:"amount" binding:"required"`
	Note        string `json:"note" binding:"required,max=255"`
	ClientToken string `json:"client_token" binding:"max=100"`
}

// WalletAdjust POST /api/v1/wallet/adjust（仅 super_admin）
// 走 internal/ledger（与线上 changeBalance 同一套语义）；禁对 status!=active 用户调账。
// event_id = 'admin:' + (client_token 或随机 ID)，天然幂等。
func (d Deps) WalletAdjust(c *gin.Context) {
	var req walletAdjustRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法（user_id/environment/amount/note 必填）"})
		return
	}
	if !envBody(c, req.Environment) {
		return
	}
	if req.Amount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_amount", "message": "调账金额不能为 0"})
		return
	}
	if strings.TrimSpace(req.Note) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_note", "message": "必须填写调账原因"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	// 禁对非 active 用户调账
	var status string
	err := d.DB.QueryRowContext(ctx, "SELECT status FROM users WHERE id = ?", req.UserID).Scan(&status)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "用户不存在"})
		return
	}
	if status != "active" {
		c.JSON(http.StatusConflict, gin.H{"error": "user_not_active", "message": "该用户已被封禁，禁止调账"})
		return
	}

	eventID := "admin:" + strings.TrimSpace(req.ClientToken)
	if eventID == "admin:" {
		eventID = "admin:" + model.NewID()
	}
	actor := c.GetString(middleware.CtxActorName)
	note := strings.TrimSpace(req.Note) + "（操作人:" + actor + "）"

	w, duplicated, err := d.Ledger.ChangeBalance(ctx, req.Environment, req.UserID, ledger.Change{
		EventID: eventID,
		Type:    "admin_adjust",
		Amount:  req.Amount,
		Note:    note,
	})
	if err != nil {
		var fe *ledger.FailError
		if errors.As(err, &fe) {
			c.JSON(fe.StatusCode, gin.H{"error": fe.Code, "message": fe.Message})
			return
		}
		d.internalError(c, "wallet adjust failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"event_id": eventID, "duplicated": duplicated, "wallet": w,
	})
}
