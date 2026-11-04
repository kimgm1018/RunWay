package com.runway.watch.dailyhr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PermissionFlowTest {
    private val hr = "android.permission.health.READ_HEART_RATE"
    private val hrBg = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    private val body = "android.permission.BODY_SENSORS"
    private val bodyBg = "android.permission.BODY_SENSORS_BACKGROUND"
    private val activity = "android.permission.ACTIVITY_RECOGNITION"

    @Test
    fun foregroundFirstOnSdk36() {
        assertEquals(listOf(hr, activity), nextPermissionRequest(36, emptySet()))
    }

    @Test
    fun onlyMissingForegroundIsRequested() {
        assertEquals(listOf(activity), nextPermissionRequest(36, setOf(hr)))
    }

    @Test
    fun backgroundAloneAfterForegroundOnSdk36() {
        assertEquals(listOf(hrBg), nextPermissionRequest(36, setOf(hr, activity)))
    }

    @Test
    fun nullWhenAllGrantedOnSdk36() {
        assertNull(nextPermissionRequest(36, setOf(hr, hrBg, activity)))
    }

    @Test
    fun legacyList() {
        assertEquals(listOf(body, activity), nextPermissionRequest(34, emptySet()))
        assertEquals(listOf(bodyBg), nextPermissionRequest(34, setOf(body, activity)))
        assertNull(nextPermissionRequest(34, setOf(body, bodyBg, activity)))
    }

    @Test
    fun backgroundGrantedAloneStillAsksForeground() {
        assertEquals(listOf(hr, activity), nextPermissionRequest(36, setOf(hrBg)))
    }
}
