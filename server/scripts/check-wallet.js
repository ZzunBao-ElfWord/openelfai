'use strict';
const { createPool } = require('../src/db');
const config = require('../src/config');
(async () => {
  const pool = await createPool(config);
  const [r] = await pool.execute('SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ?', ['u_platform_test_2742863fc5a60030']);
  console.log('余额微元:', r[0].balance_micro, '冻结微元:', r[0].frozen_micro);
  console.log('余额元:', (r[0].balance_micro / 1e6).toFixed(6));
  await pool.end();
})();
