const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileStore } = require('../auth_service');
const { parseProducts, createAppleIapService } = require('../apple_iap_service');

test('product catalog rejects invalid amounts', () => {
  assert.deepEqual(parseProducts(''), {});
  assert.deepEqual(parseProducts('{"com.ai.openelf.coins10":10}'), { 'com.ai.openelf.coins10': 10 });
  assert.throws(() => parseProducts('{"bad":0}'));
});

test('verified Apple transactions grant once and cannot be transferred', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openelf-iap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.json');
  let checks = 0;
  const store = new JsonFileStore(filename);
  const service = createAppleIapService({
    store,
    products: { 'com.ai.openelf.coins10': 10 },
    enabled: true,
    verifyTransaction: async (id) => {
      checks += 1;
      return { transactionId: id, productId: 'com.ai.openelf.coins10', revocationDate: null };
    },
  });
  const id = '2000000001234567';
  const first = await service.verify('13800138000', 'com.ai.openelf.coins10', id);
  assert.deepEqual(first.wallet, { diamonds: 10, totalRecharged: 10 });
  assert.equal(first.alreadyProcessed, false);
  const second = await service.verify('13800138000', 'com.ai.openelf.coins10', id);
  assert.equal(second.alreadyProcessed, true);
  assert.equal(checks, 1);
  await assert.rejects(() => service.verify('13900139000', 'com.ai.openelf.coins10', id), { status: 409 });
  assert.equal(new JsonFileStore(filename).data.wallets['13800138000'].diamonds, 10);
});
