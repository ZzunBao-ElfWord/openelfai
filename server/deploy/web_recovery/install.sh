#!/usr/bin/env bash
set -euo pipefail
MODE=${1:-}
case "$MODE" in --check|--install) ;; *) echo '使用 bash install.sh --check 或 --install'; exit 1;; esac
test "$(id -u)" -eq 0 || { echo '请使用root'; exit 1; }
PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT=/var/www/openelf-webapp
test -d "$WEB_ROOT" && test ! -L "$WEB_ROOT"
test "$(realpath "$WEB_ROOT")" = "$WEB_ROOT"
test -f "$WEB_ROOT/main.dart.js" && test -f "$WEB_ROOT/index.html"
test ! -L "$WEB_ROOT/main.dart.js" && test ! -L "$WEB_ROOT/index.html"
test -f "$PACKAGE_DIR/site/auth-assets/captcha-bridge.js"
test -f "$PACKAGE_DIR/site/openelf-release.json"
if find "$PACKAGE_DIR/site" -type l -print -quit | grep -q .; then
  echo '包内符号链接被拒绝'; exit 1
fi
(cd "$PACKAGE_DIR" && sha256sum --quiet -c SHA256SUMS)
node - "$PACKAGE_DIR/site" <<'JS'
const fs = require('node:fs'), path = require('node:path');
const root = process.argv[2];
let js = fs.readFileSync(path.join(root, 'main.dart.js'), 'utf8');
js = js.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, u, x) => String.fromCharCode(parseInt(u || x, 16)));
for (const marker of ['https://openelfai.com', '/api/v1/web/alipay', '/api/v1/web/wallet',
  '/api/v1/platform/web-topup/products', '支付宝充值 · 请选择充值金额']) {
  if (!js.includes(marker)) throw Error('缺少网页业务构建标记：' + marker);
}
if (js.includes('暂无可用充值渠道')) throw Error('误入关闭充值的构建，停止');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!index.includes('auth-assets/captcha-bridge.js')) throw Error('缺少验证码桥接入口');
console.log('实际网页构建：钻石充值、API余额充值、正确API域名及验证码入口标记通过');
JS
for ROUTE in /api/v1/web/alipay/products /api/v1/platform/web-topup/products; do
  RESULT=$(curl --noproxy '*' -sS --connect-timeout 3 --max-time 10 \
    -w '\n%{http_code}' "http://127.0.0.1:8787$ROUTE")
  test "${RESULT##*$'\n'}" = 401 || { echo "路由预检失败：$ROUTE"; exit 1; }
  printf '%s' "${RESULT%$'\n'*}" | node -e '
    let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
      if(JSON.parse(s).error?.code!=="UNAUTHORIZED")process.exit(1);
    });'
done
curl --noproxy '*' -fsS --connect-timeout 3 --max-time 10 \
  http://127.0.0.1:8787/api/v1/auth/captcha/config | node -e '
  let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
    const d=JSON.parse(s);if(d.enabled!==true||d.mode!=="enforce")process.exit(1);
  });'
ORIGINAL=$(sha256sum "$WEB_ROOT/main.dart.js" | cut -d ' ' -f 1)
echo "原网页主包SHA256=$ORIGINAL"
echo '预检通过：接口存在且要求登录；验证码仍强制。匿名401不代表实际付款已验收。'
if test "$MODE" = --check; then
  echo '只读预检完成：未替换文件、未重启服务、未修改配置或数据库。'; exit 0
fi

STAGE=$(mktemp -d /var/www/openelf-webapp-release-XXXXXXXX)
cp -a "$PACKAGE_DIR/site/." "$STAGE/"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
test "$(sha256sum "$WEB_ROOT/main.dart.js" | cut -d ' ' -f 1)" = "$ORIGINAL" || {
  echo "网页部署时发生并发变更，停止。待查暂存目录：$STAGE"; exit 1;
}
BACKUP=$(mktemp -d /var/www/openelf-webapp-backup-XXXXXXXX)
chmod 700 "$BACKUP"
SWITCHED=0
COMPLETE=0
finish() {
  RESULT=$?
  trap - EXIT
  if test "$SWITCHED" = 1 && test "$COMPLETE" = 0; then
    if test -d "$WEB_ROOT"; then
      FAILED=$(mktemp -d /var/www/openelf-webapp-failed-XXXXXXXX)
      chmod 700 "$FAILED"
      mv -- "$WEB_ROOT" "$FAILED/site"
      echo "失败构建保留于：$FAILED/site"
    fi
    mv -- "$BACKUP/site" "$WEB_ROOT"
    echo "安装未通过，原网页已恢复；备份来源：$BACKUP/site"
    RESULT=1
  fi
  exit "$RESULT"
}
trap finish EXIT
echo "准备保留原网页：$BACKUP/site"
mv -- "$WEB_ROOT" "$BACKUP/site"
SWITCHED=1
mv -- "$STAGE" "$WEB_ROOT"
CHECK_DIR=$(mktemp -d /tmp/openelf-web-recovery-check-XXXXXXXX)
for FILE in main.dart.js index.html flutter_bootstrap.js auth-assets/captcha-bridge.js openelf-release.json; do
  mkdir -p "$CHECK_DIR/$(dirname "$FILE")"
  curl --noproxy '*' -fsS --connect-timeout 10 --max-time 240 \
    --retry 2 --retry-delay 2 --retry-max-time 720 \
    "https://web.openelfai.com/$FILE?release=web-recovery-20261102" -o "$CHECK_DIR/$FILE"
  test "$(sha256sum "$CHECK_DIR/$FILE" | cut -d ' ' -f 1)" = \
    "$(sha256sum "$PACKAGE_DIR/site/$FILE" | cut -d ' ' -f 1)"
done
COMPLETE=1
echo "网页充值恢复版已部署，5项公网文件哈希匹配。原网页备份：$BACKUP/site"
echo '只更新网页文件；未重启API，未修改Nginx/支付密钥/业务开关/环境文件/数据库，未创建订单或付款。'
echo '仍须登录网页验证充值档位、余额、扫码入口。真实支付需用户另行确认。'
