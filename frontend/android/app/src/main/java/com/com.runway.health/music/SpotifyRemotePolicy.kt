package com.runway.health.music

internal object SpotifyRemotePolicy {
  fun connectionTimeout(interactive: Boolean): Long = if (interactive) 120_000L else 20_000L

  fun bindFlags(sdk: Int, interactive: Boolean, packageName: String?, flags: Int): Int =
    if (sdk >= 34 && interactive && packageName == "com.spotify.music")
      flags or android.content.Context.BIND_ALLOW_ACTIVITY_STARTS
    else flags

  private val playable = Regex("^spotify:(playlist|track):[A-Za-z0-9]+$")

  // 2.7 내 재생 목록 · 최근 들은 곡 play a playlist or a song, nothing else.
  fun playableUri(uri: String): Boolean = playable.matches(uri)

  fun failure(type: String, message: String): String = when {
    message.contains("user is not registered for this application", ignoreCase = true) -> "USER_NOT_REGISTERED"
    message.contains("premium required", ignoreCase = true) -> "PREMIUM_REQUIRED"
    type.contains("NotAuthorized") || type.contains("Authentication") -> "AUTH_REQUIRED"
    else -> "FAILED"
  }
}
