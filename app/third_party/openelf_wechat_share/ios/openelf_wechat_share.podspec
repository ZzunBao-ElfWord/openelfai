Pod::Spec.new do |s|
  s.name = 'openelf_wechat_share'
  s.version = '1.0.0'
  s.summary = 'User-initiated WeChat image sharing, no login or payment calls.'
  s.description = s.summary
  s.homepage = 'https://openelfai.com'
  s.license = { :type => 'Proprietary' }
  s.author = 'OpenElf'
  s.source = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.public_header_files = 'Classes/**/*.h'
  s.dependency 'Flutter'
  s.dependency 'WechatOpenSDK', '2.0.9'
  s.platform = :ios, '15.0'
  s.static_framework = true
  s.frameworks = 'UIKit'
  # Matching 2.0.9 official SDK manifest (its legacy podspec omits resources).
  s.resource_bundles = { 'openelf_wechat_share_privacy' => ['PrivacyInfo.xcprivacy'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'OTHER_LDFLAGS' => '$(inherited) -ObjC' }
end
