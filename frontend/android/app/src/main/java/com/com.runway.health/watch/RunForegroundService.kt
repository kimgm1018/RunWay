package com.runway.health.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import com.runway.health.MainActivity

/**
 * Keeps the app process (and JS) alive while a run is prepared or running so watch requests and results reach the
 * server with the screen off (S15P31E105-256 D-7). Type connectedDevice: relaying to the paired watch (D-11).
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
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("러닝 중")
      .setContentText("워치와 기록을 주고받고 있어요")
      .setContentIntent(open)
      .setOngoing(true)
      .build()
    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    return START_NOT_STICKY
  }

  private companion object {
    const val CHANNEL_ID = "run_session"
    const val NOTIFICATION_ID = 2560
  }
}
