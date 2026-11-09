package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.run.*
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test

/** 9.2 with synthetic measurements; no sensor, phone or server is involved. */
class RunStatusPageUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class FeedControl(initial: RunSnapshot) : RunControl {
        override val snapshot = MutableStateFlow(initial)
        override fun send(intent: RunIntent) {}
    }

    private val measured = RunMetrics(
        distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 356,
        heartRate = HeartRate(152), cadenceSpm = 171, rhythm = RhythmBpm(172),
    )

    private fun launch(metrics: RunMetrics, pending: Boolean = false, phone: Boolean = true): FeedControl {
        val control = FeedControl(RunSnapshot(RunState.RUNNING, phoneConnected = phone, pendingCommand = pending, metrics = metrics))
        compose.setContent { WatchApp(control) }
        return control
    }

    @Test fun showsPaceDistanceTimeAndFollowsUpdates() {
        val control = launch(measured)
        compose.onNodeWithContentDescription("거리 2.38 킬로미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("경과 시간 14분 12초").assertIsDisplayed()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 56초").assertIsDisplayed()

        control.snapshot.value = control.snapshot.value.copy(
            metrics = measured.copy(distanceMeters = 2412.0, elapsedMs = 857_000, heartRate = HeartRate(155)),
        )
        compose.onNodeWithContentDescription("거리 2.41 킬로미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("경과 시간 14분 17초").assertIsDisplayed()
    }

    /** 9.2-4: heart rate and cadence live in their own detail, opened from the heart mark. */
    @Test fun heartRateAndCadenceOpenFromTheHeartMark() {
        launch(measured)
        compose.onNodeWithContentDescription("심박·케이던스 보기").performClick()
        compose.onNodeWithContentDescription("심박수 152").assertIsDisplayed()
        compose.onNodeWithContentDescription("케이던스 분당 171걸음").assertIsDisplayed()
    }

    /** 9.2b: each source says its own state; a stopped heart sensor never keeps its old value. */
    @Test fun lostAndLateSourcesSayTheirState() {
        launch(measured.copy(feeds = MetricFeeds(location = FeedStatus.DELAYED, heartRate = FeedStatus.STOPPED)))
        compose.onNodeWithText("위치 확인 지연 · 페이스 계산 대기").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 수집 중단").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 152").assertDoesNotExist()
        compose.onNodeWithContentDescription("거리 2.38 킬로미터, 지연").assertIsDisplayed()
        compose.onNodeWithContentDescription("위치 지연, 심박 수집 중단").assertIsDisplayed()
    }

    /** A request in flight locks the handle; the run is not shown as paused. */
    @Test fun pendingRequestLocksTheHandle() {
        launch(measured, pending = true)
        compose.onNodeWithContentDescription("요청 확인 중").assertIsNotEnabled()
        compose.onNodeWithContentDescription("일시정지").assertDoesNotExist()
        compose.onNodeWithText("일시정지됨").assertDoesNotExist()
    }

    /** 9.2d: losing the phone stays on the page with an icon and one line; nothing claims the run ended or was lost. */
    @Test fun phoneLossStaysOnThePage() {
        launch(measured, phone = false)
        compose.onNodeWithText("제어 결과를 확인할 수 없어요").assertIsDisplayed()
        compose.onNodeWithContentDescription("휴대폰 연결 끊김").assertIsDisplayed()
        compose.onNodeWithContentDescription("쪽 중 1쪽", substring = true).assertExists()
    }

    /** 9.2c: a pace outside the drawn range keeps its number. */
    @Test fun paceOutsideTheDotsKeepsTheNumber() {
        launch(measured.copy(paceSecondsPerKm = 520))
        compose.onNodeWithContentDescription("페이스 킬로미터당 8분 40초").assertIsDisplayed()
        compose.onNodeWithText("페이스 눈금 범위 밖").assertIsDisplayed()
    }
}
