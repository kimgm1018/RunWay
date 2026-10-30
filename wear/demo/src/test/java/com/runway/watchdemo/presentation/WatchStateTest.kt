package com.runway.watchdemo.presentation

import com.runway.watchdemo.exercise.Permissions
import com.runway.watchdemo.session.*
import org.junit.Assert.*
import org.junit.Test

class WatchStateTest {
    @Test fun missingOldAndEstimatedMeasurementsAreDistinguished() {
        assertEquals("—", MetricDisplay.value(null, 20000))
        val sample = MetricSample(MetricKind.STEP_LENGTH, 1000, 2000, 1.2, "m/step", "estimated_distance_div_steps", "estimated")
        assertTrue(MetricDisplay.value(sample, 2000).contains("추정"))
        assertTrue(MetricDisplay.value(sample, 20000).contains("이전"))
        assertEquals("—", MetricDisplay.value(sample.copy(value = Double.NaN), 2000))
        assertEquals("—", MetricDisplay.value(sample.copy(quality = "unreliable"), 2000))
    }
    @Test fun paceAndHeartRatePermissionsUseCorrectUnitsAndApi() {
        assertEquals("5:00 /km", MetricDisplay.pace(MetricSample(MetricKind.SPEED, 1000, 1000, 10.0 / 3.0, "m/s"), 1000))
        assertEquals("—", MetricDisplay.pace(MetricSample(MetricKind.SPEED, 1000, 1000, 0.0, "m/s"), 1000))
        assertEquals("android.permission.BODY_SENSORS", Permissions.heartRate(35))
        assertEquals("android.permission.health.READ_HEART_RATE", Permissions.heartRate(36))
    }
}
