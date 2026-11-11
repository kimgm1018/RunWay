package com.runway.watch.ui

import com.runway.watch.run.*
import org.junit.Assert.*
import org.junit.Test

class RecordCompareDisplayTest {
    private val metrics = RunMetrics(distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 356, goalProgress = .476f)

    private fun snapshot(comparison: RecordComparison) = RunSnapshot(RunState.RUNNING, metrics = metrics, comparison = comparison)

    private fun view(comparison: RecordComparison) = RecordCompareDisplay.from(snapshot(comparison))

    private fun gap(current: Long, past: Long, label: String? = "10.13") =
        view(RecordComparison.Result(2384.0, current, past, label)) as RecordCompareView.Gap

    @Test fun aheadShowsMinusSecondsAndSaysFaster() {
        val v = gap(852_000, 873_000)
        assertEquals(CompareTrend.AHEAD, v.trend)
        assertEquals("−21”", v.gap)
        assertEquals("지난번보다 빨라요", v.headline)
        assertEquals("지난 기록보다 21초 빠름", v.description)
        assertEquals("10.13 기록과 비교", v.caption)
        assertEquals("2.38km 도달\n지금 14:12 · 지난 14:33", v.detail)
        assertTrue(v.marker > .5f)
    }

    @Test fun behindByMinutesShowsPlusMinutesAndSaysSlower() {
        val v = gap(938_000, 873_000)
        assertEquals(CompareTrend.BEHIND, v.trend)
        assertEquals("+1’05”", v.gap)
        assertEquals("지난번보다 느려요", v.headline)
        assertEquals("지난 기록보다 1분 5초 느림", v.description)
        assertTrue(v.marker < .5f)
    }

    @Test fun subSecondGapIsEven() {
        val v = gap(873_400, 873_000)
        assertEquals(CompareTrend.EVEN, v.trend)
        assertEquals("0”", v.gap)
        assertEquals("지난번과 같아요", v.headline)
        assertEquals(.5f, v.marker, 0f)
    }

    @Test fun largeGapsStayOnTheBar() {
        assertEquals(.9f, gap(0, 600_000).marker, 1e-6f)
        assertEquals(.1f, gap(600_000, 0).marker, 1e-6f)
    }

    @Test fun runWithoutAComparisonHasNothingToShow() {
        assertNull(view(RecordComparison.NotSelected))
        assertNull(view(RecordComparison.Result(2384.0, 852_000, 873_000, targetLabel = null)))
        assertNull(view(RecordComparison.Result(2384.0, 852_000, 873_000, targetLabel = " ")))
    }

    @Test fun statesWithoutAResultNeverShowAGap() {
        for (c in listOf(RecordComparison.NoRecord, RecordComparison.Waiting, RecordComparison.Unavailable)) {
            assertTrue(c.toString(), view(c) is RecordCompareView.Message)
        }
        assertEquals("비교할 기록이 없어요", (view(RecordComparison.NoRecord) as RecordCompareView.Message).title)
        assertTrue((view(RecordComparison.Unavailable) as RecordCompareView.Message).warning)
    }

    @Test fun invalidResultIsTreatedAsNotReceived() {
        val waiting = view(RecordComparison.Waiting)
        assertEquals(waiting, view(RecordComparison.Result(Double.NaN, 852_000, 873_000, "10.13")))
        assertEquals(waiting, view(RecordComparison.Result(2384.0, -1, 873_000, "10.13")))
    }

    @Test fun losingTheComparisonKeepsOwnRunAndGoal() {
        val before = RunStatusDisplay.from(snapshot(RecordComparison.Result(2384.0, 852_000, 873_000)))
        val after = RunStatusDisplay.from(snapshot(RecordComparison.Unavailable))
        assertEquals(before, after)
        assertTrue(after.hasGoal)
        assertEquals(.476f, after.ringProgress!!, 0f)
    }
}
