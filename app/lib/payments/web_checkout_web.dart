import 'dart:js_interop';

@JS('location.assign')
external void _assign(JSString url);

void navigateToWebCheckout(String url) => _assign(url.toJS);
