package com.runway.health.music

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 멜론 재생 연동 판단 규칙(S15P31E105-398, MUS-002·004). 곡 정보는 합성 값만 쓴다. */
class MelonPolicyTest {
  private val all = MelonPolicy.ACTION_PLAY or MelonPolicy.ACTION_PAUSE or
    MelonPolicy.ACTION_SKIP_TO_NEXT or MelonPolicy.ACTION_SKIP_TO_PREVIOUS

  @Test
  fun `sends only to Melon and only what Melon supports`() {
    assertTrue(MelonPolicy.canSend("com.iloen.melon", all, "next"))
    assertFalse(MelonPolicy.canSend("com.spotify.music", all, "next"))
    assertFalse(MelonPolicy.canSend(null, all, "play"))
    assertFalse(MelonPolicy.canSend("com.iloen.melon", MelonPolicy.ACTION_PLAY, "next"))
    assertFalse(MelonPolicy.canSend("com.iloen.melon", all, "shuffle"))
    assertFalse(MelonPolicy.canSend("com.iloen.melon", 0L, "play"))
  }

  @Test
  fun `a play-pause toggle covers play and pause but not skipping`() {
    assertEquals(listOf("play", "pause"), MelonPolicy.commandsOf(MelonPolicy.ACTION_PLAY_PAUSE))
    assertEquals(listOf("play", "pause", "next", "previous"), MelonPolicy.commandsOf(all))
  }

  @Test
  fun `only an authentication error asks for a login`() {
    assertTrue(MelonPolicy.loginRequired(MelonPolicy.STATE_ERROR, MelonPolicy.ERROR_CODE_AUTHENTICATION_EXPIRED))
    assertFalse(MelonPolicy.loginRequired(MelonPolicy.STATE_ERROR, 0))
    assertFalse(MelonPolicy.loginRequired(MelonPolicy.STATE_PLAYING, MelonPolicy.ERROR_CODE_AUTHENTICATION_EXPIRED))
  }

  @Test
  fun `position moves on while playing and stays within the song`() {
    assertEquals(13_000L, MelonPolicy.positionMs(10_000, 1_000, 1f, 4_000, true, 200_000))
    assertEquals(10_000L, MelonPolicy.positionMs(10_000, 1_000, 1f, 4_000, false, 200_000))
    assertEquals(200_000L, MelonPolicy.positionMs(199_000, 1_000, 1f, 9_000, true, 200_000))
    assertEquals(0L, MelonPolicy.positionMs(-1, 0, 1f, 9_000, true, 0))
  }

  @Test
  fun `playback json carries the track or null`() {
    val track = MelonTrack("m1", "Synthetic Song", "Synthetic Artist", 200_000, 12_000, null)
    val json = JSONObject(MelonPolicy.playbackJson(MelonSnapshot(true, true, false, listOf("pause"), track)))
    assertTrue(json.getBoolean("connected"))
    assertTrue(json.getBoolean("playing"))
    assertEquals("Synthetic Song", json.getJSONObject("track").getString("title"))
    assertTrue(json.getJSONObject("track").isNull("artworkUri"))
    assertEquals("pause", json.getJSONArray("commands").getString(0))

    val empty = JSONObject(MelonPolicy.playbackJson(MelonSnapshot(false)))
    assertFalse(empty.getBoolean("connected"))
    assertTrue(empty.isNull("track"))
  }

  @Test
  fun `finds the default playlist and TOP100 menus by name`() {
    assertTrue(MelonPolicy.isDefaultPlaylist("재생목록"))
    assertTrue(MelonPolicy.isDefaultPlaylist(" 재생목록 "))
    assertFalse(MelonPolicy.isDefaultPlaylist("내 재생목록 보관함"))
    assertFalse(MelonPolicy.isDefaultPlaylist(null))
    assertTrue(MelonPolicy.isTop100("멜론 TOP100"))
    assertTrue(MelonPolicy.isTop100("Top 100"))
    assertFalse(MelonPolicy.isTop100("TOP10"))
    assertFalse(MelonPolicy.isTop100(null))
  }

  @Test
  fun `status json reports each check separately`() {
    val json = JSONObject(MelonPolicy.statusJson(installed = true, browsable = false, permitted = true))
    assertTrue(json.getBoolean("installed"))
    assertFalse(json.getBoolean("browsable"))
    assertTrue(json.getBoolean("permitted"))
  }

  @Test
  fun `finds the music drawer menu by its name`() {
    assertTrue(MelonPolicy.isDrawer(" 음악서랍 "))
    assertFalse(MelonPolicy.isDrawer("재생목록"))
    assertFalse(MelonPolicy.isDrawer(null))
  }

  @Test
  fun `library keeps Melon's order, drops blanks and repeats, and passes only web covers`() {
    val json = JSONArray(
      MelonPolicy.libraryJson(
        listOf(
          MelonEntry("like", "좋아요한 곡", "https://example.com/like.png", "LIKED"),
          MelonEntry("recent", "최근들은 곡", null, "RECENT"),
          MelonEntry("like", "좋아요한 곡", null, "LIKED"),
          MelonEntry("", "빈 ID", null),
          MelonEntry("blank", " ", null),
          MelonEntry("list", "플리", "content://melon/cover"),
          MelonEntry("list-2", "플리 2", "https://example.com/cover.jpg"),
        ),
      ),
    )
    assertEquals(4, json.length())
    assertEquals("like", json.getJSONObject(0).getString("id"))
    assertEquals("LIKED", json.getJSONObject(0).getString("kind"))
    assertEquals("https://example.com/like.png", json.getJSONObject(0).getString("artworkUri"))
    assertTrue(json.getJSONObject(1).isNull("artworkUri"))
    assertTrue(json.getJSONObject(2).isNull("artworkUri"))
    assertEquals("https://example.com/cover.jpg", json.getJSONObject(3).getString("artworkUri"))
  }

  @Test
  fun `tells liked, recent and own playlists apart`() {
    assertEquals("LIKED", MelonPolicy.kindOf("좋아요한 곡", false))
    assertEquals("RECENT", MelonPolicy.kindOf("최근들은 곡", false))
    assertEquals("LIST", MelonPolicy.kindOf("기타", false))
    assertEquals("PLAYLIST", MelonPolicy.kindOf("최근 플리", true))
  }

  @Test
  fun `a known track count goes with the list`() {
    val json = JSONArray(
      MelonPolicy.libraryJson(listOf(MelonEntry("a", "A", null, "LIKED", 34), MelonEntry("b", "B", null, "LIKED", 0))),
    )
    assertEquals(34, json.getJSONObject(0).getInt("trackCount"))
    assertTrue(json.getJSONObject(1).isNull("trackCount"))
  }

  @Test
  fun `the card art takes the first web address and leaves the rest to the bitmap`() {
    // S15P31E105-609: 멜론 CDN 고해상도 주소가 있으면 쓰고, 없으면 null(비트맵·기본 커버로 넘어감).
    assertEquals(
      "https://cdnimg.melon.co.kr/cm/album/images/1000.jpg",
      MelonPolicy.webArtwork(null, " https://cdnimg.melon.co.kr/cm/album/images/1000.jpg ", "https://other/icon.png"),
    )
    assertEquals("http://cdn/a.jpg", MelonPolicy.webArtwork("content://melon/art/1", "http://cdn/a.jpg"))
    assertEquals(null, MelonPolicy.webArtwork("content://melon/art/1", "file:///x.jpg", "", null))
    assertEquals(null, MelonPolicy.webArtwork())
  }

  @Test
  fun `history puts the newest song first, once, up to the limit`() {
    var json = "[]"
    listOf("a", "b", "c", "a").forEach {
      json = MelonPolicy.addHistory(json, MelonHeard(it, "Song $it", "Artist", "content://x", 1000L), 3)
    }
    val songs = MelonPolicy.historyOf(json)
    assertEquals(listOf("a", "c", "b"), songs.map { it.id })
    assertEquals(null, songs.first().artworkUri)
    json = MelonPolicy.addHistory(json, MelonHeard("d", "Song d", "", null, 0L), 3)
    assertEquals(listOf("d", "a", "c"), MelonPolicy.historyOf(json).map { it.id })
    assertEquals(json, MelonPolicy.addHistory(json, MelonHeard("", "blank", "", null, 0L), 3))
    assertEquals(emptyList<MelonHeard>(), MelonPolicy.historyOf("broken"))
  }
}
