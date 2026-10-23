/// Public Alibaba Cloud PNVS graphical-authentication identifiers.
///
/// OpenElf defaults can be overridden at build time. The matching app keys are
/// server-only secrets and must never be added to the Flutter application.
class CaptchaConfig {
  const CaptchaConfig._();

  static const androidId = String.fromEnvironment(
    'ALIYUN_CAPTCHA_ANDROID_ID',
    defaultValue: '2d129e705ac4cd4df085390ec213b492',
  );

  static const iosId = String.fromEnvironment(
    'ALIYUN_CAPTCHA_IOS_ID',
    defaultValue: 'a6a503af8a6273b0c3842ef3432f08a1',
  );
}
