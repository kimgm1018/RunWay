package com.runway.health.watch

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import com.runway.health.MainActivity

/**
 * Keeps the app process (and JS) alive while a run is prepared or running so watch requests and results reach the
 * server with the screen off (S15P31E105-256 D-7). Type connectedDevice: relaying to the paired watch (D-11).
 * After a phone takeover (S15P31E105-464) it also holds the location type so phone GPS keeps coming with the screen off.
 */
class RunForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

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
      .setContentText(if (location) "폰에서 기록하고 있어요" else "워치와 기록을 주고받고 있어요")
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
      (if (location) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
    startForeground(NOTIFICATION_ID, notification, types)
    return START_NOT_STICKY
  }

  companion object {
    const val EXTRA_LOCATION = "location"
    private const val CHANNEL_ID = "run_session"
    private const val NOTIFICATION_ID = 2560
  }
}
