plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.nfgh057.capri"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.nfgh057.capri"
        // Android 11: a key only your fingerprint unlocks, for each use (setUserAuthenticationParameters)
        minSdk = 30
        targetSdk = 37
        versionCode = 4
        versionName = "0.4"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
