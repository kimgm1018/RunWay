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

    @Test fun showsAllFiveMetricsAndFollowsUpdates() {
        val control = launch(measured)
        compose.onNodeWithContentDescription("거리 2.38 킬로미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("경과 시간 14분 12초").assertIsDisplayed()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 56초").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 152").assertIsDisplayed()
        compose.onNodeWithContentDescription("케이던스 분당 171걸음").assertIsDisplayed()

        control.snapshot.value = control.snapshot.value.copy(
            metrics = measured.copy(distanceMeters = 2412.0, elapsedMs = 857_000, heartRate = HeartRate(155)),
        )
        compose.onNodeWithContentDescription("거리 2.41 킬로미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("경과 시간 14분 17초").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 155").assertIsDisplayed()
    }

    @Test fun lostAndLateSourcesShowOnlyThroughTheirValues() {
        launch(measured.copy(feeds = MetricFeeds(location = FeedStatus.DELAYED, heartRate = FeedStatus.STOPPED)))
        compose.onNodeWithText("● 폰").assertIsDisplayed()
        compose.onNodeWithText("지연", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("심박수 수집 중단").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 152").assertDoesNotExist()
        compose.onNodeWithContentDescription("거리 2.38 킬로미터, 지연").assertIsDisplayed()
    }

    @Test fun pendingPauseIsShownApartFromTheRunAndBlocksTaps() {
        launch(measured, pending = true)
        compose.onNodeWithText("요청 확인 중").assertIsDisplayed()
        compose.onNodeWithText("일시정지").assertDoesNotExist()
        compose.onNodeWithText("실제 페이스").assertIsDisplayed()
    }

    @Test fun phoneLossIsTheOnlyStatusSpelledOut() {
        launch(measured, phone = false)
        compose.onNodeWithText("● 폰 연결 끊김").assertIsDisplayed()
    }
}
