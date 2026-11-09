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

/** 9.5 pace coaching and 9.5b manual rhythm (S15P31E105-257) with a synthetic guide; buttons only send intents. */
class PaceCoachingPageUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class FeedControl(initial: RunSnapshot) : RunControl {
        override val snapshot = MutableStateFlow(initial)
        val sent = mutableListOf<RunIntent>()
        override fun send(intent: RunIntent) { sent += intent }
    }

    private fun launch(bpm: Int = 170, change: BpmChange? = null, lost: Boolean = false): FeedControl {
        val control = FeedControl(RunSnapshot(
            RunState.RUNNING, metrics = RunMetrics(guidePaceSecondsPerKm = 358, rhythm = RhythmBpm(bpm)),
            coaching = CoachingGuide(358, RhythmBpm(165), Coaching.cue(165, 170)), bpmChange = change, serverLinkLost = lost,
        ))
        compose.setContent { WatchApp(control) }
        compose.onRoot().performTouchInput { swipeLeft() }
        compose.waitForIdle()
        return control
    }

    private fun openManual() {
        compose.onNodeWithContentDescription("직접 조절").performClick()
        compose.waitForIdle()
    }

    @Test fun showsTheGuideWithTheDummyBadge() {
        launch()
        compose.onNodeWithText("더미 안내").assertIsDisplayed()
        compose.onNodeWithText("리듬 BPM 165로 조정").assertIsDisplayed()
        compose.onNodeWithContentDescription("안내 페이스 킬로미터당 5분 58초").assertIsDisplayed()
        // The guide's BPM is not the one playing, so it is not shown as applied.
        compose.onNodeWithText("✓ 165 BPM 적용됨").assertDoesNotExist()
    }

    @Test fun manualScreenSendsBpmRequestsAndBackReturns() {
        val control = launch()
        openManual()
        compose.onNodeWithText("직접 조절 중").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 170 BPM").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 BPM 높이기").performClick()
        compose.onNodeWithContentDescription("리듬 BPM 낮추기").performClick()
        assertEquals(listOf(RunIntent.BPM_UP, RunIntent.BPM_DOWN), control.sent)
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithText("페이스 코칭").assertIsDisplayed()
    }

    /** 9.5d: −/+ wait while a request is pending and the sound still playing is named. */
    @Test fun buttonsWaitWhileARequestIsPending() {
        launch(change = BpmChange(RhythmBpm(171), BpmChangeStatus.REQUESTING))
        openManual()
        compose.onNodeWithText("171 BPM 요청 중").assertIsDisplayed()
        compose.onNodeWithText("지금 소리 170 BPM").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 BPM 높이기").assertIsNotEnabled()
    }

    /** 9.5g: an unknown result shows the chosen and the last confirmed value, never a success check. */
    @Test fun unknownResultIsNotShownAsApplied() {
        launch(change = BpmChange(RhythmBpm(171), BpmChangeStatus.UNKNOWN))
        openManual()
        compose.onNodeWithText("171 BPM 적용 확인 불가").assertIsDisplayed()
        compose.onNodeWithText("선택 171 · 마지막 확인 170").assertIsDisplayed()
        compose.onNodeWithText("적용됨", substring = true).assertDoesNotExist()
    }

    @Test fun showsServerLinkLoss() {
        launch(lost = true)
        compose.onNodeWithText("서버 연결 끊김").assertExists()
    }
}
