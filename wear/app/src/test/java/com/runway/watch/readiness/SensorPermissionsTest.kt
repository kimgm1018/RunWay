package com.runway.watch.readiness

import org.junit.Assert.*
import org.junit.Test

class SensorPermissionsTest {
    @Test fun api36UsesHealthHeartRateAndDoesNotRequireBackgroundGrant() {
        val grants = setOf("android.permission.health.READ_HEART_RATE", "android.permission.ACTIVITY_RECOGNITION")
        assertEquals(SensorPermissions(true, true), sensorPermissions(36, grants))
        assertEquals(SensorPermissions(false, true), sensorPermissions(36, grants - "android.permission.health.READ_HEART_RATE"))
        assertEquals(SensorPermissions(false, true), sensorPermissions(36, grants - "android.permission.health.READ_HEART_RATE" + "android.permission.BODY_SENSORS"))
    }

    @Test fun earlierDevicesUseBodySensorsAndReportMissingActivitySeparately() {
        assertEquals(SensorPermissions(true, false), sensorPermissions(35, setOf("android.permission.BODY_SENSORS")))
        assertEquals(SensorPermissions(false, false), sensorPermissions(35, setOf("android.permission.health.READ_HEART_RATE")))
    }
}
