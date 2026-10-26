package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireRole 必须在 JWTAuth 之后使用。
func RequireRole(allowed ...string) gin.HandlerFunc {
	allow := make(map[string]bool, len(allowed))
	for _, r := range allowed {
		allow[r] = true
	}
	return func(c *gin.Context) {
		role, _ := c.Get(CtxRole)
		roleStr, _ := role.(string)
		if !allow[roleStr] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "forbidden", "message": "当前角色无权执行该操作",
			})
			return
		}
		c.Next()
	}
}
