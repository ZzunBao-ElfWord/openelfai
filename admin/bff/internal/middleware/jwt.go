package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/auth"
)

// Gin context 键名，handler 与审计中间件共用。
const (
	CtxActorID   = "actorID"
	CtxActorName = "actorName"
	CtxRole      = "role"
)

// JWTAuth 校验 Authorization: Bearer <token>。
// 额外校验：① ALLOWED_IPS 来源白名单；② 账号存在性；
// ③ "改密失效"：token 签发时间早于账号 pwd_changed_at 时拒绝。
// 后台 QPS 极低，每次请求实时查库，实时性优先于缓存。
func JWTAuth(secret string, allowedIPs map[string]bool, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if len(allowedIPs) > 0 && !allowedIPs[c.ClientIP()] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "ip_not_allowed", "message": "当前网络环境不允许访问管理后台",
			})
			return
		}

		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized", "message": "缺少登录凭证",
			})
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		claims, err := auth.Parse(secret, token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized", "message": "登录已失效，请重新登录",
			})
			return
		}

		// 账号存在性 + 改密后旧 token 失效
		if claims.IssuedAt != nil {
			ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
			defer cancel()
			var pwdChangedAt sql.NullTime
			err := db.QueryRowContext(ctx,
				"SELECT pwd_changed_at FROM admin_users WHERE id = ?", claims.Subject).Scan(&pwdChangedAt)
			if err != nil {
				// 账号已被删除等情况：拒绝
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error": "unauthorized", "message": "账号状态异常，请重新登录",
				})
				return
			}
			if pwdChangedAt.Valid && claims.IssuedAt.Time.Before(pwdChangedAt.Time) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error": "unauthorized", "message": "密码已修改，请重新登录",
				})
				return
			}
		}

		c.Set(CtxActorID, claims.Subject)
		c.Set(CtxActorName, claims.Username)
		c.Set(CtxRole, claims.Role)
		c.Next()
	}
}
