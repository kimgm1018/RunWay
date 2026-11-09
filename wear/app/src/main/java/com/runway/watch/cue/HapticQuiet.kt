package com.runway.watch.cue

/**
 * Keeps the rhythm beat's buzz off the vibrator while a one-off alert plays (S15P31E105-604). Both share the one
 * vibrator, and a new buzz cuts the one playing, so a beat right after the group pace alert would end it at once.
 * Only the beat's buzz waits; its click goes on.
 */
class HapticQuiet(private val nowMs: () -> Long) {
    @Volatile private var quietUntilMs = Long.MIN_VALUE

    /** Holds the beat's buzz for [durationMs] from now. */
    fun hold(durationMs: Long) {
        quietUntilMs = nowMs() + durationMs
    }

    /** True while an alert holds the vibrator. */
    fun active(): Boolean = nowMs() < quietUntilMs
}
