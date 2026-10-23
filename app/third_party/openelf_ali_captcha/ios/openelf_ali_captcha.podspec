Pod::Spec.new do |s|
  s.name             = 'openelf_ali_captcha'
  s.version          = '1.0.0'
  s.summary          = 'OpenElf bridge for Alibaba Cloud PNVS graphical authentication.'
  s.description      = 'A minimal Captcha4 bridge used before sending an SMS verification code.'
  s.homepage         = 'https://openelfai.com'
  s.license          = { :type => 'Proprietary' }
  s.author           = { 'OpenElf' => 'support@openelfai.com' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.resources        = 'Resources/ct4.js'
  s.dependency 'Flutter'
  s.platform = :ios, '12.0'
  s.framework = 'WebKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.swift_version = '5.0'
end
