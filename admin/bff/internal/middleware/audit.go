package middleware

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/model"
)

// Audit 记录所有变更类请求（POST/PUT/PATCH/DELETE）。
// 只记录路由与结果，不记录请求体（避免把密码、处置理由之外的敏感数据落库）。
// 失败也记录（401/403 同样有审计价值）。
func Audit(db *sql.DB, log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		method := c.Request.Method
		if method == "GET" || method == "HEAD" || method == "OPTIONS" {
			return
		}
		path := c.Request.URL.Path
		if !strings.HasPrefix(path, "/api/v1/") ||
			strings.HasPrefix(path, "/api/v1/auth/login") {
			return
		}

		actorID, _ := c.Get(CtxActorID)
		actorName, _ := c.Get(CtxActorName)
		role, _ := c.Get(CtxRole)

		ua := c.Request.UserAgent()
		if len(ua) > 255 {
			ua = ua[:255]
		}

		// 审计写入失败不阻断请求，5 秒超时，仅记日志。
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := db.ExecContext(ctx,
			`INSERT INTO admin_audit_logs (id, actor_id, actor_name, role, method, path, status, ip, ua, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			model.NewID(), asString(actorID), asString(actorName), asString(role),
			method, path, c.Writer.Status(), c.ClientIP(), ua, time.Now().UTC())
		if err != nil && log != nil {
			log.Warn("audit insert failed", "error", err, "path", path)
		}
	}
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
