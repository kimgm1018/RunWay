package com.runway.watchdemo.presentation

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.runway.watchdemo.exercise.Permissions
import com.runway.watchdemo.session.*

class MainActivity : ComponentActivity() {
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (Permissions.activity(this)) beginRecording()
        else WatchRuntime.feedback.value = "측정하려면 신체 활동 권한이 필요합니다"
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WatchRuntime.initialize(applicationContext)
        setContent {
            WatchApp(
                onStart = {
                    if (!WatchRuntime.settings.participantId.matches(Regex("[A-Za-z0-9_-]{1,40}"))) {
                        WatchRuntime.feedback.value = "설정에서 가명 참가자 ID를 먼저 입력하세요"
                    } else if (!WatchRuntime.state.value.busy) {
                        val missing = Permissions.requested(android.os.Build.VERSION.SDK_INT).filter { !Permissions.granted(this, it) }
                        if (missing.isNotEmpty()) permissions.launch(missing.toTypedArray()) else beginRecording()
                    }
                },
                onStop = { startService(Intent(this, RecordingService::class.java).setAction(RecordingService.STOP)) },
                onCue = { cue ->
                    WatchRuntime.settings.saveCue(cue)
                    if (WatchRuntime.state.value.busy) startService(Intent(this, RecordingService::class.java).setAction(RecordingService.UPDATE))
                    else WatchRuntime.state.value = WatchRuntime.state.value.copy(cue = cue)
                },
            )
        }
    }
    private fun beginRecording() {
        if (!Permissions.activity(this) || WatchRuntime.state.value.busy) return
        WatchRuntime.feedback.value = ""
        try { ContextCompat.startForegroundService(this, Intent(this, RecordingService::class.java).setAction(RecordingService.START)) }
        catch (_: Exception) { WatchRuntime.feedback.value = "측정을 시작하지 못했습니다. 앱 권한을 확인하세요" }
    }
}
