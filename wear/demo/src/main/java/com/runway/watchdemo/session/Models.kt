package com.runway.watchdemo.session

enum class SessionState { STARTING, RUNNING, STOPPING, COMPLETED, INTERRUPTED, FAILED }
enum class UploadState { PENDING, UPLOADING, UPLOADED, FAILED }
enum class MetricKind { STEPS, STEPS_TOTAL, CADENCE, DISTANCE, DISTANCE_TOTAL, SPEED, HEART_RATE, STEP_LENGTH }
data class MetricSample(
    val kind: MetricKind, val startElapsedMs: Long, val endElapsedMs: Long,
    val value: Double?, val unit: String, val source: String = "health_services",
    val quality: String = "good",
)
data class BpmEvent(
    val requestedElapsedMs: Long, val appliedElapsedMs: Long, val targetBpm: Int,
    val soundEnabled: Boolean = true, val vibrationEnabled: Boolean = true,
)
data class CueSettings(val bpm: Int = 120, val soundEnabled: Boolean = true, val vibrationEnabled: Boolean = true)
data class DeviceInfo(
    val model: String = "", val api: Int? = null, val appVersion: String = "",
    val bootCount: Int? = null, val synthetic: Boolean? = null,
)
data class SessionRecord(
    val id: String, val participantId: String, val startedAtEpochMs: Long, val startedElapsedMs: Long,
    val state: SessionState = SessionState.STARTING, val endedElapsedMs: Long? = null,
    val endReason: String = "", val device: DeviceInfo = DeviceInfo(),
    val capabilities: Map<String, String> = emptyMap(), val events: List<BpmEvent> = emptyList(),
    val samples: List<MetricSample> = emptyList(), val uploadState: UploadState = UploadState.PENDING,
) {
    val isFinal: Boolean get() = endedElapsedMs != null && state in setOf(SessionState.COMPLETED, SessionState.INTERRUPTED, SessionState.FAILED)
}

object MetricMath {
    fun unreliable(quality: String) = quality.contains("UNRELIABLE", true) || quality.contains("NO_CONTACT", true)
    fun clampBpm(value: Int) = value.coerceIn(60, 220)
    fun beatOffsetNanos(index: Long, bpm: Int): Long =
        (index * (60_000_000_000.0 / clampBpm(bpm))).toLong()
    fun bpmAt(events: List<BpmEvent>, elapsedMs: Long): Int? =
        events.filter { it.appliedElapsedMs <= elapsedMs }.maxByOrNull { it.appliedElapsedMs }?.targetBpm
    fun paceSecondsPerKm(speed: Double?): Double? =
        speed?.takeIf { it.isFinite() && it > 0 }?.let { 1000 / it }
    fun stepLength(distance: MetricSample, steps: MetricSample): Double? {
        if (distance.kind != MetricKind.DISTANCE || steps.kind != MetricKind.STEPS ||
            distance.startElapsedMs != steps.startElapsedMs || distance.endElapsedMs != steps.endElapsedMs ||
            distance.endElapsedMs <= distance.startElapsedMs ||
            unreliable(distance.quality) || unreliable(steps.quality)) return null
        val d = distance.value?.takeIf { it.isFinite() && it > 0 } ?: return null
        val s = steps.value?.takeIf { it.isFinite() && it > 0 } ?: return null
        return d / s
    }
}

enum class SupportStatus(val wireValue: String) {
    SUPPORTED("supported"), UNSUPPORTED("unsupported"), PERMISSION_DENIED("permission_denied");

    companion object {
        fun fromWire(value: String?): SupportStatus? = entries.firstOrNull { it.wireValue == value }
    }
}

/** Decode the string-map boundary; SDK availability stays separate from typed support. */
object MeasurementSupport {
    fun status(values: Map<String, String>, kind: MetricKind): SupportStatus? {
        val key = "${kind.name}.support"
        if (key in values) return SupportStatus.fromWire(values[key])
        val legacy = values[when (kind) {
        MetricKind.STEPS, MetricKind.STEPS_TOTAL -> "Steps"
        MetricKind.CADENCE -> "Step per minute"
        MetricKind.DISTANCE, MetricKind.DISTANCE_TOTAL -> "Distance"
        MetricKind.SPEED -> "Speed"
        MetricKind.HEART_RATE -> "HeartRate"
        MetricKind.STEP_LENGTH -> "Stride Length"
        }]
        // Old keys mixed support and availability. Only their AVAILABLE value implies support.
        return if (legacy == "AVAILABLE") SupportStatus.SUPPORTED else SupportStatus.fromWire(legacy)
    }
    fun isSupported(values: Map<String, String>, kind: MetricKind) = status(values, kind) == SupportStatus.SUPPORTED
}
