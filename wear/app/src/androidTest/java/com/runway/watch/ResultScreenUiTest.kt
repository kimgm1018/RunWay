package com.runway.watch

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.runway.watch.run.*
import com.runway.watch.ui.WatchApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Rule
import org.junit.Test

/** Result screen with synthetic results only; none of these come from a real save or analysis. */
class ResultScreenUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class FixedControl(initial: RunSnapshot) : RunControl {
        val state = MutableStateFlow(initial)
        override val snapshot: StateFlow<RunSnapshot> = state
        override fun send(intent: RunIntent) = Unit
    }

    private val measured = RunMetrics(distanceMeters = 5024.0, elapsedMs = 1_781_000, paceSecondsPerKm = 410, heartRate = HeartRate(170))
    private val summary = RunSummary(5020.0, 1_781_000, 355, HeartRate(156))

    private fun completed(result: RunResult?) = RunSnapshot(state = RunState.COMPLETED, metrics = measured, result = result)

    private fun launch(snapshot: RunSnapshot): FixedControl {
        val control = FixedControl(snapshot)
        compose.setContent { WatchApp(control) }
        return control
    }

    @Test fun rightAfterTheEndShowsProcessingWithMeasuredValuesOnly() {
        launch(completed(null))
        compose.onNodeWithText("운동 종료 처리 중").assertIsDisplayed()
        compose.onNodeWithContentDescription("거리 5.02 킬로미터").assertIsDisplayed()
        // The last live pace and heart rate are not an average, so they are not shown as a result.
        compose.onNodeWithContentDescription("페이스 킬로미터당 6분 50초").assertDoesNotExist()
        compose.onNodeWithContentDescription("심박수 170").assertDoesNotExist()
        compose.onNodeWithText("분석 완료").assertDoesNotExist()
    }

    @Test fun unconfirmedSaveIsAWarningWithoutRetry() {
        launch(completed(RunResult(SaveStatus.UNCONFIRMED)))
        compose.onNodeWithText("저장을 확인하지 못했어요").assertIsDisplayed()
        compose.onNodeWithText("다시 시도").assertDoesNotExist()
        compose.onNodeWithText("저장 완료", substring = true).assertDoesNotExist()
    }

    @Test fun pendingAndProcessingAnalysisKeepFinalValuesAndGoalHidden() {
        val control = launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PENDING, summary, GoalEvaluation(true))))
        compose.onNodeWithText("저장 완료 · 분석 준비 중").assertIsDisplayed()
        compose.onNodeWithText("✓ 목표 달성").assertDoesNotExist()
        compose.onNodeWithContentDescription("심박수 156").assertDoesNotExist()

        control.state.value = completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PROCESSING, summary, GoalEvaluation(true)))
        compose.onNodeWithText("저장 완료 · 분석 중").assertIsDisplayed()
        compose.onNodeWithText("✓ 목표 달성").assertDoesNotExist()
    }

    @Test fun failedAnalysisSaysTheRecordIsSaved() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.FAILED, summary, GoalEvaluation(true))))
        compose.onNodeWithText("분석하지 못했어요").assertIsDisplayed()
        compose.onNodeWithText("기록은 저장됐어요").assertIsDisplayed()
        compose.onNodeWithText("✓ 목표 달성").assertDoesNotExist()
    }

    @Test fun readyShowsTheServerSummaryAndGoal() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(true))))
        compose.onNodeWithText("분석 완료").assertIsDisplayed()
        compose.onNodeWithText("✓ 목표 달성").assertIsDisplayed()
        compose.onNodeWithContentDescription("거리 5.02 킬로미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 55초").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 156").assertIsDisplayed()
    }

    @Test fun readyWithoutGoalOrValuesShowsNoGoalAndMissingMarkers() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, RunSummary(distanceMeters = 5020.0))))
        compose.onNodeWithText("분석 완료").assertIsDisplayed()
        compose.onNodeWithText("목표", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("페이스 측정값 없음").assertIsDisplayed()
        compose.onNodeWithContentDescription("심박수 측정값 없음").assertIsDisplayed()
    }

    @Test fun missedGoalIsShownAsMissed() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(false))))
        compose.onNodeWithText("목표 미달성").assertIsDisplayed()
    }

    @Test fun reenteringFollowsTheCurrentState() {
        val control = launch(completed(RunResult(SaveStatus.ENDING)))
        compose.onNodeWithText("운동 종료 처리 중").assertIsDisplayed()
        control.state.value = completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PROCESSING))
        compose.onNodeWithText("저장 완료 · 분석 중").assertIsDisplayed()
        control.state.value = completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(true)))
        compose.onNodeWithText("분석 완료").assertIsDisplayed()
        compose.onNodeWithText("✓ 목표 달성").assertIsDisplayed()
    }

    @Test fun interruptedRunKeepsItsOwnTitle() {
        launch(RunSnapshot(state = RunState.INTERRUPTED, result = RunResult(SaveStatus.SAVED, AnalysisStatus.FAILED)))
        compose.onNodeWithText("기록이 중단됐어요").assertIsDisplayed()
        compose.onNodeWithText("분석하지 못했어요").assertIsDisplayed()
    }
}
