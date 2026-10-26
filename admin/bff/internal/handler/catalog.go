package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/catalog"
	"openelf-admin-bff/internal/middleware"
)

// catalogOverride payment_objects kind='catalog_override' 的 payload 结构。
type catalogOverride struct {
	PriceDiamonds *int64 `json:"price_diamonds"`
	Listed        *bool  `json:"listed"`
}

// GetCatalog GET /api/v1/catalog?env=
// 硬编码镜像（commerce.js MODULES/MODULE_PRICES）+ kind='catalog_override' 覆盖记录合并。
// price_diamonds 为生效价（有覆盖取覆盖）；override 为原始覆盖记录（无则 null）。
func (d Deps) GetCatalog(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// 读全部覆盖记录
	overrides := map[string]catalogOverride{}
	overrideUpdatedAt := map[string]string{}
	rows, err := d.DB.QueryContext(ctx,
		`SELECT object_id, payload, updated_at FROM payment_objects
		 WHERE environment = ? AND kind = 'catalog_override'`, env)
	if err != nil {
		d.internalError(c, "list catalog overrides failed", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var oid, payload, updatedAt string
		if err := rows.Scan(&oid, &payload, &updatedAt); err != nil {
			d.internalError(c, "scan catalog overrides failed", err)
			return
		}
		var ov catalogOverride
		if err := json.Unmarshal([]byte(payload), &ov); err != nil {
			continue // 忽略坏行，不阻断整个目录
		}
		overrides[oid] = ov
		overrideUpdatedAt[oid] = updatedAt
	}

	// 按 id 排序输出，保证顺序稳定
	ids := make([]string, 0, len(catalog.Modules))
	for id := range catalog.Modules {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	modules := make([]gin.H, 0, len(ids))
	for _, id := range ids {
		m := catalog.Modules[id]
		price := catalog.ModulePrices[id]
		ov, has := overrides[id]
		var overrideJSON any
		if has {
			overrideJSON = gin.H{
				"price_diamonds": ov.PriceDiamonds, "listed": ov.Listed,
				"updated_at": overrideUpdatedAt[id],
			}
			if ov.PriceDiamonds != nil {
				price = *ov.PriceDiamonds
			}
		} else {
			overrideJSON = nil
		}
		modules = append(modules, gin.H{
			"id": id, "track": m.Track, "label": id,
			"slot": m.Slot, "token_cost": m.TokenCost,
			"price_diamonds": price, "override": overrideJSON,
		})
	}
	c.JSON(http.StatusOK, gin.H{"modules": modules})
}

type putCatalogModuleRequest struct {
	Environment   string `json:"environment" binding:"required"`
	PriceDiamonds *int64 `json:"price_diamonds"`
	Listed        *bool  `json:"listed"`
}

// PutCatalogModule PUT /api/v1/catalog/modules/:id（仅 super_admin）
// 写 payment_objects kind='catalog_override', object_id=模块 id；
// INSERT ... ON DUPLICATE KEY UPDATE，与 Node tx.put 语义一致。
func (d Deps) PutCatalogModule(c *gin.Context) {
	moduleID := c.Param("id")
	if _, ok := catalog.ModulePrices[moduleID]; !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "模块不存在"})
		return
	}

	var req putCatalogModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法（environment 必填）"})
		return
	}
	if !envBody(c, req.Environment) {
		return
	}
	if req.PriceDiamonds == nil && req.Listed == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "price_diamonds 与 listed 至少提供一个"})
		return
	}
	if req.PriceDiamonds != nil && (*req.PriceDiamonds < 0 || *req.PriceDiamonds > 1000000) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_price", "message": "价格超出允许范围"})
		return
	}

	payload, err := json.Marshal(gin.H{
		"moduleId": moduleID, "price_diamonds": req.PriceDiamonds, "listed": req.Listed,
		"updatedBy": c.GetString(middleware.CtxActorName),
	})
	if err != nil {
		d.internalError(c, "marshal catalog override failed", err)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	_, err = d.DB.ExecContext(ctx,
		`INSERT INTO payment_objects (environment, kind, object_id, owner_id, ref_id, state, payload, updated_at)
		 VALUES (?, 'catalog_override', ?, NULL, NULL, 'active', ?, ?)
		 ON DUPLICATE KEY UPDATE state = VALUES(state), payload = VALUES(payload), updated_at = VALUES(updated_at)`,
		req.Environment, moduleID, string(payload),
		time.Now().UTC().Format("2006-01-02T15:04:05.000Z"))
	if err != nil {
		d.internalError(c, "put catalog override failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
