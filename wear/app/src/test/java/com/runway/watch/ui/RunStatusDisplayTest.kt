package com.runway.watch.ui

import com.runway.watch.readiness.CheckState
import com.runway.watch.run.*
import com.runway.watch.ui.format.MetricFormat
import org.junit.Assert.*
import org.junit.Test

class RunStatusDisplayTest {
    private val measured = RunMetrics(
        distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 356,
        heartRate = HeartRate(152), cadenceSpm = 171, goalProgress = .476f,
    )

    private fun view(metrics: RunMetrics = measured, pending: Boolean = false, phone: Boolean = true) =
        RunStatusDisplay.from(RunSnapshot(RunState.RUNNING, phoneConnected = phone, pendingCommand = pending, metrics = metrics))

    @Test fun liveValuesShowWithUnitsAndNoIssues() {
        val v = view()
        assertEquals("5′56″", v.pace.text.value)
        assertEquals("2.38", v.distance.text.value)
        assertEquals("km", v.distance.text.unit)
        assertEquals("14:12", v.elapsed.text.value)
        assertEquals("152", v.heartRate.text.value)
        assertEquals("spm", v.cadence.text.unit)
        assertFalse(v.phoneLost)
        assertFalse(v.pace.delayed)
    }

    @Test fun lostSourcesDropTheirLastValueInsteadOfShowingItAsCurrent() {
        val v = view(measured.copy(feeds = MetricFeeds(heartRate = FeedStatus.STOPPED, cadence = FeedStatus.NO_SIGNAL)))
        assertTrue(v.heartRate.text.missing)
        assertEquals(MetricFormat.MISSING, v.heartRate.text.value)
        assertEquals("심박수 수집 중단", v.heartRate.text.description)
        assertEquals("♥", v.heartRate.text.symbol)
        assertEquals(MetricFormat.MISSING, v.cadence.text.value)
        assertEquals("spm", v.cadence.text.unit)
        assertEquals("케이던스 미수신", v.cadence.text.description)
    }

    @Test fun delayedValuesStayButAreMarked() {
        val v = view(measured.copy(feeds = MetricFeeds(location = FeedStatus.DELAYED)))
        assertEquals("2.38", v.distance.text.value)
        assertTrue(v.distance.delayed)
        assertTrue(v.pace.delayed)
        assertEquals("거리 2.38 킬로미터, 지연", v.distance.text.description)
        assertEquals(.476f, v.ringProgress!!, 0f)
    }

    @Test fun delayedSourceWithoutAValueIsJustMissing() {
        val v = view(RunMetrics(feeds = MetricFeeds(heartRate = FeedStatus.DELAYED)))
        assertTrue(v.heartRate.text.missing)
        assertFalse(v.heartRate.delayed)
    }

    @Test fun missingValuesAreNeverZero() {
        val v = view(RunMetrics())
        for (metric in listOf(v.pace, v.distance, v.elapsed, v.heartRate, v.cadence)) {
            assertTrue(metric.text.missing)
            assertEquals(MetricFormat.MISSING, metric.text.value)
        }
    }

    @Test fun freeRunHasNoGoalRing() {
        val v = view(measured.copy(goalProgress = null))
        assertFalse(v.hasGoal)
        assertNull(v.ringProgress)
    }

    @Test fun goalRingKeepsOnlyItsTrackWhileLocationIsLost() {
        val v = view(measured.copy(feeds = MetricFeeds(location = FeedStatus.NO_SIGNAL)))
        assertTrue(v.hasGoal)
        assertNull(v.ringProgress)
        assertTrue(v.distance.text.missing)
        assertTrue(v.pace.text.missing)
    }

    @Test fun pendingRequestAndPhoneLossAreFlagged() {
        val v = view(pending = true, phone = false)
        assertTrue(v.pending)
        assertTrue(v.phoneLost)
    }

    @Test fun onlyAConfirmedLossOfInternetIsFlagged() {
        val snapshot = RunSnapshot(RunState.RUNNING, metrics = measured)
        assertTrue(RunStatusDisplay.from(snapshot, online = CheckState.MISSING).offline)
        assertFalse(RunStatusDisplay.from(snapshot, online = CheckState.CHECKING).offline)
        assertFalse(RunStatusDisplay.from(snapshot, online = CheckState.UNKNOWN).offline)
        assertFalse(RunStatusDisplay.from(snapshot).offline)
    }

    @Test fun serverLinkLossAndTheLabelledRhythmAreShown() {
        val v = RunStatusDisplay.from(RunSnapshot(RunState.RUNNING, serverLinkLost = true, metrics = measured.copy(rhythm = RhythmBpm(172))))
        assertTrue(v.serverLost)
        assertEquals("♪︎ 리듬 BPM 172", v.rhythmLabel)
        // 심박수는 ♥ 기호와 "심박" 표시로, 리듬은 "리듬 BPM"으로 구분한다.
        assertEquals("♥", v.heartRate.text.symbol)
        assertEquals("심박수 152", v.heartRate.text.description)
        assertFalse(view().serverLost)
    }
}
