import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val releaseKeyFile = rootProject.file("key.properties")
val releaseKeys = Properties()
if (releaseKeyFile.exists()) {
    releaseKeyFile.reader(Charsets.UTF_8).use { releaseKeys.load(it) }
}

android {
    namespace = "com.openelf.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.openelf.app"
        manifestPlaceholders["JPUSH_PKGNAME"] = "com.openelf.app"
        manifestPlaceholders["JPUSH_APPKEY"] = "3439c18b0c3021ae5e29ba92"
        manifestPlaceholders["JPUSH_CHANNEL"] = "developer-default"
        // Public ID only; intentionally blank while the Kwai app is in review.
        manifestPlaceholders["KWAI_APP_ID"] = providers.gradleProperty("OPENELF_KWAI_APP_ID").getOrElse("")
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        // Display builds restart after 20; Android update codes must not reset.
        // 1.0.4 (20) -> code 20; 1.0.5 (1) -> code 21.
        val releaseParts = flutter.versionName.split(".").map { it.toInt() }
        require(releaseParts.size == 3 && releaseParts[0] == 1 && releaseParts[1] == 0 && releaseParts[2] >= 4)
        require(flutter.versionCode in 1..20)
        versionCode = (releaseParts[2] - 4) * 20 + flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (releaseKeyFile.exists()) {
                keyAlias = releaseKeys.getProperty("keyAlias")
                keyPassword = releaseKeys.getProperty("keyPassword")
                storeFile = file(releaseKeys.getProperty("storeFile"))
                storePassword = releaseKeys.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("com.alipay.sdk:alipaysdk-android:15.8.42")
}
