package com.runway.watch.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.BasicSwipeToDismissBox
import com.runway.watch.navigation.NavState
import com.runway.watch.navigation.Overlay
import com.runway.watch.navigation.RunDetail
import com.runway.watch.navigation.RunPage
import com.runway.watch.navigation.WatchNavigation
import com.runway.watch.navigation.WatchNavigator
import com.runway.watch.navigation.WatchRoute
import com.runway.watch.readiness.CheckState
import com.runway.watch.readiness.Readiness
import com.runway.watch.readiness.ReadinessRules
import com.runway.watch.run.*
import com.runway.watch.ui.screen.ResultScreen
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayWatchTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Watch app host. The visible route comes from the confirmed run state; taps only send intents. Screens follow the
 * confirmed watch design (docs/design/watch-handoff, S15P31E105-613). System swipe-to-dismiss is off, so swiping
 * right closes the app through [onExit] only where [WatchNavigation.canExit] allows it; during a run the swipe stays
 * with the running pages and back never resumes or ends the run.
 */
@Composable
fun WatchApp(
    control: RunControl,
    readiness: StateFlow<Readiness> = remember { MutableStateFlow(Readiness()) },
    actions: ReadinessActions = ReadinessActions(),
    onExit: () -> Unit = {},
    ambient: StateFlow<AmbientMode?> = remember { MutableStateFlow(null) },
) {
    val navigator = remember(control) { WatchNavigator(control) }
    val snapshot by control.snapshot.collectAsState()
    val ready by readiness.collectAsState()
    val navState by navigator.state.collectAsState()
    val nav = WatchNavigation.reconcile(snapshot, navState)
    val route = WatchNavigation.route(snapshot, nav, ready)
    val canExit = WatchNavigation.canExit(route) && !nav.cancelOpen
    val dim by ambient.collectAsState()
    BackHandler(enabled = !canExit) { navigator.back() }
    RunwayWatchTheme {
        // S15P31E105-617: while ambient the low-power screen takes values only on each ambient update (or a route
        // change), not on every snapshot. The navigator keeps the page, so waking returns to the page last seen.
        val mode = dim
        if (mode != null) {
            val shown = remember(mode.tick, route, snapshot.state, snapshot.phoneRecording, snapshot.measurementLost) {
                AmbientDisplay.of(snapshot, route)
            }
            AmbientScreen(shown, mode)
        } else {
            BasicSwipeToDismissBox(onDismissed = onExit, userSwipeEnabled = canExit) { isBackground ->
                if (isBackground) Box(Modifier.fillMaxSize().background(RunwayColors.Background))
                else WatchScreen(route, snapshot, ready, actions, nav, navigator, onExit)
            }
        }
    }
}

@Composable
private fun WatchScreen(
    route: WatchRoute, snapshot: RunSnapshot, readiness: Readiness, actions: ReadinessActions,
    nav: NavState, navigator: WatchNavigator, onExit: () -> Unit,
) {
    val pause = { navigator.send(RunIntent.PAUSE) }
    when (WatchNavigation.overlay(snapshot, nav)) {
        Overlay.PHONE_RECORDING -> return PhoneRecordingScreen(snapshot, onExit)
        Overlay.CONTROL_UNKNOWN -> return ControlUnknownScreen(snapshot, snapshot.problem?.intent, navigator::acknowledgeProblem)
        // The personal end path stays reachable from 9.7b: its ■ handle opens the same 9.3b confirmation.
        Overlay.GROUP_ENDED -> if (route != WatchRoute.END_CONFIRM) return GroupEndedScreen(snapshot, pause, navigator::openEndConfirm)
        null -> Unit
    }
    when (route) {
        WatchRoute.STANDBY -> StandbyScreen(
            snapshot, nav.cancelOpen, onMore = navigator::openCancel,
            onCancel = { navigator.send(RunIntent.CANCEL); navigator.openCancel(false) },
        ) { navigator.send(RunIntent.START) }
        WatchRoute.CONNECTION_ISSUE -> ConnectionIssueScreen(snapshot.pendingCommand) { navigator.send(RunIntent.RECONNECT_PHONE) }
        WatchRoute.NOT_READY -> ReadinessScreen(ReadinessRules.issue(readiness), actions)
        WatchRoute.RUNNING -> when {
            snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.PAUSE -> PauseRequestScreen(snapshot)
            nav.detail == RunDetail.RHYTHM -> RhythmManualScreen(snapshot, navigator::send, pause)
            nav.detail != null -> RunDetailScreen(snapshot, nav.detail, navigator::closeDetail, pause)
            else -> RunPager(snapshot, readiness.online, nav.page, navigator::showPage, navigator::send, navigator::openDetail, pause)
        }
        WatchRoute.PAUSED ->
            if (snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.END) EndRequestScreen(snapshot)
            else PausedScreen(snapshot, onEnd = navigator::openEndConfirm) { navigator.send(RunIntent.RESUME) }
        WatchRoute.END_CONFIRM ->
            if (snapshot.pendingCommand && snapshot.pendingIntent == RunIntent.END) EndRequestScreen(snapshot)
            else EndConfirmScreen(snapshot, onCancel = { navigator.back() }) { navigator.send(RunIntent.END) }
        WatchRoute.RESULT -> ResultScreen(snapshot, onExit)
    }
}

/**
 * Running pages: personal 운동 현황 → 페이스 코칭 → 기록 비교 (only with a chosen comparison), group 운동 현황 →
 * 공동 페이스 → 진행 순서·간격. The pager only has the pages that exist, so nothing moves to a page of the other mode.
 */
@Composable
private fun RunPager(
    snapshot: RunSnapshot, online: CheckState, page: Int, onPage: (Int) -> Unit, onIntent: (RunIntent) -> Unit,
    onDetail: (RunDetail) -> Unit, onPause: () -> Unit,
) {
    val pages = WatchNavigation.pages(snapshot)
    val pager = rememberPagerState(initialPage = page.coerceIn(0, pages.lastIndex)) { pages.size }
    LaunchedEffect(page) { if (pager.currentPage != page) pager.animateScrollToPage(page) }
    LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect(onPage) }
    // The shared-pace change already shown long enough (S15P31E105-849), kept here so swiping does not show it again.
    val seenPaceChange = remember { mutableStateOf<GroupNotice.PaceChanged?>(null) }
    HorizontalPager(pager, Modifier.fillMaxSize()) { index ->
        val visible = pager.currentPage == index
        when (pages[index]) {
            RunPage.STATUS -> RunStatusPage(snapshot, pages.size, index, visible, onPause, online, onDetail)
            RunPage.PACE_COACHING -> PaceCoachingPage(snapshot, pages.size, index, visible, onPause) { onDetail(RunDetail.RHYTHM) }
            RunPage.RECORD_COMPARE -> RecordComparePage(snapshot, pages.size, index, visible, onPause)
            RunPage.GROUP_PACE -> GroupPacePage(snapshot, pages.size, index, visible, onPause, seenPaceChange)
            RunPage.GROUP_POSITION -> GroupPositionPage(snapshot, pages.size, index, visible, onPause)
        }
    }
}
