package handler

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// auditFilter 组装审计查询条件：method 精确、actor 模糊（姓名或 ID）、q 路径关键字。
func auditFilter(c *gin.Context) (string, []any) {
	where := []string{"1=1"}
	args := make([]any, 0)
	if m := strings.ToUpper(strings.TrimSpace(c.Query("method"))); m != "" {
		where = append(where, "method = ?")
		args = append(args, m)
	}
	if actor := strings.TrimSpace(c.Query("actor")); actor != "" {
		where = append(where, "(actor_name LIKE ? OR actor_id = ?)")
		args = append(args, "%"+actor+"%", actor)
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		where = append(where, "path LIKE ?")
		args = append(args, "%"+q+"%")
	}
	return strings.Join(where, " AND "), args
}

// ListAudit GET /api/v1/audit?page=1&page_size=50&method=DELETE&actor=admin&q=/users
func (d Deps) ListAudit(c *gin.Context) {
	page, pageSize, offset := pageParams(c, 50, 200)
	cond, args := auditFilter(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var total int64
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM admin_audit_logs WHERE "+cond, args...).Scan(&total); err != nil {
		d.internalError(c, "count audit failed", err)
		return
	}

	args2 := append(append([]any{}, args...), pageSize, offset)
	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, actor_id, actor_name, role, method, path, status, ip, ua, created_at
		 FROM admin_audit_logs WHERE `+cond+`
		 ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`, args2...)
	if err != nil {
		d.internalError(c, "list audit failed", err)
		return
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, actorID, actorName, role, method, path, ip, ua string
		var status int
		var createdAt time.Time
		if err := rows.Scan(&id, &actorID, &actorName, &role, &method, &path, &status, &ip, &ua, &createdAt); err != nil {
			d.internalError(c, "scan audit failed", err)
			return
		}
		items = append(items, gin.H{
			"id": id, "actor_id": actorID, "actor_name": actorName, "role": role,
			"method": method, "path": path, "status": status, "ip": ip, "ua": ua,
			"created_at": createdAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// ExportAuditCSV GET /api/v1/audit/export.csv（与列表同筛选，最多导出 5000 行）
func (d Deps) ExportAuditCSV(c *gin.Context) {
	cond, args := auditFilter(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, actor_id, actor_name, role, method, path, status, ip, ua, created_at
		 FROM admin_audit_logs WHERE `+cond+`
		 ORDER BY created_at DESC, id ASC LIMIT 5000`, args...)
	if err != nil {
		d.internalError(c, "export audit failed", err)
		return
	}
	defer rows.Close()

	filename := "audit-" + time.Now().UTC().Format("20060102-150405") + ".csv"
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	w := csv.NewWriter(c.Writer)
	_ = w.Write([]string{"id", "actor_id", "actor_name", "role", "method", "path", "status", "ip", "ua", "created_at"})
	for rows.Next() {
		var id, actorID, actorName, role, method, path, ip, ua string
		var status int
		var createdAt time.Time
		if err := rows.Scan(&id, &actorID, &actorName, &role, &method, &path, &status, &ip, &ua, &createdAt); err != nil {
			break
		}
		_ = w.Write([]string{id, actorID, actorName, role, method, path,
			strconv.Itoa(status), ip, ua, createdAt.UTC().Format(time.RFC3339)})
	}
	w.Flush()
}
