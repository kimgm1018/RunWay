package com.runway.health.music

import org.json.JSONArray
import org.json.JSONObject

/**
 * 멜론 Android 재생 연동의 판단 규칙(S15P31E105-398, requirements.md MUS-002·004). Android 객체 없이 값만 다루어
 * JVM 단위 테스트로 확인한다. 곡 정보는 화면 표시에만 쓰고 로그에 남기지 않는다.
 */
object MelonPolicy {
  const val PACKAGE = "com.iloen.melon"

  // android.media.session.PlaybackState 값. 플랫폼 상수와 같으며 JVM 테스트에서도 쓰려고 옮겨 둔다.
  const val STATE_PLAYING = 3
  const val STATE_ERROR = 7
  const val ERROR_CODE_AUTHENTICATION_EXPIRED = 3
  const val ACTION_PAUSE = 2L
  const val ACTION_PLAY = 4L
  const val ACTION_SKIP_TO_PREVIOUS = 16L
  const val ACTION_SKIP_TO_NEXT = 32L
  const val ACTION_PLAY_PAUSE = 512L

  val COMMANDS = listOf("play", "pause", "next", "previous")

  fun isMelon(packageName: String?) = packageName == PACKAGE

  // 멜론 MediaBrowser 최상위 메뉴(실기기 확인: 홈·재생목록·음악서랍) 중 기본 재생목록.
  fun isDefaultPlaylist(title: String?) = title?.trim() == "재생목록"

  fun isTop100(title: String?) = title?.replace(" ", "")?.contains("TOP100", ignoreCase = true) == true

  /** 멜론이 지원한다고 알린 동작만 보낸다. 재생·일시정지는 토글 동작으로도 지원될 수 있다. */
  fun supports(actions: Long, command: String): Boolean = when (command) {
    "play" -> actions has ACTION_PLAY || actions has ACTION_PLAY_PAUSE
    "pause" -> actions has ACTION_PAUSE || actions has ACTION_PLAY_PAUSE
    "next" -> actions has ACTION_SKIP_TO_NEXT
    "previous" -> actions has ACTION_SKIP_TO_PREVIOUS
    else -> false
  }

  fun canSend(packageName: String?, actions: Long, command: String) = isMelon(packageName) && supports(actions, command)

  fun commandsOf(actions: Long) = COMMANDS.filter { supports(actions, it) }

  /** 멜론이 인증 만료 오류 상태를 알리면 로그인이 필요한 것으로 본다(실기기 미검증 가정). */
  fun loginRequired(state: Int, errorCode: Int) = state == STATE_ERROR && errorCode == ERROR_CODE_AUTHENTICATION_EXPIRED

  /** 재생 중이면 마지막 위치 보고 이후 흐른 시간을 더하고, 곡 길이를 넘지 않게 자른다. */
  fun positionMs(position: Long, updatedAt: Long, speed: Float, now: Long, playing: Boolean, durationMs: Long): Long {
    val moved = if (playing && updatedAt > 0 && now > updatedAt) ((now - updatedAt) * speed).toLong() else 0L
    val at = (position + moved).coerceAtLeast(0L)
    return if (durationMs > 0) at.coerceAtMost(durationMs) else at
  }

  fun statusJson(installed: Boolean, browsable: Boolean, permitted: Boolean): String = JSONObject()
    .put("installed", installed)
    .put("browsable", browsable)
    .put("permitted", permitted)
    .toString()

  fun playbackJson(snapshot: MelonSnapshot): String {
    val track = snapshot.track?.let {
      JSONObject()
        .put("id", it.id)
        .put("title", it.title)
        .put("artist", it.artist)
        .put("durationMs", it.durationMs)
        .put("positionMs", it.positionMs)
        .put("artworkUri", it.artworkUri ?: JSONObject.NULL)
    }
    return JSONObject()
      .put("connected", snapshot.connected)
      .put("playing", snapshot.playing)
      .put("loginRequired", snapshot.loginRequired)
      .put("commands", JSONArray(snapshot.commands))
      .put("track", track ?: JSONObject.NULL)
      .toString()
  }

  private infix fun Long.has(action: Long) = this and action == action
}

data class MelonTrack(
  val id: String,
  val title: String,
  val artist: String,
  val durationMs: Long,
  val positionMs: Long,
  val artworkUri: String?,
)

data class MelonSnapshot(
  val connected: Boolean,
  val playing: Boolean = false,
  val loginRequired: Boolean = false,
  val commands: List<String> = emptyList(),
  val track: MelonTrack? = null,
)
