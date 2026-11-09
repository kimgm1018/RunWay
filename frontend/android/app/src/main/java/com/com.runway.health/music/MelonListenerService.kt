package com.runway.health.music

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.service.notification.NotificationListenerService

/**
 * 알림 접근 권한을 받기 위한 서비스(S15P31E105-398, MUS-002). 사용자가 허용하면 활성 멜론 재생 세션을 찾을 수
 * 있다. 알림 내용은 읽거나 저장하지 않는다. 2.7 최근 들은 곡을 위해 멜론 세션의 곡이 바뀔 때만 그 곡을 이 기기에
 * 기록한다(S15P31E105-566, MelonHistory).
 */
class MelonListenerService : NotificationListenerService() {
  private var sessions: MediaSessionManager? = null
  private var watched: MediaController? = null

  private val callback = object : MediaController.Callback() {
    override fun onMetadataChanged(metadata: MediaMetadata?) {
      MelonHistory.record(this@MelonListenerService, metadata)
    }
  }

  private val changed = MediaSessionManager.OnActiveSessionsChangedListener { watch(it) }

  override fun onListenerConnected() {
    val manager = getSystemService(MediaSessionManager::class.java) ?: return
    val me = ComponentName(this, MelonListenerService::class.java)
    try {
      manager.addOnActiveSessionsChangedListener(changed, me)
      sessions = manager
      watch(manager.getActiveSessions(me))
    } catch (_: SecurityException) {
      // 권한이 막 해제됐다.
    }
  }

  override fun onListenerDisconnected() {
    sessions?.removeOnActiveSessionsChangedListener(changed)
    sessions = null
    watched?.unregisterCallback(callback)
    watched = null
  }

  private fun watch(controllers: List<MediaController>?) {
    val melon = controllers?.firstOrNull { MelonPolicy.isMelon(it.packageName) }
    if (melon?.sessionToken == watched?.sessionToken) return
    watched?.unregisterCallback(callback)
    watched = melon
    melon?.registerCallback(callback)
    MelonHistory.record(this, melon?.metadata)
  }
}
