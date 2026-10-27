Pod::Spec.new do |s|
  s.name = 'openelf_douyin_share'
  s.version = '1.0.0'
  s.summary = 'User-initiated OpenElf sharing with the official Douyin SDK.'
  s.description = s.summary
  s.homepage = 'https://openelfai.com'
  s.license = { :type => 'Proprietary' }
  s.author = { 'OpenElf' => 'support@openelfai.com' }
  s.source = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.public_header_files = 'Classes/**/*.h'
  s.dependency 'Flutter'
  s.dependency 'DouyinOpenSDK', '4.2.5'
  s.platform = :ios, '15.0'
  s.frameworks = 'Photos', 'UIKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'OTHER_LDFLAGS' => '$(inherited) -ObjC' }
  s.user_target_xcconfig = { 'OTHER_LDFLAGS' => '$(inherited) -ObjC' }
end
