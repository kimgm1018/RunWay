package com.runway.watch.dailyhr

private const val HEALTH_BACKGROUND = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
private const val SENSORS_BACKGROUND = "android.permission.BODY_SENSORS_BACKGROUND"

/**
 * The next permission batch to request, or null when everything is granted. Foreground permissions come first;
 * the background permission is requested alone afterwards because the OS only offers it once foreground access exists.
 */
fun nextPermissionRequest(sdk: Int, granted: Set<String>): List<String>? {
    val background = if (sdk >= 36) HEALTH_BACKGROUND else SENSORS_BACKGROUND
    val missing = requiredPermissions(sdk).filter { it !in granted }
    val foreground = missing.filter { it != background }
    return when {
        foreground.isNotEmpty() -> foreground
        missing.isNotEmpty() -> listOf(background)
        else -> null
    }
}
