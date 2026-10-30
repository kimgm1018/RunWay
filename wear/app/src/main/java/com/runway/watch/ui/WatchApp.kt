package com.runway.watch.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.BasicSwipeToDismissBox
import androidx.wear.compose.material3.Text
import com.runway.watch.navigation.NavState
import com.runway.watch.navigation.RunPage
import com.runway.watch.navigation.WatchNavigation
import com.runway.watch.navigation.WatchNavigator
import com.runway.watch.navigation.WatchRoute
import com.runway.watch.run.*
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.screen.ResultScreen
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import com.runway.watch.ui.theme.RunwayWatchTheme

/**
 * Watch app host. The visible route comes from the confirmed run state; taps only send intents.
 * Screen bodies here are the shared skeleton; 265~269, 256 and 257 fill in their own details.
 * System swipe-to-dismiss is off, so swiping right closes the app through [onExit] only where
 * [WatchNavigation.canExit] allows it; during a run the swipe stays with the running pages.
 */
@Composable
fun WatchApp(control: RunControl, onExit: () -> Unit = {}) {
    val navigator = remember(control) { WatchNavigator(control) }
    val snapshot by control.snapshot.collectAsState()
    val navState by navigator.state.collectAsState()
    val nav = WatchNavigation.reconcile(snapshot, navState)
    val route = WatchNavigation.route(snapshot, nav)
    val canExit = WatchNavigation.canExit(route)
    BackHandler(enabled = !canExit) { navigator.back() }
    RunwayWatchTheme {
        BasicSwipeToDismissBox(onDismissed = onExit, userSwipeEnabled = canExit) { isBackground ->
            if (isBackground) Box(Modifier.fillMaxSize().background(RunwayColors.Background)) else WatchScreen(route, snapshot, nav, navigator)
        }
    }
}

@Composable
private fun WatchScreen(route: WatchRoute, snapshot: RunSnapshot, nav: NavState, navigator: WatchNavigator) {
    when (route) {
        WatchRoute.STANDBY -> StandbyScreen(snapshot) { navigator.send(RunIntent.START) }
        WatchRoute.CONNECTION_ISSUE -> Notice("휴대폰과 연결이 끊겼어요", "블루투스를 확인해 주세요", StatusTone.WARNING) {
            PillButton("다시 연결", { navigator.send(RunIntent.RECONNECT_PHONE) }, enabled = !snapshot.pendingCommand)
        }
        WatchRoute.RUNNING -> RunPager(snapshot, nav.page, navigator::showPage) { navigator.send(RunIntent.PAUSE) }
        WatchRoute.PAUSED -> PausedScreen(snapshot, onEnd = navigator::openEndConfirm) { navigator.send(RunIntent.RESUME) }
        WatchRoute.END_CONFIRM -> EndConfirmScreen(snapshot, onCancel = { navigator.back() }) { navigator.send(RunIntent.END) }
        WatchRoute.RESULT -> ResultScreen(snapshot)
    }
}

@Composable
private fun StandbyScreen(snapshot: RunSnapshot, onStart: () -> Unit) {
    RoundScreen {
        StatusLine("휴대폰 연결됨" to StatusTone.NORMAL)
        if (snapshot.state == null) {
            Text("휴대폰에서 러닝을 준비해 주세요", style = RunwayType.Title, color = RunwayColors.Content, textAlign = TextAlign.Center)
            return@RoundScreen
        }
        Text(snapshot.title ?: if (snapshot.mode == RunMode.GROUP) "그룹런" else "러닝",
            style = RunwayType.Title, color = RunwayColors.Content, textAlign = TextAlign.Center, maxLines = 2)
        if (snapshot.mode == RunMode.GROUP) return@RoundScreen GroupStandby(snapshot)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MetricValue(MetricFormat.pace(snapshot.metrics.guidePaceSecondsPerKm), 12, emphasized = false)
            MetricValue(MetricFormat.rhythm(snapshot.metrics.rhythm), 12, emphasized = false)
        }
        RoundButton(if (snapshot.pendingCommand) "시작 확인 중" else "시작", onStart, Modifier.padding(top = 4.dp),
            enabled = !snapshot.pendingCommand, size = 60, caption = snapshot.pendingCommand) { Icon(WatchIcon.PLAY, it, 22) }
    }
}

/**
 * A group run starts only when the leader starts it (G09), so there is no start button here. A
 * runner who was not ready when the group left is told so instead of being started late.
 */
@Composable
private fun GroupStandby(snapshot: RunSnapshot) {
    val group = GroupRunDisplay.status(snapshot)
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
        Text("공동", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
        MetricValue(MetricFormat.pace(group.guidePaceSecondsPerKm), 12, emphasized = false)
    }
    val (title, detail) = when (group.phase) {
        GroupPhase.WAITING -> "그룹장이 출발하면\n함께 시작해요" to "휴대폰에서 준비 완료를\n눌러 주세요"
        GroupPhase.RUNNING -> "그룹이 이미 출발했어요" to "내 기록은\n시작되지 않았어요"
        GroupPhase.FINISHED, GroupPhase.FORCE_FINISHED -> "그룹런이 끝났어요" to "내 기록은\n시작되지 않았어요"
    }
    Text(title, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        style = RunwayType.Body.copy(fontWeight = FontWeight.Bold), color = RunwayColors.Content, textAlign = TextAlign.Center)
    Text(detail, style = RunwayType.Body, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center)
}

@Composable
private fun RunPager(snapshot: RunSnapshot, page: Int, onPage: (Int) -> Unit, onPause: () -> Unit) {
    val pages = WatchNavigation.pages(snapshot)
    val pager = rememberPagerState(initialPage = page) { pages.size }
    LaunchedEffect(page) { if (pager.currentPage != page) pager.animateScrollToPage(page) }
    LaunchedEffect(pager) { snapshotFlow { pager.currentPage }.collect(onPage) }
    HorizontalPager(pager, Modifier.fillMaxSize()) { index ->
        val visible = pager.currentPage == index
        when (pages[index]) {
            RunPage.STATUS -> RunStatusPage(snapshot, pages.size, index, visible, onPause)
            RunPage.RECORD_COMPARE -> RecordComparePage(snapshot, pages.size, index, visible)
            RunPage.GROUP_PACE -> GroupPacePage(snapshot, pages.size, index, visible)
            RunPage.GROUP_POSITION -> GroupPositionPage(snapshot, pages.size, index, visible)
            RunPage.PACE_COACHING -> PaceCoachingPage(pages.size, index, visible)
        }
    }
}

/** Page frame kept so swipe order is fixed now; 257 replaces the body. */
@Composable
private fun PaceCoachingPage(count: Int, index: Int, visible: Boolean) {
    RoundScreen(focused = visible) {
        Text("페이스 코칭", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
        Text(MetricFormat.MISSING, style = RunwayType.number(40), color = RunwayColors.ContentDim)
        PageIndicator(count, index)
    }
}

@Composable
private fun PausedScreen(snapshot: RunSnapshot, onEnd: () -> Unit, onResume: () -> Unit) {
    val m = snapshot.metrics
    RoundScreen {
        Chip("일시정지", inverted = true)
        MetricValue(MetricFormat.distance(m.distanceMeters), 36)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MetricValue(MetricFormat.duration(m.elapsedMs), 13, emphasized = false)
            MetricValue(MetricFormat.pace(m.paceSecondsPerKm), 13, emphasized = false)
        }
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            RoundButton("종료", onEnd, kind = ButtonKind.SECONDARY, enabled = !snapshot.pendingCommand, caption = true) { Icon(WatchIcon.STOP, it, 16) }
            RoundButton("재개", onResume, enabled = !snapshot.pendingCommand, caption = true) { Icon(WatchIcon.PLAY, it, 18) }
        }
    }
}

/** 9.3b: icon buttons only; ✕ just goes back to the pause screen. */
@Composable
private fun EndConfirmScreen(snapshot: RunSnapshot, onCancel: () -> Unit, onEnd: () -> Unit) {
    val m = snapshot.metrics
    RoundScreen(spacing = 6.dp) {
        Text("러닝을 종료할까요?", style = RunwayType.Title, color = RunwayColors.Content, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MetricValue(MetricFormat.distance(m.distanceMeters), 12, emphasized = false)
            MetricValue(MetricFormat.duration(m.elapsedMs), 12, emphasized = false)
        }
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            RoundButton("취소", onCancel, kind = ButtonKind.SECONDARY) { Icon(WatchIcon.CLOSE, it, 18) }
            RoundButton("종료", onEnd, enabled = !snapshot.pendingCommand) { Icon(WatchIcon.CHECK, it, 20) }
        }
    }
}
