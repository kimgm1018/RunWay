package com.runway.watch.dailyhr

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionPolicyTest {
    @Test
    fun consentComesFirst() {
        assertEquals(CollectionState.OFF_NO_CONSENT, decide(false, false, false, 0, false))
        assertEquals(CollectionState.OFF_NO_CONSENT, decide(false, true, true, 100, true))
    }

    @Test
    fun batteryPctFallsBackWhenCapacityIsUnsupported() {
        assertEquals(42, batteryPct(42, 10, 100))
        assertEquals(50, batteryPct(Int.MIN_VALUE, 1, 2))
        assertEquals(30, batteryPct(0, 30, 100))
        assertEquals(100, batteryPct(Int.MIN_VALUE, -1, -1))
        assertEquals(100, batteryPct(-1, 5, 0))
    }

    @Test
    fun permissionComesBeforeSupport() {
        assertEquals(CollectionState.NEEDS_PERMISSION, decide(true, false, false, 0, false))
    }

    @Test
    fun supportComesBeforeBattery() {
        assertEquals(CollectionState.UNSUPPORTED, decide(true, true, false, 0, false))
    }

    @Test
    fun batteryBelowTenPausesUnlessCharging() {
        assertEquals(CollectionState.PAUSED_LOW_BATTERY, decide(true, true, true, 9, false))
        assertEquals(CollectionState.COLLECTING, decide(true, true, true, 9, true))
        assertEquals(CollectionState.COLLECTING, decide(true, true, true, 10, false))
    }

    @Test
    fun onlyAgreedConsentAllowsStoring() {
        assertFalse(canStore(null))
        assertFalse(canStore(HealthConsent(false, Instant.EPOCH)))
        assertTrue(canStore(HealthConsent(true, Instant.EPOCH)))
    }

    @Test
    fun permissionsFollowDeviceSdk() {
        assertEquals(
            listOf(
                "android.permission.health.READ_HEART_RATE",
                "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
                "android.permission.ACTIVITY_RECOGNITION",
            ),
            requiredPermissions(36),
        )
        assertEquals(
            listOf(
                "android.permission.BODY_SENSORS",
                "android.permission.BODY_SENSORS_BACKGROUND",
                "android.permission.ACTIVITY_RECOGNITION",
            ),
            requiredPermissions(35),
        )
    }
}
