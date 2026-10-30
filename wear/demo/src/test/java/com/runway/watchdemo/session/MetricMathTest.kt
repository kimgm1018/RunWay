package com.runway.watchdemo.session

import org.junit.Assert.*
import org.junit.Test

class MetricMathTest {
    @Test fun bpmBoundsAndBeatTiming() {
        assertEquals(60, MetricMath.clampBpm(58))
        assertEquals(220, MetricMath.clampBpm(222))
        assertEquals(1_000_000_000L, MetricMath.beatOffsetNanos(1, 60))
        assertEquals(600_000_000_000L, MetricMath.beatOffsetNanos(1640, 164))
    }
    @Test fun delayedSamplesUseAppliedBpmNotArrivalOrder() {
        val events = listOf(BpmEvent(2900, 3000, 168), BpmEvent(900, 1000, 164))
        assertEquals(164, MetricMath.bpmAt(events, 2500))
        assertEquals(168, MetricMath.bpmAt(events, 3000))
        assertNull(MetricMath.bpmAt(events, 500))
    }
    @Test fun paceRejectsMissingStoppedAndInvalidSpeed() {
        for (v in listOf(null, 0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY))
            assertNull(MetricMath.paceSecondsPerKm(v))
        assertEquals(250.0, MetricMath.paceSecondsPerKm(4.0)!!, 0.001)
    }
    @Test fun strideRequiresSameIntervalAndUsableMeasurements() {
        val distance = MetricSample(MetricKind.DISTANCE, 1000, 5000, 120.0, "m")
        val steps = MetricSample(MetricKind.STEPS, 1000, 5000, 100.0, "steps")
        assertEquals(1.2, MetricMath.stepLength(distance, steps)!!, 0.0001)
        assertNull(MetricMath.stepLength(distance, steps.copy(startElapsedMs = 2000)))
        assertNull(MetricMath.stepLength(distance, steps.copy(value = 0.0)))
        assertNull(MetricMath.stepLength(distance, steps.copy(value = null)))
        assertNull(MetricMath.stepLength(distance.copy(value = -1.0), steps))
        assertNull(MetricMath.stepLength(distance, steps.copy(value = Double.NaN)))
        assertNull(MetricMath.stepLength(distance.copy(quality = "unreliable"), steps))
    }
}
