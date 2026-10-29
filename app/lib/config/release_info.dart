/// Customer-visible release, shared by Android and iOS.
/// Android's monotonic versionCode is mapped separately by Gradle.
class ReleaseInfo {
  static const version = '1.0.5';
  static const build = 1;
  static const label = '$version (Build $build)';
}
