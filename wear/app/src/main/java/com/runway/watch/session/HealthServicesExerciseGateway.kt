package com.runway.watch.session

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.BatchingMode
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseUpdate
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseTrackedStatus
import androidx.health.services.client.data.ExerciseType
import android.os.SystemClock
import com.runway.watch.batch.Reading
import kotlinx.coroutines.guava.await
import java.time.Duration
import java.time.Instant

/**
 * Starts and stops a Health Services RUNNING exercise for approved commands (S15P31E105-256 [D]).
 * Readings from the update listener go to [onReadings] with their original measurement time (S15P31E105-311); the
 * uploader turns them into batches. GPS stays off until the location permission and the run foreground service are
 * added with the screens (part 2). Auto pause is off so pause/resume follow commands.
 * An update listener stays registered while the exercise runs: Health Services auto-ends an exercise whose owner has
 * no listener for a few minutes (seen in the device E2E), so it is registered again after a process restart too.
 */
class HealthServicesExerciseGateway(
    context: Context,
    private val client: ExerciseClient = HealthServices.getClient(context).exerciseClient,
    private val onReadings: (List<Reading>) -> Unit = {},
) : ExerciseGateway {
    private val context = context.applicationContext
    private var listener: ExerciseUpdateCallback? = null
    @Volatile private var lastDistanceEnd: Instant? = null

    private fun keepListening() {
        if (listener != null) return
        val callback = object : ExerciseUpdateCallback {
            override fun onRegistered() = Unit
            override fun onRegistrationFailed(throwable: Throwable) { listener = null }
            override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
                // 값은 로그에 남기지 않는다. 변환 실패는 해당 업데이트만 건너뛴다.
                val readings = try { readingsOf(update, bootInstant()) } catch (_: Exception) { return }
                // 누적 거리는 같은 구간 끝 시각으로 다시 올 수 있어 한 번만 넘긴다.
                val last = lastDistanceEnd
                val fresh = readings.filter { it.totalDistanceM == null || last == null || it.measuredAt.isAfter(last) }
                fresh.lastOrNull { it.totalDistanceM != null }?.let { lastDistanceEnd = it.measuredAt }
                if (fresh.isNotEmpty()) onReadings(fresh)
            }
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
        // 화면이 꺼져도 심박을 약 5초 간격으로 받도록 지원 기기에서만 켠다(watch-mobile-server-integration.md 2장).
        val batching = setOf(BatchingMode.HEART_RATE_5_SECONDS).intersect(supported.supportedBatchingModeOverrides)
        lastDistanceEnd = null
        keepListening()
        client.startExerciseAsync(
            ExerciseConfig(
                ExerciseType.RUNNING,
                selected,
                isAutoPauseAndResumeEnabled = false,
                isGpsEnabled = false,
                batchingModeOverrides = batching,
            ),
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

    // Same restricted-constant exception as start().
    @SuppressLint("RestrictedApi")
    override suspend fun reattach(): Boolean {
        val status = client.getCurrentExerciseInfoAsync().await().exerciseTrackedStatus
        if (status != ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS) return false
        keepListening()
        return true
    }

    // Health Services throttles flushes; a throttled one simply delivers nothing early.
    override suspend fun flush() {
        client.flushAsync().await()
    }

    override suspend fun end() {
        client.endExerciseAsync().await()
        listener?.let { client.clearUpdateCallbackAsync(it) }
        listener = null
    }

    private fun bootInstant(): Instant = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())

    companion object {
        /**
         * One [Reading] per delivered data point, at its own measurement time. Distance is the cumulative total at the
         * end of its interval; the same total for the same end time is reported once.
         */
        fun readingsOf(update: ExerciseUpdate, boot: Instant): List<Reading> {
            val metrics = update.latestMetrics
            val out = mutableListOf<Reading>()
            fun elapsed(duration: Duration?): Long = (duration ?: Duration.ZERO).seconds.coerceAtLeast(0)
            metrics.getData(DataType.HEART_RATE_BPM).forEach {
                out += Reading(it.getTimeInstant(boot), elapsed(update.getActiveDurationAtDataPoint(it)), heartRateBpm = it.value)
            }
            metrics.getData(DataType.SPEED).forEach {
                out += Reading(it.getTimeInstant(boot), elapsed(update.getActiveDurationAtDataPoint(it)), speedMps = it.value)
            }
            metrics.getData(DataType.STEPS_PER_MINUTE).forEach {
                out += Reading(it.getTimeInstant(boot), elapsed(update.getActiveDurationAtDataPoint(it)), cadenceSpm = it.value.toDouble())
            }
            metrics.getData(DataType.DISTANCE_TOTAL)?.let { total ->
                val checkpoint = update.activeDurationCheckpoint
                val active = checkpoint?.let {
                    val since = Duration.between(it.time, total.end)
                    if (update.exerciseStateInfo.state.isPaused || since.isNegative) it.activeDuration else it.activeDuration + since
                }
                out += Reading(total.end, elapsed(active), totalDistanceM = total.total)
            }
            return out
        }
    }
}
