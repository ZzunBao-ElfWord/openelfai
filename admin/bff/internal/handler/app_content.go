package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/middleware"
	"openelf-admin-bff/internal/model"
)

// 运营配置中心：App 文案 / 开关 / 法律政策文档。
//
// 只承载公开展示类内容；任何密钥、内网地址、价格常量都不允许写入这里。
// App 通过公开只读接口拉取，写入一律经后台 BFF 并自动落审计。

const (
	appDocumentContentMaxRunes = 200000
	appConfigValueMaxRunes     = 20000
)

var appDocumentSlugRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,31}$`)

// appConfigSeed 公开配置的默认值与元数据。
// key 同时是公开接口白名单：未登记在这里的 key 不会下发给 App。
type appConfigSeed struct {
	Key       string
	Group     string
	Label     string
	ValueType string // text / bool / json / number
	Value     string
	Remark    string
}

var appConfigSeeds = []appConfigSeed{
	{Key: "app.about.name", Group: "about", Label: "应用名称", ValueType: "text", Value: "OpenElf", Remark: "关于页展示的应用名"},
	{Key: "app.about.version", Group: "about", Label: "展示版本号", ValueType: "text", Value: "v1.0.0", Remark: "仅用于文案展示，真实版本以安装包为准"},
	{Key: "app.about.slogan", Group: "about", Label: "关于页标语", ValueType: "text", Value: "我的 AI，我做主", Remark: ""},
	{Key: "app.about.intro", Group: "about", Label: "关于页简介", ValueType: "text", Value: "把技能做成技能书，自己组装，放进世界替你争夺注意力。", Remark: ""},
	{Key: "app.about.copyright", Group: "about", Label: "版权信息", ValueType: "text", Value: "© 2026 OpenElf", Remark: ""},

	{Key: "app.brand.slogan", Group: "brand", Label: "全站标语", ValueType: "text", Value: "我的 AI，我做主", Remark: "登录页、首页、分享卡片统一使用"},

	{Key: "app.feedback.enabled", Group: "feedback", Label: "反馈入口开关", ValueType: "bool", Value: "true", Remark: "关闭后设置页入口显示为暂未开放"},
	{Key: "app.feedback.channel", Group: "feedback", Label: "反馈渠道", ValueType: "text", Value: "email", Remark: "email 显示邮箱；url 显示外链"},
	{Key: "app.feedback.email", Group: "feedback", Label: "反馈邮箱", ValueType: "text", Value: "support@openelfai.com", Remark: ""},
	{Key: "app.feedback.url", Group: "feedback", Label: "反馈外链", ValueType: "text", Value: "", Remark: "渠道为 url 时生效"},
	{Key: "app.feedback.note", Group: "feedback", Label: "反馈入口说明", ValueType: "text", Value: "发现违规或有建议？告诉我们", Remark: ""},

	{Key: "app.report.enabled", Group: "report", Label: "举报入口开关", ValueType: "bool", Value: "true", Remark: "关闭后内容举报图标不再弹出举报原因"},
	{Key: "app.report.reasons", Group: "report", Label: "举报原因", ValueType: "json", Value: `["色情或低俗","侮辱或攻击","违法违规","垃圾广告","其他"]`, Remark: "JSON 字符串数组，按顺序展示"},

	{Key: "app.wallet.rule", Group: "wallet", Label: "钱包规则说明", ValueType: "text", Value: "消费后钻石不再流通：10💎 = ¥1。打赏礼物的 50% 作为服务费结算给创作者，收益过冷静期后可提现。", Remark: "钱包页底部说明"},

	{Key: "app.identity.note", Group: "identity", Label: "实名认证说明", ValueType: "text", Value: "上传身份证完成核验，用于创建本人形象 AI", Remark: "设置页与实名页共用"},

	{Key: "app.create.declarations", Group: "create", Label: "创建 AI 合规声明", ValueType: "json", Value: `["形象为原创，或我已获得肖像权人的明确授权；不使用他人照片、明星或公众人物形象。","形象不包含色情、暴力、违法犯罪、未成年人或侵犯他人权益的内容。","我同意为 AI 生成的形象加注「AI 生成」标识，并遵守《生成式人工智能服务管理暂行办法》与《人工智能生成合成内容标识办法》。"]`, Remark: "JSON 字符串数组，创建页逐条勾选"},

	{Key: "app.theme.default", Group: "theme", Label: "默认外观", ValueType: "text", Value: "system", Remark: "system / light / dark；仅对未手动选择过外观的用户生效"},
}

var appConfigSeedByKey = func() map[string]appConfigSeed {
	out := make(map[string]appConfigSeed, len(appConfigSeeds))
	for _, s := range appConfigSeeds {
		out[s.Key] = s
	}
	return out
}()

// appDocumentSeeds 法律政策文档的固定 slug，首次启动建草稿，正文由运营填写后发布。
var appDocumentSeeds = []struct {
	Slug  string
	Title string
}{
	{Slug: "privacy", Title: "隐私政策"},
	{Slug: "terms", Title: "用户协议"},
	{Slug: "community", Title: "社区规范"},
}

// SeedAppContentDefaults 幂等写入配置默认值与文档草稿。
func SeedAppContentDefaults(ctx context.Context, db *sql.DB) error {
	now := time.Now().UnixMilli()
	for _, s := range appConfigSeeds {
		if _, err := db.ExecContext(ctx,
			`INSERT IGNORE INTO app_configs
			 (cfg_key, cfg_group, label, value_type, value_text, remark, updated_by, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'system', ?)`,
			s.Key, s.Group, s.Label, s.ValueType, s.Value, s.Remark, now); err != nil {
			return fmt.Errorf("seed app_configs %s: %w", s.Key, err)
		}
	}
	for _, d := range appDocumentSeeds {
		if _, err := db.ExecContext(ctx,
			`INSERT IGNORE INTO app_documents
			 (id, slug, title, version, format, content, status, created_at, updated_at)
			 VALUES (?, ?, ?, 1, 'text', '', 'draft', ?, ?)`,
			model.NewID(), d.Slug, d.Title, now, now); err != nil {
			return fmt.Errorf("seed app_documents %s: %w", d.Slug, err)
		}
	}
	return nil
}

// —— 后台：法律与政策文档 ——

type appDocumentRow struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Version     int    `json:"version"`
	Format      string `json:"format"`
	Status      string `json:"status"`
	EffectiveAt int64  `json:"effective_at"`
	PublishedAt int64  `json:"published_at"`
	PublishedBy string `json:"published_by"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
	Preview     string `json:"preview"`
}

// ListAppDocuments GET /api/v1/app-content/documents
func (d Deps) ListAppDocuments(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT id, slug, title, version, format, status,
		        COALESCE(effective_at, 0), COALESCE(published_at, 0),
		        published_by, created_at, updated_at, LEFT(content, 160)
		 FROM app_documents
		 ORDER BY slug ASC, version DESC`)
	if err != nil {
		d.internalError(c, "list app documents failed", err)
		return
	}
	defer rows.Close()

	items := make([]appDocumentRow, 0)
	for rows.Next() {
		var r appDocumentRow
		if err := rows.Scan(&r.ID, &r.Slug, &r.Title, &r.Version, &r.Format, &r.Status,
			&r.EffectiveAt, &r.PublishedAt, &r.PublishedBy, &r.CreatedAt, &r.UpdatedAt,
			&r.Preview); err != nil {
			d.internalError(c, "scan app documents failed", err)
			return
		}
		items = append(items, r)
	}
	if err := rows.Err(); err != nil {
		d.internalError(c, "iterate app documents failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// GetAppDocument GET /api/v1/app-content/documents/:id（含完整正文）
func (d Deps) GetAppDocument(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var r appDocumentRow
	var content string
	err := d.DB.QueryRowContext(ctx,
		`SELECT id, slug, title, version, format, status,
		        COALESCE(effective_at, 0), COALESCE(published_at, 0),
		        published_by, created_at, updated_at, content
		 FROM app_documents WHERE id = ?`, c.Param("id")).
		Scan(&r.ID, &r.Slug, &r.Title, &r.Version, &r.Format, &r.Status,
			&r.EffectiveAt, &r.PublishedAt, &r.PublishedBy, &r.CreatedAt, &r.UpdatedAt,
			&content)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "文档不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read app document failed", err)
		return
	}
	r.Preview = content
	c.JSON(http.StatusOK, gin.H{
		"document": r,
		"content":  content,
	})
}

type appDocumentRequest struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	EffectiveAt *int64 `json:"effective_at"`
}

// CreateAppDocument POST /api/v1/app-content/documents（运营新建草稿）
func (d Deps) CreateAppDocument(c *gin.Context) {
	var req appDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	slug := strings.TrimSpace(req.Slug)
	if !appDocumentSlugRE.MatchString(slug) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "bad_slug", "message": "slug 只能是小写字母开头、2-32 位的字母数字下划线或短横线",
		})
		return
	}
	if !validAppDocumentFields(c, req.Title, req.Content) {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var next int
	if err := d.DB.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(version), 0) + 1 FROM app_documents WHERE slug = ?", slug).
		Scan(&next); err != nil {
		d.internalError(c, "read next app document version failed", err)
		return
	}

	now := time.Now().UnixMilli()
	id := model.NewID()
	if _, err := d.DB.ExecContext(ctx,
		`INSERT INTO app_documents
		 (id, slug, title, version, format, content, status, effective_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'text', ?, 'draft', ?, ?, ?)`,
		id, slug, strings.TrimSpace(req.Title), next, req.Content, req.EffectiveAt, now, now); err != nil {
		d.internalError(c, "create app document failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "id": id, "version": next, "status": "draft"})
}

// UpdateAppDocument PUT /api/v1/app-content/documents/:id（仅草稿可改）
func (d Deps) UpdateAppDocument(c *gin.Context) {
	var req appDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	if !validAppDocumentFields(c, req.Title, req.Content) {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	var status string
	err := d.DB.QueryRowContext(ctx,
		"SELECT status FROM app_documents WHERE id = ?", c.Param("id")).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "文档不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read app document status failed", err)
		return
	}
	if status != "draft" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "draft_only", "message": "只有草稿可以编辑；已发布版本请新建草稿后再发布",
		})
		return
	}

	now := time.Now().UnixMilli()
	if _, err := d.DB.ExecContext(ctx,
		`UPDATE app_documents
		 SET title = ?, content = ?, effective_at = ?, updated_at = ?
		 WHERE id = ? AND status = 'draft'`,
		strings.TrimSpace(req.Title), req.Content, req.EffectiveAt, now,
		c.Param("id")); err != nil {
		d.internalError(c, "update app document failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "updated_at": now})
}

// PublishAppDocument POST /api/v1/app-content/documents/:id/publish（仅 super_admin）
// 发布新版本时自动把同 slug 的旧发布版本归档。
func (d Deps) PublishAppDocument(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		d.internalError(c, "begin publish app document tx failed", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var slug, status string
	var content string
	err = tx.QueryRowContext(ctx,
		"SELECT slug, status, content FROM app_documents WHERE id = ? FOR UPDATE",
		c.Param("id")).Scan(&slug, &status, &content)
	if errors.Is(err, sql.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "文档不存在"})
		return
	}
	if err != nil {
		d.internalError(c, "read app document for publish failed", err)
		return
	}
	if status != "draft" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "draft_only", "message": "只有草稿可以发布",
		})
		return
	}
	if strings.TrimSpace(content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "empty_content", "message": "正文为空，不能发布",
		})
		return
	}

	now := time.Now().UnixMilli()
	publishedBy := c.GetString(middleware.CtxActorName)
	if _, err := tx.ExecContext(ctx,
		"UPDATE app_documents SET status = 'archived', updated_at = ? WHERE slug = ? AND status = 'published'",
		now, slug); err != nil {
		d.internalError(c, "archive previous app document failed", err)
		return
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE app_documents
		 SET status = 'published', published_at = ?, published_by = ?, updated_at = ?,
		     effective_at = CASE WHEN effective_at IS NULL OR effective_at = 0 THEN ? ELSE effective_at END
		 WHERE id = ?`,
		now, publishedBy, now, now, c.Param("id")); err != nil {
		d.internalError(c, "publish app document failed", err)
		return
	}
	if err := tx.Commit(); err != nil {
		d.internalError(c, "commit publish app document failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "slug": slug, "published_at": now})
}

// ArchiveAppDocument POST /api/v1/app-content/documents/:id/archive（仅 super_admin）
func (d Deps) ArchiveAppDocument(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	now := time.Now().UnixMilli()
	res, err := d.DB.ExecContext(ctx,
		"UPDATE app_documents SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'published'",
		now, c.Param("id"))
	if err != nil {
		d.internalError(c, "archive app document failed", err)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "not_published", "message": "只有已发布文档可以下线",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func validAppDocumentFields(c *gin.Context, title, content string) bool {
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "bad_title", "message": "标题不能为空，且不超过 64 个字",
		})
		return false
	}
	if utf8.RuneCountInString(content) > appDocumentContentMaxRunes {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "content_too_long", "message": "正文过长，请拆分后发布",
		})
		return false
	}
	return true
}

// —— 后台：应用文案与开关 ——

type appConfigRow struct {
	Key       string `json:"key"`
	Group     string `json:"group"`
	Label     string `json:"label"`
	ValueType string `json:"value_type"`
	Value     string `json:"value"`
	Remark    string `json:"remark"`
	UpdatedBy string `json:"updated_by"`
	UpdatedAt int64  `json:"updated_at"`
}

// ListAppConfigs GET /api/v1/app-content/configs
func (d Deps) ListAppConfigs(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT cfg_key, cfg_group, label, value_type, value_text, remark, updated_by, updated_at
		 FROM app_configs ORDER BY cfg_group ASC, cfg_key ASC`)
	if err != nil {
		d.internalError(c, "list app configs failed", err)
		return
	}
	defer rows.Close()

	items := make([]appConfigRow, 0)
	for rows.Next() {
		var r appConfigRow
		if err := rows.Scan(&r.Key, &r.Group, &r.Label, &r.ValueType, &r.Value,
			&r.Remark, &r.UpdatedBy, &r.UpdatedAt); err != nil {
			d.internalError(c, "scan app configs failed", err)
			return
		}
		items = append(items, r)
	}
	if err := rows.Err(); err != nil {
		d.internalError(c, "iterate app configs failed", err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type putAppConfigRequest struct {
	Value string `json:"value"`
}

type putAppConfigSwitchRequest struct {
	Value bool `json:"value"`
}

// PutAppConfig PUT /api/v1/app-content/configs/:key（运营可改文案类配置）
func (d Deps) PutAppConfig(c *gin.Context) {
	var req putAppConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	d.saveAppConfig(c, req.Value, false)
}

// PutAppConfigSwitch PUT /api/v1/app-content/configs/:key/switch（仅 super_admin）
func (d Deps) PutAppConfigSwitch(c *gin.Context) {
	var req putAppConfigSwitchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	value := "false"
	if req.Value {
		value = "true"
	}
	d.saveAppConfig(c, value, true)
}

func (d Deps) saveAppConfig(c *gin.Context, value string, switchOnly bool) {
	key := c.Param("key")
	seed, ok := appConfigSeedByKey[key]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_key", "message": "未知配置项"})
		return
	}
	if switchOnly != (seed.ValueType == "bool") {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "bad_endpoint", "message": "开关类配置请走 /switch 接口，文案类配置请走普通接口",
		})
		return
	}
	if utf8.RuneCountInString(value) > appConfigValueMaxRunes {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "value_too_long", "message": "配置内容过长",
		})
		return
	}
	if message, ok := validateAppConfigValue(key, value); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_value", "message": message})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	now := time.Now().UnixMilli()
	updatedBy := c.GetString(middleware.CtxActorName)
	res, err := d.DB.ExecContext(ctx,
		`UPDATE app_configs SET value_text = ?, updated_by = ?, updated_at = ? WHERE cfg_key = ?`,
		value, updatedBy, now, key)
	if err != nil {
		d.internalError(c, "update app config failed", err)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_key", "message": "配置项不存在，请先执行初始化"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "key": key, "updated_at": now})
}

// validateAppConfigValue 对少数枚举 / JSON 配置做语义校验，避免把 App 打崩。
func validateAppConfigValue(key, value string) (string, bool) {
	switch key {
	case "app.report.reasons":
		var arr []string
		if err := json.Unmarshal([]byte(value), &arr); err != nil || len(arr) == 0 {
			return "举报原因必须是至少包含一项的 JSON 字符串数组", false
		}
	case "app.create.declarations":
		var arr []string
		if err := json.Unmarshal([]byte(value), &arr); err != nil || len(arr) == 0 {
			return "合规声明必须是至少包含一项的 JSON 字符串数组", false
		}
	case "app.theme.default":
		if value != "system" && value != "light" && value != "dark" {
			return "默认外观只允许 system / light / dark", false
		}
	case "app.feedback.channel":
		if value != "email" && value != "url" {
			return "反馈渠道只允许 email / url", false
		}
	case "app.feedback.email":
		if value != "" && (!strings.Contains(value, "@") || len(value) > 120) {
			return "反馈邮箱格式不正确", false
		}
	case "app.feedback.url":
		if value != "" && !strings.HasPrefix(value, "https://") && !strings.HasPrefix(value, "http://") {
			return "反馈外链必须以 http:// 或 https:// 开头", false
		}
	}
	return "", true
}
