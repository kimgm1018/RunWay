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

  // 계정의 곡 목록이 있는 최상위 메뉴(S15P31E105-566 실기기 확인: 좋아요한 곡·최근들은 곡·플레이리스트 폴더).
  fun isDrawer(title: String?) = title?.trim() == "음악서랍"

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

  /**
   * 음악서랍 항목의 종류. 폴더 안 항목은 내 플레이리스트, 바로 아래 항목은 이름으로 좋아요한 곡·최근들은 곡을 가른다.
   * 바로 아래 항목의 아이콘은 표지가 아니라 멜론 메뉴 기호라서 표지로 쓰지 않는다.
   */
  fun kindOf(title: String?, inFolder: Boolean): String {
    val name = title?.replace(" ", "") ?: ""
    return when {
      inFolder -> "PLAYLIST"
      name.contains("좋아요") -> "LIKED"
      name.contains("최근") -> "RECENT"
      else -> "LIST"
    }
  }

  /** 2.7 내 재생 목록 항목. 표지는 웹 이미지 주소만 넘기고, 그 밖에는 2.7 기본 타일로 둔다. */
  fun libraryJson(entries: List<MelonEntry>): String = JSONArray().apply {
    entries.filter { it.id.isNotBlank() && it.title.isNotBlank() }.distinctBy { it.id }.forEach {
      put(
        JSONObject()
          .put("id", it.id)
          .put("title", it.title)
          .put("kind", it.kind)
          .put("artworkUri", webImage(it.artworkUri) ?: JSONObject.NULL)
          .put("trackCount", it.trackCount?.takeIf { count -> count > 0 } ?: JSONObject.NULL),
      )
    }
  }.toString()

  /** 최근 들은 곡 기록에 곡을 맨 앞으로 넣는다. 같은 곡은 한 번만 두고(새 정보로 바꿈) `limit`곡까지 남긴다. */
  fun addHistory(json: String, heard: MelonHeard, limit: Int): String {
    if (heard.id.isBlank() || heard.title.isBlank()) return json
    val kept = historyOf(json).filter { it.id != heard.id }
    return JSONArray().apply {
      (listOf(heard) + kept).take(limit).forEach {
        put(
          JSONObject()
            .put("id", it.id)
            .put("title", it.title)
            .put("artist", it.artist)
            .put("artworkUri", webImage(it.artworkUri) ?: JSONObject.NULL)
            .put("durationMs", it.durationMs),
        )
      }
    }.toString()
  }

  fun historyOf(json: String): List<MelonHeard> = try {
    val array = JSONArray(json)
    (0 until array.length()).mapNotNull { index ->
      val value = array.optJSONObject(index) ?: return@mapNotNull null
      val id = value.optString("id")
      val title = value.optString("title")
      if (id.isBlank() || title.isBlank()) {
        null
      } else {
        MelonHeard(
          id,
          title,
          value.optString("artist"),
          if (value.isNull("artworkUri")) null else value.optString("artworkUri"),
          value.optLong("durationMs"),
        )
      }
    }
  } catch (_: Exception) {
    emptyList()
  }

  fun webImage(uri: String?) = uri?.takeIf { it.startsWith("https://") || it.startsWith("http://") }

  /**
   * 2.7 음악 카드 앨범 아트(S15P31E105-609): 메타데이터의 아트 주소 중 첫 웹 주소(멜론 CDN 고해상도, 약 1000px).
   * 없으면 null이고 호출하는 쪽이 메타데이터 비트맵(약 250px)으로 넘어간다.
   */
  fun webArtwork(vararg uris: String?): String? = uris.firstNotNullOfOrNull { webImage(it?.trim()) }

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

/** 멜론 MediaBrowser가 재생할 수 있다고 알린 목록(좋아요한 곡·최근들은 곡·내 플레이리스트). */
data class MelonEntry(
  val id: String,
  val title: String,
  val artworkUri: String?,
  val kind: String = "PLAYLIST",
  val trackCount: Int? = null,
)

/** 이 기기에서 멜론이 재생한 곡(최근 들은 곡). */
data class MelonHeard(val id: String, val title: String, val artist: String, val artworkUri: String?, val durationMs: Long)

data class MelonSnapshot(
  val connected: Boolean,
  val playing: Boolean = false,
  val loginRequired: Boolean = false,
  val commands: List<String> = emptyList(),
  val track: MelonTrack? = null,
)
