package com.runway.watch.session

import com.runway.watch.batch.Reading
import com.runway.watch.run.FeedStatus
import com.runway.watch.run.HeartRate
import com.runway.watch.run.MetricFeeds
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.roundToInt

/**
 * The latest measured values of the run for the watch screen (S15P31E105-420). The same readings go unchanged to the
 * uploader; here only the newest value of each kind is kept with when it arrived. Nothing is filled from guesses: a
 * value never measured stays null, and an old one is shown as delayed, then as no signal.
 */
class LiveReadings(private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 }) {

    data class Value<T>(val value: T, val receivedMs: Long)

    data class Latest(
        val heartRate: Value<Int>? = null,
        val cadence: Value<Int>? = null,
        /** Seconds per km from the latest speed; null while standing still. */
        val pace: Value<Int?>? = null,
        val distanceMeters: Value<Double>? = null,
        /** Active exercise time of the newest reading, in seconds. */
        val activeSec: Value<Long>? = null,
    )

    private val _latest = MutableStateFlow(Latest())
    val latest: StateFlow<Latest> = _latest

    @Synchronized
    fun offer(readings: List<Reading>) {
        if (readings.isEmpty()) return
        val now = elapsedMs()
        var next = _latest.value
        for (r in readings) {
            r.heartRateBpm?.takeIf { it.isFinite() && it > 0 }?.let { next = next.copy(heartRate = Value(it.roundToInt(), now)) }
            r.cadenceSpm?.takeIf { it.isFinite() && it >= 0 }?.let { next = next.copy(cadence = Value(it.roundToInt(), now)) }
            r.speedMps?.takeIf { it.isFinite() && it >= 0 }?.let { speed ->
                next = next.copy(pace = Value(if (speed < MIN_MOVING_MPS) null else (1000 / speed).roundToInt(), now))
            }
            r.totalDistanceM?.takeIf { it.isFinite() && it >= 0 }?.let { next = next.copy(distanceMeters = Value(it, now)) }
            if (r.elapsedSec >= (next.activeSec?.value ?: 0)) next = next.copy(activeSec = Value(r.elapsedSec, now))
        }
        _latest.value = next
    }

    /** A new run starts from nothing; the last run's values are never shown in it. */
    @Synchronized
    fun reset() {
        _latest.value = Latest()
    }

    companion object {
        /** Below this speed the runner is standing; no pace is shown rather than a huge one. */
        const val MIN_MOVING_MPS = 0.3
        /** A value older than this is shown as delayed. Heart rate arrives about every 5 s (HEART_RATE_5_SECONDS). */
        const val LIVE_MS = 15_000L
        /** A value older than this is no longer shown as current at all. */
        const val STALE_MS = 60_000L

        fun feed(value: Value<*>?, nowMs: Long): FeedStatus = when {
            value == null -> FeedStatus.NO_SIGNAL
            nowMs - value.receivedMs <= LIVE_MS -> FeedStatus.LIVE
            nowMs - value.receivedMs <= STALE_MS -> FeedStatus.DELAYED
            else -> FeedStatus.NO_SIGNAL
        }

        fun feeds(latest: Latest, nowMs: Long) = MetricFeeds(
            // 거리·페이스는 같은 위치 공급원으로 본다. 누적 거리는 멈춰 있으면 갱신되지 않을 수 있어, 서 있어도 계속
            // 오는 속도 수신 시각을 먼저 본다(속도 0이면 페이스 값만 비운다).
            location = feed(latest.pace ?: latest.distanceMeters, nowMs),
            heartRate = feed(latest.heartRate, nowMs),
            cadence = feed(latest.cadence, nowMs),
        )

        fun heartRate(latest: Latest): HeartRate? = latest.heartRate?.value?.let(::HeartRate)
    }
}
