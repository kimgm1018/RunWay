package com.runway.watch.navigation

import com.runway.watch.run.RunControl
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.*
import org.junit.Test

class WatchNavigatorTest {
    private class RecordingControl(state: RunState) : RunControl {
        val sent = mutableListOf<RunIntent>()
        override val snapshot: StateFlow<RunSnapshot> = MutableStateFlow(RunSnapshot(state = state))
        override fun send(intent: RunIntent) { sent += intent }
    }

    @Test fun movingBetweenScreensNeverStartsOrEndsTheRun() {
        val paused = RecordingControl(RunState.PAUSED)
        val navigator = WatchNavigator(paused)
        navigator.openEndConfirm()
        assertEquals(WatchRoute.END_CONFIRM, navigator.route(paused.snapshot.value))
        navigator.back()
        assertEquals(WatchRoute.PAUSED, navigator.route(paused.snapshot.value))
        assertTrue(paused.sent.isEmpty())

        val running = RecordingControl(RunState.RUNNING)
        val pager = WatchNavigator(running)
        pager.showPage(2)
        pager.back()
        pager.back()
        assertEquals(WatchRoute.RUNNING, pager.route(running.snapshot.value))
        assertTrue(running.sent.isEmpty())
    }

    @Test fun endConfirmCannotOpenOutsidePause() {
        val running = RecordingControl(RunState.RUNNING)
        val navigator = WatchNavigator(running)
        navigator.openEndConfirm()
        assertFalse(navigator.state.value.endConfirmOpen)
    }

    @Test fun onlyExplicitIntentsReachTheRunControl() {
        val control = RecordingControl(RunState.PAUSED)
        val navigator = WatchNavigator(control)
        navigator.openEndConfirm()
        navigator.send(RunIntent.END)
        assertEquals(listOf(RunIntent.END), control.sent)
    }
}
