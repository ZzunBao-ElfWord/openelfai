#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/openelf-api
ENV_FILE=/etc/openelf-api.env
SERVICE=openelf-api
test "$(id -u)" -eq 0 || { echo '请使用 sudo bash 执行'; exit 1; }
test "$(realpath "$APP_DIR")" = /opt/openelf-api
grep -q APPLE_IAP_SANDBOX_ONLY "$APP_DIR/src/config.js"
grep -q apple_iap_sandbox_wallets "$APP_DIR/src/db.js"
grep -q 'appAccountToken: appleIap.accountToken' "$APP_DIR/src/app.js"
sudo -u openelf test -r /etc/openelf/keys/SubscriptionKey_P245X949C7.p8
cd "$APP_DIR"
node --env-file="$ENV_FILE" - <<'NODE'
const config = require('./src/config');
const { createAppleIapService, createAppleVerifier } = require('./src/apple_iap');
const settings = { ...config.appleIap, enabled: true, sandboxOnly: true, allowSandbox: true };
createAppleIapService({ db: {}, settings });
createAppleVerifier(settings).then(() => console.log('沙盒 SDK、证书、密钥和商品配置检查通过'))
  .catch(() => { console.error('检查失败，未开启沙盒；请先核对 Apple SDK、证书和配置'); process.exitCode = 1; });
NODE

BACKUP_DIR="$(mktemp -d /root/openelf-apple-sandbox-backup-XXXXXXXX)"
chmod 700 "$BACKUP_DIR"
cp -p "$ENV_FILE" "$BACKUP_DIR/openelf-api.env"
rollback() {
  trap - ERR
  cp -p "$BACKUP_DIR/openelf-api.env" "$ENV_FILE"
  systemctl restart "$SERVICE" || true
  echo "沙盒启动失败，已恢复环境配置。备份：$BACKUP_DIR"
  exit 1
}
trap rollback ERR
node - "$ENV_FILE" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const filename = process.argv[2];
const stat = fs.statSync(filename);
let content = fs.readFileSync(filename, 'utf8');
for (const name of ['APPLE_IAP_ENABLED', 'APPLE_IAP_SANDBOX_ONLY', 'APPLE_IAP_ALLOW_SANDBOX']) {
  const pattern = new RegExp('^' + name + '=.*$', 'gm');
  const matches = content.match(pattern) || [];
  if (matches.length > 1) throw new Error(name + ' 存在重复项，请先整理配置');
  content = matches.length ? content.replace(pattern, name + '=true') : content.trimEnd() + '\n' + name + '=true\n';
}
const temporary = filename + '.apple-' + crypto.randomUUID();
fs.writeFileSync(temporary, content, { mode: stat.mode & 0o777, flag: 'wx' });
fs.chownSync(temporary, stat.uid, stat.gid);
fs.renameSync(temporary, filename);
NODE
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
echo '沙盒支付已开启：仅接受 Sandbox 交易，测试钻石进入独立沙盒账本。'
echo '正式支付未开放，未接受真实交易；短信和其他环境配置保持原值。'
echo "原环境配置备份：$BACKUP_DIR"
