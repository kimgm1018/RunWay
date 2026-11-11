plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    // Code package stays watch-specific; applicationId must match the phone app for the Data Layer.
    namespace = "com.runway.watch"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.runway.health"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // 폰·워치 Data Layer 연결을 위해 같은 테스트용 debug 서명을 사용한다.
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("../frontend/android/app/debug.keystore")
        }
    }

    buildTypes {
        release {
            optimization {
                enable = true
                packageScope = setOf("androidx.**", "kotlin.**", "kotlinx.**")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.10.2")
    implementation("androidx.health:health-services-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    // Lifts the transitive fragment 1.0.0 so the activity-result APIs used by MainActivity are valid.
    implementation("androidx.fragment:fragment:1.8.5")
    implementation(libs.play.services.wearable)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.16.1")
    implementation(platform(libs.compose.bom))
    implementation(libs.activity.compose)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling)
    implementation(libs.core.splashscreen)
    // S15P31E105-617: 러닝 중 Ongoing Activity(화면을 켜면 러닝 화면으로 복귀)와 Ambient 저전력 화면.
    implementation(libs.wear.ongoing)
    implementation(libs.wear)
    implementation(libs.ui)
    implementation(libs.ui.graphics)
    implementation(libs.ui.tooling.preview)
    implementation(libs.wear.tooling.preview)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.ui.test.junit4)
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    debugImplementation(libs.ui.test.manifest)
    debugImplementation(libs.ui.tooling)
}
