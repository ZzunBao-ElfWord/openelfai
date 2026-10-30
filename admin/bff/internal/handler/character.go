package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// 形象工坊：统一代理到 openelf-api 的内部运营接口 /internal/ops/character。
// 该接口只认 x-ops-token（环境变量 OPS_TOKEN），写操作仍全部在 openelf-api 内完成，
// 后台 MySQL 账号对该模块只开 SELECT 权限。
const (
	characterOpsPath     = "/internal/ops/character"
	characterAssetPath   = "/api/v1/character-assets/"
	characterOpsTimeout  = 90 * time.Second // 批量渲染远慢于普通请求
	characterBodyLimit   = 1 << 20          // 批量生成请求体上限 1MB
	characterRespLimit   = 8 << 20
	characterDisabledMsg = "未配置 OPS_TOKEN，形象工坊不可用"
)

// characterAssetURL 把相对素材路径拼上 OPS_ASSET_BASE_URL；绝对地址原样返回。
func characterAssetURL(base, raw string) string {
	if raw == "" || base == "" {
		return raw
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "//") {
		return raw
	}
	return base + "/" + strings.TrimPrefix(raw, "/")
}

// normalizeCharacterAssetURLs 递归改写响应里的 imageUrl/thumbUrl/sheetUrl。
// 上游若只返回 *Key（文件名），则补出指向 /api/v1/character-assets/ 的外链字段。
func normalizeCharacterAssetURLs(node any, base string) {
	switch value := node.(type) {
	case map[string]any:
		for key, field := range map[string]string{
			"imageKey": "imageUrl", "thumbKey": "thumbUrl", "sheetKey": "sheetUrl",
		} {
			if _, exists := value[field]; exists {
				continue
			}
			if keyValue, ok := value[key].(string); ok && keyValue != "" && !strings.Contains(keyValue, "/") {
				value[field] = characterAssetURL(base, characterAssetPath+keyValue)
			}
		}
		for key, child := range value {
			if raw, ok := child.(string); ok {
				switch key {
				case "imageUrl", "thumbUrl", "sheetUrl":
					value[key] = characterAssetURL(base, raw)
					continue
				}
			}
			normalizeCharacterAssetURLs(child, base)
		}
	case []any:
		for _, child := range value {
			normalizeCharacterAssetURLs(child, base)
		}
	}
}

// characterOpsProxy 代理一次内部运营请求。body 为空表示无请求体。
func (d Deps) characterOpsProxy(c *gin.Context, method, subPath string, body []byte) {
	if d.Cfg.OpsToken == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "OPS_DISABLED", "message": characterDisabledMsg,
		})
		return
	}

	target := d.Cfg.OpsAPIBaseURL + characterOpsPath + subPath
	ctx, cancel := context.WithTimeout(c.Request.Context(), characterOpsTimeout)
	defer cancel()

	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		d.internalError(c, "build character ops request failed", err)
		return
	}
	// 令牌只放请求头，不写日志、不回显。
	req.Header.Set("x-ops-token", d.Cfg.OpsToken)
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{Timeout: characterOpsTimeout}
	resp, err := client.Do(req)
	if err != nil {
		d.Log.Error("character ops upstream unreachable", "method", method,
			"upstream_path", characterOpsPath+strings.SplitN(subPath, "?", 2)[0], "error", err)
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "OPS_UNREACHABLE", "message": "上游运营服务不可达或响应超时，请稍后重试",
		})
		return
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, characterRespLimit))
	if err != nil {
		d.Log.Error("read character ops response failed", "method", method, "error", err)
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "OPS_BAD_RESPONSE", "message": "上游运营服务响应读取失败，请稍后重试",
		})
		return
	}

	// 上游 4xx/5xx：状态码与 {code,message} 原样透传。
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		c.Data(resp.StatusCode, "application/json; charset=utf-8", raw)
		return
	}

	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		c.Data(resp.StatusCode, "application/json; charset=utf-8", raw)
		return
	}
	normalizeCharacterAssetURLs(payload, d.Cfg.OpsAssetBaseURL)
	out, err := json.Marshal(payload)
	if err != nil {
		d.internalError(c, "marshal character ops response failed", err)
		return
	}
	c.Data(resp.StatusCode, "application/json; charset=utf-8", out)
}

// readCharacterBody 读取并限制请求体大小；超限时已写入 413 响应。
func readCharacterBody(c *gin.Context) ([]byte, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, characterBodyLimit)
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": "body_too_large", "message": "请求体超过 1MB",
			})
			return nil, false
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "读取请求体失败"})
		return nil, false
	}
	return raw, true
}

// ListCharacterParts GET /api/v1/character/parts
func (d Deps) ListCharacterParts(c *gin.Context) {
	d.characterOpsProxy(c, http.MethodGet, "/parts", nil)
}

// UpdateCharacterPart PUT /api/v1/character/parts/:id（仅 super_admin）
func (d Deps) UpdateCharacterPart(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxy(c, http.MethodPut, "/parts/"+url.PathEscape(c.Param("id")), raw)
}

// ListCharacterBatches GET /api/v1/character/batches?limit=
func (d Deps) ListCharacterBatches(c *gin.Context) {
	query := url.Values{}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_limit", "message": "limit 必须是 1-100 的整数"})
			return
		}
		query.Set("limit", strconv.Itoa(n))
	}
	subPath := "/batches"
	if encoded := query.Encode(); encoded != "" {
		subPath += "?" + encoded
	}
	d.characterOpsProxy(c, http.MethodGet, subPath, nil)
}

// CreateCharacterBatch POST /api/v1/character/batches（仅 super_admin）
func (d Deps) CreateCharacterBatch(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxy(c, http.MethodPost, "/batches", raw)
}

// GetCharacterBatch GET /api/v1/character/batches/:id
func (d Deps) GetCharacterBatch(c *gin.Context) {
	d.characterOpsProxy(c, http.MethodGet, "/batches/"+url.PathEscape(c.Param("id")), nil)
}
