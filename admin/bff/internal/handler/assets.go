package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// 素材上传：仅接受位图，单文件上限 5MB，按内容 SHA256 命名天然去重。
const maxAssetBytes = 5 << 20

var assetNameRE = regexp.MustCompile(`^[a-f0-9]{64}\.(png|jpg|webp)$`)

// assetsDir 素材落盘目录；未配置时使用部署默认值。
func (d Deps) assetsDir() string {
	if dir := strings.TrimSpace(d.Cfg.AssetsDir); dir != "" {
		return dir
	}
	return "/var/lib/openelf-admin/assets"
}

// UploadAsset POST /api/v1/assets（仅 super_admin，multipart 字段名 file）
// 返回可直接公开访问的 URL；同内容重复上传不会产生第二份文件。
func (d Deps) UploadAsset(c *gin.Context) {
	// 请求体整体限流，避免超大 multipart 打满内存/磁盘
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAssetBytes+(1<<20))

	f, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "缺少文件字段 file"})
		return
	}
	if f.Size <= 0 || f.Size > maxAssetBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "asset_too_large", "message": "单文件不超过 5MB"})
		return
	}

	src, err := f.Open()
	if err != nil {
		d.internalError(c, "open uploaded file failed", err)
		return
	}
	defer src.Close()

	buf, err := io.ReadAll(io.LimitReader(src, maxAssetBytes+1))
	if err != nil {
		d.internalError(c, "read uploaded file failed", err)
		return
	}
	if len(buf) > maxAssetBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "asset_too_large", "message": "单文件不超过 5MB"})
		return
	}

	ext, mime, ok := sniffImageExt(buf)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported_type", "message": "仅支持 png / jpg / webp"})
		return
	}

	sum := sha256.Sum256(buf)
	name := hex.EncodeToString(sum[:]) + ext

	dir := d.assetsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		d.internalError(c, "create assets dir failed", err)
		return
	}
	dest := filepath.Join(dir, name)
	if _, statErr := os.Stat(dest); errors.Is(statErr, os.ErrNotExist) {
		tmp := dest + ".tmp-" + time.Now().UTC().Format("20060102150405.000000000")
		if err := os.WriteFile(tmp, buf, 0o644); err != nil {
			d.internalError(c, "write asset failed", err)
			return
		}
		if err := os.Rename(tmp, dest); err != nil {
			_ = os.Remove(tmp)
			d.internalError(c, "rename asset failed", err)
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":     true,
		"name":   name,
		"url":    "/api/v1/assets/" + name,
		"sha256": name[:64],
		"bytes":  len(buf),
		"mime":   mime,
	})
}

// GetAsset GET /api/v1/assets/:name（公开）
// 文件名即内容哈希，可长期缓存。
func (d Deps) GetAsset(c *gin.Context) {
	name := c.Param("name")
	if !assetNameRE.MatchString(name) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "素材不存在"})
		return
	}
	dest := filepath.Join(d.assetsDir(), name)
	if _, err := os.Stat(dest); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "素材不存在"})
		return
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("X-Content-Type-Options", "nosniff")
	c.File(dest)
}

// sniffImageExt 以文件头判定真实类型，不信任客户端文件名。
func sniffImageExt(buf []byte) (ext, mime string, ok bool) {
	head := buf
	if len(head) > 512 {
		head = head[:512]
	}
	switch http.DetectContentType(head) {
	case "image/png":
		return ".png", "image/png", true
	case "image/jpeg":
		return ".jpg", "image/jpeg", true
	case "image/webp":
		return ".webp", "image/webp", true
	default:
		return "", "", false
	}
}
