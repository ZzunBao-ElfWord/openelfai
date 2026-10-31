package handler

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// 系列发行（P4 B2B 千人千面）：全部代理到 openelf-api 的 /internal/ops/character/series。
// 渲染/铸造/重铸为链上长任务，超时放宽到 120 秒；其余沿用 90 秒。
const characterSeriesLongTimeout = 120 * time.Second

// ListCharacterSeries GET /api/v1/character/series?limit=
func (d Deps) ListCharacterSeries(c *gin.Context) {
	query := url.Values{}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_limit", "message": "limit 必须是 1-100 的整数"})
			return
		}
		query.Set("limit", strconv.Itoa(n))
	}
	subPath := "/series"
	if encoded := query.Encode(); encoded != "" {
		subPath += "?" + encoded
	}
	d.characterOpsProxy(c, http.MethodGet, subPath, nil)
}

// CreateCharacterSeries POST /api/v1/character/series（仅 super_admin）
func (d Deps) CreateCharacterSeries(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxy(c, http.MethodPost, "/series", raw)
}

// GetCharacterSeries GET /api/v1/character/series/:id
func (d Deps) GetCharacterSeries(c *gin.Context) {
	d.characterOpsProxy(c, http.MethodGet, "/series/"+url.PathEscape(c.Param("id")), nil)
}

// RenderCharacterSeries POST /api/v1/character/series/:id/render（仅 super_admin）
// 分批渲染：每批上限 200，未 ready 时由前端反复调用。
func (d Deps) RenderCharacterSeries(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxyTimed(c, http.MethodPost,
		"/series/"+url.PathEscape(c.Param("id"))+"/render", raw, characterSeriesLongTimeout)
}

// AuthorizeCharacterSeries POST /api/v1/character/series/:id/authorize（仅 super_admin）
func (d Deps) AuthorizeCharacterSeries(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxy(c, http.MethodPost,
		"/series/"+url.PathEscape(c.Param("id"))+"/authorize", raw)
}

// MintCharacterSeries POST /api/v1/character/series/:id/mint（仅 super_admin）
// 分批铸造：每批上限 50。
func (d Deps) MintCharacterSeries(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxyTimed(c, http.MethodPost,
		"/series/"+url.PathEscape(c.Param("id"))+"/mint", raw, characterSeriesLongTimeout)
}

// RetryCharacterSeries POST /api/v1/character/series/:id/retry（仅 super_admin）
// 失败条目重铸：每批上限 50。
func (d Deps) RetryCharacterSeries(c *gin.Context) {
	raw, ok := readCharacterBody(c)
	if !ok {
		return
	}
	d.characterOpsProxyTimed(c, http.MethodPost,
		"/series/"+url.PathEscape(c.Param("id"))+"/retry", raw, characterSeriesLongTimeout)
}
