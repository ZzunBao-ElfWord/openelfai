'use strict';
// A station account/resource identifier is not a crypto address or token.
const RESOURCE_POLICY = Object.freeze({ version: 1, kind: 'platform_ai_resource',
  onChain: false, externalWallet: false, externalTransfer: false, resale: false,
  freeInternalGift: true, diamondCashout: false, earningsTransfer: false,
  creatorEarningsSource: 'verified_content_tips', guaranteedReturn: false });
function assertResourceAction(body, fail) {
  if (['mint_nft', 'import_nft', 'export_nft', 'list', 'sell', 'resell', 'transfer_diamonds', 'withdraw_diamonds', 'transfer_earnings'].includes(body?.type)) {
    throw fail(403, 'RESOURCE_OPERATION_DISABLED', '仅支持站内AI服务，不支持NFT、资产寄售或余额转让兑换');
  }
  if (body?.tokenId != null || body?.chainId != null || body?.transactionHash != null || body?.externalWallet != null) {
    throw fail(400, 'EXTERNAL_ASSET_UNSUPPORTED', '不接入链上资产或外部钱包');
  }
  if (body?.type === 'gift_elf' && ['price', 'amount', 'payment', 'consideration'].some(key => body[key] != null)) {
    throw fail(400, 'GIFT_MUST_BE_FREE', '站内转赠不能附带价格、付款或交换条件');
  }
}
module.exports = { RESOURCE_POLICY, assertResourceAction };
