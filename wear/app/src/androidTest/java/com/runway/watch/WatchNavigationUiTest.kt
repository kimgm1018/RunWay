package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.run.*
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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

    private val statusPage = "쪽 중 1쪽"

    @Test fun fullFlowMovesOnlyThroughConfirmedStates() {
        val control = launch()
        compose.onNodeWithContentDescription("러닝 시작").performClick()
        compose.onNodeWithContentDescription(statusPage, substring = true).assertExists()

        compose.onNodeWithContentDescription("일시정지").performClick()
        compose.onNodeWithText("일시정지됨").assertIsDisplayed()

        compose.onNodeWithContentDescription("러닝 종료").performClick()
        compose.onNodeWithText("러닝을 종료할까요?").assertIsDisplayed()
        pressBack()
        compose.onNodeWithText("일시정지됨").assertIsDisplayed()

        compose.onNodeWithContentDescription("러닝 종료").performClick()
        compose.onNodeWithText("취소").performClick()
        compose.onNodeWithText("일시정지됨").assertIsDisplayed()

        compose.onNodeWithContentDescription("러닝 종료").performClick()
        compose.onNodeWithText("종료").performClick()
        compose.onNodeWithContentDescription("닫기").assertIsDisplayed()
        assertEquals(listOf(RunIntent.START, RunIntent.PAUSE, RunIntent.END), control.sent)
    }

    /** flows.md 복귀: resuming returns to the page the runner was on before the pause. */
    @Test fun resumeReturnsToTheLastPage() {
        launch(RunSnapshot(state = RunState.RUNNING))
        compose.onRoot().performTouchInput { swipeLeft() }
        compose.onNodeWithText("페이스 코칭").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("일시정지").onFirst().performClick()
        compose.onNodeWithContentDescription("재개").performClick()
        compose.onNodeWithText("페이스 코칭").assertIsDisplayed()
    }

    @Test fun backDuringARunStaysAndSendsNothing() {
        val control = launch(RunSnapshot(state = RunState.RUNNING))
        compose.onRoot().performTouchInput { swipeLeft() }
        compose.onNodeWithText("페이스 코칭").assertIsDisplayed()
        pressBack()
        compose.onNodeWithContentDescription(statusPage, substring = true).assertExists()
        pressBack()
        compose.onNodeWithContentDescription(statusPage, substring = true).assertExists()
        assertEquals(emptyList<RunIntent>(), control.sent)
    }

    /** 9.2-1: a value opens its detail; back returns to the page and sends nothing. */
    @Test fun aValueOpensItsDetailAndBackReturns() {
        val control = launch(RunSnapshot(state = RunState.RUNNING, metrics = RunMetrics(distanceMeters = 2384.0)))
        compose.onNodeWithContentDescription("거리 2.38 킬로미터").performClick()
        compose.onNodeWithContentDescription(statusPage, substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("거리 2.38 킬로미터").assertIsDisplayed()
        pressBack()
        compose.onNodeWithContentDescription(statusPage, substring = true).assertExists()
        assertEquals(emptyList<RunIntent>(), control.sent)
    }

    @Test fun groupModeSwapsOnlyTheLaterPages() {
        launch(RunSnapshot(state = RunState.RUNNING, mode = RunMode.GROUP))
        compose.onRoot().performTouchInput { swipeLeft() }
        compose.onNodeWithText("공동 페이스를 기다려요").assertIsDisplayed()
        compose.onNodeWithText("페이스 코칭").assertDoesNotExist()
    }

    @Test fun missingValuesShowOneMarkerAndKeepHeartRateApartFromRhythm() {
        launch(RunSnapshot(state = RunState.RUNNING, metrics = RunMetrics(rhythm = RhythmBpm(172))))
        compose.onNodeWithContentDescription("심박·케이던스 보기").performClick()
        compose.onNodeWithContentDescription("심박수 측정값 없음").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 172 BPM").assertDoesNotExist()
    }

    @Test fun pendingStartStaysOnStandbyAndBlocksRepeatTaps() {
        launch(RunSnapshot(state = RunState.READY, pendingCommand = true, pendingIntent = RunIntent.START))
        compose.onNodeWithText("시작 요청 중").assertIsDisplayed()
        compose.onNodeWithContentDescription("시작 확인 중").assertIsNotEnabled()
        compose.onNodeWithContentDescription("더보기").assertDoesNotExist()
    }

    @Test fun pendingCancelShowsCancelCheckAndBlocksBothButtons() {
        val control = launch(RunSnapshot(state = RunState.READY, pendingCommand = true, pendingIntent = RunIntent.CANCEL))
        compose.onNodeWithText("취소 확인 중").assertIsDisplayed()
        compose.onNodeWithContentDescription("러닝 시작").assertIsNotEnabled()
        compose.onNodeWithContentDescription("더보기").assertIsNotEnabled()
        assertEquals(emptyList<RunIntent>(), control.sent)
    }

    /** The prepared run is cancelled only after confirming; back keeps it. */
    @Test fun cancellingAPreparedRunAsksFirst() {
        val control = launch(RunSnapshot(state = RunState.READY))
        compose.onNodeWithContentDescription("더보기").performClick()
        compose.onNodeWithText("준비된 러닝을\n취소할까요?").assertIsDisplayed()
        pressBack()
        compose.onNodeWithContentDescription("러닝 시작").assertIsDisplayed()
        compose.onNodeWithContentDescription("더보기").performClick()
        compose.onNodeWithText("러닝 취소").performClick()
        assertEquals(listOf(RunIntent.CANCEL), control.sent)
    }

    /** S15P31E105-457: after a confirmed cancel the old run and its start button are gone until the phone prepares a new one. */
    @Test fun cancelledRunShowsThePreparePromptUntilANewRunArrives() {
        val title = "민락수변공원 출발 5.0km"
        val state = MutableStateFlow(RunSnapshot(state = RunState.CANCELLED, title = title))
        val sent = mutableListOf<RunIntent>()
        val control = object : RunControl {
            override val snapshot: StateFlow<RunSnapshot> = state
            override fun send(intent: RunIntent) { sent += intent }
        }
        compose.setContent { WatchApp(control) }

        compose.onNodeWithText("휴대폰에서 러닝을 준비해 주세요").assertIsDisplayed()
        compose.onNodeWithText(title).assertDoesNotExist()
        compose.onNodeWithContentDescription("러닝 시작").assertDoesNotExist()

        state.value = RunSnapshot(state = RunState.READY, title = "새 러닝")
        compose.onNodeWithText("새 러닝").assertIsDisplayed()
        compose.onNodeWithContentDescription("러닝 시작").assertIsEnabled().performClick()
        assertEquals(listOf(RunIntent.START), sent)
    }

    @Test fun phoneDisconnectBeforeTheRunShowsTheNotice() {
        val control = launch(RunSnapshot(state = RunState.READY, phoneConnected = false))
        compose.onNodeWithText("휴대폰과 연결되지\n않았어요").assertIsDisplayed()
        compose.onNodeWithContentDescription("다시 연결").performClick()
        compose.onNodeWithContentDescription("러닝 시작").assertIsDisplayed()
        assertEquals(listOf(RunIntent.RECONNECT_PHONE), control.sent)
    }

    /** 9.3e: an unknown pause result covers the pages until 다시 확인, which only shows the last confirmed state. */
    @Test fun anUnknownPauseIsNeitherSuccessNorFailure() {
        val control = launch(RunSnapshot(state = RunState.RUNNING, problem = ControlProblem(ControlProblemKind.UNCONFIRMED, RunIntent.PAUSE)))
        compose.onNodeWithText("일시정지 확인 안 됨").assertIsDisplayed()
        compose.onNodeWithText("일시정지됨").assertDoesNotExist()
        compose.onNodeWithContentDescription("다시 확인").performClick()
        compose.onNodeWithContentDescription(statusPage, substring = true).assertExists()
        assertEquals(emptyList<RunIntent>(), control.sent)
    }
}
