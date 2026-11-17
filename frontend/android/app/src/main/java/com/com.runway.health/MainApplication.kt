package com.runway.health

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
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
          add(NaverMapAuthPackage())
          add(SpotifyRemotePackage())
          add(CoachingVoicePackage())
          add(ScreenCapturePackage())
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // 화면이 꺼져도 끝없이 기다리는 요청이 없게 네이티브 HTTP 상한과 유휴 연결 정리를 둔다(S15P31E105-533).
    RunwayHttpClient.install(this)
    // 지도 키 인증 실패(401/429)를 첫 지도보다 먼저 듣는다(S15P31E105-898).
    NaverMapAuthWatch.install(this)
    createPushChannel()
    loadReactNative(this)
  }

  // S15P31E105-815 (ADR-0025): the channel FCM pushes use (server android.notification.channel_id and
  // firebase.json default). Creating an existing channel again is a no-op and keeps the user's choices.
  private fun createPushChannel() {
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(
      NotificationChannel(PUSH_CHANNEL_ID, "알림", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "그룹런·크루·댓글·팔로우 소식"
      },
    )
  }

  companion object {
    const val PUSH_CHANNEL_ID = "runway_default"
  }
}
