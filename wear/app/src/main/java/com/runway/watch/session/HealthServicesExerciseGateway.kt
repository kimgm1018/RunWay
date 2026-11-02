package com.runway.watch.session

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseUpdate
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import kotlinx.coroutines.guava.await

/**
 * Starts and stops a Health Services RUNNING exercise for approved commands (S15P31E105-256 [D]).
 * Only start/stop: turning readings into batches is S15P31E105-311. GPS stays off until the location permission and
 * the run foreground service are added with the screens (part 2). Auto pause is off so pause/resume follow commands.
 * An update listener stays registered while the exercise runs: Health Services auto-ends an exercise whose owner has
 * no listener for a few minutes (seen in the device E2E), so it is registered again after a process restart too.
 */
class HealthServicesExerciseGateway(
    context: Context,
    private val client: ExerciseClient = HealthServices.getClient(context).exerciseClient,
) : ExerciseGateway {
    private val context = context.applicationContext
    private var listener: ExerciseUpdateCallback? = null

    // 측정값 묶음 전송은 S15P31E105-311 범위라 여기서는 연결만 유지한다.
    private fun keepListening() {
        if (listener != null) return
        val callback = object : ExerciseUpdateCallback {
            override fun onRegistered() = Unit
            override fun onRegistrationFailed(throwable: Throwable) { listener = null }
            override fun onExerciseUpdateReceived(update: ExerciseUpdate) = Unit
            override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) = Unit
            override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) = Unit
        }
        listener = callback
        client.setUpdateCallback(callback)
    }

    // health-services-client 1.1.0 marks the tracked-status constants restricted although they are documented
    // for getCurrentExerciseInfoAsync; same exception as the demo app.
    @SuppressLint("RestrictedApi")
    override suspend fun start() {
        if (context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED) {
            throw ExerciseRejected("PERMISSION_DENIED")
        }
        when (client.getCurrentExerciseInfoAsync().await().exerciseTrackedStatus) {
            ExerciseTrackedStatus.NO_EXERCISE_IN_PROGRESS -> Unit
            // 이전 실행이 남긴 이 앱의 운동은 정리하고 새로 시작한다. 다른 앱의 운동은 중단하지 않는다.
            ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS -> client.endExerciseAsync().await()
            else -> throw ExerciseRejected("EXERCISE_IN_USE")
        }
        val supported = client.getCapabilitiesAsync().await()
        if (ExerciseType.RUNNING !in supported.supportedExerciseTypes) throw ExerciseRejected("EXERCISE_UNSUPPORTED")
        val available = supported.getExerciseTypeCapabilities(ExerciseType.RUNNING).supportedDataTypes
        val wanted = setOf(DataType.HEART_RATE_BPM, DataType.DISTANCE_TOTAL, DataType.SPEED, DataType.STEPS_PER_MINUTE)
        val selected = wanted.intersect(available)
        if (selected.isEmpty()) throw ExerciseRejected("EXERCISE_UNSUPPORTED")
        keepListening()
        client.startExerciseAsync(
            ExerciseConfig(ExerciseType.RUNNING, selected, isAutoPauseAndResumeEnabled = false, isGpsEnabled = false),
        ).await()
    }

    override suspend fun pause() {
        keepListening()
        client.pauseExerciseAsync().await()
    }

    override suspend fun resume() {
        keepListening()
        client.resumeExerciseAsync().await()
    }

    override suspend fun end() {
        client.endExerciseAsync().await()
        listener?.let { client.clearUpdateCallbackAsync(it) }
        listener = null
    }
}
