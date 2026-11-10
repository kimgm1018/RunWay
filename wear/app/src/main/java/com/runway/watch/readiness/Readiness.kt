package com.runway.watch.readiness

import com.runway.watch.dailyhr.requiredPermissions

/**
 * One prerequisite as far as the watch knows it. [UNKNOWN] means nothing reported it yet and is
 * never shown as satisfied; [CHECKING] means a source exists but has not settled.
 */
enum class CheckState { UNKNOWN, CHECKING, OK, MISSING }

/**
 * Online-MVP prerequisites besides the phone link (WAT-001, SYS-001·003). The phone link stays in
 * [com.runway.watch.run.RunSnapshot.phoneConnected]; OS pairing, server device registration and
 * health consent are separate steps and are never folded into each other.
 */
data class Readiness(
    /** Health data consent the phone shared with the watch (W05). */
    val consent: CheckState = CheckState.UNKNOWN,
    /** Runtime permissions the watch needs to measure during a run. */
    val permission: CheckState = CheckState.UNKNOWN,
    /** Server device registration (W01). No delivery path to the watch is agreed yet. */
    val registration: CheckState = CheckState.UNKNOWN,
    /** Internet as the watch sees it. The server round trip itself is checked by the phone at prepare. */
    val online: CheckState = CheckState.UNKNOWN,
)

/** The single thing a runner must fix before a run, in the order they can fix it. */
enum class ReadinessIssue { CONSENT, PERMISSION, REGISTRATION, OFFLINE }

object ReadinessRules {
    /**
     * Only a reported [CheckState.MISSING] blocks. Consent comes first because the watch asks for
     * permissions only after consent, so a missing permission counts only once consent is confirmed;
     * registration and internet are fixed on the phone afterwards.
     */
    fun issue(r: Readiness): ReadinessIssue? = when {
        r.consent == CheckState.MISSING -> ReadinessIssue.CONSENT
        r.consent == CheckState.OK && r.permission == CheckState.MISSING -> ReadinessIssue.PERMISSION
        r.registration == CheckState.MISSING -> ReadinessIssue.REGISTRATION
        r.online == CheckState.MISSING -> ReadinessIssue.OFFLINE
        else -> null
    }
}

/**
 * Permissions the watch needs to measure heart rate and steps during a run. The background
 * permission only serves daily heart rate, so a run is not blocked by it.
 */
fun runPermissions(sdk: Int): List<String> = requiredPermissions(sdk).filterNot { it.endsWith("_BACKGROUND") }

/**
 * What "권한 허용" asks for: only the missing run permissions, never the daily background one, which
 * the launch sequence asks for separately. Null when nothing for a run is missing.
 */
fun runnerPermissionRequest(sdk: Int, granted: Set<String>): List<String>? =
    runPermissions(sdk).filter { it !in granted }.ifEmpty { null }

fun permissionState(sdk: Int, granted: Set<String>): CheckState =
    if (runPermissions(sdk).all { it in granted }) CheckState.OK else CheckState.MISSING

/** A network that the OS has not validated may still be captive or unreachable, so it is only "checking". */
fun networkState(hasNetwork: Boolean, validated: Boolean): CheckState = when {
    !hasNetwork -> CheckState.MISSING
    validated -> CheckState.OK
    else -> CheckState.CHECKING
}

/** Watch GPS for the run route (S15P31E105-549). Fine location needs coarse in the same request (Android 12+). */
val LOCATION_PERMISSIONS = listOf("android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION")

/**
 * The location permissions to ask for, or null when fine location is granted. Optional: a run without it starts
 * without GPS and leaves its route unknown, so it never counts in [permissionState].
 */
fun locationPermissionRequest(granted: Set<String>): List<String>? =
    if (LOCATION_PERMISSIONS[0] in granted) null else LOCATION_PERMISSIONS.filter { it !in granted }

/** Background location ("항상 허용", S15P31E105-549): lets a run started from the phone with the watch screen off use GPS. */
const val BACKGROUND_LOCATION = "android.permission.ACCESS_BACKGROUND_LOCATION"

/**
 * Background location to ask for, alone and only after fine location (Android 11+ asks it on its own screen). Null
 * once granted or while fine location is missing. Optional: without it watch GPS runs only when started on screen.
 */
fun backgroundLocationRequest(granted: Set<String>): List<String>? =
    if (LOCATION_PERMISSIONS[0] !in granted || BACKGROUND_LOCATION in granted) null else listOf(BACKGROUND_LOCATION)
