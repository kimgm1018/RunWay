package com.runway.health.music

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.browse.MediaBrowser
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream

/**
 * 멜론 Android의 재생 정보와 재생 제어(S15P31E105-398, MUS-002·004·005). 멜론 SDK나 비공개 API 없이 표준 Android
 * MediaBrowser 연결로 받은 멜론 세션만 제어하며, 알림 접근 권한이 있으면 활성 멜론 세션도 찾는다. 다른 앱의 세션에는
 * 명령을 보내지 않는다. 곡 정보와 앨범 아트는 화면 표시에만 쓰고 로그·서버로 보내지 않는다.
 */
class MelonMediaModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val main = Handler(Looper.getMainLooper())
  private var browser: MediaBrowser? = null
  private var browserController: MediaController? = null
  private val waiting = mutableListOf<Promise>()

  override fun getName() = "MelonMedia"

  /** 설치 여부, MediaBrowser 지원 여부, 알림 접근 허용 여부. */
  @ReactMethod fun getStatus(promise: Promise) {
    promise.resolve(MelonPolicy.statusJson(installed(), browserService() != null, permitted()))
  }

  /** 멜론 MediaBrowser 연결. 멜론이 수락하면 true, 거부·시간 초과·미지원이면 false. */
  @ReactMethod fun connect(promise: Promise) {
    main.post {
      if (browser?.isConnected == true && browserController != null) {
        promise.resolve(true)
        return@post
      }
      waiting += promise
      if (waiting.size > 1) return@post
      val service = browserService()
      if (service == null) {
        settle(false)
        return@post
      }
      browser?.disconnect()
      val next = MediaBrowser(app, service, object : MediaBrowser.ConnectionCallback() {
        override fun onConnected() {
          val current = browser ?: return settle(false)
          val controller = try {
            MediaController(app, current.sessionToken)
          } catch (_: Exception) {
            null
          }
          if (controller == null || !MelonPolicy.isMelon(controller.packageName)) {
            close()
            settle(false)
            return
          }
          browserController = controller
          settle(true)
        }

        override fun onConnectionFailed() {
          close()
          settle(false)
        }

        // MUS-005: 연결이 끊기면 제어 가능 상태를 해제한다. 다음 조회가 연결 끊김으로 알린다.
        override fun onConnectionSuspended() {
          close()
        }
      }, null)
      browser = next
      try {
        next.connect()
      } catch (_: Exception) {
        close()
        settle(false)
        return@post
      }
      main.postDelayed({ if (waiting.isNotEmpty()) { close(); settle(false) } }, CONNECT_TIMEOUT_MS)
    }
  }

  /** 지금 재생 중인 멜론 곡과 재생 상태. 제어할 멜론 세션이 없으면 connected=false. */
  @ReactMethod fun getNowPlaying(promise: Promise) {
    main.post {
      val controller = controller()
      promise.resolve(MelonPolicy.playbackJson(if (controller == null) MelonSnapshot(false) else snapshot(controller)))
    }
  }

  /** play·pause·next·previous. 멜론이 지원한다고 알린 동작만 보내고, 보냈으면 true. */
  @ReactMethod fun command(name: String, promise: Promise) {
    main.post {
      val controller = controller()
      val actions = controller?.playbackState?.actions ?: 0L
      if (controller == null || !MelonPolicy.canSend(controller.packageName, actions, name)) {
        promise.resolve(false)
        return@post
      }
      val controls = controller.transportControls
      when (name) {
        "play" -> controls.play()
        "pause" -> controls.pause()
        "next" -> controls.skipToNext()
        "previous" -> controls.skipToPrevious()
      }
      promise.resolve(true)
    }
  }

  /**
   * 재생할 곡이 없을 때 첫 재생(MUS-003). 멜론이 MediaBrowser로 제공하는 기본 재생목록을 재생하고, 없거나 비어 있으면
   * TOP100을 재생한다. 목록 ID가 공개되지 않아 메뉴 이름으로 찾는다. 결과는 "PLAYLIST"·"TOP100"·"NONE".
   */
  @ReactMethod fun playDefault(promise: Promise) {
    main.post {
      val current = browser
      val controller = browserController
      if (current == null || !current.isConnected || controller == null) {
        promise.resolve("NONE")
        return@post
      }
      var settled = false
      val finish = { result: String ->
        if (!settled) {
          settled = true
          promise.resolve(result)
        }
      }
      main.postDelayed({ finish("NONE") }, BROWSE_TIMEOUT_MS)
      val play = { item: MediaBrowser.MediaItem, result: String ->
        controller.transportControls.playFromMediaId(item.mediaId, null)
        finish(result)
      }
      // 목록 자체가 재생 가능하면 그대로, 아니면 첫 재생 가능 곡부터 재생한다(멜론이 이어서 목록을 재생).
      val playList = { item: MediaBrowser.MediaItem, result: String, otherwise: () -> Unit ->
        if (item.isPlayable) {
          play(item, result)
        } else {
          children(current, item.mediaId) { songs ->
            songs.firstOrNull { it.isPlayable }?.let { play(it, result) } ?: otherwise()
          }
        }
      }
      children(current, current.root) { roots ->
        val top100 = {
          val direct = roots.firstOrNull { MelonPolicy.isTop100(title(it)) }
          if (direct != null) {
            playList(direct, "TOP100") { finish("NONE") }
          } else {
            // 홈 같은 상위 메뉴 아래에 있으면 한 단계만 더 찾는다.
            val menus = roots.filter { it.isBrowsable }
            fun search(index: Int) {
              if (index >= menus.size) return finish("NONE")
              children(current, menus[index].mediaId) { items ->
                val found = items.firstOrNull { MelonPolicy.isTop100(title(it)) }
                if (found != null) playList(found, "TOP100") { finish("NONE") } else search(index + 1)
              }
            }
            search(0)
          }
        }
        val playlist = roots.firstOrNull { MelonPolicy.isDefaultPlaylist(title(it)) }
        if (playlist == null) top100() else playList(playlist, "PLAYLIST", top100)
      }
    }
  }

  private fun title(item: MediaBrowser.MediaItem) = item.description.title?.toString()

  // 한 번만 받는 구독. 오류·빈 목록은 빈 목록으로 넘긴다.
  private fun children(browser: MediaBrowser, parentId: String?, done: (List<MediaBrowser.MediaItem>) -> Unit) {
    if (parentId.isNullOrEmpty()) return done(emptyList())
    browser.subscribe(parentId, object : MediaBrowser.SubscriptionCallback() {
      override fun onChildrenLoaded(parent: String, items: MutableList<MediaBrowser.MediaItem>) {
        browser.unsubscribe(parentId)
        done(items)
      }

      override fun onError(parent: String) {
        browser.unsubscribe(parentId)
        done(emptyList())
      }
    })
  }

  /** 알림 접근 설정. 이 앱의 상세 화면을 열고, 없는 기기에서는 전체 목록을 연다. */
  @ReactMethod fun openPermissionSettings(promise: Promise) {
    val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
      .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, listener().flattenToString())
    promise.resolve(start(detail) || start(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)))
  }

  /** 멜론 앱(로그인·재생). 설치되지 않았으면 스토어의 멜론 화면. */
  @ReactMethod fun openMelon(promise: Promise) {
    val launch = app.packageManager.getLaunchIntentForPackage(MelonPolicy.PACKAGE)
    promise.resolve(
      (launch != null && start(launch)) ||
        start(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${MelonPolicy.PACKAGE}"))) ||
        start(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${MelonPolicy.PACKAGE}"))),
    )
  }

  override fun invalidate() {
    main.post {
      close()
      settle(false)
    }
    super.invalidate()
  }

  private fun settle(connected: Boolean) {
    val pending = waiting.toList()
    waiting.clear()
    pending.forEach { it.resolve(connected) }
  }

  private fun close() {
    try {
      browser?.disconnect()
    } catch (_: Exception) {
      // 이미 끊겼다.
    }
    browser = null
    browserController = null
  }

  private fun installed() = try {
    app.packageManager.getPackageInfo(MelonPolicy.PACKAGE, 0)
    true
  } catch (_: PackageManager.NameNotFoundException) {
    false
  }

  private fun browserService(): ComponentName? = try {
    app.packageManager
      .queryIntentServices(Intent("android.media.browse.MediaBrowserService").setPackage(MelonPolicy.PACKAGE), 0)
      .firstOrNull()?.serviceInfo?.let { ComponentName(it.packageName, it.name) }
  } catch (_: Exception) {
    null
  }

  private fun listener() = ComponentName(app, MelonListenerService::class.java)

  private fun permitted() = try {
    app.getSystemService(android.app.NotificationManager::class.java)?.isNotificationListenerAccessGranted(listener()) == true
  } catch (_: Exception) {
    false
  }

  // MediaBrowser 연결의 세션을 먼저 쓰고, 없으면 알림 접근 권한으로 활성 멜론 세션을 찾는다.
  private fun controller(): MediaController? {
    browserController?.let { if (browser?.isConnected == true) return it }
    if (!permitted()) return null
    return try {
      app.getSystemService(MediaSessionManager::class.java)
        ?.getActiveSessions(listener())
        ?.firstOrNull { MelonPolicy.isMelon(it.packageName) }
    } catch (_: SecurityException) {
      null
    }
  }

  private fun snapshot(controller: MediaController): MelonSnapshot {
    val state = controller.playbackState
    val metadata = controller.metadata
    val playing = state?.state == PlaybackState.STATE_PLAYING
    val actions = state?.actions ?: 0L
    val loginRequired = state != null && MelonPolicy.loginRequired(state.state, errorCode(state))
    val title = metadata?.getText(MediaMetadata.METADATA_KEY_TITLE)?.toString()
    val track = if (metadata == null || title.isNullOrBlank()) {
      null
    } else {
      val artist = (metadata.getText(MediaMetadata.METADATA_KEY_ARTIST)
        ?: metadata.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST))?.toString() ?: ""
      val duration = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION).coerceAtLeast(0L)
      val id = metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)?.takeIf { it.isNotBlank() } ?: "$title\u0000$artist"
      MelonTrack(
        id = id,
        title = title,
        artist = artist,
        durationMs = duration,
        positionMs = if (state == null) 0L else MelonPolicy.positionMs(
          state.position, state.lastPositionUpdateTime, state.playbackSpeed, SystemClock.elapsedRealtime(), playing, duration,
        ),
        artworkUri = artwork(id, metadata),
      )
    }
    return MelonSnapshot(true, playing, loginRequired, MelonPolicy.commandsOf(actions), track)
  }

  // 플랫폼 PlaybackState는 오류 코드를 공개하지 않는다. 기기에 있으면 읽고, 없으면 0(로그인 필요로 보지 않음).
  // 멜론의 로그아웃 상태 보고 방식은 실기기 미검증이다.
  private fun errorCode(state: PlaybackState) = try {
    PlaybackState::class.java.getMethod("getErrorCode").invoke(state) as? Int ?: 0
  } catch (_: Exception) {
    0
  }

  // 메타데이터의 앨범 아트 비트맵을 캐시에 곡별 파일로 저장해 file:// URI로 넘긴다. 마지막 곡 하나만 남긴다.
  // 비트맵이 없으면 멜론이 준 아트 URI를 그대로 넘기고, 그것도 없으면 null(2.7 기본 커버).
  private fun artwork(id: String, metadata: MediaMetadata): String? {
    val bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
      ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
    if (bitmap == null) {
      return (metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI)
        ?: metadata.getString(MediaMetadata.METADATA_KEY_ART_URI))?.takeIf { it.isNotBlank() }
    }
    return try {
      val dir = File(app.cacheDir, ART_DIR).apply { mkdirs() }
      val file = File(dir, "${Integer.toHexString(id.hashCode())}-${bitmap.width}x${bitmap.height}.jpg")
      if (!file.exists()) {
        dir.listFiles()?.forEach { it.delete() }
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      }
      Uri.fromFile(file).toString()
    } catch (_: Exception) {
      null
    }
  }

  private fun start(intent: Intent) = try {
    app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (_: Exception) {
    false
  }

  private companion object {
    const val CONNECT_TIMEOUT_MS = 5_000L
    const val BROWSE_TIMEOUT_MS = 8_000L
    const val ART_DIR = "melon-art"
  }
}

class MelonMediaPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(MelonMediaModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
