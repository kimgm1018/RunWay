package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.run.*
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test

/** 9.6 / 9.6b with synthetic comparison results; no real calculation or delivery is involved. */
class RecordComparePageUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class FeedControl(initial: RunSnapshot) : RunControl {
        override val snapshot = MutableStateFlow(initial)
        override fun send(intent: RunIntent) {}
    }

    private val ahead = RecordComparison.Result(2384.0, currentElapsedMs = 852_000, pastElapsedMs = 873_000, targetLabel = "10.13")

    private val measured = RunMetrics(distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 356, goalProgress = .476f)

    private fun launch(comparison: RecordComparison): FeedControl {
        val control = FeedControl(RunSnapshot(RunState.RUNNING, metrics = measured, comparison = comparison))
        compose.setContent { WatchApp(control) }
        return control
    }

    private fun openComparePage() {
        repeat(2) { compose.onRoot().performTouchInput { swipeLeft() } }
        compose.onNodeWithContentDescription("3쪽 중 3쪽").assertIsDisplayed()
    }

    @Test fun showsTheGapAndFollowsUpdates() {
        val control = launch(ahead)
        openComparePage()
        compose.onNodeWithText("10.13 기록과 비교").assertIsDisplayed()
        compose.onNodeWithContentDescription("지난 기록보다 21초 빠름").assertIsDisplayed()

        control.snapshot.value = control.snapshot.value.copy(
            comparison = ahead.copy(distanceMeters = 2500.0, currentElapsedMs = 940_000, pastElapsedMs = 905_000),
        )
        compose.onNodeWithContentDescription("지난 기록보다 35초 느림").assertIsDisplayed()
        compose.onNodeWithText("2.50km 도달\n지금 15:40 · 지난 15:05").assertIsDisplayed()
    }

    @Test fun runWithoutAComparisonHasNoComparisonPage() {
        launch(RecordComparison.NotSelected)
        compose.onNodeWithContentDescription("2쪽 중 1쪽").assertIsDisplayed()
        repeat(2) { compose.onRoot().performTouchInput { swipeLeft() } }
        compose.onNodeWithContentDescription("2쪽 중 2쪽").assertIsDisplayed()
        compose.onNodeWithText("비교", substring = true).assertDoesNotExist()
    }

    @Test fun droppingTheComparisonRemovesThePage() {
        val control = launch(ahead)
        openComparePage()
        control.snapshot.value = control.snapshot.value.copy(comparison = ahead.copy(targetLabel = null))
        compose.onNodeWithContentDescription("2쪽 중 2쪽").assertIsDisplayed()
        compose.onNodeWithText("비교", substring = true).assertDoesNotExist()
    }

    @Test fun noRecordShowsGuidanceWithoutAValue() {
        launch(RecordComparison.NoRecord)
        openComparePage()
        compose.onNodeWithText("비교할 기록이 없어요").assertIsDisplayed()
        compose.onNodeWithText("″", substring = true).assertDoesNotExist()
    }

    @Test fun waitingDropsTheLastGap() {
        val control = launch(ahead)
        openComparePage()
        control.snapshot.value = control.snapshot.value.copy(comparison = RecordComparison.Waiting)
        compose.onNodeWithText("비교 결과를 기다려요").assertIsDisplayed()
        compose.onNodeWithContentDescription("지난 기록보다 21초 빠름").assertDoesNotExist()
    }

    @Test fun stoppedComparisonKeepsTheRunGoing() {
        val control = launch(ahead)
        openComparePage()
        control.snapshot.value = control.snapshot.value.copy(comparison = RecordComparison.Unavailable)
        compose.onNodeWithText("비교를 멈췄어요").assertIsDisplayed()
        compose.onNodeWithContentDescription("지난 기록보다 21초 빠름").assertDoesNotExist()

        repeat(2) { compose.onRoot().performTouchInput { swipeRight() } }
        compose.onNodeWithText("실제 페이스").assertIsDisplayed()
        compose.onNodeWithContentDescription("거리 2.38 킬로미터").assertIsDisplayed()
    }
}
