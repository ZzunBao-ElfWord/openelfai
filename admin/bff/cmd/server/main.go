package main

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"time"

	"openelf-admin-bff/internal/auth"
	"openelf-admin-bff/internal/config"
	"openelf-admin-bff/internal/handler"
	"openelf-admin-bff/internal/ledger"
	"openelf-admin-bff/internal/model"
	"openelf-admin-bff/internal/router"
	"openelf-admin-bff/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	cfg := config.Load()
	if cfg.MysqlDSN == "" {
		log.Error("MYSQL_DSN 未配置，无法启动")
		os.Exit(1)
	}
	if cfg.JWTSecret == "" {
		log.Error("JWT_SECRET 未配置，无法启动")
		os.Exit(1)
	}

	ctx := context.Background()

	db, err := store.Connect(ctx, cfg.MysqlDSN)
	if err != nil {
		log.Error("连接 MySQL 失败", "error", err)
		os.Exit(1)
	}
	log.Info("MySQL 已连接")

	bootstrapAdmin(ctx, cfg, db, log)

	seedCtx, seedCancel := context.WithTimeout(ctx, 10*time.Second)
	if err := handler.SeedAppContentDefaults(seedCtx, db); err != nil {
		log.Warn("运营配置默认值写入失败，配置页可能为空", "error", err)
	}
	seedCancel()

	deps := handler.Deps{
		Cfg:    cfg,
		Log:    log,
		DB:     db,
		Ledger: ledger.New(db),
	}

	r := router.New(deps)
	addr := cfg.ListenHost + ":" + cfg.Port
	log.Info("openelf-admin 启动", "addr", addr)
	if err := r.Run(addr); err != nil {
		log.Error("HTTP 服务退出", "error", err)
		os.Exit(1)
	}
}

// bootstrapAdmin 若配置了 BOOTSTRAP_ADMIN_* 且账号表为空，创建首个 super_admin（幂等）。
func bootstrapAdmin(ctx context.Context, cfg *config.Config, db *sql.DB, log *slog.Logger) {
	if cfg.BootstrapUsername == "" || cfg.BootstrapPassword == "" {
		return
	}

	countCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var n int
	if err := db.QueryRowContext(countCtx, "SELECT COUNT(*) FROM admin_users").Scan(&n); err != nil {
		log.Warn("统计后台账号失败，跳过种子", "error", err)
		return
	}
	if n > 0 {
		return
	}

	hash, err := auth.HashPassword(cfg.BootstrapPassword)
	if err != nil {
		log.Error("种子超管密码哈希失败", "error", err)
		return
	}
	insertCtx, cancelInsert := context.WithTimeout(ctx, 5*time.Second)
	defer cancelInsert()
	_, err = db.ExecContext(insertCtx,
		"INSERT INTO admin_users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
		model.NewID(), cfg.BootstrapUsername, hash, model.RoleSuperAdmin, time.Now().UTC())
	if err != nil {
		log.Error("种子超管创建失败", "error", err)
		return
	}
	log.Info("已创建初始超级管理员，请尽快登录并在生产环境清空 BOOTSTRAP_ADMIN_* 环境变量",
		"username", cfg.BootstrapUsername)
}
