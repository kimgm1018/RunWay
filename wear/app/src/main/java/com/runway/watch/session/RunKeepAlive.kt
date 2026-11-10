package com.runway.watch.session

import android.Manifest
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.os.IBinder
import android.os.PowerManager
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

/**
 * Whether the run may use watch GPS (S15P31E105-549). Health Services needs a location-type foreground service for
 * the whole GPS exercise, and Android 14+ refuses that type from the background without background location. So GPS
 * is used only with fine location, the GPS provider on, and either the app on screen or the service already holding
 * the type. The service and the exercise gateway ask the same question, so a run started normally does not have GPS
 * without the type. A process restarted in the background can still reattach to a GPS exercise while the service
 * holds health only; that case is left to device checks (review R-1).
 */
object RunLocationHold {
    /** The run service currently holds the location type. */
    @Volatile var held = false

    /**
     * Whether the run service should ask for the location type: on screen, already holding it, or with background
     * location ("항상 허용", S15P31E105-549 사용자 결정) so a run started from the phone with the watch screen off can use GPS too.
     */
    fun allowed(context: Context): Boolean = permitted(context) && (held || onScreen() || background(context))

    /**
     * Whether the exercise may turn GPS on (S15P31E105-549). On screen the service gets the type at once. Otherwise
     * GPS is used only once the service really holds the type: with background location it waits up to [waitMs] for the
     * service started just before. A GPS exercise never runs without the location service type.
     */
    suspend fun gpsReady(context: Context, waitMs: Long = 2_000, stepMs: Long = 100): Boolean {
        if (!permitted(context)) return false
        if (held || onScreen()) return true
        if (!background(context)) return false
        var waited = 0L
        while (waited < waitMs) {
            if (held) return true
            kotlinx.coroutines.delay(stepMs)
            waited += stepMs
        }
        return held
    }

    /** Background location ("항상 허용") granted. */
    fun background(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Fine location granted and the GPS provider on (Health Services asks for both before a GPS exercise). */
    fun permitted(context: Context): Boolean {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false
        return try {
            context.getSystemService(LocationManager::class.java)?.isProviderEnabled(LocationManager.GPS_PROVIDER) == true
        } catch (_: Exception) {
            false
        }
    }

    /** Whether the app is on screen; replaced in tests, where Robolectric cannot tell. */
    @Volatile internal var onScreen: () -> Boolean = ::appOnScreen

    private fun appOnScreen(): Boolean = try {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    } catch (_: Exception) {
        false
    }
}

/**
 * Health-type foreground service with an ongoing notification that opens the run screen. When [RunLocationHold]
 * allows it, it also holds the location type for the GPS exercise. If the OS still refuses that type, the service
 * starts as health only instead of crashing the run; the route then stays unknown.
 */
class RunForegroundService : Service() {
    /** Already in the foreground: later starts (every server snapshot) keep the types it got, never downgrade them. */
    private var foreground = false

    /**
     * S15P31E105-549 (시험): 화면이 꺼지면 Health Services가 거리·속도를 모아 1분쯤 뒤에 준다. 러닝 중에는 CPU를 깨워 두어
     * 측정값이 바로 오게 한다. 서비스가 끝나면 놓고, 놓지 못해도 최대 [WAKE_MAX_MS] 뒤 풀린다.
     */
    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (foreground) return START_NOT_STICKY
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
        val health = ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        val location = RunLocationHold.allowed(this)
        RunLocationHold.held = if (location) {
            try {
                startForeground(NOTIFICATION_ID, notification, health or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
                Log.i("RunSession", "run service location type held")
                true
            } catch (e: Exception) {
                // 백그라운드 위치 유형 시작 제한 등. 기록은 위치 없이 이어간다.
                Log.w("RunSession", "location foreground refused: ${e.javaClass.simpleName}")
                startForeground(NOTIFICATION_ID, notification, health)
                false
            }
        } else {
            startForeground(NOTIFICATION_ID, notification, health)
            false
        }
        foreground = true
        try {
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "runway:run")
                .apply { setReferenceCounted(false); acquire(WAKE_MAX_MS) }
            Log.i("RunSession", "run service wake lock held")
        } catch (e: Exception) {
            Log.w("RunSession", "wake lock refused: ${e.javaClass.simpleName}")
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        try { wake?.takeIf { it.isHeld }?.release() } catch (_: Exception) { }
        wake = null
        RunLocationHold.held = false
        super.onDestroy()
    }

    private companion object {
        const val CHANNEL_ID = "run_session"
        const val NOTIFICATION_ID = 3110
        const val WAKE_MAX_MS = 4L * 60 * 60 * 1000
    }
}
