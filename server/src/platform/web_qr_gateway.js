'use strict';
const fs = require('node:fs');
const { createAlipayGateway, shanghaiTime } = require('../alipay_gateway');
// PC website payment's official inline QR mode; not a QR image of a redirect URL.
// Keep APP-pay signing, trade queries and notification verification unchanged.
function createQrPageGateway(settings) {
  const gateway = createAlipayGateway(settings);
  if (!gateway) return null;
  if (settings.keyMode !== 'public') throw Error('当前网页二维码配置应为已安装的公钥模式');
  const privateKey = fs.readFileSync(settings.privateKeyPath, 'utf8');
  const sdk = new (require('alipay-sdk').AlipaySdk)({ appId: settings.appId, privateKey,
    keyType: privateKey.includes('BEGIN RSA PRIVATE') ? 'PKCS1' : 'PKCS8', signType: 'RSA2',
    alipayPublicKey: fs.readFileSync(settings.publicKeyPath, 'utf8'), camelcase: false, timeout: 10000,
    gateway: settings.sandbox ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do' });
  return { ...gateway,
    pagePay(order, options = {}) {
      return sdk.pageExecute('alipay.trade.page.pay', 'GET', {
        timestamp: shanghaiTime(Date.now()), notifyUrl: options.notifyUrl || settings.notifyUrl,
        // No return_url: payment stays in the QR frame, parent confirms via authenticated trade query.
        bizContent: { out_trade_no: order.id, seller_id: settings.sellerId, product_code: 'FAST_INSTANT_TRADE_PAY',
          total_amount: (order.priceFen / 100).toFixed(2), subject: order.subject || 'OpenElf 充值',
          time_expire: shanghaiTime(order.expiresAt), qr_pay_mode: '4', qrcode_width: 240 }
      });
    }
  };
}
module.exports = { createQrPageGateway };
