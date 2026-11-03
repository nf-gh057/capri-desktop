import java.util.Properties

plugins {
    id("com.android.application")
}

// Her app's own signing key, for every version of it to install over the last: kept with you, never in the repo
// (%USERPROFILE%\.capri\android\signing.properties next to its keystore, or CAPRI_SIGNING pointing at the file).
// Without it, a release is signed with this PC's debug key, as a debug build is.
val signing = (System.getenv("CAPRI_SIGNING") ?: "${System.getProperty("user.home")}/.capri/android/signing.properties")
    .let(::File).takeIf { it.isFile }
    ?.let { file -> Properties().apply { file.inputStream().use(::load) }.also { it["dir"] = file.parentFile } }

android {
    namespace = "io.github.nfgh057.capri"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.nfgh057.capri"
        // Android 11: a key only your fingerprint unlocks, for each use (setUserAuthenticationParameters)
        minSdk = 30
        targetSdk = 37
        versionCode = 17
        versionName = "0.17"
    }

    signingConfigs {
        if (signing != null) {
            create("capri") {
                storeFile = File(signing["dir"] as File, signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("capri") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
