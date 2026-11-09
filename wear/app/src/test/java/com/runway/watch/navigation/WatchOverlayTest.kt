package com.runway.watch.navigation

import com.runway.watch.run.ControlProblem
import com.runway.watch.run.ControlProblemKind
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.GroupStatus
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import org.junit.Assert.*
import org.junit.Test

/** S15P31E105-613: full-screen states, run details and the cancel sheet of the confirmed watch design. */
class WatchOverlayTest {
    private fun unknown(intent: RunIntent) = ControlProblem(ControlProblemKind.UNCONFIRMED, intent)

    @Test fun anUnknownRequestResultCoversTheScreenUntilAcknowledged() {
        val running = RunSnapshot(RunState.RUNNING, problem = unknown(RunIntent.PAUSE))
        assertEquals(Overlay.CONTROL_UNKNOWN, WatchNavigation.overlay(running, NavState()))
        val acknowledged = WatchNavigation.reconcile(running, NavState(dismissedProblem = running.problem))
        assertNull(WatchNavigation.overlay(running, acknowledged))
        // A start that is not confirmed shows from standby too (9.1e).
        assertEquals(Overlay.CONTROL_UNKNOWN, WatchNavigation.overlay(RunSnapshot(RunState.READY, problem = unknown(RunIntent.START)), NavState()))
    }

    @Test fun anAcknowledgementIsForgottenOnceTheProblemChanges() {
        val nav = NavState(dismissedProblem = unknown(RunIntent.PAUSE))
        assertNull(WatchNavigation.reconcile(RunSnapshot(RunState.RUNNING), nav).dismissedProblem)
        val other = RunSnapshot(RunState.PAUSED, problem = unknown(RunIntent.RESUME))
        assertEquals(Overlay.CONTROL_UNKNOWN, WatchNavigation.overlay(other, WatchNavigation.reconcile(other, nav)))
    }

    @Test fun refusalsAndCoachingProblemsNeverTakeOverTheScreen() {
        val refused = RunSnapshot(RunState.RUNNING, problem = ControlProblem(ControlProblemKind.REJECTED, RunIntent.PAUSE))
        assertNull(WatchNavigation.overlay(refused, NavState()))
        val bpm = RunSnapshot(RunState.RUNNING, problem = ControlProblem(ControlProblemKind.UNCONFIRMED, null))
        assertNull(WatchNavigation.overlay(bpm, NavState()))
        assertNull(WatchNavigation.overlay(RunSnapshot(RunState.RUNNING, phoneConnected = false, serverLinkLost = true), NavState()))
    }

    @Test fun handOverAndGroupEndAreFullScreen() {
        assertEquals(Overlay.PHONE_RECORDING, WatchNavigation.overlay(RunSnapshot(RunState.RUNNING, phoneRecording = true), NavState()))
        assertEquals(Overlay.PHONE_RECORDING, WatchNavigation.overlay(RunSnapshot(RunState.PAUSED, measurementLost = true), NavState()))
        val ended = RunSnapshot(RunState.RUNNING, RunMode.GROUP, group = GroupStatus(GroupPhase.FORCE_FINISHED))
        assertEquals(Overlay.GROUP_ENDED, WatchNavigation.overlay(ended, NavState()))
        assertNull(WatchNavigation.overlay(ended.copy(state = RunState.COMPLETED), NavState()))
    }

    @Test fun detailsLiveOnlyWhileRunningAndBackClosesThemFirst() {
        val running = RunSnapshot(RunState.RUNNING)
        val nav = NavState(page = 1, detail = RunDetail.PACE)
        assertEquals(RunDetail.PACE, WatchNavigation.reconcile(running, nav).detail)
        assertEquals(BackResult(NavState(page = 0), handled = true).handled, WatchNavigation.back(running, nav).handled)
        assertEquals(NavState(page = 1), WatchNavigation.back(running, nav).nav)
        assertNull(WatchNavigation.reconcile(RunSnapshot(RunState.PAUSED), nav).detail)
        assertNull(WatchNavigation.reconcile(running.copy(pendingCommand = true), nav).detail)
        // A group run has no rhythm screen.
        assertNull(WatchNavigation.reconcile(RunSnapshot(RunState.RUNNING, RunMode.GROUP), NavState(detail = RunDetail.RHYTHM)).detail)
    }

    @Test fun theCancelSheetIsOnlyForAPreparedPersonalRun() {
        val ready = RunSnapshot(RunState.READY)
        assertTrue(WatchNavigation.reconcile(ready, NavState(cancelOpen = true)).cancelOpen)
        assertFalse(WatchNavigation.reconcile(ready.copy(mode = RunMode.GROUP), NavState(cancelOpen = true)).cancelOpen)
        assertFalse(WatchNavigation.reconcile(RunSnapshot(RunState.CANCELLED), NavState(cancelOpen = true)).cancelOpen)
        val back = WatchNavigation.back(ready, NavState(cancelOpen = true))
        assertTrue(back.handled)
        assertFalse(back.nav.cancelOpen)
    }
}
