package com.runway.watchdemo.cue

import com.runway.watchdemo.session.*

interface CuePlayer {
    fun start(settings: CueSettings, onApplied: (BpmEvent) -> Unit, onError: (String) -> Unit)
    fun update(settings: CueSettings)
    fun stop()
    fun close()
}
