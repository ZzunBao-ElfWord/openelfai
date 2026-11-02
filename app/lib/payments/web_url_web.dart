// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;

/// Web 端进入支付宝网页收银台。
///
/// 下单是一次异步请求，浏览器会把异步后的 window.open 视为非用户手势而拦截，
/// 所以这里直接在当前标签页跳转；支付完成后服务端回跳到 `?diamond_return=1`，
/// 重新进入应用即会自动确认订单并补发钻石。
bool openExternalUrl(String url) {
  if (url.isEmpty) return false;
  html.window.location.href = url;
  return true;
}
