'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../app/web/auth-assets/captcha-bridge.js'), 'utf8');
function harness(response) {
  const calls = [];
  let proofs = 0;
  const window = { initAlicom4() {}, OpenElfWebCaptcha: { async requestProof() {
    proofs++; return { platform: 'web', lot_number: 'fixture-lot' };
  } } };
  vm.runInNewContext(source, { window, document: { createElement() { throw Error('SDK should already be loaded'); } },
    fetch: async (url, options) => { calls.push({ url, options }); return response; },
    AbortController, setTimeout, clearTimeout, Map, JSON, String });
  return { window, calls, proofs: () => proofs };
}
test('web captcha config uses real API origin, not Flutter HTML fallback, and never sends SMS', async () => {
  const h = harness(new Response(JSON.stringify({ enabled: true, platform: 'web', appId: 'a'.repeat(32) }),
    { headers: { 'content-type': 'application/json' } }));
  const proof = JSON.parse(await h.window.OpenElfCaptcha.requestJson());
  assert.equal(proof.platform, 'web');
  assert.equal(h.proofs(), 1);
  assert.deepEqual(h.calls.map(call => call.url), ['https://openelfai.com/api/v1/auth/captcha/config']);
  assert.equal(h.calls[0].options.credentials, 'omit');
});
test('HTML response fails before challenge or SMS with a useful error', async () => {
  const h = harness(new Response('<!DOCTYPE html><html></html>', { headers: { 'content-type': 'text/html' } }));
  const result = JSON.parse(await h.window.OpenElfCaptcha.requestJson());
  assert.match(result.error, /接口返回格式异常/);
  assert.equal(h.proofs(), 0);
  assert.equal(h.calls.length, 1);
});
