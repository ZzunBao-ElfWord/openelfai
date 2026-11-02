package handler

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// workBuddyCheck 与 workbuddy/scripts/validate.mjs 产出的检查项对齐。
type workBuddyCheck struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// workBuddyFile 包内文件清单（相对包目录）。
type workBuddyFile struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
}

// workBuddyPackage 单个上架包：元信息、依赖、文件与校验结果。
type workBuddyPackage struct {
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	Version      string `json:"version"`
	Dir          string `json:"dir"`
	Dependencies struct {
		Connectors []string `json:"connectors"`
	} `json:"dependencies"`
	Files  []workBuddyFile  `json:"files"`
	Checks []workBuddyCheck `json:"checks"`
	OK     bool             `json:"ok"`
}

// workBuddyManifest 对应 dist/manifest.json。
type workBuddyManifest struct {
	GeneratedAt string             `json:"generated_at"`
	Packages    []workBuddyPackage `json:"packages"`
}

// ListWorkBuddyPackages GET /api/v1/workbuddy/packages
// 只读展示 WorkBuddy 上架包清单与本地校验结果；文件缺失返回 available=false，
// 由前端提示先执行 workbuddy/scripts/validate.mjs 并同步目录。
func (d Deps) ListWorkBuddyPackages(c *gin.Context) {
	dir := d.Cfg.WorkBuddyDir
	resp := gin.H{
		"available":    false,
		"dir":          dir,
		"generated_at": "",
		"releases":     "",
		"message":      "",
		"packages":     []workBuddyPackage{},
	}

	raw, err := os.ReadFile(filepath.Join(dir, "dist", "manifest.json"))
	if err != nil {
		// 目录未同步属于预期状态，不当成服务异常
		resp["message"] = "未找到 dist/manifest.json，请先执行 node scripts/validate.mjs 并把 workbuddy 目录同步到该路径"
		c.JSON(http.StatusOK, resp)
		return
	}

	var manifest workBuddyManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		resp["message"] = "manifest.json 解析失败，请重新执行 node scripts/validate.mjs"
		c.JSON(http.StatusOK, resp)
		return
	}

	resp["available"] = true
	resp["generated_at"] = manifest.GeneratedAt
	resp["packages"] = manifest.Packages
	if manifest.Packages == nil {
		resp["packages"] = []workBuddyPackage{}
	}

	// 发布记录为原始 Markdown，前端按纯文本展示，不做渲染
	if rel, relErr := os.ReadFile(filepath.Join(dir, "RELEASES.md")); relErr == nil {
		resp["releases"] = string(rel)
	}
	c.JSON(http.StatusOK, resp)
}
