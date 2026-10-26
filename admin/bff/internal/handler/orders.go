package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/middleware"
	"openelf-admin-bff/internal/model"
)

// ListAlipayOrders GET /api/v1/orders/alipay?env=&state=&page=
// payment_objects kind='alipay_order'，items 含基础列 + payload 摘要。
func (d Deps) ListAlipayOrders(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	page, pageSize, offset := pageParams(c, 20, 100)

	where := []string{"environment = ?", "kind = 'alipay_order'"}
	args := []any{env}
	if state := strings.TrimSpace(c.Query("state")); state != "" {
		where = append(where, "state = ?")
		args = append(args, state)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM payment_objects WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count alipay orders failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT object_id, owner_id, state, ref_id, updated_at, payload
		 FROM payment_objects WHERE `+cond+`
		 ORDER BY updated_at DESC, object_id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list alipay orders failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var oid, state, updatedAt, payload string
		var ownerID, refID sql.NullString
		if err := rows.Scan(&oid, &ownerID, &state, &refID, &updatedAt, &payload); err != nil {
			d.internalError(c, "scan alipay orders failed", err)
			return
		}
		items = append(items, gin.H{
			"object_id": oid, "owner_id": ownerID.String, "state": state,
			"ref_id": refID.String, "updated_at": updatedAt,
			"payload": alipayOrderSummary(payload),
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// alipayOrderSummary 从 alipay_order payload 解析摘要字段（结构见 server/src/alipay.js）。
func alipayOrderSummary(payload string) gin.H {
	var p struct {
		ID        string `json:"id"`
		TierID    string `json:"tierId"`
		Status    string `json:"status"`
		Diamonds  int64  `json:"diamonds"`
		PriceFen  int64  `json:"priceFen"`
		Credited  bool   `json:"credited"`
		TradeNo   any    `json:"tradeNo"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return gin.H{"_parse_error": true}
	}
	return gin.H{
		"id": p.ID, "tier_id": p.TierID, "status": p.Status, "diamonds": p.Diamonds,
		"price_fen": p.PriceFen, "credited": p.Credited, "trade_no": p.TradeNo, "expires_at": p.ExpiresAt,
	}
}

// appleOrderTable 对应 payment_store.tables() 的 order 表路由。
func appleOrderTable(env string) string {
	if env == model.EnvSandbox {
		return "apple_iap_sandbox_transactions"
	}
	return "apple_iap_transactions"
}

// ListAppleOrders GET /api/v1/orders/apple?env=&page=
// Production → apple_iap_transactions，Sandbox → apple_iap_sandbox_transactions。
func (d Deps) ListAppleOrders(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	page, pageSize, offset := pageParams(c, 20, 100)
	table := appleOrderTable(env)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&total); err != nil {
		d.internalError(c, "count apple orders failed", err)
		return
	}

	rows, err := d.DB.QueryContext(ctx,
		fmt.Sprintf(`SELECT transaction_id, user_id, product_id, diamonds, environment, purchased_at, created_at
		 FROM %s ORDER BY created_at DESC, transaction_id ASC LIMIT ? OFFSET ?`, table),
		pageSize, offset)
	if err != nil {
		d.internalError(c, "list apple orders failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var tid, uid, pid, envCol, createdAt string
		var diamonds int64
		var purchasedAt sql.NullInt64
		if err := rows.Scan(&tid, &uid, &pid, &diamonds, &envCol, &purchasedAt, &createdAt); err != nil {
			d.internalError(c, "scan apple orders failed", err)
			return
		}
		items = append(items, gin.H{
			"transaction_id": tid, "user_id": uid, "product_id": pid, "diamonds": diamonds,
			"environment": envCol, "purchased_at": purchasedAt.Int64, "created_at": createdAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ListReviews GET /api/v1/orders/reviews?env=&page=
// kind='alipay_review' AND state='needs_review'。
func (d Deps) ListReviews(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	page, pageSize, offset := pageParams(c, 20, 100)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM payment_objects
		 WHERE environment = ? AND kind = 'alipay_review' AND state = 'needs_review'`, env).Scan(&total); err != nil {
		d.internalError(c, "count reviews failed", err)
		return
	}

	rows, err := d.DB.QueryContext(ctx,
		`SELECT object_id, owner_id, updated_at, payload
		 FROM payment_objects
		 WHERE environment = ? AND kind = 'alipay_review' AND state = 'needs_review'
		 ORDER BY updated_at DESC, object_id ASC LIMIT ? OFFSET ?`, env, pageSize, offset)
	if err != nil {
		d.internalError(c, "list reviews failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var oid, updatedAt, payload string
		var ownerID sql.NullString
		if err := rows.Scan(&oid, &ownerID, &updatedAt, &payload); err != nil {
			d.internalError(c, "scan reviews failed", err)
			return
		}
		items = append(items, gin.H{
			"object_id": oid, "owner_id": ownerID.String, "state": "needs_review",
			"updated_at": updatedAt, "payload": json.RawMessage(payload),
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

type resolveReviewRequest struct {
	Environment string `json:"environment" binding:"required"`
	Note        string `json:"note" binding:"max=255"`
}

// ResolveReview POST /api/v1/orders/reviews/:id/resolve（仅 super_admin）
// 事务内 FOR UPDATE 读改写：state='resolved'，payload 记录处理人与备注。
func (d Deps) ResolveReview(c *gin.Context) {
	var req resolveReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法（environment 必填）"})
		return
	}
	if !envBody(c, req.Environment) {
		return
	}
	reviewID := c.Param("id")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin tx failed", err)
		return
	}
	defer tx.Rollback()

	var payload, state string
	err = tx.QueryRowContext(ctx,
		`SELECT payload, state FROM payment_objects
		 WHERE environment = ? AND kind = 'alipay_review' AND object_id = ? FOR UPDATE`,
		req.Environment, reviewID).Scan(&payload, &state)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "核对单不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "lock review failed", err)
		return
	}
	if state != "needs_review" {
		c.JSON(http.StatusConflict, gin.H{"error": "already_resolved", "message": "该核对单已处理"})
		return
	}

	// 处理信息合并进 payload（与 Node tx.put 的"整存整取"语义一致）
	var doc map[string]any
	if err := json.Unmarshal([]byte(payload), &doc); err != nil {
		doc = map[string]any{}
	}
	doc["resolvedBy"] = c.GetString(middleware.CtxActorName)
	doc["resolvedAt"] = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	if req.Note != "" {
		doc["resolveNote"] = req.Note
	}
	newPayload, err := json.Marshal(doc)
	if err != nil {
		d.internalError(c, "marshal review payload failed", err)
		return
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE payment_objects SET state = 'resolved', payload = ?, updated_at = ?
		 WHERE environment = ? AND kind = 'alipay_review' AND object_id = ?`,
		string(newPayload), time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		req.Environment, reviewID); err != nil {
		d.internalError(c, "resolve review failed", err)
		return
	}
	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit resolve review failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
