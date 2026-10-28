package com.runway.watchdemo.exercise

import android.content.Context
import android.location.LocationManager
import android.os.SystemClock
import androidx.health.services.client.HealthServices
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.data.*
import com.runway.watchdemo.session.*
import java.util.concurrent.TimeUnit

/** Blocking commands run on the recording service's dedicated executor, never the UI thread. */
class HealthExerciseSource(private val context: Context, private val client: androidx.health.services.client.ExerciseClient = HealthServices.getClient(context).exerciseClient) : ExerciseSource {
    private var callback: ExerciseUpdateCallback? = null
    private var owned = false
    // 1.1.0 marks the status annotation restricted, including the constants explicitly
    // documented for getCurrentExerciseInfoAsync. Keep this exception at that boundary.
    @android.annotation.SuppressLint("RestrictedApi")
    override fun start(onSamples: (List<MetricSample>) -> Unit, onState: (ExerciseSignal) -> Unit) {
        check(Permissions.activity(context)) { "신체 활동 권한을 허용하세요" }
        val info = client.getCurrentExerciseInfoAsync().get(15, TimeUnit.SECONDS)
        when (info.exerciseTrackedStatus) {
            ExerciseTrackedStatus.OWNED_EXERCISE_IN_PROGRESS -> client.endExerciseAsync().get(15, TimeUnit.SECONDS)
            ExerciseTrackedStatus.NO_EXERCISE_IN_PROGRESS -> Unit
            else -> error("기존 운동을 먼저 종료하세요. 다른 앱의 운동은 중단하지 않습니다")
        }
        val caps = client.getCapabilitiesAsync().get(15, TimeUnit.SECONDS)
        check(ExerciseType.RUNNING in caps.supportedExerciseTypes) { "이 기기는 러닝 측정을 지원하지 않습니다" }
        val supported = caps.getExerciseTypeCapabilities(ExerciseType.RUNNING).supportedDataTypes
        val gps = Permissions.gps(context) && context.getSystemService(LocationManager::class.java).isProviderEnabled(LocationManager.GPS_PROVIDER)
        val wanted = mutableSetOf<DataType<*, *>>(DataType.STEPS, DataType.STEPS_TOTAL, DataType.STEPS_PER_MINUTE,
            DataType.DISTANCE, DataType.DISTANCE_TOTAL, DataType.SPEED, DataType.STRIDE_LENGTH)
        if (Permissions.heart(context)) wanted.add(DataType.HEART_RATE_BPM)
        val selected = wanted.intersect(supported)
        check(selected.isNotEmpty()) { "수집 가능한 지표가 없습니다" }
        val support = linkedMapOf<String, String>()
        for (type in wanted + DataType.HEART_RATE_BPM) {
            val status = when {
                type == DataType.HEART_RATE_BPM && !Permissions.heart(context) -> SupportStatus.PERMISSION_DENIED
                type in selected -> SupportStatus.SUPPORTED
                else -> SupportStatus.UNSUPPORTED
            }
            support["${metricKind(type)!!.name}.support"] = status.wireValue
            // Legacy names combine interval and total support; canonical keys above are authoritative.
            if (SupportStatus.fromWire(support[type.name]) != SupportStatus.SUPPORTED) support[type.name] = status.wireValue
        }
        support["gps"] = if (gps) "enabled_fallback_possible" else "disabled_steps_based"
        val originWall = System.currentTimeMillis(); val originElapsed = SystemClock.elapsedRealtime()
        fun elapsed(epoch: Long) = originElapsed + epoch - originWall
        val distanceSource = if (gps) "health_services_gps_enabled_fallback_possible" else "health_services_steps_based"
        val listener = object : ExerciseUpdateCallback {
            override fun onRegistered() {}
            override fun onRegistrationFailed(throwable: Throwable) { onState(ExerciseSignal.Error("운동 측정 연결 실패")) }
            override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
            override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {
                val values = mutableMapOf(dataType.name to availability.toString())
                metricKind(dataType)?.let { values["${it.name}.availability"] = availability.toString() }
                onState(ExerciseSignal.Availability(values))
            }
            override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
                val metrics = update.latestMetrics
                val points = mutableListOf<MetricSample>()
                fun <T : Number> samples(type: DeltaDataType<T, SampleDataPoint<T>>, kind: MetricKind, unit: String) {
                    metrics.getData(type).forEach { p ->
                        val accuracy = p.accuracy?.toString() ?: "unknown"
                        val v = p.value.toDouble()
                        points.add(MetricSample(kind, p.timeDurationFromBoot.toMillis(), p.timeDurationFromBoot.toMillis(),
                            v.takeIf { it.isFinite() && it >= 0 }, unit,
                            if (kind == MetricKind.SPEED) distanceSource else "health_services",
                            if (!v.isFinite() || accuracy.contains("UNRELIABLE", true) || accuracy.contains("NO_CONTACT", true)) "unreliable" else accuracy))
                    }
                }
                samples(DataType.HEART_RATE_BPM, MetricKind.HEART_RATE, "bpm")
                samples(DataType.SPEED, MetricKind.SPEED, "m/s")
                samples(DataType.STEPS_PER_MINUTE, MetricKind.CADENCE, "steps/min")
                samples(DataType.STRIDE_LENGTH, MetricKind.STEP_LENGTH, "m/step")
                metrics.getData(DataType.STEPS).forEach { p -> points.add(MetricSample(MetricKind.STEPS,
                    p.startDurationFromBoot.toMillis(), p.endDurationFromBoot.toMillis(), p.value.toDouble(), "steps",
                    quality = p.accuracy?.toString() ?: "good")) }
                metrics.getData(DataType.DISTANCE).forEach { p -> points.add(MetricSample(MetricKind.DISTANCE,
                    p.startDurationFromBoot.toMillis(), p.endDurationFromBoot.toMillis(),
                    p.value.takeIf { it.isFinite() && it >= 0 }, "m", distanceSource,
                    p.accuracy?.toString() ?: "unknown")) }
                metrics.getData(DataType.STEPS_TOTAL)?.let { p -> points.add(MetricSample(MetricKind.STEPS_TOTAL,
                    elapsed(p.start.toEpochMilli()), elapsed(p.end.toEpochMilli()), p.total.toDouble(), "steps")) }
                metrics.getData(DataType.DISTANCE_TOTAL)?.let { p -> points.add(MetricSample(MetricKind.DISTANCE_TOTAL,
                    elapsed(p.start.toEpochMilli()), elapsed(p.end.toEpochMilli()), p.total, "m", distanceSource, "unknown")) }
                val state = update.exerciseStateInfo.state
                if (state == ExerciseState.ACTIVE) onState(ExerciseSignal.Active(support))
                if (points.isNotEmpty()) onSamples(points)
                if (state.isEnded) { owned = false; onState(ExerciseSignal.Ended(update.exerciseStateInfo.endReason.toString())) }
            }
        }
        callback = listener
        client.setUpdateCallback(listener)
        try {
            client.startExerciseAsync(ExerciseConfig(ExerciseType.RUNNING, selected,
                isAutoPauseAndResumeEnabled = false, isGpsEnabled = gps)).get(20, TimeUnit.SECONDS)
            owned = true
        } catch (e: Exception) { close(); throw IllegalStateException("운동을 시작하지 못했습니다. 권한과 기존 운동을 확인하세요", e) }
    }
    override fun stop() { if (owned) client.endExerciseAsync().get(15, TimeUnit.SECONDS) }
    override fun close() { callback?.let { client.clearUpdateCallbackAsync(it) }; callback = null }

    private fun metricKind(type: DataType<*, *>): MetricKind? = when (type) {
        DataType.STEPS -> MetricKind.STEPS
        DataType.STEPS_TOTAL -> MetricKind.STEPS_TOTAL
        DataType.STEPS_PER_MINUTE -> MetricKind.CADENCE
        DataType.DISTANCE -> MetricKind.DISTANCE
        DataType.DISTANCE_TOTAL -> MetricKind.DISTANCE_TOTAL
        DataType.SPEED -> MetricKind.SPEED
        DataType.HEART_RATE_BPM -> MetricKind.HEART_RATE
        DataType.STRIDE_LENGTH -> MetricKind.STEP_LENGTH
        else -> null
    }
}
