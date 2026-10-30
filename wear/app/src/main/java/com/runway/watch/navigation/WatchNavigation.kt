package com.runway.watch.navigation

import com.runway.watch.run.RunControl
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.run.compared
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Watch screens 9.1 ~ 9.4 of the v15 wireframe. */
enum class WatchRoute { STANDBY, CONNECTION_ISSUE, RUNNING, PAUSED, END_CONFIRM, RESULT }

/** Swipe pages while running (9.2 / 9.5 · 9.6 / 9.7 · 9.8). */
enum class RunPage { STATUS, PACE_COACHING, RECORD_COMPARE, GROUP_PACE, GROUP_POSITION }

/** Screen-local choices that the run state does not carry. */
data class NavState(val endConfirmOpen: Boolean = false, val page: Int = 0)

data class BackResult(val nav: NavState, val handled: Boolean)

/**
 * Pure routing rules. The screen is derived from the confirmed run state, so moving between
 * screens can never start, pause or end a run by itself.
 */
object WatchNavigation {
    /** A personal run without a comparison has no comparison page at all. */
    fun pages(snapshot: RunSnapshot): List<RunPage> = when (snapshot.mode) {
        RunMode.PERSONAL -> listOfNotNull(RunPage.STATUS, RunPage.PACE_COACHING,
            RunPage.RECORD_COMPARE.takeIf { snapshot.comparison.compared })
        RunMode.GROUP -> listOf(RunPage.STATUS, RunPage.GROUP_PACE, RunPage.GROUP_POSITION)
    }

    fun route(snapshot: RunSnapshot, nav: NavState): WatchRoute = when (snapshot.state) {
        null, RunState.READY, RunState.CANCELLED ->
            if (snapshot.phoneConnected) WatchRoute.STANDBY else WatchRoute.CONNECTION_ISSUE
        RunState.RUNNING -> WatchRoute.RUNNING
        RunState.PAUSED -> if (nav.endConfirmOpen) WatchRoute.END_CONFIRM else WatchRoute.PAUSED
        RunState.COMPLETED, RunState.INTERRUPTED -> WatchRoute.RESULT
    }

    /** Drops screen-local choices that no longer fit the current state. */
    fun reconcile(snapshot: RunSnapshot, nav: NavState): NavState = NavState(
        endConfirmOpen = nav.endConfirmOpen && snapshot.state == RunState.PAUSED,
        page = if (snapshot.state == RunState.RUNNING) nav.page.coerceIn(0, pages(snapshot).lastIndex) else 0,
    )

    /** Back or a swipe to the right may close the app only outside a run (standby, connection issue, result). */
    fun canExit(route: WatchRoute): Boolean =
        route == WatchRoute.STANDBY || route == WatchRoute.CONNECTION_ISSUE || route == WatchRoute.RESULT

    /** The bottom button is back. During a run it never closes the app or ends the run. */
    fun back(snapshot: RunSnapshot, nav: NavState): BackResult {
        val current = reconcile(snapshot, nav)
        val route = route(snapshot, current)
        return when {
            canExit(route) -> BackResult(current, handled = false)
            route == WatchRoute.END_CONFIRM -> BackResult(current.copy(endConfirmOpen = false), handled = true)
            route == WatchRoute.RUNNING -> BackResult(current.copy(page = 0), handled = true)
            else -> BackResult(current, handled = true)
        }
    }
}

/** Holds screen-local navigation and forwards explicit intents to the run controller. */
class WatchNavigator(private val control: RunControl) {
    private val nav = MutableStateFlow(NavState())
    val state: StateFlow<NavState> = nav

    fun route(snapshot: RunSnapshot): WatchRoute = WatchNavigation.route(snapshot, current(snapshot))

    fun current(snapshot: RunSnapshot): NavState = WatchNavigation.reconcile(snapshot, nav.value)

    fun openEndConfirm() {
        val snapshot = control.snapshot.value
        if (snapshot.state == RunState.PAUSED) nav.value = current(snapshot).copy(endConfirmOpen = true)
    }

    fun showPage(page: Int) {
        val snapshot = control.snapshot.value
        nav.value = WatchNavigation.reconcile(snapshot, nav.value.copy(page = page))
    }

    /** Returns false when the system should handle back (close the app). */
    fun back(): Boolean {
        val result = WatchNavigation.back(control.snapshot.value, nav.value)
        nav.value = result.nav
        return result.handled
    }

    fun send(intent: RunIntent) = control.send(intent)
}
