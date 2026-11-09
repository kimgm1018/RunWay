package com.runway.health.music

import android.content.Context
import android.media.MediaMetadata

/**
 * 2.7 최근 들은 곡(S15P31E105-566). 멜론 MediaBrowser는 곡별 재생 기록을 주지 않아(실기기 확인), 이 기기에서 멜론이
 * 알린 재생 곡을 최신순으로 이 앱 저장소에만 남긴다. 로그·서버로 보내지 않는다.
 */
object MelonHistory {
  private const val PREFS = "melon-history"
  private const val KEY = "tracks"
  private const val LIMIT = 20

  fun record(context: Context, metadata: MediaMetadata?) {
    metadata ?: return
    val title = metadata.getText(MediaMetadata.METADATA_KEY_TITLE)?.toString()
    if (title.isNullOrBlank()) return
    val artist = (metadata.getText(MediaMetadata.METADATA_KEY_ARTIST)
      ?: metadata.getText(MediaMetadata.METADATA_KEY_ALBUM_ARTIST))?.toString() ?: ""
    val id = metadata.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)?.takeIf { it.isNotBlank() } ?: "$title\u0000$artist"
    val art = MelonPolicy.webImage(metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI))
      ?: MelonPolicy.webImage(metadata.description?.iconUri?.toString())
    val heard = MelonHeard(id, title, artist, art, metadata.getLong(MediaMetadata.METADATA_KEY_DURATION).coerceAtLeast(0L))
    val prefs = prefs(context)
    val current = prefs.getString(KEY, "[]") ?: "[]"
    val next = MelonPolicy.addHistory(current, heard, LIMIT)
    if (next != current) prefs.edit().putString(KEY, next).apply()
  }

  fun read(context: Context): String = prefs(context).getString(KEY, "[]") ?: "[]"

  fun find(context: Context, id: String): MelonHeard? = MelonPolicy.historyOf(read(context)).firstOrNull { it.id == id }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
