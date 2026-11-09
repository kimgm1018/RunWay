package com.runway.watch.navigation

import com.runway.watch.readiness.Readiness
import com.runway.watch.readiness.ReadinessRules
import com.runway.watch.run.ControlProblem
import com.runway.watch.run.ControlProblemKind
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.RunControl
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.run.compared
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Watch screens 9.1 ~ 9.4 of the v15 wireframe. [NOT_READY] is 9.1b for consent, permission, registration and internet. */
enum class WatchRoute { STANDBY, CONNECTION_ISSUE, NOT_READY, RUNNING, PAUSED, END_CONFIRM, RESULT }

/** Swipe pages while running (9.2 / 9.5 · 9.6 / 9.7 · 9.8). */
enum class RunPage { STATUS, PACE_COACHING, RECORD_COMPARE, GROUP_PACE, GROUP_POSITION }

/** Screens opened from a run page; not pages themselves (no page dots, back returns to the page). */
enum class RunDetail { PACE, DISTANCE, TIME, BODY, RHYTHM }

/**
 * Full-screen states that replace the pages for a while (flows.md 강제 전환): the result of the runner's own request
 * when it is unknown (9.1e, 9.3e), the hand-over to the phone (9.3f) and the group's end (9.7b). Coaching and link
 * problems never take over the screen.
 */
enum class Overlay { CONTROL_UNKNOWN, PHONE_RECORDING, GROUP_ENDED }

/**
 * Screen-local choices that the run state does not carry. [page] is kept while paused so resuming returns to the last
 * page (flows.md 복귀). [dismissedProblem] is an unconfirmed request the runner already acknowledged with 다시 확인.
 */
data class NavState(
    val endConfirmOpen: Boolean = false,
    val page: Int = 0,
    val detail: RunDetail? = null,
    val cancelOpen: Boolean = false,
    val dismissedProblem: ControlProblem? = null,
)

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

    /**
     * Readiness only replaces the screens before a run. The phone link is checked first: consent and
     * registration are fixed on the phone, and a registered watch is not a connected one.
     */
    fun route(snapshot: RunSnapshot, nav: NavState, readiness: Readiness = Readiness()): WatchRoute = when (snapshot.state) {
        null, RunState.READY, RunState.CANCELLED -> when {
            !snapshot.phoneConnected -> WatchRoute.CONNECTION_ISSUE
            ReadinessRules.issue(readiness) != null -> WatchRoute.NOT_READY
            else -> WatchRoute.STANDBY
        }
        RunState.RUNNING -> WatchRoute.RUNNING
        RunState.PAUSED -> if (nav.endConfirmOpen) WatchRoute.END_CONFIRM else WatchRoute.PAUSED
        RunState.COMPLETED, RunState.INTERRUPTED -> WatchRoute.RESULT
    }

    /** Drops screen-local choices that no longer fit the current state. */
    fun reconcile(snapshot: RunSnapshot, nav: NavState): NavState {
        val running = snapshot.state == RunState.RUNNING
        val detail = nav.detail?.takeIf {
            running && !snapshot.pendingCommand && !snapshot.phoneRecording &&
                (it != RunDetail.RHYTHM || snapshot.mode == RunMode.PERSONAL)
        }
        return NavState(
            endConfirmOpen = nav.endConfirmOpen && snapshot.state == RunState.PAUSED,
            page = if (running || snapshot.state == RunState.PAUSED) nav.page.coerceIn(0, pages(snapshot).lastIndex) else 0,
            detail = detail,
            cancelOpen = nav.cancelOpen && snapshot.state == RunState.READY && snapshot.mode == RunMode.PERSONAL,
            dismissedProblem = nav.dismissedProblem?.takeIf { it == snapshot.problem },
        )
    }

    private val controlIntents = setOf(RunIntent.START, RunIntent.PAUSE, RunIntent.RESUME, RunIntent.END)

    /** Which full-screen state, if any, covers the route now. */
    fun overlay(snapshot: RunSnapshot, nav: NavState): Overlay? {
        val state = snapshot.state
        val live = state == RunState.RUNNING || state == RunState.PAUSED
        val problem = snapshot.problem
        return when {
            live && (snapshot.phoneRecording || snapshot.measurementLost) -> Overlay.PHONE_RECORDING
            problem != null && problem.kind == ControlProblemKind.UNCONFIRMED && problem.intent in controlIntents &&
                problem != nav.dismissedProblem && (live || state == RunState.READY) -> Overlay.CONTROL_UNKNOWN
            live && snapshot.mode == RunMode.GROUP &&
                (snapshot.group?.phase == GroupPhase.FINISHED || snapshot.group?.phase == GroupPhase.FORCE_FINISHED) -> Overlay.GROUP_ENDED
            else -> null
        }
    }

    /** Back or a swipe to the right may close the app only outside a run (standby, connection or readiness issue, result). */
    fun canExit(route: WatchRoute): Boolean = route == WatchRoute.STANDBY || route == WatchRoute.CONNECTION_ISSUE ||
        route == WatchRoute.NOT_READY || route == WatchRoute.RESULT

    /** Back closes a detail or sheet first. During a run it never closes the app, resumes or ends the run. */
    fun back(snapshot: RunSnapshot, nav: NavState): BackResult {
        val current = reconcile(snapshot, nav)
        val route = route(snapshot, current)
        return when {
            current.detail != null -> BackResult(current.copy(detail = null), handled = true)
            current.cancelOpen -> BackResult(current.copy(cancelOpen = false), handled = true)
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

    fun openDetail(detail: RunDetail) {
        val snapshot = control.snapshot.value
        nav.value = WatchNavigation.reconcile(snapshot, nav.value.copy(detail = detail))
    }

    fun closeDetail() {
        nav.value = nav.value.copy(detail = null)
    }

    fun openCancel(open: Boolean) {
        val snapshot = control.snapshot.value
        nav.value = WatchNavigation.reconcile(snapshot, nav.value.copy(cancelOpen = open))
    }

    /**
     * 다시 확인 on an unconfirmed request (9.1e, 9.3e): the watch shows the last confirmed state again. There is no
     * state re-query contract yet (unconfirmed.md); TODO(S15P31E105-613): ask the phone for the state once it exists.
     */
    fun acknowledgeProblem() {
        val snapshot = control.snapshot.value
        nav.value = nav.value.copy(dismissedProblem = snapshot.problem)
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
