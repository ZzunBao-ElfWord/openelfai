package router

import (
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/handler"
	"openelf-admin-bff/internal/middleware"
	"openelf-admin-bff/internal/model"
	"openelf-admin-bff/internal/web"
)

// New 组装全部路由。
func New(d handler.Deps) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(requestLogger(d))
	r.Use(corsMiddleware(d.Cfg.CORSOrigins))

	// 健康检查（容器/反代探活）
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true, "ts": time.Now().Unix()})
	})

	api := r.Group("/api/v1")

	// 公开：登录（限流 5 次/分钟/IP）
	api.POST("/auth/login", middleware.RateLimit(5, time.Minute), d.Login)
	// 公开：运营素材读取（文件名即内容哈希，可长期缓存）
	api.GET("/assets/:name", d.GetAsset)

	// 需登录
	authed := api.Group("")
	authed.Use(middleware.JWTAuth(d.Cfg.JWTSecret, d.Cfg.AllowedIPs, d.DB))
	authed.Use(middleware.Audit(d.DB, d.Log))

	authed.GET("/auth/me", d.Me)
	// 修改自己的密码（三角色均可）
	authed.POST("/auth/change-password", d.ChangePassword)

	// 数据看板与服务健康：三角色均可
	allRoles := middleware.RequireRole(model.RoleSuperAdmin, model.RoleModerator, model.RoleOperator)
	authed.GET("/stats/overview", allRoles, d.StatsOverview)
	authed.GET("/system/health", allRoles, d.SystemHealth)

	// 业务管理能力：super / moderator
	modOnly := middleware.RequireRole(model.RoleSuperAdmin, model.RoleModerator)
	{
		authed.GET("/users", modOnly, d.ListUsers)
		authed.GET("/users/:id", modOnly, d.UserDetail)
		authed.POST("/users/:id/status", modOnly, d.SetUserStatus)

		authed.GET("/wallets/:userId", modOnly, d.GetWallet)
		authed.GET("/ledger", modOnly, d.ListLedger)

		authed.GET("/orders/alipay", modOnly, d.ListAlipayOrders)
		authed.GET("/orders/apple", modOnly, d.ListAppleOrders)
		authed.GET("/orders/reviews", modOnly, d.ListReviews)

		authed.GET("/elves", modOnly, d.ListElves)
		authed.GET("/elves/:id", modOnly, d.GetElf)
		authed.GET("/official/elves", modOnly, d.ListOfficialElves)

		authed.GET("/listings", modOnly, d.ListListings)
		authed.GET("/posts", modOnly, d.ListPosts)
		authed.DELETE("/posts/:id", modOnly, d.DeletePost)

		authed.GET("/catalog", modOnly, d.GetCatalog)

		authed.GET("/platform/models", modOnly, d.ListPlatformModels)
		authed.GET("/platform/developers", modOnly, d.ListPlatformDevelopers)
		authed.GET("/platform/keys", modOnly, d.ListPlatformKeys)
		authed.GET("/platform/wallets/:userId", modOnly, d.GetPlatformWallet)
		authed.GET("/platform/requests", modOnly, d.ListPlatformRequests)
		authed.GET("/platform/usage", modOnly, d.ListPlatformUsage)
		authed.GET("/platform/vendors", modOnly, d.ListPlatformVendors)
	}

	// 高危操作：仅 super_admin
	superOnly := middleware.RequireRole(model.RoleSuperAdmin)
	{
		authed.POST("/wallet/adjust", superOnly, d.WalletAdjust)
		authed.POST("/orders/reviews/:id/resolve", superOnly, d.ResolveReview)
		authed.POST("/elves/:id/state", superOnly, d.SetElfState)
		authed.PUT("/catalog/modules/:id", superOnly, d.PutCatalogModule)

		// 官方 AI 运营：素材上传 + 建档 + 更新
		authed.POST("/assets", superOnly, d.UploadAsset)
		authed.POST("/official/elves", superOnly, d.CreateOfficialElf)
		authed.PUT("/official/elves/:id", superOnly, d.UpdateOfficialElf)

		authed.POST("/platform/models/upsert", superOnly, d.PutPlatformModel)
		authed.PUT("/platform/keys/:id", superOnly, d.PutPlatformKey)
		authed.POST("/platform/keys/:id/revoke", superOnly, d.RevokePlatformKey)
		authed.POST("/platform/wallets/:userId/topup", superOnly, d.TopupPlatformWallet)
		authed.PUT("/platform/vendors/:vendor", superOnly, d.PutPlatformVendorCredential)
		authed.POST("/platform/vendors/:vendor/test", superOnly, d.TestPlatformVendor)

		authed.GET("/admin-users", superOnly, d.ListAdminUsers)
		authed.POST("/admin-users", superOnly, d.CreateAdminUser)
		authed.PUT("/admin-users/:id/password", superOnly, d.ResetAdminPassword)
		authed.DELETE("/admin-users/:id", superOnly, d.DeleteAdminUser)
	}

	// 审计：super / operator
	authed.GET("/audit",
		middleware.RequireRole(model.RoleSuperAdmin, model.RoleOperator),
		d.ListAudit)
	authed.GET("/audit/export.csv",
		middleware.RequireRole(model.RoleSuperAdmin, model.RoleOperator),
		d.ExportAuditCSV)

	serveFrontend(r)
	return r
}

func serveFrontend(r *gin.Engine) {
	sub, err := web.Dist()
	if err != nil {
		return
	}
	indexHTML, indexErr := fs.ReadFile(sub, "index.html")
	fileServer := http.FileServer(http.FS(sub))

	r.NoRoute(func(c *gin.Context) {
		p := c.Request.URL.Path
		if strings.HasPrefix(p, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "接口不存在"})
			return
		}

		rel := strings.TrimPrefix(p, "/")
		if rel == "" {
			rel = "index.html"
		}
		if f, openErr := sub.Open(rel); openErr == nil {
			_ = f.Close()
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}

		// 非静态资源路径一律回退 index.html（前端路由 SPA fallback）
		if indexErr == nil {
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
			return
		}
		c.String(http.StatusNotFound, "admin frontend not built")
	})
}

// requestLogger 轻量访问日志（slog JSON）。
func requestLogger(d handler.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		d.Log.Info("http",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"cost_ms", time.Since(start).Milliseconds(),
			"ip", c.ClientIP())
	}
}

// corsMiddleware 仅放行配置中的来源；生产同源不需要 CORS。
func corsMiddleware(allowed []string) gin.HandlerFunc {
	allow := make(map[string]bool, len(allowed))
	for _, o := range allowed {
		allow[o] = true
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && allow[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
