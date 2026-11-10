package com.runway.watch.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 화면이 꺼진 동안의 걸음 추정(S15P31E105-549). 합성 값만 쓴다.
class StepEstimateTest {
    private fun sec(s: Double) = (s * 1_000_000_000).toLong()

    @Test
    fun `cadence comes from the steps of the last 15 s`() {
        val e = StepEstimate()
        assertNull(e.estimate(sec(0.0)))
        // 사용 전 센서 누적 1000걸음에서 시작해 초당 2.5걸음(150 spm).
        for (i in 0..20) e.onSteps(sec(i.toDouble()), 1000L + (i * 5) / 2)
        val v = e.estimate(sec(20.0))!!
        assertEquals(150.0, v.cadenceSpm!!.toDouble(), 3.0)
        // 기본 보폭 0.8 m: 150 spm → 2 m/s → 500 s/km.
        assertEquals(500.0, v.paceSecPerKm!!.toDouble(), 15.0)
        assertEquals(50 * 0.8, v.distanceM!!, 1.0)
    }

    @Test
    fun `the stride follows the Health Services distance at the same moment`() {
        val e = StepEstimate()
        for (i in 0..60) e.onSteps(sec(i.toDouble()), 2L * i)
        // HS: 0 m at 0 s, 120 m at 60 s (120 steps) → 1.0 m per step.
        e.onDistance(sec(0.0), 0.0)
        e.onDistance(sec(60.0), 120.0)
        assertEquals(1.0, e.strideM, 0.01)
        // 20 more steps after the HS distance: 120 + 20 × 1.0.
        for (i in 61..70) e.onSteps(sec(i.toDouble()), 2L * i)
        assertEquals(140.0, e.estimate(sec(70.0))!!.distanceM!!, 0.5)
        assertTrue(e.calibrated)
    }

    @Test
    fun `steps while paused do not count and standing shows no pace`() {
        val e = StepEstimate()
        e.onSteps(sec(0.0), 100)
        e.onSteps(sec(10.0), 120)
        e.pause()
        // 일시정지 동안 300걸음: 재개 뒤 첫 값은 새 기준이다.
        e.onSteps(sec(70.0), 420)
        e.onSteps(sec(80.0), 420)
        val v = e.estimate(sec(80.0))!!
        assertEquals(20 * 0.8, v.distanceM!!, 0.01)
        assertEquals(0, v.cadenceSpm)
        assertNull(v.paceSecPerKm)
    }

    @Test
    fun `an unlikely stride is ignored and reset clears the run`() {
        val e = StepEstimate()
        for (i in 0..30) e.onSteps(sec(i.toDouble()), 2L * i)
        e.onDistance(sec(0.0), 0.0)
        e.onDistance(sec(30.0), 500.0) // 60 steps for 500 m: not a stride.
        assertEquals(StepEstimate.DEFAULT_STRIDE_M, e.strideM, 0.0)
        assertFalse(e.calibrated)
        e.reset()
        assertNull(e.estimate(sec(0.0)))
    }

    @Test
    fun `the cadence factor follows Health Services when one swing counts once`() {
        val e = StepEstimate()
        // 가속도로 초당 1.25번(75 spm)만 셌지만 Health Services 케이던스는 150 spm.
        for (i in 0..40) e.onSteps(sec(i * 0.8), 1000L + i)
        e.onCadence(sec(30.0), 150.0)
        assertEquals(2.0, e.cadenceFactor, 0.0)
        assertEquals(150.0, e.estimate(sec(32.0))!!.cadenceSpm!!.toDouble(), 5.0)
    }

    @Test
    fun `no new step for 3 s means standing even though the last 15 s had steps`() {
        // 걸음은 셀 때만 표본이 생긴다. 신호등에서 멈추면 표본이 더 오지 않는다.
        val e = StepEstimate()
        for (i in 0..20) e.onSteps(sec(i.toDouble()), 1000L + (i * 5) / 2)
        assertEquals(150.0, e.estimate(sec(21.0))!!.cadenceSpm!!.toDouble(), 3.0)
        val still = e.estimate(sec(24.0))!!
        assertEquals(0, still.cadenceSpm)
        assertNull(still.paceSecPerKm)
        assertEquals(50 * 0.8, still.distanceM!!, 1.0)
    }
}
