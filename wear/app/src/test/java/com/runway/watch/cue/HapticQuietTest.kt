package com.runway.watch.cue

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** S15P31E105-604: the rhythm beat leaves the vibrator to the group pace alert while it plays. */
class HapticQuietTest {
    private var now = 1_000L
    private val quiet = HapticQuiet { now }

    @Test
    fun `nothing holds the vibrator until an alert asks`() {
        assertFalse(quiet.active())
    }

    @Test
    fun `an alert holds the vibrator for its time only`() {
        quiet.hold(600)
        assertTrue(quiet.active())
        now += 599
        assertTrue(quiet.active())
        now += 1
        assertFalse(quiet.active())
    }
}
