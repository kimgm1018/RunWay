package com.runway.watch.session

import com.runway.watch.batch.Reading
import com.runway.watch.run.FeedStatus
import com.runway.watch.run.HeartRate
import com.runway.watch.run.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** S15P31E105-420: the watch screen shows the values the watch measures, as measured, with how fresh they are. */
class LiveReadingsTest {
    private var now = 1_000L
    private val live = LiveReadings(elapsedMs = { now })
    private val at = Instant.parse("2026-11-09T02:00:00Z")
    private val running = WatchSessionState(sessionId = "13", confirmed = RunState.RUNNING, stateVersion = 2)

    @Test
    fun `the newest value of each kind is shown with the pace from the speed`() {
        live.offer(listOf(
            Reading(at, 60, heartRateBpm = 151.6),
            Reading(at, 61, speedMps = 2.5),
            Reading(at, 61, cadenceSpm = 171.0),
            Reading(at, 62, totalDistanceM = 180.0),
        ))

        val metrics = SessionRunControl.metrics(running, live.latest.value, now)
        assertEquals(HeartRate(152), metrics.heartRate)
        assertEquals(400, metrics.paceSecondsPerKm)
        assertEquals(171, metrics.cadenceSpm)
        assertEquals(180.0, metrics.distanceMeters!!, 0.0)
        assertEquals(62_000L, metrics.elapsedMs)
        assertEquals(FeedStatus.LIVE, metrics.feeds.heartRate)
    }

    @Test
    fun `standing still shows no pace instead of a huge one, and unmeasured values stay empty`() {
        live.offer(listOf(Reading(at, 5, speedMps = 0.1)))

        val metrics = SessionRunControl.metrics(running, live.latest.value, now)
        assertNull(metrics.paceSecondsPerKm)
        assertNull(metrics.heartRate)
        assertEquals(FeedStatus.NO_SIGNAL, metrics.feeds.heartRate)
    }

    @Test
    fun `old values turn delayed, then no signal, and time runs on only while running`() {
        live.offer(listOf(Reading(at, 100, heartRateBpm = 150.0)))
        now += LiveReadings.LIVE_MS + 1
        val late = SessionRunControl.metrics(running, live.latest.value, now)
        assertEquals(FeedStatus.DELAYED, late.feeds.heartRate)
        assertEquals(100_000L + LiveReadings.LIVE_MS + 1, late.elapsedMs)

        val paused = SessionRunControl.metrics(running.copy(confirmed = RunState.PAUSED), live.latest.value, now)
        assertEquals(100_000L, paused.elapsedMs)

        now += LiveReadings.STALE_MS
        assertEquals(FeedStatus.NO_SIGNAL, SessionRunControl.metrics(running, live.latest.value, now).feeds.heartRate)
    }

    @Test
    fun `standing still keeps the location feed live through the speed readings`() {
        live.offer(listOf(Reading(at, 10, totalDistanceM = 50.0), Reading(at, 10, speedMps = 2.0)))
        now += LiveReadings.STALE_MS
        // 서 있어 누적 거리가 갱신되지 않아도 속도 0은 계속 온다.
        live.offer(listOf(Reading(at, 70, speedMps = 0.0)))

        val metrics = SessionRunControl.metrics(running, live.latest.value, now)
        assertEquals(FeedStatus.LIVE, metrics.feeds.location)
        assertNull(metrics.paceSecondsPerKm)
        assertEquals(50.0, metrics.distanceMeters!!, 0.0)
    }

    @Test
    fun `nothing is shown before the run, after it was handed to the phone, or after a reset`() {
        live.offer(listOf(Reading(at, 10, heartRateBpm = 150.0)))

        assertNull(SessionRunControl.metrics(running.copy(confirmed = RunState.READY), live.latest.value, now).heartRate)
        assertNull(SessionRunControl.metrics(running.copy(phoneRecording = true), live.latest.value, now).heartRate)
        live.reset()
        assertNull(SessionRunControl.metrics(running, live.latest.value, now).heartRate)
    }
}
