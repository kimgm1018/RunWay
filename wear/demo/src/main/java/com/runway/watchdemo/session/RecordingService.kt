package com.runway.watchdemo.session

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import com.runway.watchdemo.R
import com.runway.watchdemo.BuildConfig
import com.runway.watchdemo.cue.WatchCuePlayer
import com.runway.watchdemo.exercise.HealthExerciseSource
import com.runway.watchdemo.exercise.Permissions
import com.runway.watchdemo.presentation.MainActivity
import kotlinx.coroutines.*

class RecordingService : Service() {
    private lateinit var controller: SessionController
    private var wakeLock: PowerManager.WakeLock? = null
    private var tick: Job? = null
    private var completed = false
    override fun onCreate() {
        super.onCreate(); WatchRuntime.initialize(this)
        val scope = WatchRuntime.io
        controller = SessionController(WatchRuntime.store, HealthExerciseSource(this), WatchCuePlayer(this),
            { SystemClock.elapsedRealtime() }, { System.currentTimeMillis() },
            DeviceInfo(model = Build.MODEL, api = Build.VERSION.SDK_INT, appVersion = BuildConfig.VERSION_NAME,
                bootCount = runCatching { android.provider.Settings.Global.getInt(contentResolver,
                    android.provider.Settings.Global.BOOT_COUNT, -1) }.getOrNull()?.takeIf { it >= 0 },
                synthetic = Build.FINGERPRINT.contains("generic") || Build.MODEL.contains("sdk")),
            { block -> scope.launch { block() } }, { snapshot ->
                WatchRuntime.state.value = snapshot
                if (!snapshot.busy && snapshot.state != null && !completed) {
                    completed = true
                    scope.launch { runCatching { WatchRuntime.refresh() }; releaseResources(); stopSelf() }
                }
            })
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            START -> {
                try { showForeground(); acquireWakeLock() }
                catch (_: Exception) { WatchRuntime.feedback.value = "운동 서비스를 시작하지 못했습니다. 권한을 확인하세요"; stopSelf(); return START_NOT_STICKY }
                WatchRuntime.io.launch {
                    controller.start(WatchRuntime.settings.participantId, WatchRuntime.settings.cue())
                    if (!controller.snapshot().busy) { releaseResources(); stopSelf() }
                }
                if (tick == null) tick = WatchRuntime.io.launch {
                    while (isActive) { delay(1000); controller.tick() }
                }
            }
            UPDATE -> WatchRuntime.io.launch { controller.updateCue(WatchRuntime.settings.cue()) }
            STOP -> WatchRuntime.io.launch { controller.stop() }
        }
        return START_NOT_STICKY
    }
    private fun showForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("recording", "러닝 실험 기록", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, RecordingService::class.java).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(this, "recording").setSmallIcon(R.drawable.splash_icon)
            .setContentTitle("RunWay 측정 중").setContentText("BPM 안내와 운동 기록이 진행 중입니다")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).addAction(0, "실험 종료", stop)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
        OngoingActivity.Builder(this, 53, builder).setStaticIcon(R.drawable.splash_icon).setTouchIntent(open).build().apply(this)
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (Build.VERSION.SDK_INT >= 34) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        if (Permissions.gps(this)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        startForeground(53, builder.build(), types)
    }
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RunWay:recording").apply {
            setReferenceCounted(false); acquire(2 * 60 * 60 * 1000L)
        }
    }
    private fun releaseResources() { tick?.cancel(); tick = null; if (wakeLock?.isHeld == true) wakeLock?.release(); stopForeground(STOP_FOREGROUND_REMOVE) }
    override fun onDestroy() {
        WatchRuntime.io.launch { controller.interrupt(); releaseResources() }
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    companion object {
        const val START = "runway.start"; const val STOP = "runway.stop"; const val UPDATE = "runway.cue"
    }
}
