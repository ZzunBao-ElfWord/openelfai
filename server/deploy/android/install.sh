#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/openelf-api
ENV_FILE=/etc/openelf-api.env
PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
test "$(id -u)" -eq 0 || { echo '请用 sudo bash 执行'; exit 1; }
test "$(realpath "$APP_DIR")" = /opt/openelf-api
test -f "$ENV_FILE"
systemctl is-active --quiet openelf-api
node "$PACKAGE_DIR/deploy/android/patch.cjs" "$APP_DIR" --check
node --test "$PACKAGE_DIR/test/alipay.test.js" "$PACKAGE_DIR/test/apple_iap.test.js" "$PACKAGE_DIR/test/apple_deploy.test.js" "$PACKAGE_DIR/test/android_deploy.test.js"
BACKUP_DIR="$(mktemp -d /opt/openelf-android-backup-XXXXXXXX)"
chmod 700 "$BACKUP_DIR"
mkdir "$BACKUP_DIR/src"
for file in src/app.js src/config.js src/db.js package.json; do cp -p "$APP_DIR/$file" "$BACKUP_DIR/$file"; done
MODULES=(apple_iap apple_orders payment_store commerce alipay alipay_gateway)
for module in "${MODULES[@]}"; do
  if [ -f "$APP_DIR/src/$module.js" ]; then cp -p "$APP_DIR/src/$module.js" "$BACKUP_DIR/src/$module.js"; fi
done
rollback() {
  trap - ERR
  for file in src/app.js src/config.js src/db.js package.json; do cp -p "$BACKUP_DIR/$file" "$APP_DIR/$file"; done
  for module in "${MODULES[@]}"; do
    if [ -f "$BACKUP_DIR/src/$module.js" ]; then cp -p "$BACKUP_DIR/src/$module.js" "$APP_DIR/src/$module.js"; fi
  done
  systemctl restart openelf-api || true
  echo "启动失败，已恢复原入口与模块；新增空表保留，不删除业务数据。备份：$BACKUP_DIR"
  exit 1
}
trap rollback ERR
for module in "${MODULES[@]}"; do install -m 644 "$PACKAGE_DIR/src/$module.js" "$APP_DIR/src/$module.js"; done
node "$PACKAGE_DIR/deploy/android/patch.cjs" "$APP_DIR"
for module in app config db "${MODULES[@]}"; do node --check "$APP_DIR/src/$module.js"; done
systemctl restart openelf-api
HEALTHY=false
for attempt in {1..15}; do
  if curl -fSs --max-time 2 http://127.0.0.1:8787/api/v1/health >/dev/null; then HEALTHY=true; break; fi
  sleep 1
done
test "$HEALTHY" = true || rollback
trap - ERR
echo "安卓代码更新成功，所有支付开关和 env 保持原值。备份：$BACKUP_DIR"
echo '未安装依赖、未启用支付宝、未改短信或验证码；请按 ANDROID_ALIPAY_SETUP.md 开启钱包并验证。'
