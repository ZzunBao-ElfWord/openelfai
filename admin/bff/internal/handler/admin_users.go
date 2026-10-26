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

// ListAdminUsers GET /api/v1/admin-users（仅 super_admin）
func (d Deps) ListAdminUsers(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		"SELECT id, username, role, created_at FROM admin_users ORDER BY created_at DESC")
	if err != nil {
		d.Log.Error("find admin users failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "查询后台账号失败"})
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, username, role string
		var createdAt time.Time
		if err := rows.Scan(&id, &username, &role, &createdAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "解析后台账号失败"})
			return
		}
		items = append(items, gin.H{"id": id, "username": username, "role": role, "created_at": createdAt})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type createAdminRequest struct {
	Username string `json:"username" binding:"required,min=2,max=64"`
	Password string `json:"password" binding:"required,min=10,max=128"`
	Role     string `json:"role" binding:"required"`
}

// CreateAdminUser POST /api/v1/admin-users（仅 super_admin）
func (d Deps) CreateAdminUser(c *gin.Context) {
	var req createAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "参数不合法（密码至少 10 位）"})
		return
	}
	if !model.ValidRoles[req.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_role", "message": "角色不存在"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var n int
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM admin_users WHERE username = ?", req.Username).Scan(&n); err == nil && n > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "conflict", "message": "用户名已存在"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "密码处理失败"})
		return
	}

	id := model.NewID()
	if _, err := d.DB.ExecContext(ctx,
		"INSERT INTO admin_users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
		id, req.Username, hash, req.Role, time.Now().UTC()); err != nil {
		d.Log.Error("create admin user failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true, "id": id})
}

type resetPasswordRequest struct {
	Password string `json:"password" binding:"required,min=10,max=128"`
}

// ResetAdminPassword PUT /api/v1/admin-users/:id/password（仅 super_admin）
// 重置任意后台账号密码；pwd_changed_at 使该账号既有 JWT 立即失效（见 middleware.JWTAuth）。
func (d Deps) ResetAdminPassword(c *gin.Context) {
	var req resetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "密码至少 10 位"})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "密码处理失败"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	res, err := d.DB.ExecContext(ctx,
		"UPDATE admin_users SET password_hash = ?, pwd_changed_at = ? WHERE id = ?",
		hash, time.Now().UTC(), c.Param("id"))
	if err != nil {
		d.Log.Error("reset admin password failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "重置失败"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "账号不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DeleteAdminUser DELETE /api/v1/admin-users/:id（仅 super_admin）
// 删除后台账号。安全约束：禁止删除自己；系统至少保留一个 super_admin。
// 删除后该账号既有 JWT 因中间件查不到记录而立即失效。
func (d Deps) DeleteAdminUser(c *gin.Context) {
	targetID := c.Param("id")
	actorID := c.GetString(middleware.CtxActorID)
	if targetID == actorID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "不能删除当前登录账号"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	var targetRole string
	err := d.DB.QueryRowContext(ctx,
		"SELECT role FROM admin_users WHERE id = ?", targetID).Scan(&targetRole)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "账号不存在"})
		return
	}
	// 禁止删除最后一个 super_admin
	if targetRole == model.RoleSuperAdmin {
		var n int
		if err := d.DB.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM admin_users WHERE role = ?", model.RoleSuperAdmin).Scan(&n); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "检查超管数量失败"})
			return
		} else if n <= 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "至少保留一个超级管理员账号"})
			return
		}
	}

	res, err := d.DB.ExecContext(ctx, "DELETE FROM admin_users WHERE id = ?", targetID)
	if err != nil {
		d.Log.Error("delete admin user failed", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "删除失败"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "账号不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
