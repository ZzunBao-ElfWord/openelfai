Pod::Spec.new do |s|
  s.name = 'openelf_kwai_share'
  s.version = '1.0.0'
  s.summary = 'User initiated handoff to the Kwai image editor.'
  s.description = s.summary
  s.homepage = 'https://openelfai.com'
  s.license = { :type => 'Proprietary' }
  s.author = 'OpenElf'
  s.source = { :path => '.' }
  s.source_files = 'Classes/**/*'
  s.public_header_files = 'Classes/**/*.h'
  s.dependency 'Flutter'
  s.dependency 'KwaiSDK', '3.7.3'
  s.platform = :ios, '15.0'
  s.frameworks = 'UIKit', 'Photos'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'OTHER_LDFLAGS' => '$(inherited) -ObjC -all_load' }
end
