# OpenElf 1.0.5 (Build 1) — 2026-10-29

- Shared customer version: `1.0.5 (Build 1)`, pubspec `1.0.5+1`.
- Android package `com.openelf.app`, monotonic versionCode `21`; original release signing key retained. The visible build counter restarts every 20 builds; Gradle maps the 1.0.x patch and counter to a continuous update code.
- iOS Bundle ID `com.ai.openelf`, version `1.0.5`, CFBundleVersion `1`; build through existing independent-branch macOS workflow. No App Store submission or automatic upload.
- Includes consent-based JPush setup, authenticated installation/account binding, logout unbinding and notification navigation. Server package was installed by the operator; actual provider authentication, APNs validity and device delivery are not proven by route smoke checks.
- Includes latest P1 brand resource cleanup, OpenElf app name, in-app corner clipping and iOS storefront price re-query safeguards. No new payment credentials, wallet migrations or NFT policy changes.
- Push is opt-in: Settings > 消息通知. Old packages without the push SDK cannot receive via this new integration. Notification-triggering business events are not automatically implemented by basic SDK integration.
- Before public release, verify JPush credentials/APNs on a real device and update the hosted privacy policy to match the bundled SDK disclosure. No credential values are included in source or release notes.

Validation before packaging: 149 Flutter tests passed, 1 skipped; 5 launcher-artwork tests passed; 35 brand/icon assets validated. Native signing and artifact validation must additionally pass; these tests alone do not prove push delivery or real-money payment behavior.
