package com.runway.health

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.runway.health.music.SpotifyRemotePackage
import com.runway.health.music.MelonMediaPackage
import com.runway.health.watch.WatchHealthPackage
import com.runway.health.watch.WatchSessionPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      useDevSupport = false, // This PoC loads the bundled JS without a Metro server.
      packageList =
        PackageList(this).packages.apply {
          add(SamsungHealthPackage())
          add(WatchHealthPackage())
          add(WatchSessionPackage())
          add(MelonMediaPackage())
          add(PlaceNamePackage())
          add(RunwayNaverMapLegalPackage())
          add(SpotifyRemotePackage())
          add(CoachingVoicePackage())
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // 화면이 꺼져도 끝없이 기다리는 요청이 없게 네이티브 HTTP 상한과 유휴 연결 정리를 둔다(S15P31E105-533).
    RunwayHttpClient.install(this)
    loadReactNative(this)
  }
}
