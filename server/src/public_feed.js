'use strict';
const { createCommerceService } = require('./commerce');
const { filterResult, createCommunityService } = require('./community');

// Content is shared across clients. Never infer its environment from StoreKit.
// This adapter cannot create wallets, settle earnings or execute commerce actions.
async function publicFeed(store, user, query = {}) {
  const readOnly = { transaction: (env, work) => {
    if (env !== 'Production') throw new Error('Public content must use Production');
    return store.transaction('Production', async tx => {
      const denied = () => { throw new Error('Public feed cannot mutate funds or content'); };
      return work({ ...tx, put: denied, lockWallet: denied, saveWallet: denied,
        log: denied, legacyGrant: denied,
        async list(kind, options) {
          const rows = await tx.list(kind, options);
          // Filter BEFORE pagination; pending rows cannot create empty early pages.
          return kind === 'post'
            ? (await filterResult(tx, { posts: rows }, user.id)).posts : rows;
        },
      });
    });
  } };
  const reader = createCommerceService({ store: readOnly,
    settings: { enabled: true, sandboxOnly: false, allowSandbox: false } });
  const result = await reader.listFeed(user, { ...query, environment: 'Production' });
  delete result.communityViewer;
  // Public profiles do not grant ownership in a different payment ledger.
  result.elves = result.elves.map(elf => ({ ...elf, isMine: false }));
  const community = await createCommunityService(store).snapshot(user, 'Production');
  return { ...result, protocol: 1, contentEnvironment: 'production', community };
}
module.exports = { publicFeed };
