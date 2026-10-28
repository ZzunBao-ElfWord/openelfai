#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?Run this script only in the configured macOS build job}"
: "${IOS_SIGNING_IDENTITY:?Missing validated distribution identity}"
: "${BUILD_NAME:?Missing release version}"
: "${BUILD_NUMBER:?Missing build number}"

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="$APP_DIR/build/ios/iphoneos/Runner.app"
PROFILE_PATH="$RUNNER_TEMP/openelf.mobileprovision"
ENTITLEMENTS_PATH="$RUNNER_TEMP/openelf-entitlements.plist"
PLIST_BUDDY=/usr/libexec/PlistBuddy

test -d "$APP_PATH"
test -f "$PROFILE_PATH"
test -f "$ENTITLEMENTS_PATH"
security find-identity -v -p codesigning | grep -F "$IOS_SIGNING_IDENTITY" >/dev/null
# Stamp only release metadata before signing, never repair mismatched identity,
# missing permissions, URL handlers or an already populated wrong version.
export OPENELF_BUILT_APP="$APP_PATH" OPENELF_SOURCE_APP="$APP_DIR/ios/Runner"
python3 - <<'PY'
import os, plistlib
path = os.environ['OPENELF_BUILT_APP'] + '/Info.plist'
with open(path, 'rb') as f:
    built = plistlib.load(f)
with open(os.environ['OPENELF_SOURCE_APP'] + '/Info.plist', 'rb') as f:
    source = plistlib.load(f)
assert built.get('CFBundleIdentifier') == 'com.ai.openelf', 'Wrong app identity'
assert built.get('CFBundleExecutable') == 'Runner', 'Missing app executable'
for key in ('NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription',
            'LSApplicationQueriesSchemes', 'UIApplicationSceneManifest',
            'DouyinAppID', 'UILaunchStoryboardName', 'UIMainStoryboardFile'):
    assert built.get(key) == source[key], 'Built metadata differs: ' + key
assert built.get('WechatShareAppID') == 'wxf3b5d7fbc0abcd37', 'Wrong mobile WeChat AppID'
schemes = {s for entry in built.get('CFBundleURLTypes', []) for s in entry.get('CFBundleURLSchemes', [])}
assert {'wxf3b5d7fbc0abcd37', 'awf8w18qtnqq1kum'} <= schemes, 'Missing share callbacks'
assert built.get('CFBundleIcons') and built.get('MinimumOSVersion'), 'Incomplete built bundle metadata'
for key, expected in (('CFBundleShortVersionString', os.environ['BUILD_NAME']),
                      ('CFBundleVersion', os.environ['BUILD_NUMBER'])):
    assert source[key] == expected, 'Source release stamp mismatch: ' + key
    current = built.get(key)
    assert current in (None, '', expected), 'Wrong built version: ' + key
    if current != expected:
        print('Stamping missing unsigned bundle field:', key, expected)
        built[key] = expected
with open(path, 'wb') as f:
    plistlib.dump(built, f, fmt=plistlib.FMT_BINARY)
PY
test "$($PLIST_BUDDY -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")" = com.ai.openelf
test "$($PLIST_BUDDY -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist")" = "$BUILD_NAME"
test "$($PLIST_BUDDY -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist")" = "$BUILD_NUMBER"
SDK_NAME="$($PLIST_BUDDY -c 'Print :DTSDKName' "$APP_PATH/Info.plist")"
if [[ ! "$SDK_NAME" =~ ^iphoneos([0-9]+) ]] || [ "${BASH_REMATCH[1]}" -lt 26 ]; then
  echo 'The app was not built with iOS SDK 26 or later.'; exit 1
fi
test -n "$(find "$APP_PATH" -name ct4.js -print -quit)"
if [ -n "$(find "$APP_PATH" -name '*.appex' -print -quit)" ]; then
  echo 'App extensions need separate validated profiles; refusing to reuse the main-app profile.'
  exit 1
fi
cp "$PROFILE_PATH" "$APP_PATH/embedded.mobileprovision"

if [ -d "$APP_PATH/Frameworks" ]; then
  while IFS= read -r -d '' dylib; do
    codesign --force --sign "$IOS_SIGNING_IDENTITY" --timestamp=none --generate-entitlement-der "$dylib"
  done < <(find "$APP_PATH/Frameworks" -type f -name '*.dylib' -print0)
  while IFS= read -r -d '' framework; do
    codesign --force --sign "$IOS_SIGNING_IDENTITY" --timestamp=none --generate-entitlement-der "$framework"
  done < <(find "$APP_PATH/Frameworks" -depth -type d -name '*.framework' -print0)
fi
codesign --force --sign "$IOS_SIGNING_IDENTITY" --entitlements "$ENTITLEMENTS_PATH" \
  --timestamp=none --generate-entitlement-der "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -d --entitlements :- "$APP_PATH" > "$RUNNER_TEMP/openelf-signed-entitlements.plist"
python3 - <<'PY'
import os, plistlib
with open(os.environ['RUNNER_TEMP'] + '/openelf-signed-entitlements.plist', 'rb') as f:
    entitlements = plistlib.load(f)
assert entitlements.get('aps-environment') == 'production', 'Signed IPA must enable production APNs'
assert entitlements.get('application-identifier') == 'ZJ3YQXTB93.com.ai.openelf', 'Signed application ID mismatch'
print('Verified production APNs entitlement in signed app')
PY
SIGNATURE="$(codesign -d --verbose=4 "$APP_PATH" 2>&1)"
printf '%s\n' "$SIGNATURE" | grep -E '^Authority=(Apple Distribution:|iPhone Distribution:)'

PACKAGE_ROOT="$(mktemp -d "$RUNNER_TEMP/openelf-package.XXXXXXXX")"
mkdir -p "$PACKAGE_ROOT/Payload" "$APP_DIR/build/ios/export"
ditto "$APP_PATH" "$PACKAGE_ROOT/Payload/Runner.app"
IPA_PATH="$APP_DIR/build/ios/export/OpenElf${BUILD_NAME}.ipa"
(
  cd "$PACKAGE_ROOT"
  ditto -c -k --sequesterRsrc --keepParent Payload "$IPA_PATH"
)
test -s "$IPA_PATH"
unzip -tq "$IPA_PATH"
echo "Created App Store distribution IPA: $BUILD_NAME ($BUILD_NUMBER), com.ai.openelf, $SDK_NAME"
shasum -a 256 "$IPA_PATH"
