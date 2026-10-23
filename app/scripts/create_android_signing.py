"""Generate a local, git-ignored release key once. Never print passwords."""
import hashlib
import os
from pathlib import Path
import secrets
import subprocess

root = Path(__file__).resolve().parents[2]
android = root / 'app' / 'android'
output = root / '打包文件夹' / 'Android正式签名'
properties = android / 'key.properties'
keytool = Path(r'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe')
keystore = output / 'openelf-release.jks'
if properties.exists() or keystore.exists():
    raise SystemExit('Existing signing material found; refusing to replace it.')
output.mkdir(parents=True, exist_ok=True)
password = secrets.token_urlsafe(32)
environment = dict(os.environ, OPENELF_KEY_PASSWORD=password)
subprocess.run([
    str(keytool), '-genkeypair', '-keystore', str(keystore), '-storetype', 'JKS',
    '-alias', 'openelf', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-dname', 'CN=OpenElf, OU=Mobile, O=OpenElf, C=CN',
    '-storepass:env', 'OPENELF_KEY_PASSWORD', '-keypass:env', 'OPENELF_KEY_PASSWORD',
], env=environment, check=True, capture_output=True)
certificate = subprocess.run([
    str(keytool), '-exportcert', '-keystore', str(keystore), '-alias', 'openelf',
    '-storepass:env', 'OPENELF_KEY_PASSWORD',
], env=environment, check=True, capture_output=True).stdout
settings = (f'storePassword={password}\nkeyPassword={password}\n'
            f'keyAlias=openelf\nstoreFile={keystore.as_posix()}\n')
properties.write_text(settings, encoding='utf-8')
(output / 'key.properties').write_text(settings, encoding='utf-8')
(output / 'openelf-release.cer').write_bytes(certificate)
lines = ['Package: com.openelf.app', 'Alias: openelf']
for algorithm in ['md5', 'sha1', 'sha256']:
    value = hashlib.new(algorithm, certificate).hexdigest().upper()
    lines += [f'{algorithm.upper()} (no separators): {value}',
              f'{algorithm.upper()} (colon separated): ' + ':'.join(value[i:i+2] for i in range(0,len(value),2))]
(output / '签名指纹.txt').write_text('\n'.join(lines)+'\n', encoding='utf-8')
(output / '请先阅读.txt').write_text(
    '这是 OpenElf 安卓正式签名。以后所有版本必须沿用，不要重新生成。\n'
    '请将整个文件夹备份到安全位置；key.properties 包含密码，不要公开或提交 Git。\n'
    '平台仅需公钥证书或指纹时，不要上传 JKS 或密码文件。\n'
    '原 debug 签名测试包通常需要卸载后才能安装正式签名包，卸载会清除本地数据。\n', encoding='utf-8')
print('Created release keystore and local Gradle signing configuration. Passwords not displayed.')
print('\n'.join(lines))
