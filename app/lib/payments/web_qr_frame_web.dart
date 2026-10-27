import 'dart:js_interop';

import 'package:flutter/material.dart';

@JS()
@staticInterop
class _Frame {}

extension _FrameAttributes on _Frame {
  external void setAttribute(JSString name, JSString value);
}

Widget webQrFrame(String url) => HtmlElementView.fromTagName(
  tagName: 'iframe',
  onElementCreated: (element) {
        final frame = element as _Frame;
    frame.setAttribute('title'.toJS, '支付宝官方付款二维码'.toJS);
    frame.setAttribute(
      'sandbox'.toJS,
      'allow-scripts allow-forms allow-same-origin'.toJS,
    );
    frame.setAttribute('referrerpolicy'.toJS, 'no-referrer'.toJS);
    frame.setAttribute(
      'style'.toJS,
      'border:0;width:100%;height:100%;background:white'.toJS,
    );
    frame.setAttribute('src'.toJS, url.toJS);
  },
);
