package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.run.*
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** 9.7 / 9.8 and group states with synthetic G10-shaped data; no real group API or delivery is involved. */
class GroupRunPageUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class FeedControl(initial: RunSnapshot) : RunControl {
        override val snapshot = MutableStateFlow(initial)
        val sent = mutableListOf<RunIntent>()
        override fun send(intent: RunIntent) { sent += intent }
    }

    private val standing = GroupStanding(rank = 2, aheadCount = 1, behindCount = 2, gapToAheadMeters = 35.0, gapToBehindMeters = 20.0)

    private val running = GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Known(standing))

    private fun launch(state: RunState = RunState.RUNNING, group: GroupStatus? = running): FeedControl {
        val control = FeedControl(RunSnapshot(state, RunMode.GROUP, group = group,
            metrics = RunMetrics(distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 342, rhythm = RhythmBpm(170))))
        compose.setContent { WatchApp(control) }
        return control
    }

    private fun FeedControl.update(group: GroupStatus?) { snapshot.value = snapshot.value.copy(group = group) }

    private fun openPage(page: Int) {
        repeat(page - 1) { compose.onRoot().performTouchInput { swipeLeft() } }
        compose.onNodeWithContentDescription("3쪽 중 ${page}쪽").assertIsDisplayed()
    }

    @Test fun paceDetailShowsTheSharedPace() {
        launch()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 42초").performClick()
        compose.onNodeWithText("공동").assertIsDisplayed()
        compose.onNodeWithText("안내").assertDoesNotExist()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 40초").assertIsDisplayed()
    }

    @Test fun pacePageShowsSharedAndOwnPaceAndFollowsChanges() {
        val control = launch()
        openPage(2)
        compose.onNodeWithContentDescription("공동 페이스 킬로미터당 5분 40초").assertIsDisplayed()
        compose.onNodeWithText("내 5’42” · +2”").assertIsDisplayed()

        control.update(running.copy(guidePaceSecondsPerKm = 355, notice = GroupNotice.PaceChanged(340, 355)))
        compose.onNodeWithContentDescription("공동 페이스 킬로미터당 5분 55초").assertIsDisplayed()
        compose.onNodeWithText("이전 5’40” → 새 5’55”").assertIsDisplayed()
    }

    @Test fun positionPageShowsRankCountsAndGaps() {
        val control = launch()
        openPage(3)
        compose.onNodeWithContentDescription("현재 2위", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("앞서 달리는 1명, 바로 앞 사람과 35미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("뒤따르는 2명, 바로 뒤 사람과 20미터").assertIsDisplayed()

        control.update(running.copy(leaderToLastGapMeters = 180.0))
        compose.onNodeWithContentDescription("선두와 후미 간격 180미터").assertIsDisplayed()
    }

    @Test fun missingOrLateDataNeverShowsAFakeRank() {
        val control = launch()
        openPage(3)
        control.update(running.copy(position = GroupPosition.Unavailable))
        compose.onNodeWithText("순위를 계산할 수\n없어요").assertIsDisplayed()
        compose.onNodeWithContentDescription("현재 2위", substring = true).assertDoesNotExist()

        control.update(running.copy(position = GroupPosition.Known(standing, delayed = true)))
        compose.onNodeWithText("순위 갱신 지연").assertIsDisplayed()
        compose.onNodeWithContentDescription("현재 2위, 지연", substring = true).assertIsDisplayed()

        control.snapshot.value = control.snapshot.value.copy(group = running,
            metrics = RunMetrics(feeds = MetricFeeds(location = FeedStatus.NO_SIGNAL)))
        compose.onNodeWithText("내 진행 데이터가\n없어요").assertIsDisplayed()
        compose.onNodeWithContentDescription("현재 2위", substring = true).assertDoesNotExist()
    }

    @Test fun waitingGroupHasNoStartButton() {
        val control = launch(RunState.READY, GroupStatus(GroupPhase.WAITING, 340))
        compose.onNodeWithText("그룹장 출발을 기다려요").assertIsDisplayed()
        compose.onNodeWithContentDescription("러닝 시작").assertDoesNotExist()

        control.update(GroupStatus(GroupPhase.RUNNING, 340))
        compose.onNodeWithText("그룹이 이미 출발했어요").assertIsDisplayed()
        assertEquals(emptyList<RunIntent>(), control.sent)
    }

    @Test fun forcedEndIsToldApartAndNotShownAsAFinish() {
        val control = launch()
        control.update(running.copy(phase = GroupPhase.FORCE_FINISHED))
        // 9.7b: the group's end takes over the screen; the runner's own end path stays on the handle.
        compose.onNodeWithContentDescription("일시정지").assertIsDisplayed()
        compose.onNodeWithText("그룹장이 그룹런을\n종료했어요").assertIsDisplayed()

        control.snapshot.value = control.snapshot.value.copy(state = RunState.COMPLETED)
        compose.onNodeWithText("그룹장이 그룹런을 종료").assertIsDisplayed()
        compose.onNodeWithText("목표 달성", substring = true).assertDoesNotExist()
    }

    @Test fun ownEndWhileTheGroupRunsOn() {
        val control = launch()
        control.snapshot.value = control.snapshot.value.copy(state = RunState.COMPLETED)
        compose.onNodeWithText("내 러닝 종료 · 그룹 진행 중").assertIsDisplayed()
    }

    @Test fun personalControlsStayTheSame() {
        val control = launch()
        compose.onNodeWithContentDescription("일시정지").performClick()
        assertEquals(listOf(RunIntent.PAUSE), control.sent)
    }
}
