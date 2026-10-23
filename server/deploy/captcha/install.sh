#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/openelf-api
ENV_FILE=/etc/openelf-api.env
SERVICE=openelf-api
PACKAGE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo '请使用 sudo bash 执行此脚本。'
  exit 1
fi
test "$(realpath "$APP_DIR")" = /opt/openelf-api
test -f "$ENV_FILE"
test -f "$APP_DIR/src/app.js"
test -f "$APP_DIR/src/config.js"
systemctl is-active --quiet "$SERVICE"

# Validate private settings without printing their values or contacting Alibaba.
node --env-file="$ENV_FILE" - "$PACKAGE_DIR" <<'NODE'
const { createCaptchaVerifier } = require(process.argv[2] + '/src/captcha.js');
const e = process.env;
if (!['true', '1'].includes((e.ALIYUN_CAPTCHA_ENABLED || '').toLowerCase())) {
  throw new Error('请先在 /etc/openelf-api.env 设置 ALIYUN_CAPTCHA_ENABLED=true');
}
const expected = {
  ANDROID: '2d129e705ac4cd4df085390ec213b492',
  IOS: 'a6a503af8a6273b0c3842ef3432f08a1',
};
const schemes = {};
for (const [platform, appId] of Object.entries(expected)) {
  const appKey = (e[`ALIYUN_CAPTCHA_${platform}_APP_KEY`] || '').trim();
  if (e[`ALIYUN_CAPTCHA_${platform}_APP_ID`] !== appId ||
      !appKey || /填写|appKey|placeholder/i.test(appKey)) {
    throw new Error(`${platform} 的 appId 或 appKey 未正确配置；请修改 /etc/openelf-api.env`);
  }
  schemes[platform.toLowerCase()] = { appId, appKey };
}
createCaptchaVerifier({ enabled: true, schemes });
console.log('图形验证配置检查通过（密钥未输出）');
NODE

node "$PACKAGE_DIR/deploy/captcha/patch.cjs" "$APP_DIR" --check
node "$PACKAGE_DIR/test/captcha.test.js"
BACKUP_DIR="$(mktemp -d /opt/openelf-captcha-backup-XXXXXXXX)"
chmod 700 "$BACKUP_DIR"
cp -p "$APP_DIR/src/app.js" "$BACKUP_DIR/app.js"
cp -p "$APP_DIR/src/config.js" "$BACKUP_DIR/config.js"
if [ -f "$APP_DIR/src/captcha.js" ]; then
  cp -p "$APP_DIR/src/captcha.js" "$BACKUP_DIR/captcha.js"
fi

rollback() {
  trap - ERR
  cp -p "$BACKUP_DIR/app.js" "$APP_DIR/src/app.js"
  cp -p "$BACKUP_DIR/config.js" "$APP_DIR/src/config.js"
  if [ -f "$BACKUP_DIR/captcha.js" ]; then
    cp -p "$BACKUP_DIR/captcha.js" "$APP_DIR/src/captcha.js"
  fi
  systemctl restart "$SERVICE" || true
  echo "更新失败，已恢复原入口和配置。备份：$BACKUP_DIR"
  exit 1
}
trap rollback ERR
install -m 644 "$PACKAGE_DIR/src/captcha.js" "$APP_DIR/src/captcha.js"
node "$PACKAGE_DIR/deploy/captcha/patch.cjs" "$APP_DIR"
node --check "$APP_DIR/src/app.js"
node --check "$APP_DIR/src/config.js"
node --check "$APP_DIR/src/captcha.js"
systemctl restart "$SERVICE"

HEALTHY=false
for attempt in {1..15}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8787/api/v1/health >/dev/null; then
    HEALTHY=true
    break
  fi
  sleep 1
done
if [ "$HEALTHY" != true ]; then
  echo '服务健康检查失败。'
  rollback
fi
trap - ERR
echo "图形验证更新成功；代码备份：$BACKUP_DIR"
echo '还需安装配置了新方案 ID 的客户端，在手机上完成验证码和短信登录联调。'
