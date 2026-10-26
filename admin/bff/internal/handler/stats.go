package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// 业务表时间列均为 VARCHAR ISO 字符串（UTC），用字符串范围比较做统计。
// isoDayStart 返回某天 UTC 00:00 的 ISO 串（与 Node new Date().toISOString() 同格式）。
func isoDayStart(t time.Time) string {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Format("2006-01-02T15:04:05.000Z")
}

// StatsOverview GET /api/v1/stats/overview?env=
// 充值/打赏单位均为钻石；type 与 server 端 payment_store/commerce 实际写入值对齐：
// 充值类 = 'recharge'，打赏类 = 'tip_out'（金额为负，统计时取反）。
func (d Deps) StatsOverview(c *gin.Context) {
	env, ok := envParam(c)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	now := time.Now().UTC()
	todayStart := isoDayStart(now)
	sevenDaysAgoStart := isoDayStart(now.AddDate(0, 0, -6))

	var usersTotal, usersNewToday, usersNew7d, activeToday, elvesTotal, pendingReviews int64
	var rechargeToday, recharge7d, tip7d int64

	count := func(dest *int64, query string, args ...any) bool {
		if err := d.DB.QueryRowContext(ctx, query, args...).Scan(dest); err != nil {
			d.internalError(c, "stats query failed", err)
			return false
		}
		return true
	}

	if !count(&usersTotal, "SELECT COUNT(*) FROM users") {
		return
	}
	if !count(&usersNewToday, "SELECT COUNT(*) FROM users WHERE created_at >= ?", todayStart) {
		return
	}
	if !count(&usersNew7d, "SELECT COUNT(*) FROM users WHERE created_at >= ?", sevenDaysAgoStart) {
		return
	}
	if !count(&activeToday, "SELECT COUNT(*) FROM users WHERE last_login_at IS NOT NULL AND last_login_at >= ?", todayStart) {
		return
	}
	if !count(&elvesTotal, "SELECT COUNT(*) FROM payment_objects WHERE environment = ? AND kind = 'elf'", env) {
		return
	}
	if !count(&rechargeToday,
		"SELECT COALESCE(SUM(amount),0) FROM payment_ledger WHERE environment = ? AND type = 'recharge' AND created_at >= ?",
		env, todayStart) {
		return
	}
	if !count(&recharge7d,
		"SELECT COALESCE(SUM(amount), 0) FROM payment_ledger WHERE environment = ? AND type = 'recharge' AND created_at >= ?",
		env, sevenDaysAgoStart) {
		return
	}
	if !count(&tip7d,
		"SELECT COALESCE(SUM(-amount), 0) FROM payment_ledger WHERE environment = ? AND type = 'tip_out' AND created_at >= ?",
		env, sevenDaysAgoStart) {
		return
	}
	if !count(&pendingReviews,
		"SELECT COUNT(*) FROM payment_objects WHERE environment = ? AND kind = 'alipay_review' AND state = 'needs_review'",
		env) {
		return
	}

	// 最近 7 天逐日：新增用户、充值、打赏
	daily7 := make([]gin.H, 0, 7)
	for i := 6; i >= 0; i-- {
		day := now.AddDate(0, 0, -i)
		start := isoDayStart(day)
		end := isoDayStart(day.AddDate(0, 0, 1))
		var newUsers, recharge, tip int64
		if !count(&newUsers, "SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ?", start, end) {
			return
		}
		if !count(&recharge,
			"SELECT COALESCE(SUM(amount),0) FROM payment_ledger WHERE environment = ? AND type = 'recharge' AND created_at >= ? AND created_at < ?",
			env, start, end) {
			return
		}
		if !count(&tip,
			"SELECT COALESCE(SUM(-amount),0) FROM payment_ledger WHERE environment = ? AND type = 'tip_out' AND created_at >= ? AND created_at < ?",
			env, start, end) {
			return
		}
		daily7 = append(daily7, gin.H{
			"date": day.Format("2006-01-02"), "new_users": newUsers, "recharge": recharge, "tip": tip,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"users_total": usersTotal, "users_new_today": usersNewToday, "users_new_7d": usersNew7d,
		"active_today": activeToday, "elves_total": elvesTotal,
		"recharge_today": rechargeToday, "recharge_7d": recharge7d, "tip_7d": tip7d,
		"pending_reviews": pendingReviews, "daily7": daily7,
	})
}
