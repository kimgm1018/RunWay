package com.runway.health.music

internal object SpotifyRemotePolicy {
  fun connectionTimeout(interactive: Boolean): Long = if (interactive) 120_000L else 20_000L

  fun bindFlags(sdk: Int, interactive: Boolean, packageName: String?, flags: Int): Int =
    if (sdk >= 34 && interactive && packageName == "com.spotify.music")
      flags or android.content.Context.BIND_ALLOW_ACTIVITY_STARTS
    else flags

  fun failure(type: String, message: String): String = when {
    message.contains("user is not registered for this application", ignoreCase = true) -> "USER_NOT_REGISTERED"
    message.contains("premium required", ignoreCase = true) -> "PREMIUM_REQUIRED"
    type.contains("NotAuthorized") || type.contains("Authentication") -> "AUTH_REQUIRED"
    else -> "FAILED"
  }
}
