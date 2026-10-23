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
node --env-file="$ENV_FILE" - <<'NODE'
for (const k of ['ALIYUN_CLOUDAUTH_ACCESS_KEY_ID', 'ALIYUN_CLOUDAUTH_ACCESS_KEY_SECRET']) {
  if (!(process.env[k] || '').trim()) throw new Error(k + ' 未填写');
}
if (process.env.ALIYUN_CLOUDAUTH_ENABLED !== 'true') throw new Error('实名认证开关未开启');
console.log('私有配置检查通过（未输出密钥）');
NODE
node "$PACKAGE_DIR/deploy/identity/patch.cjs" "$APP_DIR" --check
BACKUP_DIR="$(mktemp -d /opt/openelf-identity-backup-XXXXXXXX)"
chmod 700 "$BACKUP_DIR"
mkdir "$BACKUP_DIR/src"
for file in src/app.js src/config.js src/db.js package.json package-lock.json src/identity.js; do
  if [ -f "$APP_DIR/$file" ]; then cp -p "$APP_DIR/$file" "$BACKUP_DIR/$file"; fi
done
rollback() {
  trap - ERR
  for file in src/app.js src/config.js src/db.js package.json package-lock.json; do
    if [ -f "$BACKUP_DIR/$file" ]; then cp -p "$BACKUP_DIR/$file" "$APP_DIR/$file"; fi
  done
  if [ -f "$BACKUP_DIR/src/identity.js" ]; then cp -p "$BACKUP_DIR/src/identity.js" "$APP_DIR/src/identity.js"; fi
  systemctl restart "$SERVICE" || true
  echo "部署失败，已恢复原源码和依赖清单。备份：$BACKUP_DIR"
  echo '新增依赖和新增数据库表保留；未删除业务数据。'
  exit 1
}
trap rollback ERR
node "$PACKAGE_DIR/deploy/identity/patch.cjs" "$APP_DIR"
install -m 644 "$PACKAGE_DIR/src/identity.js" "$APP_DIR/src/identity.js"
cd "$APP_DIR"
npm install --omit=dev --ignore-scripts
for file in app config db identity; do node --check "src/$file.js"; done
node - <<'NODE'
const sdk = require('@alicloud/cloudauth20190307');
if (typeof sdk.default.prototype.id2MetaVerifyWithOCRAdvance !== 'function') throw new Error('实人认证SDK不完整');
console.log('阿里云SDK检查通过');
NODE
systemctl restart "$SERVICE"
READY=false
for attempt in {1..15}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8787/api/v1/health >/dev/null; then READY=true; break; fi
  sleep 1
done
test "$READY" = true
STATUS="$(curl --silent --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/v1/identity/status)"
test "$STATUS" = 401
trap - ERR
echo "实名认证接口部署完成；未登录返回401，符合预期。备份：$BACKUP_DIR"
echo '尚需公网Nginx转发、客户端更新及真实证件联调；本脚本未发起收费核验。'
