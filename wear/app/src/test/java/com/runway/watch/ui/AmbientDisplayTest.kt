package com.runway.watch.ui

import androidx.compose.ui.unit.IntOffset
import com.runway.watch.navigation.WatchRoute
import com.runway.watch.run.RunMetrics
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** S15P31E105-617: the ambient screen keeps only key run values, in whole minutes. */
class AmbientDisplayTest {
    private val metrics = RunMetrics(distanceMeters = 2384.0, elapsedMs = 852_000)

    @Test fun runningShowsStateMinutesAndDistance() {
        val d = AmbientDisplay.of(RunSnapshot(RunState.RUNNING, metrics = metrics), WatchRoute.RUNNING)
        assertEquals(AmbientDisplay("러닝 중", "14분", "2.38 km"), d)
    }

    @Test fun pausedAndEndConfirmShowPaused() {
        val s = RunSnapshot(RunState.PAUSED, metrics = metrics)
        assertEquals("일시정지", AmbientDisplay.of(s, WatchRoute.PAUSED).label)
        assertEquals("일시정지", AmbientDisplay.of(s, WatchRoute.END_CONFIRM).label)
    }

    @Test fun otherScreensKeepOnlyALine() {
        val standby = AmbientDisplay.of(RunSnapshot(RunState.READY), WatchRoute.STANDBY)
        assertEquals(AmbientDisplay("RunWay"), standby)
        assertEquals(AmbientDisplay("러닝 종료"), AmbientDisplay.of(RunSnapshot(RunState.COMPLETED), WatchRoute.RESULT))
        assertEquals(AmbientDisplay("휴대폰에서 기록 중"), AmbientDisplay.of(RunSnapshot(RunState.RUNNING, phoneRecording = true), WatchRoute.RUNNING))
        assertNull(AmbientDisplay.of(RunSnapshot(RunState.RUNNING, measurementLost = true), WatchRoute.RUNNING).elapsed)
    }

    @Test fun minutesDropSeconds() {
        assertEquals("0분", AmbientDisplay.minutes(59_000))
        assertEquals("1시간 05분", AmbientDisplay.minutes(65 * 60_000L + 30_000))
        assertEquals("– –", AmbientDisplay.minutes(null))
    }

    @Test fun burnInProtectionMovesTheContentEachUpdate() {
        assertEquals(IntOffset.Zero, AmbientDisplay.shift(AmbientMode(burnInProtection = false, tick = 3)))
        val first = AmbientDisplay.shift(AmbientMode(burnInProtection = true, tick = 1))
        assertNotEquals(first, AmbientDisplay.shift(AmbientMode(burnInProtection = true, tick = 2)))
    }
}
