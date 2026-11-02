'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assets = path.resolve(__dirname, '../../app/assets/captcha');
const source = fs.readFileSync(path.join(assets, 'desktop.js'), 'utf8');
function fixture({ origin = 'https://web.openelfai.com', mode = 'enforce', error } = {}) {
  const calls = [], messages = [];
  let click, proofs = 0;
  const button = { addEventListener(_name, fn) { click = fn; } }, status = {};
  const window = { initAlicom4() {}, chrome: { webview: { postMessage: msg => messages.push(msg) } },
    OpenElfWebCaptcha: { async requestProof() {
      proofs++; if (error) throw Error(error);
      return { platform: 'web', lot_number: 'fixture', pass_token: 'fixture', gen_time: '123', captcha_output: 'fixture' };
    } } };
  vm.runInNewContext(source, { window, location: { origin, hash: '#' + 'a'.repeat(64) },
    document: { getElementById: id => id === 'verify' ? button : status },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ enabled: true, platform: 'web', mode, appId: 'b'.repeat(32) }),
        { headers: { 'content-type': 'application/json' } });
    }, AbortController, setTimeout, clearTimeout });
  return { click: async () => click?.(), calls, messages, proofs: () => proofs, status, button };
}
test('desktop page only reads config, obtains real proof, and binds result to request nonce', async () => {
  const h = fixture(); await h.click(); await h.click();
  assert.equal(h.proofs(), 1); assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].type, 'proof'); assert.equal(h.messages[0].nonce, 'a'.repeat(64));
  assert.deepEqual(h.calls.map(c => c.url), ['https://openelfai.com/api/v1/auth/captcha/config']);
  assert.equal(h.calls[0].options.credentials, 'omit');
});
test('cancel never submits SMS or proof, invalid config cannot bypass verification', async () => {
  const h = fixture({ error: '已取消图形验证' }); await h.click();
  assert.equal(h.messages[0].type, 'cancel'); assert.equal(h.messages[0].proof, undefined);
  const invalid = fixture({ mode: 'off' }); await invalid.click();
  assert.equal(invalid.proofs(), 0); assert.equal(invalid.messages.length, 0);
});
test('foreign origin cannot start a challenge and bundled vendor files stay identical', async () => {
  const h = fixture({ origin: 'https://evil.example' }); await h.click();
  assert.equal(h.calls.length, 0); assert.equal(h.messages.length, 0);
  for (const name of ['ct4.js', 'web-captcha.js']) {
    assert.ok(fs.readFileSync(path.join(assets, name)).equals(
      fs.readFileSync(path.resolve(__dirname, '../../app/web/auth-assets/', name))));
  }
});
