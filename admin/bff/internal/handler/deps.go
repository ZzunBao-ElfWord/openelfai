package handler

import (
	"database/sql"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/config"
	"openelf-admin-bff/internal/ledger"
	"openelf-admin-bff/internal/model"
)

// Deps 全部 handler 共享的依赖，main 中构造一次。
// handler 不允许自建 MySQL 连接或持有全局变量。
type Deps struct {
	Cfg    *config.Config
	Log    *slog.Logger
	DB     *sql.DB
	Ledger *ledger.Store
}

// envParam 读取并强校验 env 参数；缺省为 Production。
// 校验失败时已写入 400 响应，返回 ok=false。
func envParam(c *gin.Context) (string, bool) {
	env := c.DefaultQuery("env", model.EnvProduction)
	if env == "" {
		env = model.EnvProduction
	}
	if !model.ValidEnv(env) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_environment", "message": "环境参数只允许 Production 或 Sandbox"})
		return "", false
	}
	return env, true
}

// envBody 校验请求体里的 environment 字段。
func envBody(c *gin.Context, env string) bool {
	if !model.ValidEnv(env) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_environment", "message": "环境参数只允许 Production 或 Sandbox"})
		return false
	}
	return true
}

// pageParams 解析分页参数：page 默认 1，page_size 默认 20、上限 100。
func pageParams(c *gin.Context, defSize, maxSize int) (page, pageSize, offset int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ = strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(defSize)))
	if pageSize < 1 || pageSize > maxSize {
		pageSize = defSize
	}
	return page, pageSize, (page - 1) * pageSize
}

// internalError 统一 500 响应并记日志（不向前端泄露内部错误细节）。
func (d Deps) internalError(c *gin.Context, msg string, err error) {
	d.Log.Error(msg, "error", err, "path", c.Request.URL.Path)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": "服务内部错误"})
}
