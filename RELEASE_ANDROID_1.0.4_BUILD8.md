# OpenElf Android 1.0.4 (8)

- Package: `com.openelf.app`
- Production Alipay mode; merchant credentials remain on the server, never in the APK.
- Includes Android Alipay SDK, order recovery, server-confirmed crediting, ID-card OCR verification, and basic JPush device notifications.
- Paused push account binding, backend sending, and notification routing work is deliberately excluded. That work remains in the original local development directory.
- Release signing reads local `app/android/key.properties`. Release builds must use the existing OpenElf keystore; no debug-signing fallback is allowed.
- Release certificate MD5: `FE8496B7DA198DE1CE7ADAFD59431530`.
- Never commit or share the JKS, passwords, server `.env`, or merchant private keys.

Build with Flutter 3.47.6 using `flutter build apk --release --build-name=1.0.4 --build-number=8` from `app/`, after securely configuring the local release keystore.

Automated validation does not replace real-device payment, callback, refund, identity-verification, or push delivery testing. No server payment flags are changed by this build.
