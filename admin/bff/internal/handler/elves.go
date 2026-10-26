package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// listObjects payment_objects 通用分页查询（kind 由调用方给定白名单值）。
// 返回 object_id/owner_id/state/ref_id/updated_at + payload 原样 JSON。
func (d Deps) listObjects(c *gin.Context, env, kind string, extraWhere []string, extraArgs []any) {
	page, pageSize, offset := pageParams(c, 20, 100)

	where := append([]string{"environment = ?", "kind = ?"}, extraWhere...)
	args := append([]any{env, kind}, extraArgs...)
	cond := strings.Join(where, " AND ")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM payment_objects WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count objects failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT object_id, owner_id, state, ref_id, updated_at, payload
		 FROM payment_objects WHERE `+cond+`
		 ORDER BY updated_at DESC, object_id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list objects failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var oid, state, updatedAt, payload string
		var ownerID, refID sql.NullString
		if err := rows.Scan(&oid, &ownerID, &state, &refID, &updatedAt, &payload); err != nil {
			d.internalError(c, "scan objects failed", err)
			return
		}
		item := gin.H{
			"object_id": oid, "owner_id": ownerID.String, "state": state,
			"ref_id": refID.String, "updated_at": updatedAt,
			"payload": json.RawMessage(payload),
		}
		// 精灵列表附带官方标记，前端无需再取 payload
		if kind == "elf" {
			var probe struct {
				IsOfficial bool   `json:"isOfficial"`
				Name       string `json:"name"`
			}
			if json.Unmarshal([]byte(payload), &probe) == nil {
				item["is_official"] = probe.IsOfficial
				item["name"] = probe.Name
			}
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ListElves GET /api/v1/elves?env=&owner=&state=&q=&page=
// state 过滤 payload 内的 status（elf 对象的 state 列恒为空串，见 commerce.js saveElf）；
// q 按 payload.name 模糊匹配。
func (d Deps) ListElves(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}

	var where []string
	var args []any
	if owner := strings.TrimSpace(c.Query("owner")); owner != "" {
		where = append(where, "owner_id = ?")
		args = append(args, owner)
	}
	if state := strings.TrimSpace(c.Query("state")); state != "" {
		where = append(where, "JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) = ?")
		args = append(args, state)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		where = append(where, "JSON_UNQUOTE(JSON_EXTRACT(payload, '$.name')) LIKE ?")
		args = append(args, "%"+q+"%")
	}
	if c.Query("official") == "1" {
		where = append(where, "JSON_UNQUOTE(JSON_EXTRACT(payload, '$.isOfficial')) = 'true'")
	}
	d.listObjects(c, env, "elf", where, args)
}

// GetElf GET /api/v1/elves/:id?env=
// payload 完整 JSON 原样返回；附带 owner 基础信息。
func (d Deps) GetElf(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var oid, state, updatedAt, payload string
	var ownerID sql.NullString
	err := d.DB.QueryRowContext(ctx,
		`SELECT object_id, owner_id, state, updated_at, payload
		 FROM payment_objects WHERE environment = ? AND kind = 'elf' AND object_id = ?`,
		env, c.Param("id")).Scan(&oid, &ownerID, &state, &updatedAt, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "精灵不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "get elf failed", err)
		return
	}

	var owner gin.H
	if ownerID.Valid && ownerID.String != "" {
		var uid, nickname, phone string
		err := d.DB.QueryRowContext(ctx,
			"SELECT id, nickname, phone FROM users WHERE id = ?", ownerID.String).
			Scan(&uid, &nickname, &phone)
		if err == nil {
			owner = gin.H{"id": uid, "nickname": nickname, "phone": phone}
		} else if !errors.Is(err, sql.ErrNoRows) {
			d.internalError(c, "get elf owner failed", err)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"object_id": oid, "owner_id": ownerID.String, "state": state,
		"updated_at": updatedAt, "payload": json.RawMessage(payload), "owner": owner,
	})
}

type setElfStateRequest struct {
	Environment string `json:"environment" binding:"required"`
	State       string `json:"state" binding:"required,max=24"`
}

// SetElfState POST /api/v1/elves/:id/state（仅 super_admin）
// SELECT FOR UPDATE 改 state 列；payload 内的 status 字段同步改。
func (d Deps) SetElfState(c *gin.Context) {
	var req setElfStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法（environment/state 必填）"})
		return
	}
	if !envBody(c, req.Environment) {
		return
	}
	elfID := c.Param("id")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin tx failed", err)
		return
	}
	defer tx.Rollback()

	var payload string
	err = tx.QueryRowContext(ctx,
		`SELECT payload FROM payment_objects
		 WHERE environment = ? AND kind = 'elf' AND object_id = ? FOR UPDATE`,
		req.Environment, elfID).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "精灵不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "lock elf failed", err)
		return
	}

	// payload 内 status 字段同步（若存在）
	var doc map[string]any
	if err := json.Unmarshal([]byte(payload), &doc); err != nil {
		d.internalError(c, "parse elf payload failed", err)
		return
	}
	if _, has := doc["status"]; has {
		doc["status"] = req.State
	}
	newPayload, err := json.Marshal(doc)
	if err != nil {
		d.internalError(c, "marshal elf payload failed", err)
		return
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE payment_objects SET state = ?, payload = ?, updated_at = ?
		 WHERE environment = ? AND kind = 'elf' AND object_id = ?`,
		req.State, string(newPayload), time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		req.Environment, elfID); err != nil {
		d.internalError(c, "set elf state failed", err)
		return
	}
	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit elf state failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListListings GET /api/v1/listings?env=&state=&page=
func (d Deps) ListListings(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	var where []string
	var args []any
	if state := strings.TrimSpace(c.Query("state")); state != "" {
		where = append(where, "state = ?")
		args = append(args, state)
	}
	d.listObjects(c, env, "listing", where, args)
}

// ListPosts GET /api/v1/posts?env=&elf_id=&page=
// elf_id 对应 ref_id 列（commerce.js 发贴时 ref=elf.id）。
func (d Deps) ListPosts(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}
	var where []string
	var args []any
	if elfID := strings.TrimSpace(c.Query("elf_id")); elfID != "" {
		where = append(where, "ref_id = ?")
		args = append(args, elfID)
	}
	d.listObjects(c, env, "post", where, args)
}

// DeletePost DELETE /api/v1/posts/:id?env=（软删：state='deleted'）
func (d Deps) DeletePost(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	res, err := d.DB.ExecContext(ctx,
		`UPDATE payment_objects SET state = 'deleted', updated_at = ?
		 WHERE environment = ? AND kind = 'post' AND object_id = ?`,
		time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), env, c.Param("id"))
	if err != nil {
		d.internalError(c, "delete post failed", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "内容不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
