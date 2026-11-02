'use strict';
// Read-only release guard. No environment changes, network, orders or secrets.
const fs = require('node:fs');
const path = require('node:path');
function audit(root, webDir, readSource = relative => fs.readFileSync(path.join(root, relative), 'utf8')) {
  const errors = [];
  const read = relative => {
    try { return readSource(relative); }
    catch { errors.push('Missing business source: ' + relative); return ''; }
  };
  const requireMarkers = (text, markers, label) => {
    for (const marker of markers) if (!text.includes(marker)) errors.push(label + ': missing ' + marker);
  };
  requireMarkers(read('app/lib/pages/wallet_page.dart'),
    ['if (kIsWeb)', 'WebDiamondRechargePanel()', 'IosRechargePanel()', 'AlipayRechargePanel()'], 'wallet');
  requireMarkers(read('app/lib/config/commerce_config.dart'),
    ["'/api/v1/web/wallet'", "'/api/v1/android/wallet'"], 'platform wallets');
  const iap = read('app/lib/config/iap_config.dart');
  requireMarkers(iap, ['TargetPlatform.iOS', '!disabled', '!kIsWeb'], 'iOS StoreKit isolation');
  requireMarkers(read('app/lib/payments/web_diamond_service.dart'),
    ['/api/v1/web/alipay', "catalog['protocol'] != 2"], 'web payment protocol');
  requireMarkers(read('app/lib/payments/alipay_service.dart'),
    ['/api/v1/android/alipay/products', "catalog['protocol'] != 2"], 'Android payment protocol');
  requireMarkers(read('app/lib/payments/ios_iap_service.dart'),
    ['/api/v1/ios/products'], 'iOS products');
  requireMarkers(read('server/src/app.js'),
    ['/api/v1/ios/products', '/api/v1/android/alipay/products', 'registerWebTopup'], 'server wiring');
  const config = read('server/src/config.js');
  if (!/process\.env\.WEB_CAPTCHA_MODE\s*\|\|\s*['"]enforce['"]/.test(config)) {
    errors.push('Web captcha default must stay enforce; omission must not disable it');
  }
  requireMarkers(read('app/web/index.html'), ['auth-assets/captcha-bridge.js'], 'web captcha bootstrap');
  if (webDir) {
    let js = '';
    try { js = fs.readFileSync(path.join(webDir, 'main.dart.js'), 'utf8'); }
    catch { errors.push('Missing compiled web main.dart.js'); }
    js = js.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
      (_, u, x) => String.fromCharCode(parseInt(u || x, 16)));
    requireMarkers(js, ['https://openelfai.com', '/api/v1/web/alipay', '/api/v1/web/wallet',
      '/api/v1/platform/web-topup/products', '支付宝充值 · 请选择充值金额'], 'compiled web');
    if (js.includes('暂无可用充值渠道')) errors.push('Compiled web contains closed-wallet fallback');
    try {
      requireMarkers(fs.readFileSync(path.join(webDir, 'index.html'), 'utf8'),
        ['auth-assets/captcha-bridge.js'], 'compiled captcha entry');
      if (!fs.statSync(path.join(webDir, 'auth-assets/captcha-bridge.js')).isFile()) throw Error();
    } catch { errors.push('Compiled captcha bridge missing'); }
  }
  return errors;
}
module.exports = { audit };
if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const errors = audit(root, process.argv[2] && path.resolve(process.argv[2]));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Business continuity guard passed (source' + (process.argv[2] ? ' + actual web bundle' : '') + '). Not a live payment certification.');
}
