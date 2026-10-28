package com.runway.watchdemo.settings

import android.content.Context
import com.runway.watchdemo.session.CueSettings

class WatchSettings(context: Context) {
    private val prefs = context.getSharedPreferences("watch_settings", Context.MODE_PRIVATE)
    var participantId: String
        get() = prefs.getString("participant", "")!!
        set(value) { prefs.edit().putString("participant", value.trim()).apply() }
    var endpoint: String
        get() = prefs.getString("endpoint", "")!!
        set(value) { prefs.edit().putString("endpoint", value.trim()).apply() }
    fun cue() = CueSettings(prefs.getInt("bpm", CueSettings().bpm), prefs.getBoolean("sound", true), prefs.getBoolean("vibration", true))
    fun saveCue(cue: CueSettings) { prefs.edit().putInt("bpm", cue.bpm).putBoolean("sound", cue.soundEnabled).putBoolean("vibration", cue.vibrationEnabled).apply() }
}
