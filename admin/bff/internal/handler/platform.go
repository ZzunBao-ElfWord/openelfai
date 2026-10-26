package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// platformNullableString / platformNullableInt64 把 MySQL NULL 映射为 JSON null。
func platformNullableString(v sql.NullString) any {
	if v.Valid {
		return v.String
	}
	return nil
}

func platformNullableInt64(v sql.NullInt64) any {
	if v.Valid {
		return v.Int64
	}
	return nil
}

// validPlatformModelID 模型 id 只允许 [a-z0-9._/-]，长度 1-64（与 VARCHAR(64) 对齐）。
func validPlatformModelID(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '.', r == '_', r == '/', r == '-':
		default:
			return false
		}
	}
	return true
}

// platformDayStart 返回 UTC+8 当天 00:00 的时间（usage 按天聚合统一用该时区）。
func platformDayStart(t time.Time) time.Time {
	loc := time.FixedZone("UTC+8", 8*60*60)
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

// ListPlatformModels GET /api/v1/platform/models
// 目录 + 每模型「当前有效价」（effective_from <= now 中最大的一条）。
func (d Deps) ListPlatformModels(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT c.model_id, c.vendor, c.display_name, c.region, c.capabilities, c.context_tokens,
			c.status, c.external_only,
			p.input_micro_per_1m, p.output_micro_per_1m, p.markup_bp, p.effective_from
		 FROM platform_model_catalog c
		 LEFT JOIN platform_model_price p ON p.model_id = c.model_id
		   AND p.effective_from = (
		     SELECT MAX(p2.effective_from) FROM platform_model_price p2
		     WHERE p2.model_id = c.model_id AND p2.effective_from <= ?
		   )
		 ORDER BY c.model_id ASC`, time.Now().UnixMilli())
	if err != nil {
		d.internalError(c, "list platform models failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var modelID, vendor, displayName, region, capabilities, status string
		var contextTokens, externalOnly int64
		var input, output, markup, effectiveFrom sql.NullInt64
		if err := rows.Scan(&modelID, &vendor, &displayName, &region, &capabilities, &contextTokens,
			&status, &externalOnly, &input, &output, &markup, &effectiveFrom); err != nil {
			d.internalError(c, "scan platform models failed", err)
			return
		}
		items = append(items, gin.H{
			"model_id": modelID, "vendor": vendor, "display_name": displayName,
			"region": region, "capabilities": capabilities, "context_tokens": contextTokens,
			"status": status, "external_only": externalOnly != 0,
			"input_micro_per_1m":  platformNullableInt64(input),
			"output_micro_per_1m": platformNullableInt64(output),
			"markup_bp":           platformNullableInt64(markup),
			"effective_from":      platformNullableInt64(effectiveFrom),
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// ListPlatformDevelopers GET /api/v1/platform/developers?status=&page=&page_size=
func (d Deps) ListPlatformDevelopers(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 20, 100)

	where := []string{"1=1"}
	args := make([]any, 0)
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		where = append(where, "d.status = ?")
		args = append(args, status)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM platform_developers d WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count platform developers failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT d.user_id, d.real_name, d.purpose, d.status, d.tier, d.created_at, d.approved_at,
			COALESCE(w.balance_micro, 0), COALESCE(w.frozen_micro, 0), COALESCE(w.total_topup_micro, 0),
			COUNT(k.id)
		 FROM platform_developers d
		 LEFT JOIN platform_wallets w ON w.user_id = d.user_id
		 LEFT JOIN platform_api_keys k ON k.user_id = d.user_id
		 WHERE `+cond+`
		 GROUP BY d.user_id, d.real_name, d.purpose, d.status, d.tier, d.created_at, d.approved_at,
			w.balance_micro, w.frozen_micro, w.total_topup_micro
		 ORDER BY d.created_at DESC, d.user_id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list platform developers failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var userID, realName, purpose, status, tier string
		var createdAt int64
		var approvedAt sql.NullInt64
		var balance, frozen, totalTopup, keyCount int64
		if err := rows.Scan(&userID, &realName, &purpose, &status, &tier, &createdAt, &approvedAt,
			&balance, &frozen, &totalTopup, &keyCount); err != nil {
			d.internalError(c, "scan platform developers failed", err)
			return
		}
		items = append(items, gin.H{
			"user_id": userID, "real_name": realName, "purpose": purpose,
			"status": status, "tier": tier, "created_at": createdAt,
			"approved_at":       platformNullableInt64(approvedAt),
			"balance_micro":     balance,
			"frozen_micro":      frozen,
			"total_topup_micro": totalTopup,
			"key_count":         keyCount,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ListPlatformKeys GET /api/v1/platform/keys?user_id=&page=&page_size=
// 严禁返回 key_hash。
func (d Deps) ListPlatformKeys(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 20, 100)

	where := []string{"1=1"}
	args := make([]any, 0)
	if userID := strings.TrimSpace(c.Query("user_id")); userID != "" {
		where = append(where, "user_id = ?")
		args = append(args, userID)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM platform_api_keys WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count platform keys failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, user_id, name, key_prefix, allowed_models, monthly_budget_micro, qps_limit,
			ip_allowlist, created_at, last_used_at, revoked_at
		 FROM platform_api_keys WHERE `+cond+`
		 ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list platform keys failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, userID, name, keyPrefix string
		var allowedModels, ipAllowlist sql.NullString
		var lastUsedAt, revokedAt sql.NullInt64
		var monthlyBudget int64
		var qpsLimit int
		var createdAt int64
		if err := rows.Scan(&id, &userID, &name, &keyPrefix, &allowedModels, &monthlyBudget, &qpsLimit,
			&ipAllowlist, &createdAt, &lastUsedAt, &revokedAt); err != nil {
			d.internalError(c, "scan platform keys failed", err)
			return
		}
		items = append(items, gin.H{
			"id": id, "user_id": userID, "name": name, "key_prefix": keyPrefix,
			"allowed_models":       platformNullableString(allowedModels),
			"monthly_budget_micro": monthlyBudget,
			"qps_limit":            qpsLimit,
			"ip_allowlist":         platformNullableString(ipAllowlist),
			"created_at":           createdAt,
			"last_used_at":         platformNullableInt64(lastUsedAt),
			"revoked_at":           platformNullableInt64(revokedAt),
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// GetPlatformWallet GET /api/v1/platform/wallets/:userId
// 钱包视图 + 最近 20 条账本；钱包未开立时返回全 0。
func (d Deps) GetPlatformWallet(c *gin.Context) {
	userID := c.Param("userId")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var balance, frozen, totalTopup, updatedAt int64
	err := d.DB.QueryRowContext(ctx,
		`SELECT balance_micro, frozen_micro, total_topup_micro, updated_at
		 FROM platform_wallets WHERE user_id = ?`, userID).
		Scan(&balance, &frozen, &totalTopup, &updatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		d.internalError(c, "get platform wallet failed", err)
		return
	}

	rows, err := d.DB.QueryContext(ctx,
		`SELECT type, delta_micro, balance_after, note, created_at, request_id
		 FROM platform_ledger WHERE user_id = ?
		 ORDER BY created_at DESC, id DESC LIMIT 20`, userID)
	if err != nil {
		d.internalError(c, "list platform ledger failed", err)
		return
	}
	defer rows.Close()

	ledger := make([]gin.H, 0)
	for rows.Next() {
		var typ string
		var delta, balanceAfter, createdAt int64
		var note, requestID sql.NullString
		if err := rows.Scan(&typ, &delta, &balanceAfter, &note, &createdAt, &requestID); err != nil {
			d.internalError(c, "scan platform ledger failed", err)
			return
		}
		ledger = append(ledger, gin.H{
			"type": typ, "delta_micro": delta, "balance_after": balanceAfter,
			"note": platformNullableString(note), "created_at": createdAt,
			"request_id": platformNullableString(requestID),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"user_id": userID, "balance_micro": balance, "frozen_micro": frozen,
		"total_topup_micro": totalTopup, "updated_at": updatedAt, "ledger": ledger,
	})
}

// ListPlatformRequests GET /api/v1/platform/requests?model=&status=&user_id=&page=&page_size=
func (d Deps) ListPlatformRequests(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 20, 100)

	where := []string{"1=1"}
	args := make([]any, 0)
	if model := strings.TrimSpace(c.Query("model")); model != "" {
		where = append(where, "(requested_model = ? OR resolved_model = ?)")
		args = append(args, model, model)
	}
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		where = append(where, "status = ?")
		args = append(args, status)
	}
	if userID := strings.TrimSpace(c.Query("user_id")); userID != "" {
		where = append(where, "user_id = ?")
		args = append(args, userID)
	}
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM platform_requests WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count platform requests failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, user_id, key_id, source, requested_model, resolved_model,
			prompt_tokens, completion_tokens, cost_micro, price_micro, latency_ms, status,
			error_code, estimated, created_at
		 FROM platform_requests WHERE `+cond+`
		 ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list platform requests failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, userID, source, requestedModel, resolvedModel, status string
		var keyID, errorCode sql.NullString
		var promptTokens, completionTokens, cost, price, latencyMS, createdAt int64
		var estimated int64
		if err := rows.Scan(&id, &userID, &keyID, &source, &requestedModel, &resolvedModel,
			&promptTokens, &completionTokens, &cost, &price, &latencyMS, &status,
			&errorCode, &estimated, &createdAt); err != nil {
			d.internalError(c, "scan platform requests failed", err)
			return
		}
		items = append(items, gin.H{
			"id": id, "user_id": userID, "key_id": platformNullableString(keyID),
			"source": source, "requested_model": requestedModel, "resolved_model": resolvedModel,
			"prompt_tokens": promptTokens, "completion_tokens": completionTokens,
			"cost_micro": cost, "price_micro": price, "latency_ms": latencyMS,
			"status": status, "error_code": platformNullableString(errorCode),
			"estimated": estimated != 0, "created_at": createdAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ListPlatformUsage GET /api/v1/platform/usage?days=（默认 7，最大 90）
// daily 按 UTC+8 自然日补齐缺失日期；by_model 按 resolved_model 聚合。
func (d Deps) ListPlatformUsage(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}

	now := time.Now()
	start := platformDayStart(now).AddDate(0, 0, -(days - 1))
	startMillis := start.UnixMilli()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT (created_at - ?) DIV 86400000 AS day_idx, COUNT(*),
			COALESCE(SUM(prompt_tokens), 0), COALESCE(SUM(completion_tokens), 0), COALESCE(SUM(price_micro), 0)
		 FROM platform_requests WHERE created_at >= ?
		 GROUP BY day_idx ORDER BY day_idx ASC`, startMillis, startMillis)
	if err != nil {
		d.internalError(c, "query platform usage daily failed", err)
		return
	}

	daily := make([]gin.H, days)
	for i := 0; i < days; i++ {
		daily[i] = gin.H{
			"date":     start.AddDate(0, 0, i).Format("2006-01-02"),
			"requests": int64(0), "prompt_tokens": int64(0),
			"completion_tokens": int64(0), "price_micro": int64(0),
		}
	}
	for rows.Next() {
		var idx, requests, promptTokens, completionTokens, price int64
		if err := rows.Scan(&idx, &requests, &promptTokens, &completionTokens, &price); err != nil {
			rows.Close()
			d.internalError(c, "scan platform usage daily failed", err)
			return
		}
		if idx < 0 || idx >= int64(days) {
			continue
		}
		daily[idx] = gin.H{
			"date":     start.AddDate(0, 0, int(idx)).Format("2006-01-02"),
			"requests": requests, "prompt_tokens": promptTokens,
			"completion_tokens": completionTokens, "price_micro": price,
		}
	}
	rows.Close()

	modelRows, err := d.DB.QueryContext(ctx,
		`SELECT resolved_model, COUNT(*), COALESCE(SUM(price_micro), 0)
		 FROM platform_requests WHERE created_at >= ?
		 GROUP BY resolved_model ORDER BY COUNT(*) DESC, resolved_model ASC`, startMillis)
	if err != nil {
		d.internalError(c, "query platform usage by model failed", err)
		return
	}
	defer modelRows.Close()

	byModel := make([]gin.H, 0)
	for modelRows.Next() {
		var model string
		var requests, price int64
		if err := modelRows.Scan(&model, &requests, &price); err != nil {
			d.internalError(c, "scan platform usage by model failed", err)
			return
		}
		byModel = append(byModel, gin.H{
			"resolved_model": model, "requests": requests, "price_micro": price,
		})
	}

	c.JSON(http.StatusOK, gin.H{"daily": daily, "by_model": byModel})
}

type putPlatformModelRequest struct {
	ModelID          string `json:"model_id"`
	Vendor           string `json:"vendor"`
	DisplayName      string `json:"display_name"`
	Region           string `json:"region"`
	Capabilities     string `json:"capabilities"`
	ContextTokens    int64  `json:"context_tokens"`
	Status           string `json:"status"`
	InputMicroPer1M  int64  `json:"input_micro_per_1m"`
	OutputMicroPer1M int64  `json:"output_micro_per_1m"`
	MarkupBP         int64  `json:"markup_bp"`
}

// PutPlatformModel POST /api/v1/platform/models/upsert（仅 super_admin）
// model_id 放在请求体里：模型 id 形如 deepseek/deepseek-chat，含 / 无法作为 URL 路径段。
// catalog 行 upsert；价格有变化时追加一条新 platform_model_price（不 UPDATE 旧价）。
func (d Deps) PutPlatformModel(c *gin.Context) {
	var req putPlatformModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	modelID := strings.TrimSpace(req.ModelID)
	if !validPlatformModelID(modelID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_model_id", "message": "model_id 只允许小写字母、数字与 . _ / -"})
		return
	}
	req.Vendor = strings.TrimSpace(req.Vendor)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.Status = strings.TrimSpace(req.Status)
	if req.Vendor == "" || req.DisplayName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "vendor 与 display_name 不能为空"})
		return
	}
	if req.ContextTokens <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_context_tokens", "message": "context_tokens 必须大于 0"})
		return
	}
	if req.InputMicroPer1M < 0 || req.OutputMicroPer1M < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_price", "message": "价格不能为负数"})
		return
	}
	if req.MarkupBP < 1000 || req.MarkupBP > 3000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_markup", "message": "markup_bp 必须在 1000-3000 之间"})
		return
	}
	if req.Status != "active" && req.Status != "disabled" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_status", "message": "status 只允许 active 或 disabled"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin platform model tx failed", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO platform_model_catalog
		 (model_id, vendor, display_name, region, capabilities, context_tokens, status, external_only)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0)
		 ON DUPLICATE KEY UPDATE vendor = VALUES(vendor), display_name = VALUES(display_name),
		   region = VALUES(region), capabilities = VALUES(capabilities),
		   context_tokens = VALUES(context_tokens), status = VALUES(status)`,
		modelID, req.Vendor, req.DisplayName, req.Region, req.Capabilities,
		req.ContextTokens, req.Status); err != nil {
		d.internalError(c, "upsert platform model failed", err)
		return
	}

	now := time.Now().UnixMilli()
	var curInput, curOutput, curMarkup int64
	err = tx.QueryRowContext(ctx,
		`SELECT input_micro_per_1m, output_micro_per_1m, markup_bp FROM platform_model_price
		 WHERE model_id = ? AND effective_from <= ?
		 ORDER BY effective_from DESC LIMIT 1`, modelID, now).
		Scan(&curInput, &curOutput, &curMarkup)
	priceChanged := errors.Is(err, sql.ErrNoRows) ||
		(err == nil && (curInput != req.InputMicroPer1M || curOutput != req.OutputMicroPer1M || curMarkup != req.MarkupBP))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		d.internalError(c, "read current platform price failed", err)
		return
	}
	if priceChanged {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO platform_model_price
			 (model_id, input_micro_per_1m, output_micro_per_1m, markup_bp, effective_from)
			 VALUES (?, ?, ?, ?, ?)`,
			modelID, req.InputMicroPer1M, req.OutputMicroPer1M, req.MarkupBP, now); err != nil {
			d.internalError(c, "append platform price failed", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit platform model tx failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type putPlatformKeyRequest struct {
	Name               string  `json:"name"`
	AllowedModels      *string `json:"allowed_models"`
	MonthlyBudgetMicro int64   `json:"monthly_budget_micro"`
	QPSLimit           int     `json:"qps_limit"`
	IPAllowlist        *string `json:"ip_allowlist"`
}

// PutPlatformKey PUT /api/v1/platform/keys/:id（仅 super_admin）
// 仅允许修改未吊销的 key；key_hash 不可改、不可读。
func (d Deps) PutPlatformKey(c *gin.Context) {
	keyID := c.Param("id")

	var req putPlatformKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_name", "message": "name 长度必须为 1-64 个字符"})
		return
	}
	if req.QPSLimit < 1 || req.QPSLimit > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_qps", "message": "qps_limit 必须在 1-1000 之间"})
		return
	}
	if req.MonthlyBudgetMicro < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_budget", "message": "monthly_budget_micro 不能为负数"})
		return
	}

	var allowedModels, ipAllowlist any
	if req.AllowedModels != nil {
		v := strings.TrimSpace(*req.AllowedModels)
		if v != "" {
			if utf8.RuneCountInString(v) > 512 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "bad_allowed_models", "message": "allowed_models 不能超过 512 个字符"})
				return
			}
			allowedModels = v
		}
	}
	if req.IPAllowlist != nil {
		v := strings.TrimSpace(*req.IPAllowlist)
		if v != "" {
			if utf8.RuneCountInString(v) > 512 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "bad_ip_allowlist", "message": "ip_allowlist 不能超过 512 个字符"})
				return
			}
			ipAllowlist = v
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var revokedAt sql.NullInt64
	err := d.DB.QueryRowContext(ctx,
		"SELECT revoked_at FROM platform_api_keys WHERE id = ?", keyID).Scan(&revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "API Key 不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read platform key failed", err)
		return
	}
	if revokedAt.Valid {
		c.JSON(http.StatusConflict, gin.H{"error": "key_revoked", "message": "该 API Key 已吊销，不能再修改"})
		return
	}

	if _, err := d.DB.ExecContext(ctx,
		`UPDATE platform_api_keys SET name = ?, allowed_models = ?, monthly_budget_micro = ?,
		 qps_limit = ?, ip_allowlist = ? WHERE id = ? AND revoked_at IS NULL`,
		name, allowedModels, req.MonthlyBudgetMicro, req.QPSLimit, ipAllowlist, keyID); err != nil {
		d.internalError(c, "update platform key failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RevokePlatformKey POST /api/v1/platform/keys/:id/revoke（仅 super_admin）
// 幂等：已吊销直接返回成功。
func (d Deps) RevokePlatformKey(c *gin.Context) {
	keyID := c.Param("id")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	now := time.Now().UnixMilli()
	res, err := d.DB.ExecContext(ctx,
		"UPDATE platform_api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", now, keyID)
	if err != nil {
		d.internalError(c, "revoke platform key failed", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		c.JSON(http.StatusOK, gin.H{"ok": true, "revoked_at": now})
		return
	}

	var revokedAt sql.NullInt64
	err = d.DB.QueryRowContext(ctx,
		"SELECT revoked_at FROM platform_api_keys WHERE id = ?", keyID).Scan(&revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "API Key 不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read platform key failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "revoked_at": platformNullableInt64(revokedAt)})
}

type topupPlatformWalletRequest struct {
	AmountMicro int64  `json:"amount_micro"`
	Note        string `json:"note"`
}

// TopupPlatformWallet POST /api/v1/platform/wallets/:userId/topup（仅 super_admin）
// 事务内建行 → FOR UPDATE → 加余额与累计充值 → 追加 topup 账本。
func (d Deps) TopupPlatformWallet(c *gin.Context) {
	userID := c.Param("userId")

	var req topupPlatformWalletRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	if req.AmountMicro < 1 || req.AmountMicro > 100000000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_amount", "message": "amount_micro 必须在 1-100000000 之间（1 元~100 元）"})
		return
	}
	note := strings.TrimSpace(req.Note)
	if utf8.RuneCountInString(note) > 255 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_note", "message": "note 不能超过 255 个字符"})
		return
	}
	var noteValue any
	if note != "" {
		noteValue = note
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin platform topup tx failed", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UnixMilli()
	if _, err := tx.ExecContext(ctx,
		`INSERT IGNORE INTO platform_wallets
		 (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at)
		 VALUES (?, 0, 0, 0, ?)`, userID, now); err != nil {
		d.internalError(c, "ensure platform wallet failed", err)
		return
	}

	var balance, frozen, totalTopup int64
	if err := tx.QueryRowContext(ctx,
		`SELECT balance_micro, frozen_micro, total_topup_micro FROM platform_wallets
		 WHERE user_id = ? FOR UPDATE`, userID).Scan(&balance, &frozen, &totalTopup); err != nil {
		d.internalError(c, "lock platform wallet failed", err)
		return
	}

	newBalance := balance + req.AmountMicro
	newTotalTopup := totalTopup + req.AmountMicro
	if _, err := tx.ExecContext(ctx,
		`UPDATE platform_wallets SET balance_micro = ?, total_topup_micro = ?, updated_at = ?
		 WHERE user_id = ?`, newBalance, newTotalTopup, now, userID); err != nil {
		d.internalError(c, "update platform wallet failed", err)
		return
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO platform_ledger
		 (user_id, key_id, request_id, type, delta_micro, balance_after, note, created_at)
		 VALUES (?, NULL, NULL, 'topup', ?, ?, ?, ?)`,
		userID, req.AmountMicro, newBalance, noteValue, now); err != nil {
		d.internalError(c, "insert platform ledger failed", err)
		return
	}

	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit platform topup tx failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"user_id": userID, "balance_micro": newBalance,
		"frozen_micro": frozen, "total_topup_micro": newTotalTopup,
	})
}
