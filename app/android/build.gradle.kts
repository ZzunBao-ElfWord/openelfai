allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

// Isolated playback regression-test build. The published Media3 alpha02
// includes the official #3440 stale-position retry fix. Keep all Media3
// modules aligned; do not change unrelated SDKs or silently opt releases in.
val playbackRetryTest = providers.gradleProperty("OPENELF_MEDIA3_RETRY_TEST")
    .map { it == "true" }.getOrElse(false)
subprojects {
    if (playbackRetryTest) {
        // Compile-only platform requirement of Media3 alpha02. Do not change
        // targetSdk/minSdk or opt normal builds into this test dependency.
        plugins.withId("com.android.library") {
            extensions.getByType<com.android.build.api.variant.LibraryAndroidComponentsExtension>()
                .finalizeDsl {
                    it.compileSdk = 37
                    it.compileSdkMinor = 0
                }
        }
        configurations.configureEach {
            resolutionStrategy.eachDependency {
                if (requested.group == "androidx.media3") {
                    useVersion("1.12.0-alpha02")
                    because("OpenElf isolated test: preserve seek target when open fails, Media3 #3440")
                }
            }
        }
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
