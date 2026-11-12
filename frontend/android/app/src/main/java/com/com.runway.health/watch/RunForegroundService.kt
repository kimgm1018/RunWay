package com.runway.health.watch

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import com.runway.health.MainActivity

/**
 * Keeps the app process (and JS) alive while a run is prepared or running so watch requests and results reach the
 * server with the screen off (S15P31E105-256 D-7). Type connectedDevice: relaying to the paired watch (D-11).
 * After a phone takeover (S15P31E105-464) it also holds the location type so phone GPS keeps coming with the screen off.
 */
class RunForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("WakelockTimeout") // One lock per active service, released in onDestroy; runs have no fixed duration.
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "러닝 기록", NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE,
    )
    // Without the location permission the type is left out; the run then keeps time only.
    val location = intent?.getBooleanExtra(EXTRA_LOCATION, false) == true &&
      checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("러닝 중")
      // S15P31E105-549: 워치 기록 중에도 위치 유형을 켜므로 위치 여부로 기록 기기를 말하지 않는다.
      .setContentText("러닝 기록을 저장하고 있어요")
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    val device = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    if (location) {
      try {
        startForeground(NOTIFICATION_ID, notification, device or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } catch (_: Exception) {
        // Android 14+ may refuse the location type (started from the background, location off). The relay keeps
        // running without it; phone GPS may then stop with the screen off and the route stays unknown (S15P31E105-549).
        startForeground(NOTIFICATION_ID, notification, device)
      }
    } else {
      startForeground(NOTIFICATION_ID, notification, device)
    }
    // RunTimersKeeper keeps RN timers eligible, but HeadlessJsTaskContext.startTask does not acquire a wake lock.
    // A foreground notification also does not prevent CPU suspend. Keep GPS callbacks, relay and JS uploads running
    // while the screen is off. Repeated starts (including PHONE_FALLBACK) must not acquire another lock.
    if (wakeLock == null) {
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunWay:RunRecording")
        .apply {
          setReferenceCounted(false)
          acquire()
        }
      diag("run CPU kept on")
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
      diag("run CPU kept off")
    } finally {
      super.onDestroy()
    }
  }

  companion object {
    const val EXTRA_LOCATION = "location"
    private const val CHANNEL_ID = "run_session"
    private const val NOTIFICATION_ID = 2560
  }
}
