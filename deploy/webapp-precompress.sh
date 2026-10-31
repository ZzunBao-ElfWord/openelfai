#!/usr/bin/env bash
# 部署后预压缩：把可压缩的静态资源生成 .gz 供 nginx gzip_static 直接下发。
# 用法：bash /usr/local/bin/openelf-webapp-precompress.sh
set -euo pipefail

ROOT=/var/www/openelf-webapp
cd "$ROOT"

# 顶层脚本
for f in main.dart.js flutter.js flutter_bootstrap.js; do
  [ -f "$f" ] && gzip -9 -kf "$f"
done

# CanvasKit 各渲染后端（跳过 .symbols 调试文件）
find canvaskit -type f \( -name '*.wasm' -o -name '*.js' \) ! -name '*.symbols' -print0 \
  | xargs -0 -r -P 4 -I{} gzip -9 -kf {}

chmod 644 "$ROOT"/canvaskit/*.gz 2>/dev/null || true
echo "precompress done"
