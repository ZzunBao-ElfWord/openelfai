package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// SystemHealth GET /api/v1/system/health（三角色均可）
// 探测 MySQL 与 Node 业务 API；只返回可用性与延迟，不含任何凭据。
func (d Deps) SystemHealth(c *gin.Context) {
	// MySQL
	mysqlStart := time.Now()
	mysqlOK := true
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	if err := d.DB.PingContext(ctx); err != nil {
		mysqlOK = false
	}
	cancel()
	mysqlLatency := time.Since(mysqlStart).Milliseconds()

	// Node 业务 API
	nodeOK := false
	nodeStatus := 0
	nodeStart := time.Now()
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(d.Cfg.NodeAPIHealthURL)
	if err == nil {
		nodeStatus = resp.StatusCode
		nodeOK = resp.StatusCode >= 200 && resp.StatusCode < 300
		_ = resp.Body.Close()
	}
	nodeLatency := time.Since(nodeStart).Milliseconds()

	c.JSON(http.StatusOK, gin.H{
		"mysql":    gin.H{"ok": mysqlOK, "latency_ms": mysqlLatency},
		"node_api": gin.H{"ok": nodeOK, "status_code": nodeStatus, "latency_ms": nodeLatency},
	})
}
