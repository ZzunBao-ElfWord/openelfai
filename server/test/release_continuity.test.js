'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { audit } = require('../deploy/verify_business.cjs');
const root = path.resolve(__dirname, '../..');
test('integrated source preserves all three payment entries and enforced captcha', () => {
  assert.deepEqual(audit(root), []);
});
for (const marker of ['WebDiamondRechargePanel()', 'IosRechargePanel()', 'AlipayRechargePanel()']) {
  test('guard fails when a platform payment entry disappears: ' + marker, () => {
    const errors = audit(root, undefined, relative => {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      return relative === 'app/lib/pages/wallet_page.dart' ? source.replaceAll(marker, 'RemovedPanel()') : source;
    });
    assert.ok(errors.some(x => x.includes('wallet: missing ' + marker)));
  });
}
test('guard fails when default web captcha changes back to off', () => {
  const errors = audit(root, undefined, relative => {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    return relative === 'server/src/config.js' ? source.replace("WEB_CAPTCHA_MODE || 'enforce'", "WEB_CAPTCHA_MODE || 'off'") : source;
  });
  assert.ok(errors.some(x => x.includes('captcha default')));
});
test('guard rejects old/empty web bundle instead of treating compilation as release acceptance', () => {
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'openelf-web-guard-'));
  try {
    fs.writeFileSync(path.join(web, 'main.dart.js'), '暂无可用充值渠道');
    const errors = audit(root, web);
    assert.ok(errors.some(x => x.includes('compiled web: missing /api/v1/web/alipay')));
    assert.ok(errors.some(x => x.includes('closed-wallet')));
    assert.ok(errors.some(x => x.includes('captcha')));
  } finally {
    // Only files created by this test, no recursive deletion or broad paths.
    fs.unlinkSync(path.join(web, 'main.dart.js'));
    fs.rmdirSync(web);
  }
});
