package com.runway.watch.run

import com.runway.watch.run.PaceRule.DistanceSample
import com.runway.watch.run.PaceRule.SpeedSample
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** 현재 페이스 공통 규칙(S15P31E105-549 2안). 폰 paceRule.test.ts와 같은 값으로 검증한다. */
class PaceRuleTest {
    private fun at(sec: Long) = Instant.EPOCH.plusSeconds(sec)

    @Test
    fun `the pace is the time over the distance of the last 15 s`() {
        val samples = listOf(
            DistanceSample(at(0), 0.0), DistanceSample(at(10), 50.0),
            DistanceSample(at(15), 65.0), DistanceSample(at(25), 95.0),
        )
        assertEquals(1000 / 3.0, PaceRule.currentPace(samples, null)!!, 1e-6)
    }

    @Test
    fun `with too few samples in 15 s it uses the nearest earlier one within 60 s`() {
        assertEquals(1000 / 3.0, PaceRule.currentPace(listOf(DistanceSample(at(0), 100.0), DistanceSample(at(40), 220.0)), null)!!, 1e-6)
        assertNull(PaceRule.currentPace(listOf(DistanceSample(at(0), 0.0), DistanceSample(at(70), 200.0)), null))
    }

    @Test
    fun `standing still shows no pace, by the latest speed or by the distance`() {
        val moving = listOf(DistanceSample(at(0), 0.0), DistanceSample(at(15), 45.0))
        assertNull(PaceRule.currentPace(moving, SpeedSample(at(16), 0.2)))
        assertNull(PaceRule.currentPace(listOf(DistanceSample(at(0), 0.0), DistanceSample(at(15), 3.0)), null))
    }

    @Test
    fun `without enough distance it falls back to the latest speed`() {
        assertEquals(400.0, PaceRule.currentPace(listOf(DistanceSample(at(0), 0.0)), SpeedSample(at(1), 2.5))!!, 1e-6)
        assertNull(PaceRule.currentPace(emptyList(), null))
    }
}
