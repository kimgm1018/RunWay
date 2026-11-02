package com.runway.watch.navigation

import com.runway.watch.readiness.CheckState
import com.runway.watch.readiness.Readiness
import com.runway.watch.run.RecordComparison
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import org.junit.Assert.*
import org.junit.Test

class WatchNavigationTest {
    private val compared = RecordComparison.Result(2384.0, 852_000, 873_000, targetLabel = "10.13")

    private fun snapshot(state: RunState?, phone: Boolean = true, mode: RunMode = RunMode.PERSONAL) =
        RunSnapshot(state = state, mode = mode, phoneConnected = phone, comparison = compared)

    @Test fun confirmedStateDecidesTheScreen() {
        val nav = NavState()
        assertEquals(WatchRoute.STANDBY, WatchNavigation.route(snapshot(null), nav))
        assertEquals(WatchRoute.STANDBY, WatchNavigation.route(snapshot(RunState.READY), nav))
        assertEquals(WatchRoute.RUNNING, WatchNavigation.route(snapshot(RunState.RUNNING), nav))
        assertEquals(WatchRoute.PAUSED, WatchNavigation.route(snapshot(RunState.PAUSED), nav))
        assertEquals(WatchRoute.RESULT, WatchNavigation.route(snapshot(RunState.COMPLETED), nav))
        assertEquals(WatchRoute.RESULT, WatchNavigation.route(snapshot(RunState.INTERRUPTED), nav))
        assertEquals(WatchRoute.STANDBY, WatchNavigation.route(snapshot(RunState.CANCELLED), nav))
    }

    @Test fun pendingStartDoesNotLeaveStandby() {
        val pending = snapshot(RunState.READY).copy(pendingCommand = true)
        assertEquals(WatchRoute.STANDBY, WatchNavigation.route(pending, NavState()))
    }

    @Test fun phoneDisconnectOnlyReplacesScreensBeforeTheRun() {
        assertEquals(WatchRoute.CONNECTION_ISSUE, WatchNavigation.route(snapshot(RunState.READY, phone = false), NavState()))
        assertEquals(WatchRoute.CONNECTION_ISSUE, WatchNavigation.route(snapshot(null, phone = false), NavState()))
        assertEquals(WatchRoute.RUNNING, WatchNavigation.route(snapshot(RunState.RUNNING, phone = false), NavState()))
        assertEquals(WatchRoute.PAUSED, WatchNavigation.route(snapshot(RunState.PAUSED, phone = false), NavState()))
    }

    @Test fun missingReadinessReplacesOnlyTheScreensBeforeTheRun() {
        val offline = Readiness(online = CheckState.MISSING)
        assertEquals(WatchRoute.NOT_READY, WatchNavigation.route(snapshot(null), NavState(), offline))
        assertEquals(WatchRoute.NOT_READY, WatchNavigation.route(snapshot(RunState.READY), NavState(), offline))
        assertEquals(WatchRoute.RUNNING, WatchNavigation.route(snapshot(RunState.RUNNING), NavState(), offline))
        assertEquals(WatchRoute.RESULT, WatchNavigation.route(snapshot(RunState.COMPLETED), NavState(), offline))
        assertEquals(WatchRoute.STANDBY, WatchNavigation.route(snapshot(RunState.READY), NavState(), Readiness(online = CheckState.CHECKING)))
        assertTrue(WatchNavigation.canExit(WatchRoute.NOT_READY))
    }

    @Test fun registrationIsNeverShownAsAPhoneConnection() {
        // A registered watch without a phone link still gets the connection screen, not standby.
        val registered = Readiness(registration = CheckState.OK)
        assertEquals(WatchRoute.CONNECTION_ISSUE, WatchNavigation.route(snapshot(RunState.READY, phone = false), NavState(), registered))
        // The phone link is checked first because consent and registration are fixed on the phone.
        val unregistered = Readiness(registration = CheckState.MISSING)
        assertEquals(WatchRoute.CONNECTION_ISSUE, WatchNavigation.route(snapshot(RunState.READY, phone = false), NavState(), unregistered))
    }

    @Test fun endConfirmIsOnlyReachableWhilePaused() {
        val open = NavState(endConfirmOpen = true)
        assertEquals(WatchRoute.END_CONFIRM, WatchNavigation.route(snapshot(RunState.PAUSED), open))
        assertEquals(WatchRoute.RUNNING, WatchNavigation.route(snapshot(RunState.RUNNING), open))
        assertEquals(NavState(), WatchNavigation.reconcile(snapshot(RunState.RUNNING), open))
    }

    @Test fun leavingRunningResetsThePager() {
        val paged = NavState(page = 2)
        assertEquals(2, WatchNavigation.reconcile(snapshot(RunState.RUNNING), paged).page)
        assertEquals(0, WatchNavigation.reconcile(snapshot(RunState.PAUSED), paged).page)
    }

    @Test fun pagesDifferOnlyByModeAfterTheStatusPage() {
        assertEquals(listOf(RunPage.STATUS, RunPage.PACE_COACHING, RunPage.RECORD_COMPARE), WatchNavigation.pages(snapshot(RunState.RUNNING)))
        assertEquals(listOf(RunPage.STATUS, RunPage.GROUP_PACE, RunPage.GROUP_POSITION),
            WatchNavigation.pages(snapshot(RunState.RUNNING, mode = RunMode.GROUP)))
    }

    @Test fun runWithoutAComparisonHasNoComparisonPage() {
        val personal = listOf(RunPage.STATUS, RunPage.PACE_COACHING)
        for (c in listOf(RecordComparison.NotSelected, compared.copy(targetLabel = null), compared.copy(targetLabel = " "))) {
            assertEquals(personal, WatchNavigation.pages(snapshot(RunState.RUNNING).copy(comparison = c)))
        }
        // A chosen comparison keeps its page even when it has no result or stops.
        for (c in listOf(RecordComparison.NoRecord, RecordComparison.Waiting, RecordComparison.Unavailable)) {
            assertEquals(3, WatchNavigation.pages(snapshot(RunState.RUNNING).copy(comparison = c)).size)
        }
    }

    @Test fun droppingTheComparisonMovesOffTheRemovedPage() {
        val dropped = snapshot(RunState.RUNNING).copy(comparison = RecordComparison.NotSelected)
        assertEquals(1, WatchNavigation.reconcile(dropped, NavState(page = 2)).page)
    }

    @Test fun backNeverLeavesAnActiveRun() {
        val running = snapshot(RunState.RUNNING)
        assertEquals(BackResult(NavState(page = 0), handled = true), WatchNavigation.back(running, NavState(page = 2)))
        assertEquals(BackResult(NavState(), handled = true), WatchNavigation.back(running, NavState()))
        assertEquals(BackResult(NavState(), handled = true), WatchNavigation.back(snapshot(RunState.PAUSED), NavState()))
    }

    @Test fun backFromEndConfirmReturnsToPauseWithoutEnding() {
        val result = WatchNavigation.back(snapshot(RunState.PAUSED), NavState(endConfirmOpen = true))
        assertEquals(BackResult(NavState(), handled = true), result)
    }

    @Test fun backOutsideARunLetsTheSystemCloseTheApp() {
        assertFalse(WatchNavigation.back(snapshot(RunState.READY), NavState()).handled)
        assertFalse(WatchNavigation.back(snapshot(null, phone = false), NavState()).handled)
        assertFalse(WatchNavigation.back(snapshot(RunState.COMPLETED), NavState()).handled)
    }

    @Test fun swipeToCloseOnlyOutsideARun() {
        val exits = WatchRoute.entries.filter(WatchNavigation::canExit)
        assertEquals(listOf(WatchRoute.STANDBY, WatchRoute.CONNECTION_ISSUE, WatchRoute.NOT_READY, WatchRoute.RESULT), exits)
    }
}
