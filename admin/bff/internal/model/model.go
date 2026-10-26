package model

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"time"
)

// 三角色（固定，不引入 Casbin）。
const (
	RoleSuperAdmin = "super_admin"
	RoleModerator  = "moderator"
	RoleOperator   = "operator"
)

// ValidRoles 供创建账号等场景校验。
var ValidRoles = map[string]bool{
	RoleSuperAdmin: true,
	RoleModerator:  true,
	RoleOperator:   true,
}

// 交易环境（与 server/src/payment_store.js 的 tables() 一致，仅允许这两个取值）。
const (
	EnvProduction = "Production"
	EnvSandbox    = "Sandbox"
)

// ValidEnv 强校验 env 参数。
func ValidEnv(env string) bool {
	return env == EnvProduction || env == EnvSandbox
}

// AdminUser 后台账号，存于 admin_users 表。
// PwdChangedAt 用于"改密后旧 JWT 立即失效"：签发时间早于此时间的 token 一律拒绝。
type AdminUser struct {
	ID           string       `json:"id"`
	Username     string       `json:"username"`
	PasswordHash string       `json:"-"`
	Role         string       `json:"role"`
	CreatedAt    time.Time    `json:"created_at"`
	PwdChangedAt sql.NullTime `json:"-"`
}

// AuditLog 审计日志，存于 admin_audit_logs 表。
type AuditLog struct {
	ID        string    `json:"id"`
	ActorID   string    `json:"actor_id"`
	ActorName string    `json:"actor_name"`
	Role      string    `json:"role"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Status    int       `json:"status"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"ua"`
	CreatedAt time.Time `json:"created_at"`
}

// NewID 生成 128 位随机十六进制 ID（admin_users/admin_audit_logs 主键）。
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand 失败意味着系统级熵源异常，继续运行已无安全意义。
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
