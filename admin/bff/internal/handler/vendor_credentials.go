package handler

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"openelf-admin-bff/internal/middleware"
)

// vendorSpec 上游厂商注册表（硬编码）。
// EnvVar 与 Litellm config.yaml 中 os.environ 引用的变量名保持一致。
type vendorSpec struct {
	Vendor      string
	DisplayName string
	EnvVar      string
	BaseURL     string
	// TestModel 非空时用一次最小 chat/completions 请求验证密钥；
	// 为空则退回 GET /models（适用于暴露模型列表的上游）。
	TestModel string
}

var platformVendorRegistry = []vendorSpec{
	{Vendor: "deepseek", DisplayName: "DeepSeek", EnvVar: "DEEPSEEK_API_KEY", BaseURL: "https://api.deepseek.com"},
	{Vendor: "volcengine", DisplayName: "火山引擎（豆包）", EnvVar: "VOLCENGINE_API_KEY", BaseURL: "https://ark.cn-beijing.volces.com/api/v3", TestModel: "doubao-seed-2-1-pro-260915"},
	{Vendor: "aliyun", DisplayName: "阿里云百炼（通义千问）", EnvVar: "ALIYUN_API_KEY", BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"},
	{Vendor: "moonshot", DisplayName: "月之暗面 Kimi", EnvVar: "MOONSHOT_API_KEY", BaseURL: "https://api.moonshot.cn/v1", TestModel: "kimi-k2-0711-preview"},
	{Vendor: "zhipu", DisplayName: "智谱 AI", EnvVar: "ZHIPU_API_KEY", BaseURL: "https://open.bigmodel.cn/api/paas/v4", TestModel: "glm-4-flash"},
	{Vendor: "baidu", DisplayName: "百度文心", EnvVar: "BAIDU_API_KEY", BaseURL: "https://qianfan.baidubce.com/v2", TestModel: "ernie-4.0-8k"},
	{Vendor: "hunyuan", DisplayName: "腾讯混元", EnvVar: "HUNYUAN_API_KEY", BaseURL: "https://tokenhub.tencentmaas.com/v1", TestModel: "hy3"},
	{Vendor: "stepfun", DisplayName: "阶跃星辰", EnvVar: "STEPFUN_API_KEY", BaseURL: "https://api.stepfun.com/v1", TestModel: "step-2-mini"},
	{Vendor: "yi", DisplayName: "零一万物", EnvVar: "YI_API_KEY", BaseURL: "https://api.lingyiwanwu.com/v1", TestModel: "yi-lightning"},
	{Vendor: "spark", DisplayName: "讯飞星火", EnvVar: "SPARK_API_KEY", BaseURL: "https://spark-api-open.xf-yun.com/v1", TestModel: "generalv3.5"},
	{Vendor: "baichuan", DisplayName: "百川智能", EnvVar: "BAICHUAN_API_KEY", BaseURL: "https://api.baichuan-ai.com/v1", TestModel: "Baichuan4"},
	{Vendor: "openai", DisplayName: "OpenAI", EnvVar: "OPENAI_API_KEY", BaseURL: "https://api.openai.com/v1", TestModel: "gpt-4o-mini"},
	{Vendor: "anthropic", DisplayName: "Anthropic（Claude）", EnvVar: "ANTHROPIC_API_KEY", BaseURL: "https://api.anthropic.com/v1", TestModel: "claude-3-5-haiku-latest"},
	{Vendor: "google", DisplayName: "Google（Gemini）", EnvVar: "GOOGLE_API_KEY", BaseURL: "https://generativelanguage.googleapis.com/v1beta/openai", TestModel: "gemini-2.0-flash"},
	{Vendor: "xai", DisplayName: "xAI（Grok）", EnvVar: "XAI_API_KEY", BaseURL: "https://api.x.ai/v1", TestModel: "grok-2-latest"},
	{Vendor: "mistral", DisplayName: "Mistral AI", EnvVar: "MISTRAL_API_KEY", BaseURL: "https://api.mistral.ai/v1", TestModel: "mistral-small-latest"},
	{Vendor: "cohere", DisplayName: "Cohere", EnvVar: "COHERE_API_KEY", BaseURL: "https://api.cohere.ai/compatibility/v1", TestModel: "command-r-08-2024"},
}

const (
	vendorSyncDir     = "/var/lib/openelf/litellm-sync"
	vendorSyncRequest = vendorSyncDir + "/request.json"
	vendorSyncResult  = vendorSyncDir + "/result.json"
	vendorSyncTimeout = 70 * time.Second
	vendorTestTimeout = 8 * time.Second
)

// vendorSyncMu 串行化密钥同步：request/result 是固定路径的共享文件。
// BFF 服务以 openelfadmin 运行且开启 NoNewPrivileges，不能用 sudo；
// 改由 root 的 systemd path 单元监听 request.json 触发同步脚本。
var vendorSyncMu sync.Mutex

// vendorSpecByID 按 vendor 查找注册表项。
func vendorSpecByID(vendor string) (vendorSpec, bool) {
	for _, spec := range platformVendorRegistry {
		if spec.Vendor == vendor {
			return spec, true
		}
	}
	return vendorSpec{}, false
}

// secretsKey 从环境变量 SECRETS_KEY 读取 AES-256 密钥（base64 编码的 32 字节）。
// 缺失或长度错误时已写入 500 响应，返回 ok=false。
func (d Deps) secretsKey(c *gin.Context) ([]byte, bool) {
	raw := strings.TrimSpace(d.Cfg.SecretsKey)
	if raw == "" {
		d.Log.Error("secret_not_configured", "reason", "SECRETS_KEY is missing",
			"path", c.Request.URL.Path)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "secret_not_configured", "message": "服务端未配置密钥加密环境变量 SECRETS_KEY，请联系运维",
		})
		return nil, false
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		d.Log.Error("secret_not_configured", "reason", "SECRETS_KEY must be base64-encoded 32 bytes",
			"path", c.Request.URL.Path)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "secret_not_configured", "message": "服务端密钥加密配置不合法，请联系运维",
		})
		return nil, false
	}
	return key, true
}

// encryptSecret AES-256-GCM 加密，密文格式 base64(nonce12 + tag16 + ciphertext)。
func encryptSecret(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	tagSize := gcm.Overhead()
	body := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	out := make([]byte, 0, len(nonce)+len(tag)+len(body))
	out = append(out, nonce...)
	out = append(out, tag...)
	out = append(out, body...)
	return base64.StdEncoding.EncodeToString(out), nil
}

// decryptSecret 解密 base64(nonce12 + tag16 + ciphertext)。
func decryptSecret(key []byte, encoded string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize, tagSize := gcm.NonceSize(), gcm.Overhead()
	if len(raw) < nonceSize+tagSize {
		return "", errors.New("ciphertext too short")
	}
	nonce := raw[:nonceSize]
	tag := raw[nonceSize : nonceSize+tagSize]
	body := raw[nonceSize+tagSize:]

	sealed := make([]byte, 0, len(body)+len(tag))
	sealed = append(sealed, body...)
	sealed = append(sealed, tag...)
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// validVendorAPIKey 密钥 trim 后长度 8-512，且不允许任何空白字符。
func validVendorAPIKey(s string) bool {
	n := utf8.RuneCountInString(s)
	if n < 8 || n > 512 {
		return false
	}
	for _, r := range s {
		if unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

// vendorKeyHint 长度 >= 12 时显示前 4 后 4，否则只显示 ****。
func vendorKeyHint(s string) string {
	runes := []rune(s)
	if len(runes) < 12 {
		return "****"
	}
	return string(runes[:4]) + "****" + string(runes[len(runes)-4:])
}

// truncateVendorMessage 截断到 255 个字符（与 VARCHAR(255) 对齐）。
func truncateVendorMessage(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= 255 {
		return s
	}
	runes := []rune(s)
	return string(runes[:255])
}

// ListPlatformVendors GET /api/v1/platform/vendors
// 按注册表顺序输出全部厂商；未配置厂商 configured=false，其余字段 null/0。
// 严禁返回 key_cipher 或任何明文。
func (d Deps) ListPlatformVendors(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	rows, err := d.DB.QueryContext(ctx,
		`SELECT vendor, key_hint, status, updated_at, updated_by,
			last_test_at, last_test_result, last_test_message
		 FROM platform_vendor_credentials`)
	if err != nil {
		d.internalError(c, "list platform vendor credentials failed", err)
		return
	}
	defer rows.Close()

	saved := make(map[string]gin.H, len(platformVendorRegistry))
	for rows.Next() {
		var vendor, status string
		var updatedAt int64
		var keyHint, updatedBy, lastTestResult, lastTestMessage sql.NullString
		var lastTestAt sql.NullInt64
		if err := rows.Scan(&vendor, &keyHint, &status, &updatedAt, &updatedBy,
			&lastTestAt, &lastTestResult, &lastTestMessage); err != nil {
			d.internalError(c, "scan platform vendor credentials failed", err)
			return
		}
		saved[vendor] = gin.H{
			"key_hint":          platformNullableString(keyHint),
			"status":            status,
			"updated_at":        updatedAt,
			"updated_by":        platformNullableString(updatedBy),
			"last_test_at":      platformNullableInt64(lastTestAt),
			"last_test_result":  platformNullableString(lastTestResult),
			"last_test_message": platformNullableString(lastTestMessage),
		}
	}

	items := make([]gin.H, 0, len(platformVendorRegistry))
	for _, spec := range platformVendorRegistry {
		item := gin.H{
			"vendor":       spec.Vendor,
			"display_name": spec.DisplayName,
			"env_var":      spec.EnvVar,
			"base_url":     spec.BaseURL,
		}
		if row, ok := saved[spec.Vendor]; ok {
			item["configured"] = true
			for k, v := range row {
				item[k] = v
			}
		} else {
			item["configured"] = false
			item["key_hint"] = nil
			item["status"] = nil
			item["updated_at"] = int64(0)
			item["updated_by"] = nil
			item["last_test_at"] = nil
			item["last_test_result"] = nil
			item["last_test_message"] = nil
		}
		items = append(items, item)
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

type putVendorCredentialRequest struct {
	APIKey string `json:"api_key"`
}

// PutPlatformVendorCredential PUT /api/v1/platform/vendors/:vendor（仅 super_admin）
// 先同步 Litellm（特权脚本走 stdin），成功后才 UPSERT 数据库；同步失败返回 502 且不落库。
func (d Deps) PutPlatformVendorCredential(c *gin.Context) {
	spec, ok := vendorSpecByID(c.Param("vendor"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_vendor", "message": "未知的上游厂商"})
		return
	}

	var req putVendorCredentialRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if !validVendorAPIKey(apiKey) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "bad_api_key", "message": "api_key 长度必须为 8-512 个字符，且不能包含空白字符",
		})
		return
	}

	key, ok := d.secretsKey(c)
	if !ok {
		return
	}
	keyCipher, err := encryptSecret(key, apiKey)
	if err != nil {
		d.internalError(c, "encrypt vendor key failed", err)
		return
	}
	keyHint := vendorKeyHint(apiKey)

	if message, ok := d.syncVendorKey(spec, apiKey); !ok {
		c.JSON(http.StatusBadGateway, gin.H{"error": "sync_failed", "message": message})
		return
	}

	now := time.Now().UnixMilli()
	updatedBy := c.GetString(middleware.CtxActorName)

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	if _, err := d.DB.ExecContext(ctx,
		`INSERT INTO platform_vendor_credentials
		 (vendor, env_var, key_cipher, key_hint, status, created_at, updated_at, updated_by)
		 VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
		 ON DUPLICATE KEY UPDATE env_var = VALUES(env_var), key_cipher = VALUES(key_cipher),
		   key_hint = VALUES(key_hint), status = VALUES(status),
		   updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
		spec.Vendor, spec.EnvVar, keyCipher, keyHint, now, now, updatedBy); err != nil {
		d.internalError(c, "upsert platform vendor credential failed", err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok": true, "vendor": spec.Vendor, "key_hint": keyHint, "updated_at": now,
	})
}

// syncVendorKey 通过 systemd path 单元触发 root 特权脚本同步密钥。
// 密钥只写入 0600 的 request.json，不进命令行参数、不进日志；完成后删除请求与结果文件。
// 返回 true 表示同步成功；失败时返回可直接展示的中文消息。
func (d Deps) syncVendorKey(spec vendorSpec, apiKey string) (string, bool) {
	payload, err := json.Marshal(gin.H{"keys": gin.H{spec.EnvVar: apiKey}})
	if err != nil {
		d.Log.Error("marshal vendor sync payload failed", "vendor", spec.Vendor)
		return "同步密钥失败，请稍后重试", false
	}

	vendorSyncMu.Lock()
	defer vendorSyncMu.Unlock()

	_ = os.Remove(vendorSyncResult)
	if err := os.WriteFile(vendorSyncRequest, payload, 0o600); err != nil {
		d.Log.Error("write vendor sync request failed", "vendor", spec.Vendor, "error", err)
		return "同步密钥失败：后台服务无法写入同步请求目录", false
	}
	defer func() {
		_ = os.Remove(vendorSyncRequest)
		_ = os.Remove(vendorSyncResult)
	}()

	var out struct {
		OK      bool     `json:"ok"`
		Message string   `json:"message"`
		Keys    []string `json:"keys"`
	}
	deadline := time.Now().Add(vendorSyncTimeout)
	for time.Now().Before(deadline) {
		time.Sleep(500 * time.Millisecond)
		raw, readErr := os.ReadFile(vendorSyncResult)
		if readErr != nil {
			continue
		}
		if jsonErr := json.Unmarshal(raw, &out); jsonErr != nil {
			continue
		}
		if out.OK {
			return "", true
		}
		message := strings.TrimSpace(out.Message)
		if message == "" {
			message = "同步密钥失败，请检查 LiteLLM 同步服务状态"
		}
		message = strings.ReplaceAll(message, apiKey, "****")
		d.Log.Error("vendor key sync rejected", "vendor", spec.Vendor, "message", message)
		return truncateVendorMessage(message), false
	}

	d.Log.Error("vendor key sync timed out", "vendor", spec.Vendor,
		"hint", "check systemctl status openelf-litellm-sync.path openelf-litellm-sync.service")
	return "同步密钥超时：密钥同步服务未响应，请检查 openelf-litellm-sync.path 是否运行", false
}

type testVendorCredentialRequest struct {
	APIKey string `json:"api_key"`
}

// TestPlatformVendor POST /api/v1/platform/vendors/:vendor/test（仅 super_admin）
// body 带 api_key 时只测试不落库；否则解密库中已存密钥并回写测试结果。
func (d Deps) TestPlatformVendor(c *gin.Context) {
	spec, ok := vendorSpecByID(c.Param("vendor"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown_vendor", "message": "未知的上游厂商"})
		return
	}

	var req testVendorCredentialRequest
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "请求体不是合法 JSON"})
		return
	}

	apiKey := strings.TrimSpace(req.APIKey)
	fromStore := false
	if apiKey != "" {
		if !validVendorAPIKey(apiKey) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "bad_api_key", "message": "api_key 长度必须为 8-512 个字符，且不能包含空白字符",
			})
			return
		}
	} else {
		key, ok := d.secretsKey(c)
		if !ok {
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		var keyCipher sql.NullString
		err := d.DB.QueryRowContext(ctx,
			"SELECT key_cipher FROM platform_vendor_credentials WHERE vendor = ?", spec.Vendor).
			Scan(&keyCipher)
		cancel()
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !keyCipher.Valid) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "not_configured", "message": "该厂商尚未配置密钥",
			})
			return
		}
		if err != nil {
			d.internalError(c, "read platform vendor credential failed", err)
			return
		}

		plain, err := decryptSecret(key, keyCipher.String)
		if err != nil {
			d.internalError(c, "decrypt vendor key failed", err)
			return
		}
		apiKey = plain
		fromStore = true
	}

	result, message, valid := testVendorEndpoint(spec, apiKey)

	if fromStore {
		now := time.Now().UnixMilli()
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		_, err := d.DB.ExecContext(ctx,
			`UPDATE platform_vendor_credentials
			 SET last_test_at = ?, last_test_result = ?, last_test_message = ?
			 WHERE vendor = ?`,
			now, result, truncateVendorMessage(message), spec.Vendor)
		cancel()
		if err != nil {
			d.Log.Warn("update vendor credential test result failed", "vendor", spec.Vendor, "error", err)
		}
	}

	c.JSON(http.StatusOK, gin.H{"ok": valid, "result": result, "message": message})
}

// testVendorEndpoint 带 Bearer 密钥调用厂商接口，8 秒超时。
// 返回值 result 为 valid / invalid_key / unreachable；三种都对应 HTTP 200 响应。
func testVendorEndpoint(spec vendorSpec, apiKey string) (result, message string, valid bool) {
	ctx, cancel := context.WithTimeout(context.Background(), vendorTestTimeout)
	defer cancel()

	method := http.MethodGet
	url := spec.BaseURL + "/models"
	var body io.Reader
	contentType := ""
	if spec.TestModel != "" {
		method = http.MethodPost
		url = spec.BaseURL + "/chat/completions"
		payload, _ := json.Marshal(map[string]any{
			"model":      spec.TestModel,
			"messages":   []map[string]string{{"role": "user", "content": "ping"}},
			"max_tokens": 1,
		})
		body = strings.NewReader(string(payload))
		contentType = "application/json"
	}

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return "unreachable", "构造上游请求失败", false
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	client := &http.Client{Timeout: vendorTestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "unreachable", "上游服务响应超时（8 秒）", false
		}
		return "unreachable", "无法连接上游服务", false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	switch {
	case resp.StatusCode == http.StatusOK:
		return "valid", "连接正常", true
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return "invalid_key", fmt.Sprintf("密钥无效(HTTP %d)", resp.StatusCode), false
	default:
		return "unreachable", fmt.Sprintf("上游返回 HTTP %d", resp.StatusCode), false
	}
}
