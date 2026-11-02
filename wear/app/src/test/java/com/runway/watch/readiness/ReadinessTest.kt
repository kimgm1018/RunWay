package com.runway.watch.readiness

import com.runway.watch.readiness.CheckState.*
import org.junit.Assert.*
import org.junit.Test

class ReadinessTest {
    private val ready = Readiness(consent = OK, permission = OK, registration = OK, online = OK)

    @Test fun nothingMissingMeansNoIssue() {
        assertNull(ReadinessRules.issue(ready))
        // Unknown and still-checking items are not issues; the phone's own check still guards the start.
        assertNull(ReadinessRules.issue(Readiness()))
        assertNull(ReadinessRules.issue(ready.copy(online = CHECKING, registration = UNKNOWN)))
    }

    @Test fun eachMissingItemIsItsOwnIssue() {
        assertEquals(ReadinessIssue.CONSENT, ReadinessRules.issue(ready.copy(consent = MISSING)))
        assertEquals(ReadinessIssue.PERMISSION, ReadinessRules.issue(ready.copy(permission = MISSING)))
        assertEquals(ReadinessIssue.REGISTRATION, ReadinessRules.issue(ready.copy(registration = MISSING)))
        assertEquals(ReadinessIssue.OFFLINE, ReadinessRules.issue(ready.copy(online = MISSING)))
    }

    @Test fun consentComesBeforePermissionBecausePermissionsAreAskedOnlyAfterConsent() {
        val all = Readiness(MISSING, MISSING, MISSING, MISSING)
        assertEquals(ReadinessIssue.CONSENT, ReadinessRules.issue(all))
        assertEquals(ReadinessIssue.PERMISSION, ReadinessRules.issue(all.copy(consent = OK)))
        assertEquals(ReadinessIssue.REGISTRATION, ReadinessRules.issue(all.copy(consent = OK, permission = OK)))
        assertEquals(ReadinessIssue.OFFLINE, ReadinessRules.issue(all.copy(consent = OK, permission = OK, registration = OK)))
    }

    @Test fun permissionIsNotAnIssueUntilConsentIsConfirmed() {
        // At launch permissions are read at once while consent is still loading; asking then would precede consent.
        assertNull(ReadinessRules.issue(ready.copy(consent = UNKNOWN, permission = MISSING)))
        assertNull(ReadinessRules.issue(ready.copy(consent = CHECKING, permission = MISSING)))
        assertEquals(ReadinessIssue.OFFLINE, ReadinessRules.issue(ready.copy(consent = UNKNOWN, permission = MISSING, online = MISSING)))
    }

    @Test fun runnerRequestAsksOnlyMissingRunPermissions() {
        val heart = "android.permission.health.READ_HEART_RATE"
        val activity = "android.permission.ACTIVITY_RECOGNITION"
        assertEquals(listOf(heart, activity), runnerPermissionRequest(36, emptySet()))
        assertEquals(listOf(activity), runnerPermissionRequest(36, setOf(heart)))
        // The daily background permission is never part of the runner's request.
        assertNull(runnerPermissionRequest(36, setOf(heart, activity)))
        assertNull(runnerPermissionRequest(35, setOf("android.permission.BODY_SENSORS", activity)))
    }

    @Test fun runPermissionsLeaveOutTheDailyBackgroundPermission() {
        assertEquals(listOf("android.permission.health.READ_HEART_RATE", "android.permission.ACTIVITY_RECOGNITION"), runPermissions(36))
        assertEquals(listOf("android.permission.BODY_SENSORS", "android.permission.ACTIVITY_RECOGNITION"), runPermissions(35))
    }

    @Test fun permissionStateFollowsTheRunPermissionsOnly() {
        val run = runPermissions(36).toSet()
        assertEquals(OK, permissionState(36, run))
        assertEquals(MISSING, permissionState(36, run - "android.permission.ACTIVITY_RECOGNITION"))
    }

    @Test fun networkStateNeedsAValidatedNetwork() {
        assertEquals(MISSING, networkState(hasNetwork = false, validated = false))
        assertEquals(CHECKING, networkState(hasNetwork = true, validated = false))
        assertEquals(OK, networkState(hasNetwork = true, validated = true))
    }
}
