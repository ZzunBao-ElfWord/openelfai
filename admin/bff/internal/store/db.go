// Package store 负责 MySQL 连接与后台自有表的兜底建表。
package store

import (
	"context"
	"database/sql"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// 后台自有表 DDL（与 deploy/mysql-admin-init.sql 保持一致；启动时兜底创建）。
var adminTables = []string{
	`CREATE TABLE IF NOT EXISTS admin_users (
	  id CHAR(32) PRIMARY KEY,
	  username VARCHAR(64) NOT NULL UNIQUE,
	  password_hash VARCHAR(80) NOT NULL,
	  role VARCHAR(16) NOT NULL,
	  pwd_changed_at DATETIME(3) NULL,
	  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
	`CREATE TABLE IF NOT EXISTS admin_audit_logs (
	  id CHAR(32) PRIMARY KEY,
	  actor_id VARCHAR(40) NOT NULL DEFAULT '',
	  actor_name VARCHAR(64) NOT NULL DEFAULT '',
	  role VARCHAR(16) NOT NULL DEFAULT '',
	  method VARCHAR(8) NOT NULL,
	  path VARCHAR(255) NOT NULL,
	  status INT NOT NULL,
	  ip VARCHAR(64) NOT NULL DEFAULT '',
	  ua VARCHAR(255) NOT NULL DEFAULT '',
	  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	  INDEX idx_admin_audit_created (created_at),
	  INDEX idx_admin_audit_actor (actor_name)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
}

// Connect 建立连接池并兜底创建后台自有表。
func Connect(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}

	for _, ddl := range adminTables {
		ddlCtx, ddlCancel := context.WithTimeout(ctx, 10*time.Second)
		if _, err := db.ExecContext(ddlCtx, ddl); err != nil {
			ddlCancel()
			_ = db.Close()
			return nil, err
		}
		ddlCancel()
	}
	return db, nil
}
