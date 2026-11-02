@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/config/api_config.dart';

void main() {
  test('Web API defaults to same-origin without a build override', () {
    expect(ApiConfig.baseUrl, isEmpty,
        reason: 'Web builds must not silently restore a cross-origin API URL.');
  });
}
