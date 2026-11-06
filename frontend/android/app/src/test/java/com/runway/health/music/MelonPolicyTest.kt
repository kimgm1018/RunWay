package com.runway.health.music

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
}
