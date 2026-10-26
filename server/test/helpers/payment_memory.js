'use strict';

const clone = (value) => value == null ? value : structuredClone(value);

function memoryStore() {
  let state = { users: new Map(), wallets: new Map(), objects: new Map(), legacy: new Map(), logs: new Map() };
  let queue = Promise.resolve();
  return {
    addUser(user) { state.users.set(user.id, { status: 'active', ...user }); },
    inspect() { return clone(state); },
    seedLegacy(environment, order, balance) {
      state.legacy.set(environment + ':' + order.transaction_id, clone(order));
      state.wallets.set(environment + ':' + order.user_id, {
        diamonds: balance, totalRecharged: order.diamonds, totalSpent: 0, refundDebt: 0, earningsFen: 0, version: 0,
      });
    },
    transaction(environment, work) {
      const result = queue.then(async () => {
        const next = clone(state);
        const prefix = environment + ':';
        const objectKey = (kind, id) => prefix + kind + ':' + id;
        const tx = {
          async user(id) { return clone(next.users.get(id)); },
          async userByPhone(phone) {
            for (const user of next.users.values()) if (user.phone === phone) return clone(user);
            return undefined;
          },
          async userByHumanAddress(humanAddress) {
            for (const row of next.objects.values()) {
              if (row.environment !== environment || row.kind !== 'profile') continue;
              if (row.value?.humanAddress === humanAddress) return clone(next.users.get(row.owner));
            }
            return undefined;
          },
          async lockWallet(id) {
            if (!next.users.has(id)) throw new Error('Foreign key: missing user');
            const key = prefix + id;
            if (!next.wallets.has(key)) next.wallets.set(key, {
              diamonds: 0, totalRecharged: 0, totalSpent: 0, refundDebt: 0, earningsFen: 0, version: 0,
              pendingCents: 0, availableCents: 0, withdrawnCents: 0,
            });
            const wallet = next.wallets.get(key);
            // 老测试数据没有收益三档字段，这里补齐默认值。
            for (const field of ['pendingCents', 'availableCents', 'withdrawnCents']) {
              if (wallet[field] === undefined) wallet[field] = 0;
            }
            return clone(wallet);
          },
          async saveWallet(id, wallet) {
            for (const n of Object.values(wallet)) if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid wallet');
            next.wallets.set(prefix + id, clone(wallet));
          },
          async get(kind, id) { return clone(next.objects.get(objectKey(kind, id))?.value || null); },
          async put(kind, id, value, options = {}) { next.objects.set(objectKey(kind, id), { environment, kind, id, value: clone(value), ...options }); },
          async list(kind, { owner, state: status, ref, limit = 200 } = {}) {
            return [...next.objects.values()].filter((row) => row.environment === environment && row.kind === kind &&
              (owner === undefined || row.owner === owner) && (status === undefined || row.state === status) &&
              (ref === undefined || row.ref === ref))
              .reverse().slice(0, limit).map((row) => clone(row.value));
          },
          async legacyOrder(id) { return clone(next.legacy.get(prefix + id) || null); },
          async legacyGrant(order) {
            if (!next.legacy.has(prefix + order.id)) next.legacy.set(prefix + order.id, {
              transaction_id: order.id, user_id: order.userId, product_id: order.productId, diamonds: order.amount,
            });
          },
          async logExists(id, event) { return next.logs.has(prefix + id + ':' + event); },
          async log(id, event, type, amount, wallet, note) {
            const key = prefix + id + ':' + event;
            if (next.logs.has(key)) throw new Error('Duplicate ledger event');
            next.logs.set(key, { id: event, environment, userId: id, type, amount, wallet: clone(wallet), note, time: 'now' });
          },
          async logs(id) { return [...next.logs.values()].filter((row) => row.environment === environment && row.userId === id).reverse().map(clone); },
        };
        const value = await work(tx);
        state = next;
        return value;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { memoryStore };
