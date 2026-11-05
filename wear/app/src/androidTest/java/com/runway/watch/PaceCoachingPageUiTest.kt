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

/** 9.5 pace coaching (S15P31E105-257) with a synthetic guide; buttons only send intents. */
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

    @Test fun showsTheGuideWithTheDummyBadgeAndSendsBpmRequests() {
        val control = launch()
        compose.onNodeWithText("더미 안내").assertIsDisplayed()
        compose.onNodeWithText("리듬 BPM 165로 조정").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 170 BPM").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 BPM 높이기").performClick()
        compose.onNodeWithContentDescription("리듬 BPM 낮추기").performClick()
        assertEquals(listOf(RunIntent.BPM_UP, RunIntent.BPM_DOWN), control.sent)
    }

    @Test fun buttonsWaitWhileARequestIsPendingAndStatusIsShown() {
        launch(change = BpmChange(RhythmBpm(171), BpmChangeStatus.REQUESTING))
        compose.onNodeWithText("리듬 BPM 171 요청 중").assertIsDisplayed()
        compose.onNodeWithContentDescription("리듬 BPM 높이기").assertIsNotEnabled()
    }

    @Test fun showsServerLinkLoss() {
        launch(lost = true)
        compose.onAllNodesWithText("● 서버 연결 끊김").onFirst().assertExists()
    }
}
