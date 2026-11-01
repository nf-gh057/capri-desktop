// Her app on Android: her chat in your pocket, unlocked with your fingerprint, and her orders
// (src/main/pocket.js is what it talks to, over Tailscale)

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "capri"
include(":app")
