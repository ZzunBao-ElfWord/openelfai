# Flutter 自动处理 Dart 层混淆，这里只加 Android 侧 keep 规则

# Google Play Split Install：release 构建时 Flutter embedding 引用这些类，
# 但项目没引入 google-play-core 依赖。忽略即可（非 Play 商店分发路径不影响）。
-dontwarn com.google.android.play.core.**
-keep class io.flutter.embedding.android.FlutterPlayStoreSplitApplication { *; }

# shared_preferences（JNI 反射）
-keep class io.flutter.plugin.common.** { *; }
-keep class io.flutter.** { *; }
-keep class * extends io.flutter.plugin.common.MethodCall

# flutter_secure_storage
-keep class com.tekartik.flutter_secure_storage.** { *; }
-keep class flutter.secure.storage.** { *; }

# video_player
-keep class tv.danmaku.ijk.** { *; }
-keep class androidx.media3.** { *; }

# audioplayers（exoplayer 底层）
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# http / retrofit 类反射
-keep class retrofit2.** { *; }
-keepattributes Signature, InnerClasses, EnclosingMethod

# 通配：keep 所有 Plugin 注册相关的类（保守策略）
-keep class **PluginRegistrant** { *; }
-keep class * extends io.flutter.embedding.engine.plugins.FlutterPlugin
