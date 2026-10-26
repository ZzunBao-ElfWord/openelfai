// Package web 通过 go:embed 承载前端构建产物，使最终交付物为单个二进制。
// 部署时把前端构建产物拷贝到本目录的 dist/ 后再编译；
// 本地无前端构建时仅有 dist/.gitkeep，静态路由返回 404 提示，不影响 /api 运行。
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Dist 返回可直接交给 http.FileServer 的子文件系统。
func Dist() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
