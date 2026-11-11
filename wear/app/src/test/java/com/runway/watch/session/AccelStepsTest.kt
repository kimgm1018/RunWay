package com.runway.watch.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

// 가속도 걸음 세기(S15P31E105-549). 합성 파형만 쓴다.
class AccelStepsTest {
    private fun run(hz: Double, amplitude: Double, seconds: Int): Long {
        val steps = AccelSteps()
        val rate = 50
        for (i in 0 until seconds * rate) {
            val t = i.toDouble() / rate
            val z = 9.81 + amplitude * sin(2 * PI * hz * t)
            steps.offer((t * 1_000_000_000).toLong(), 0f, 0f, z.toFloat())
        }
        return steps.count
    }

    @Test
    fun `a walking swing of 2_5 Hz counts about 2_5 steps a second`() {
        val counted = run(2.5, 4.0, 20)
        assertTrue("counted=$counted", counted in 45..52)
    }

    @Test
    fun `small shaking on a desk counts nothing`() {
        assertEquals(0L, run(2.5, 0.5, 20))
    }

    @Test
    fun `steps faster than 240 a minute are not counted twice`() {
        val counted = run(6.0, 4.0, 10)
        assertTrue("counted=$counted", counted <= 41)
    }
}
