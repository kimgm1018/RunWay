package com.runway.watch.session

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import com.runway.watch.MainActivity

/**
 * Keeps the watch process alive while a run is recorded (S15P31E105-311). Without it the OS ends the process as soon
 * as the app leaves the screen, and the exercise listener, the batch queue and the session state go with it.
 */
interface RunKeepAlive {
    fun start()
    fun stop()
}

object NoKeepAlive : RunKeepAlive {
    override fun start() = Unit
    override fun stop() = Unit
}

class ServiceKeepAlive(context: Context) : RunKeepAlive {
    private val context = context.applicationContext

    override fun start() {
        try {
            context.startForegroundService(Intent(context, RunForegroundService::class.java))
        } catch (e: Exception) {
            // Android may refuse a start from the background; the run goes on, only the process is less protected.
            Log.w("RunSession", "keep-alive start failed: ${e.javaClass.simpleName}")
        }
    }

    override fun stop() {
        context.stopService(Intent(context, RunForegroundService::class.java))
    }
}

/** Health-type foreground service with an ongoing notification that opens the run screen. */
class RunForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "러닝 기록", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("러닝 중")
            .setContentText("기록을 휴대폰으로 보내고 있어요")
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .build()
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        return START_NOT_STICKY
    }

    private companion object {
        const val CHANNEL_ID = "run_session"
        const val NOTIFICATION_ID = 3110
    }
}
