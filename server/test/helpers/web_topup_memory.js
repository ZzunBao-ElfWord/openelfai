'use strict';
function makeDb() {
  const state = { orders: [], wallets: new Map(), ledger: [], calls: [] };

  function execute(sql, params = []) {
    const query = String(sql).replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: query, params });

    if (query.includes('FROM platform_topup_orders')) {
      if (query.includes('WHERE user_id = ? AND request_id = ?')) {
        return [state.orders.filter((row) => row.user_id === params[0] && row.request_id === params[1]), []];
      }
      if (query.includes("WHERE user_id = ? AND status = 'pending' AND expires_at > ?")) {
        return [state.orders.filter((row) => row.user_id === params[0] && row.status === 'pending' &&
          Number(row.expires_at) > Number(params[1]) &&
          (params[2] === undefined || row.app_id === params[2]) && (params[3] === undefined || row.seller_id === params[3])), []];
      }
      if (query.includes('WHERE id = ?')) {
        return [state.orders.filter((row) => row.id === params[0]), []];
      }
      throw new Error('Unexpected topup order SQL: ' + query);
    }

    if (query.startsWith('INSERT INTO platform_topup_orders')) {
      const [id, user_id, tier_id, amount_fen, status, app_id, seller_id, trade_no, request_id,
        created_at, paid_at, expires_at] = params;
      state.orders.push({
        id, user_id, tier_id, amount_fen, status, app_id, seller_id, trade_no, request_id,
        created_at, paid_at, expires_at,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (query.startsWith("UPDATE platform_topup_orders SET status = 'paid'")) {
      const [trade_no, paid_at, id] = params;
      const row = state.orders.find((item) => item.id === id);
      if (row && row.status !== 'paid') {
        row.status = 'paid';
        row.trade_no = trade_no;
        row.paid_at = paid_at;
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith("UPDATE platform_topup_orders SET status = 'closed'")) {
      const row = state.orders.find((item) => item.id === params[0]);
      if (row && row.status === 'pending') row.status = 'closed';
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith('INSERT INTO platform_wallets')) {
      const [user_id, , , , balanceDelta, topupDelta, updatedAt] = params;
      const wallet = state.wallets.get(user_id) || { balance_micro: 0, frozen_micro: 0, total_topup_micro: 0 };
      wallet.balance_micro += balanceDelta;
      wallet.total_topup_micro += topupDelta;
      wallet.updated_at = updatedAt;
      state.wallets.set(user_id, wallet);
      return [{ affectedRows: 1 }, []];
    }

    if (query.includes('FROM platform_wallets WHERE user_id = ?')) {
      const wallet = state.wallets.get(params[0]);
      return [[wallet || { balance_micro: 0, frozen_micro: 0, total_topup_micro: 0 }], []];
    }

    if (query.startsWith('INSERT INTO platform_ledger')) {
      const [user_id, request_id, delta_micro, balance_after, note, created_at] = params;
      state.ledger.push({
        id: state.ledger.length + 1,
        user_id,
        request_id,
        type: 'topup',
        delta_micro,
        balance_after,
        note,
        created_at,
      });
      return [{ insertId: state.ledger.length }, []];
    }

    throw new Error('Unexpected SQL in topup test: ' + query);
  }

  const connection = {
    execute,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  return {
    state,
    calls: state.calls,
    execute,
    async getConnection() { return connection; },
  };
}
module.exports = { makeDb };
