#!/bin/bash
# Openelf Flutter 构建脚本
# 用法: ./build.sh [web|apk|all]

set -e

MODE="${1:-all}"
SERVER="root@180.184.160.179"
REMOTE_APP="/var/www/openelf/app"

echo "=== Openelf Flutter Build ==="
echo "Mode: $MODE"

# 检查 Flutter
if ! command -v flutter &> /dev/null; then
    echo "Error: Flutter not found. Please install Flutter first."
    echo "  git clone https://github.com/flutter/flutter.git -b stable --depth 1"
    echo "  export PATH=\"\$PWD/flutter/bin:\$PATH\""
    exit 1
fi

flutter doctor

cd "$(dirname "$0")"

# 获取依赖
echo "[1/4] Getting dependencies..."
flutter pub get

# 构建 Web
if [ "$MODE" = "web" ] || [ "$MODE" = "all" ]; then
    echo "[2/4] Building Web..."
    flutter build web --release
    echo "Web build complete: build/web/"
    
    # 部署到服务器（如果配置了 SSH）
    if command -v scp &> /dev/null; then
        read -p "Deploy to server $SERVER? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "Deploying to $REMOTE_APP ..."
            scp -r build/web/* "$SERVER:$REMOTE_APP/"
            echo "Deployed to https://openelfai.com/app/"
        fi
    fi
fi

# 构建 APK
if [ "$MODE" = "apk" ] || [ "$MODE" = "all" ]; then
    echo "[3/4] Building Android APK..."
    flutter build apk --release
    APK_SRC="build/app/outputs/flutter-apk/app-release.apk"
    APK_DST="openelf.apk"
    cp "$APK_SRC" "$APK_DST"
    echo "APK build complete: $APK_DST"
    
    # 上传到服务器
    if command -v scp &> /dev/null; then
        read -p "Upload APK to server $SERVER? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            scp "$APK_DST" "$SERVER:$REMOTE_APP/openelf.apk"
            echo "APK uploaded to https://openelfai.com/app/openelf.apk"
        fi
    fi
fi

# 打包源码
echo "[4/4] Packing source..."
zip -r openelf-flutter-src.zip \
    pubspec.yaml analysis_options.yaml README.md build.sh \
    assets/ lib/ \
    -x "*.dart_tool/*" -x "build/*" -x "*.zip"
echo "Source packed: openelf-flutter-src.zip"

echo "=== Build Complete ==="
