/// 非 Web 端不支持网页收银台跳转。
///
/// Android 走原生支付宝 SDK，iOS 走 StoreKit，都不使用这个入口。
bool openExternalUrl(String url) => false;
