package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.run.*
import com.runway.watch.ui.WatchApp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class WatchNavigationUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class Recording(private val inner: SimulatedRunControl) : RunControl by inner {
        val sent = mutableListOf<RunIntent>()
        override fun send(intent: RunIntent) { sent += intent; inner.send(intent) }
    }

    private fun launch(initial: RunSnapshot? = null): Recording {
        val control = Recording(initial?.let { SimulatedRunControl(it) } ?: SimulatedRunControl())
        compose.setContent { WatchApp(control) }
        return control
    }

    private fun pressBack() = compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }

    @Test fun fullFlowMovesOnlyThroughConfirmedStates() {
        val control = launch()
        compose.onNodeWithContentDescription("시작").performClick()
        compose.onNodeWithText("실제 페이스").assertIsDisplayed()

        compose.onNodeWithText("실제 페이스").performClick()
        compose.onNodeWithText("일시정지").assertIsDisplayed()

        compose.onNodeWithContentDescription("종료").performClick()
        compose.onNodeWithText("러닝을 종료할까요?").assertIsDisplayed()
        pressBack()
        compose.onNodeWithText("일시정지").assertIsDisplayed()

        compose.onNodeWithContentDescription("종료").performClick()
        compose.onNodeWithContentDescription("취소").performClick()
        compose.onNodeWithText("일시정지").assertIsDisplayed()

        compose.onNodeWithContentDescription("종료").performClick()
        compose.onAllNodesWithContentDescription("종료").onLast().performClick()
        compose.onNodeWithText("러닝 종료").assertIsDisplayed()
        assertEquals(listOf(RunIntent.START, RunIntent.PAUSE, RunIntent.END), control.sent)
    }

    @Test fun backDuringARunStaysAndSendsNothing() {
        val control = launch(RunSnapshot(state = RunState.RUNNING))
        compose.onNodeWithText("실제 페이스").performTouchInput { swipeLeft() }
        compose.onNodeWithText("페이스 코칭").assertIsDisplayed()
        pressBack()
        compose.onNodeWithText("실제 페이스").assertIsDisplayed()
        pressBack()
        compose.onNodeWithText("실제 페이스").assertIsDisplayed()
        assertEquals(emptyList<RunIntent>(), control.sent)
    }

    @Test fun groupModeSwapsOnlyTheLaterPages() {
        launch(RunSnapshot(state = RunState.RUNNING, mode = RunMode.GROUP))
        compose.onNodeWithText("실제 페이스").performTouchInput { swipeLeft() }
        compose.onNodeWithText("그룹 공동 페이스").assertIsDisplayed()
    }

    @Test fun missingValuesShowOneMarkerAndKeepHeartRateApartFromRhythm() {
        launch(RunSnapshot(state = RunState.RUNNING, metrics = RunMetrics(rhythm = RhythmBpm(172))))
        compose.onNodeWithContentDescription("심박수 측정값 없음").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 172 BPM").assertIsDisplayed()
    }

    @Test fun pendingStartStaysOnStandbyAndBlocksRepeatTaps() {
        launch(RunSnapshot(state = RunState.READY, pendingCommand = true))
        compose.onNodeWithContentDescription("시작 확인 중").assertIsNotEnabled()
    }

    @Test fun phoneDisconnectBeforeTheRunShowsTheNotice() {
        val control = launch(RunSnapshot(state = RunState.READY, phoneConnected = false))
        compose.onNodeWithText("휴대폰 연결이 없어요").assertIsDisplayed()
        compose.onNodeWithText("다시 연결").performClick()
        compose.onNodeWithContentDescription("시작").assertIsDisplayed()
        assertEquals(listOf(RunIntent.RECONNECT_PHONE), control.sent)
    }
}
