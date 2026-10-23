#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/openelf-api
ENV_FILE=/etc/openelf-api.env
SERVICE=openelf-api
PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

test "$(id -u)" -eq 0 || { echo '请使用 sudo bash 执行'; exit 1; }
test "$(realpath "$APP_DIR")" = /opt/openelf-api
test -f "$ENV_FILE"
systemctl is-active --quiet "$SERVICE"
# Never print environment values or load secrets into a shell.
node --env-file="$ENV_FILE" - <<'NODE'
const e = process.env;
if (!['true', 'false'].includes(e.APPLE_IAP_ENABLED)) throw new Error('请先明确配置 APPLE_IAP_ENABLED=true 或 false');
if (e.APPLE_IAP_APP_ID !== '6761752635' || e.APPLE_IAP_BUNDLE_ID !== 'com.ai.openelf') {
  throw new Error('OpenElf 应用标识未正确配置');
}
if (e.APPLE_IAP_PRIVATE_KEY_PATH !== '/etc/openelf/keys/SubscriptionKey_P245X949C7.p8') {
  throw new Error('内购私钥路径未正确配置');
}
require('node:crypto').createPrivateKey(require('node:fs').readFileSync(e.APPLE_IAP_PRIVATE_KEY_PATH));
console.log('应用标识和私钥格式检查通过（未输出密钥）');
NODE
sudo -u openelf test -r /etc/openelf/keys/SubscriptionKey_P245X949C7.p8
node "$PACKAGE_DIR/deploy/apple/patch.cjs" "$APP_DIR" --check
node --test "$PACKAGE_DIR/test/apple_iap.test.js" "$PACKAGE_DIR/test/apple_deploy.test.js"

BACKUP_DIR="$(mktemp -d /opt/openelf-apple-backup-XXXXXXXX)"
chmod 700 "$BACKUP_DIR"
mkdir "$BACKUP_DIR/src"
for file in src/app.js src/config.js src/db.js package.json; do
  cp -p "$APP_DIR/$file" "$BACKUP_DIR/$file"
done
for module in apple_iap apple_orders payment_store commerce; do
  if [ -f "$APP_DIR/src/$module.js" ]; then
    cp -p "$APP_DIR/src/$module.js" "$BACKUP_DIR/src/$module.js"
  fi
done
rollback() {
  trap - ERR
  for file in src/app.js src/config.js src/db.js package.json; do
    cp -p "$BACKUP_DIR/$file" "$APP_DIR/$file"
  done
  for module in apple_iap apple_orders payment_store commerce; do
    if [ -f "$BACKUP_DIR/src/$module.js" ]; then
      cp -p "$BACKUP_DIR/src/$module.js" "$APP_DIR/src/$module.js"
    fi
  done
  systemctl restart "$SERVICE" || true
  echo "更新失败，已恢复原入口、配置、表定义和依赖清单。备份：$BACKUP_DIR"
  echo '新建的数据库表（如有）会保留，不删除任何业务数据。'
  exit 1
}
trap rollback ERR
for module in apple_iap apple_orders payment_store commerce; do
  install -m 644 "$PACKAGE_DIR/src/$module.js" "$APP_DIR/src/$module.js"
done
node "$PACKAGE_DIR/deploy/apple/patch.cjs" "$APP_DIR"
install -d -m 755 "$APP_DIR/deploy/apple"
for script in check-runtime.cjs reconcile.cjs; do
  install -m 644 "$PACKAGE_DIR/deploy/apple/$script" "$APP_DIR/deploy/apple/$script"
done
for file in app config db apple_iap apple_orders payment_store commerce; do
  node --check "$APP_DIR/src/$file.js"
done
# The SDK is imported only when payments are enabled. Do not change installed
# SMS/captcha dependencies during this disabled foundation deployment.
systemctl restart "$SERVICE"
HEALTHY=false
for attempt in {1..15}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8787/api/v1/health >/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 1
done
test "$HEALTHY" = true || rollback
trap - ERR
echo "苹果支付与钻石消费代码已更新，支付开关保持原值。代码备份：$BACKUP_DIR"
echo '未修改环境文件、短信和图形验证码代码；未安装或升级依赖。'
echo '新增表仅创建，不删除或清空业务数据。请继续验证数据库、通知回调及 iPhone 沙盒，不要直接启用正式收款。'
