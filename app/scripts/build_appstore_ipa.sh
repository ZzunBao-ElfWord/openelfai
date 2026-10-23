#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_NAME=1.0.4
BUILD_NUMBER=
PREPARE=false

usage() {
  echo '准备签名：bash scripts/build_appstore_ipa.sh --prepare'
  echo '导出 IPA：bash scripts/build_appstore_ipa.sh --build-number 未使用的构建号 [--build-name 1.0.4]'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prepare) PREPARE=true; shift ;;
    --build-name|--build-number)
      if [ "$#" -lt 2 ]; then usage; exit 1; fi
      if [ "$1" = --build-name ]; then BUILD_NAME="$2"; else BUILD_NUMBER="$2"; fi
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

if [ "$(uname -s)" != Darwin ]; then
  echo '此脚本必须在安装完整 Xcode 的 Mac 上运行，Windows 不能编译或签名 IPA。'
  exit 1
fi
for executable in flutter pod xcodebuild xcrun python3; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    echo "缺少 $executable。请先安装 Flutter、完整 Xcode 和 CocoaPods。"
    exit 1
  fi
done
XCODE_MAJOR="$(xcodebuild -version | awk 'NR == 1 { split($2, v, "."); print v[1] }')"
SDK_VERSION="$(xcrun --sdk iphoneos --show-sdk-version)"
if [ "$XCODE_MAJOR" -lt 26 ] || [ "${SDK_VERSION%%.*}" -lt 26 ]; then
  echo '上传 App Store Connect 需要 Xcode 26+ 和 iOS 26+ SDK。请先更新或选择正确的 Xcode。'
  exit 1
fi
if [[ ! "$BUILD_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '版本号格式应为 1.0.0。'; exit 1
fi
if [ "$PREPARE" != true ] && [ -z "$BUILD_NUMBER" ] && [ -t 0 ]; then
  printf '请输入 App Store Connect 尚未使用的新构建号（正整数）：'
  IFS= read -r BUILD_NUMBER
fi
if [ "$PREPARE" != true ] && [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo '请用 --build-number 指定一个未上传过的正整数构建号（1 到 9999）。'
  exit 1
fi

cd "$APP_DIR"
echo "Bundle ID: com.ai.openelf；Xcode: $XCODE_MAJOR；iOS SDK: $SDK_VERSION"
echo '本源码使用 Flutter 3.47.6 验证；建议 Mac 使用相同版本。'
flutter --version
flutter pub get

if [ "$PREPARE" = true ]; then
  flutter build ios --config-only --release --no-codesign
  open ios/Runner.xcworkspace
  echo '在 Xcode 中选择 Runner TARGET > Signing & Capabilities，选择 Apple 团队，启用自动签名。'
  echo '确认 Bundle Identifier 为 com.ai.openelf，完成后回到终端执行带 --build-number 的导出命令。'
  exit 0
fi

# Normal StoreKit builds detect the actual production/TestFlight environment.
# Do not force OPENELF_IOS_IAP_TEST for a Transporter distribution build.
flutter build ipa --release --no-pub \
  --build-name="$BUILD_NAME" \
  --build-number="$BUILD_NUMBER" \
  --dart-define=ALIYUN_CAPTCHA_IOS_ID=a6a503af8a6273b0c3842ef3432f08a1 \
  --export-options-plist=ios/ExportOptions-AppStore.plist

# Flutter can leave an archive even if export fails. Require an actual IPA.
shopt -s nullglob
IPAS=("$APP_DIR/build/ios/ipa/"*.ipa)
if [ "${#IPAS[@]}" -ne 1 ]; then
  echo '没有找到唯一导出的 IPA。请检查上面的签名/导出错误，勿把 xcarchive 当成 IPA。'
  exit 1
fi
VERIFY_DIR="$(mktemp -d /tmp/openelf-ipa-check.XXXXXXXX)"
cleanup() {
  case "$VERIFY_DIR" in
    /tmp/openelf-ipa-check.*) rm -rf -- "$VERIFY_DIR" ;;
  esac
}
trap cleanup EXIT
ditto -x -k "${IPAS[0]}" "$VERIFY_DIR"
APPS=("$VERIFY_DIR/Payload/"*.app)
if [ "${#APPS[@]}" -ne 1 ]; then echo 'IPA Payload 结构异常。'; exit 1; fi
APP_BUNDLE="${APPS[0]}"
PLIST_BUDDY=/usr/libexec/PlistBuddy
ACTUAL_ID="$($PLIST_BUDDY -c 'Print :CFBundleIdentifier' "$APP_BUNDLE/Info.plist")"
ACTUAL_BUILD="$($PLIST_BUDDY -c 'Print :CFBundleVersion' "$APP_BUNDLE/Info.plist")"
ACTUAL_VERSION="$($PLIST_BUDDY -c 'Print :CFBundleShortVersionString' "$APP_BUNDLE/Info.plist")"
ACTUAL_SDK="$($PLIST_BUDDY -c 'Print :DTSDKName' "$APP_BUNDLE/Info.plist")"
if [ "$ACTUAL_ID" != com.ai.openelf ] || [ "$ACTUAL_BUILD" != "$BUILD_NUMBER" ] || [ "$ACTUAL_VERSION" != "$BUILD_NAME" ]; then
  echo '导出 IPA 的包名、版本号或构建号不匹配。'; exit 1
fi
if [[ ! "$ACTUAL_SDK" =~ ^iphoneos([0-9]+) ]] || [ "${BASH_REMATCH[1]}" -lt 26 ]; then
  echo '导出 IPA 的构建 SDK 不满足上传要求。'; exit 1
fi
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
SIGNATURE="$(codesign -d --verbose=4 "$APP_BUNDLE" 2>&1)"
if ! printf '%s\n' "$SIGNATURE" | grep -Eq '^Authority=(Apple Distribution:|iPhone Distribution:)'; then
  echo '此 IPA 未使用 Apple 分发证书签名。'; exit 1
fi
security cms -D -i "$APP_BUNDLE/embedded.mobileprovision" -o "$VERIFY_DIR/profile.plist"
DEBUG_ALLOWED="$($PLIST_BUDDY -c 'Print :Entitlements:get-task-allow' "$VERIFY_DIR/profile.plist" 2>/dev/null || true)"
if [ "$DEBUG_ALLOWED" != false ]; then echo '描述文件不是有效的分发描述文件。'; exit 1; fi
if $PLIST_BUDDY -c 'Print :ProvisionedDevices' "$VERIFY_DIR/profile.plist" >/dev/null 2>&1; then
  echo '描述文件包含设备列表，属于开发/Ad Hoc 分发，不能用于 Transporter。'; exit 1
fi
ALL_DEVICES="$($PLIST_BUDDY -c 'Print :ProvisionsAllDevices' "$VERIFY_DIR/profile.plist" 2>/dev/null || true)"
if [ "$ALL_DEVICES" = true ]; then echo '企业分发 IPA 不能上传 App Store Connect。'; exit 1; fi
if [ -z "$(find "$APP_BUNDLE" -name ct4.js -print -quit)" ]; then
  echo 'IPA 缺少图形验证资源 ct4.js。'; exit 1
fi
echo "已导出并通过本地检查：$ACTUAL_ID / $ACTUAL_VERSION ($ACTUAL_BUILD) / $ACTUAL_SDK"
echo "IPA 文件：${IPAS[0]}"
echo '可将该 IPA 拖入 Mac 的 Transporter 进行验证和上传；Apple 服务端处理结果仍以 Transporter 为准。'
open "$APP_DIR/build/ios/ipa"
