#!/usr/bin/env python3
"""Flutter Web 构建后处理：给主包加版本参数、关闭已废弃的 Service Worker。

问题背景：
1. 老访客浏览器里可能残留一份旧的 main.dart.js（旧部署没配 Cache-Control，
   浏览器按启发式规则缓存数天），表现为"已经发版但打开的还是旧界面"。
2. Flutter 默认在 flutter_bootstrap.js 里注册 Service Worker，SW 会继续
   吐旧构建，且跨版本难以失效。

处理方式：把 mainJsPath 改成带内容哈希的 URL（缓存键变化，天然拿到新包），
并去掉 serviceWorkerSettings（不再注册 SW）。文件名仍叫 main.dart.js，
nginx 无需额外路由。

用法：python deploy/webapp-postbuild.py <build/web 目录>
"""
import hashlib
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\openelf_build\build\web")
main_js = root / "main.dart.js"
bootstrap = root / "flutter_bootstrap.js"

version = hashlib.sha256(main_js.read_bytes()).hexdigest()[:10]

src = bootstrap.read_text(encoding="utf-8")
src = src.replace('"mainJsPath":"main.dart.js"', f'"mainJsPath":"main.dart.js?v={version}"')
src = re.sub(r"_flutter\.loader\.load\(\{[\s\S]*?\}\);\s*$", "_flutter.loader.load();\n", src)

bootstrap.write_text(src, encoding="utf-8")

if not src.rstrip().endswith("_flutter.loader.load();"):
    sys.exit("postbuild: 未关闭 Service Worker 注册")
if f"main.dart.js?v={version}" not in src:
    sys.exit("postbuild: 版本参数未写入")

print(f"postbuild ok: main.dart.js?v={version}")
