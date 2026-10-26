package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/auth"
	"openelf-admin-bff/internal/middleware"
	"openelf-admin-bff/internal/model"
)

type loginRequest struct {
	Username string `json:"username" binding:"required,min=2,max=64"`
	Password string `json:"password" binding:"required,min=6,max=128"`
}

// Login POST /api/v1/auth/login
func (d Deps) Login(c *gin.Context) {
	// 登录来源 IP 白名单（.env ALLOWED_IPS，逗号分隔；为空不限制）
	if len(d.Cfg.AllowedIPs) > 0 && !d.Cfg.AllowedIPs[c.ClientIP()] {
		d.Log.Warn("login rejected by ip whitelist", "ip", c.ClientIP())
		c.JSON(http.StatusForbidden, gin.H{"error": "ip_not_allowed", "message": "当前网络环境不允许登录管理后台"})
		return
	}

	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "用户名或密码格式不正确"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var admin model.AdminUser
	err := d.DB.QueryRowContext(ctx,
		"SELECT id, username, password_hash, role, created_at FROM admin_users WHERE username = ?",
		req.Username).Scan(&admin.ID, &admin.Username, &admin.PasswordHash, &admin.Role, &admin.CreatedAt)
	if err != nil {
		// 不区分"账号不存在"与"密码错误"，避免枚举账号。
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials", "message": "用户名或密码错误"})
		return
	}
	if !auth.CheckPassword(admin.PasswordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials", "message": "用户名或密码错误"})
		return
	}

	token, err := auth.Issue(d.Cfg.JWTSecret, admin.ID, admin.Username, admin.Role, d.Cfg.JWTTTL)
	if err != nil {
		d.Log.Error("issue jwt failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "登录服务异常"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  gin.H{"id": admin.ID, "username": admin.Username, "role": admin.Role},
	})
}

// Me GET /api/v1/auth/me
func (d Deps) Me(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var createdAt time.Time
	err := d.DB.QueryRowContext(ctx,
		"SELECT created_at FROM admin_users WHERE id = ?",
		c.GetString(middleware.CtxActorID)).Scan(&createdAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "账号不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         c.GetString(middleware.CtxActorID),
		"username":   c.GetString(middleware.CtxActorName),
		"role":       c.GetString(middleware.CtxRole),
		"created_at": createdAt,
	})
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=10,max=128"`
}

// ChangePassword POST /api/v1/auth/change-password
// 登录用户修改自己的密码（三角色均可），需验证旧密码。
func (d Deps) ChangePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "新密码至少 10 位"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var admin model.AdminUser
	err := d.DB.QueryRowContext(ctx,
		"SELECT id, password_hash FROM admin_users WHERE id = ?",
		c.GetString(middleware.CtxActorID)).Scan(&admin.ID, &admin.PasswordHash)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "账号不存在"})
		return
	}
	if !auth.CheckPassword(admin.PasswordHash, req.OldPassword) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_old_password", "message": "旧密码不正确"})
		return
	}

	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "密码处理失败"})
		return
	}
	// pwd_changed_at 驱动"改密后旧 JWT 立即失效"（见 middleware.JWTAuth）
	if _, err := d.DB.ExecContext(ctx,
		"UPDATE admin_users SET password_hash = ?, pwd_changed_at = ? WHERE id = ?",
		hash, time.Now().UTC(), admin.ID); err != nil {
		d.Log.Error("change password failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "修改失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
