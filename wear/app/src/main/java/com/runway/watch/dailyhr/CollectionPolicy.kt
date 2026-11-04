package com.runway.watch.dailyhr

private const val MIN_BATTERY_PCT = 10

/** Why daily heart-rate collection is, or is not, running. */
enum class CollectionState { OFF_NO_CONSENT, NEEDS_PERMISSION, UNSUPPORTED, PAUSED_LOW_BATTERY, COLLECTING }

/** Checks in priority order: consent, permission, device support, then battery (charging overrides the level). */
fun decide(consented: Boolean, permitted: Boolean, hrSupported: Boolean, batteryPct: Int, charging: Boolean): CollectionState =
    when {
        !consented -> CollectionState.OFF_NO_CONSENT
        !permitted -> CollectionState.NEEDS_PERMISSION
        !hrSupported -> CollectionState.UNSUPPORTED
        batteryPct < MIN_BATTERY_PCT && !charging -> CollectionState.PAUSED_LOW_BATTERY
        else -> CollectionState.COLLECTING
    }

/**
 * Battery level from BATTERY_PROPERTY_CAPACITY, falling back to the sticky ACTION_BATTERY_CHANGED level/scale.
 * An unknown level counts as full so an unsupported property cannot pause collection forever.
 */
fun batteryPct(capacity: Int, level: Int, scale: Int): Int = when {
    capacity in 1..100 -> capacity
    level >= 0 && scale > 0 -> level * 100 / scale
    else -> 100
}

/** The state in effect after a reconcile; [failed] means applying it did not complete and should be retried. */
data class ReconcileResult(val state: CollectionState, val failed: Boolean)

/** Data may be stored only under explicit agreement; missing consent counts as withdrawn. */
fun canStore(consent: HealthConsent?): Boolean = consent?.agreed == true

/** Runtime permissions passive HR collection needs on a device running [sdk]. */
fun requiredPermissions(sdk: Int): List<String> = if (sdk >= 36) {
    listOf(
        "android.permission.health.READ_HEART_RATE",
        "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
        "android.permission.ACTIVITY_RECOGNITION",
    )
} else {
    listOf(
        "android.permission.BODY_SENSORS",
        "android.permission.BODY_SENSORS_BACKGROUND",
        "android.permission.ACTIVITY_RECOGNITION",
    )
}
