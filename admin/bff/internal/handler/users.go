package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/model"
)

// ListUsers GET /api/v1/users?q=&status=&page=&page_size=
// items 含 Production 环境钻石余额（LEFT JOIN user_wallets）。
func (d Deps) ListUsers(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 20, 100)

	where := []string{"1=1"}
	args := make([]any, 0)
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		where = append(where, "(u.phone LIKE ? OR u.nickname LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		if status != "active" && status != "banned" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_status", "message": "状态参数只允许 active 或 banned"})
			return
		}
		where = append(where, "u.status = ?")
		args = append(args, status)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM users u WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count users failed", err)
		return
	}

	query := `SELECT u.id, u.phone, u.nickname, u.avatar_initial, u.status, u.created_at, u.last_login_at,
		COALESCE(w.diamonds, 0)
		FROM users u LEFT JOIN user_wallets w ON w.user_id = u.id
		WHERE ` + cond + ` ORDER BY u.created_at DESC, u.id ASC LIMIT ? OFFSET ?`
	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx, query, args2...)
	if err != nil {
		d.internalError(c, "list users failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, phone, nickname, avatar, status, createdAt string
		var lastLogin sql.NullString
		var diamonds int64
		if err := rows.Scan(&id, &phone, &nickname, &avatar, &status, &createdAt, &lastLogin, &diamonds); err != nil {
			d.internalError(c, "scan users failed", err)
			return
		}
		items = append(items, gin.H{
			"id": id, "phone": phone, "nickname": nickname, "avatar_initial": avatar,
			"status": status, "created_at": createdAt, "last_login_at": lastLogin.String,
			"diamonds": diamonds,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// UserDetail GET /api/v1/users/:id
// 返回用户基础信息、双环境钱包合并视图、名下精灵、最近 10 条账本与活跃会话数。
func (d Deps) UserDetail(c *gin.Context) {
	userID := c.Param("id")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var id, phone, nickname, avatar, status, createdAt string
	var lastLogin sql.NullString
	err := d.DB.QueryRowContext(ctx,
		"SELECT id, phone, nickname, avatar_initial, status, created_at, last_login_at FROM users WHERE id = ?",
		userID).Scan(&id, &phone, &nickname, &avatar, &status, &createdAt, &lastLogin)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "用户不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "get user failed", err)
		return
	}
	user := gin.H{
		"id": id, "phone": phone, "nickname": nickname, "avatar_initial": avatar,
		"status": status, "created_at": createdAt, "last_login_at": lastLogin.String,
	}

	wallets := gin.H{}
	for _, env := range []string{model.EnvProduction, model.EnvSandbox} {
		w, err := d.Ledger.ReadWallet(ctx, env, userID)
		if err != nil {
			d.internalError(c, "read wallet failed", err)
			return
		}
		wallets[env] = w
	}

	// 名下精灵（双环境，最多 50 条；name 从 payload JSON 解析）
	elfRows, err := d.DB.QueryContext(ctx,
		`SELECT environment, object_id, state, updated_at,
		 COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.name')), ''),
		 COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')), '')
		 FROM payment_objects WHERE kind = 'elf' AND owner_id = ?
		 ORDER BY updated_at DESC, object_id ASC LIMIT 50`, userID)
	if err != nil {
		d.internalError(c, "list user elves failed", err)
		return
	}
	elves := make([]gin.H, 0)
	for elfRows.Next() {
		var env, oid, state, updatedAt, name, payloadStatus string
		if err := elfRows.Scan(&env, &oid, &state, &updatedAt, &name, &payloadStatus); err != nil {
			elfRows.Close()
			d.internalError(c, "scan user elves failed", err)
			return
		}
		elves = append(elves, gin.H{
			"environment": env, "object_id": oid, "state": state,
			"status": payloadStatus, "updated_at": updatedAt, "name": name,
		})
	}
	elfRows.Close()

	// 最近 10 条账本（双环境混排）
	ledgerRows, err := d.DB.QueryContext(ctx,
		`SELECT environment, event_id, type, amount, balance_after, debt_after, note, created_at
		 FROM payment_ledger WHERE user_id = ?
		 ORDER BY created_at DESC, event_id DESC LIMIT 10`, userID)
	if err != nil {
		d.internalError(c, "list user ledger failed", err)
		return
	}
	recent := make([]gin.H, 0)
	for ledgerRows.Next() {
		var env, eventID, typ, note, createdAt string
		var amount, balanceAfter, debtAfter int64
		if err := ledgerRows.Scan(&env, &eventID, &typ, &amount, &balanceAfter, &debtAfter, &note, &createdAt); err != nil {
			ledgerRows.Close()
			d.internalError(c, "scan user ledger failed", err)
			return
		}
		recent = append(recent, gin.H{
			"environment": env, "event_id": eventID, "type": typ, "amount": amount,
			"balance_after": balanceAfter, "debt_after": debtAfter, "note": note, "created_at": createdAt,
		})
	}
	ledgerRows.Close()

	// 活跃会话数（refresh_sessions：未撤销且未过期；时间列为毫秒时间戳）
	var sessions int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM refresh_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?",
		userID, time.Now().UnixMilli()).Scan(&sessions); err != nil {
		d.internalError(c, "count sessions failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": user, "wallets": wallets, "elves": elves,
		"recent_ledger": recent, "sessions": sessions,
	})
}

type setUserStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

// SetUserStatus POST /api/v1/users/:id/status
// 仅允许 UPDATE users.status 列（数据库账号也只有这一列的 UPDATE 权限）。
func (d Deps) SetUserStatus(c *gin.Context) {
	var req setUserStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil ||
		(req.Status != "active" && req.Status != "banned") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_status", "message": "状态只允许 active 或 banned"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	res, err := d.DB.ExecContext(ctx,
		"UPDATE users SET status = ? WHERE id = ?", req.Status, c.Param("id"))
	if err != nil {
		d.internalError(c, "set user status failed", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "用户不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
