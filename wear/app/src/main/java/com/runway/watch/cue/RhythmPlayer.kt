package com.runway.watch.cue

/**
 * Rhythm (step) cue output: a click sound and a short vibration on every beat (D-4, ported from the demo's CuePlayer).
 * The session controller calls it only for server-approved BPM in a RUNNING run (pace-coaching.md BPM 처리).
 */
interface RhythmPlayer {
    /** Plays [bpm]. Playing the same BPM again keeps the current beat instead of restarting it. */
    fun play(bpm: Int)

    /** Stops the beat (pause, end, or the run is no longer running). Safe to call when already stopped. */
    fun stop()
}

/** No output: tests, and builds where the run has no rhythm cue. */
object SilentRhythm : RhythmPlayer {
    override fun play(bpm: Int) = Unit
    override fun stop() = Unit
}
