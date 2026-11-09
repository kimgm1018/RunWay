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

/** Result screens (9.4 family) with synthetic results only; none of these come from a real save or analysis. */
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

    private fun launch(snapshot: RunSnapshot, onExit: () -> Unit = {}): FixedControl {
        val control = FixedControl(snapshot)
        compose.setContent { WatchApp(control, onExit = onExit) }
        return control
    }

    /** 9.4a: the watch measurement while the save is checked; the last live pace and heart rate are not a result. */
    @Test fun rightAfterTheEndShowsSavingWithMeasuredValuesOnly() {
        launch(completed(null))
        compose.onNodeWithText("저장 확인 중").assertIsDisplayed()
        compose.onNodeWithContentDescription("거리 5.02 킬로미터").assertIsDisplayed()
        compose.onNodeWithContentDescription("페이스 킬로미터당 6분 50초").assertDoesNotExist()
        compose.onNodeWithContentDescription("심박수 170").assertDoesNotExist()
        compose.onNodeWithText("평균 페이스").assertDoesNotExist()
    }

    @Test fun unconfirmedSaveIsNeitherSavedNorLost() {
        launch(completed(RunResult(SaveStatus.UNCONFIRMED)))
        compose.onNodeWithText("저장을 확인하지 못했어요").assertIsDisplayed()
        compose.onNodeWithContentDescription("저장 확인 확인 안 됨, 분석 대기, 결과 대기").assertIsDisplayed()
        compose.onNodeWithText("다시 시도").assertDoesNotExist()
        compose.onNodeWithText("저장됐어요", substring = true).assertDoesNotExist()
    }

    @Test fun pendingAndProcessingAnalysisKeepFinalValuesAndGoalHidden() {
        val control = launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PENDING, summary, GoalEvaluation(true))))
        compose.onNodeWithText("분석 중").assertIsDisplayed()
        compose.onNodeWithText("목표 달성").assertDoesNotExist()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 55초").assertDoesNotExist()

        control.state.value = completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PROCESSING, summary, GoalEvaluation(true)))
        compose.onNodeWithText("분석 중").assertIsDisplayed()
        compose.onNodeWithText("목표 달성").assertDoesNotExist()
    }

    @Test fun failedAnalysisSaysTheRecordIsSaved() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.FAILED, summary, GoalEvaluation(true))))
        compose.onNodeWithText("분석하지 못했어요").assertIsDisplayed()
        compose.onNodeWithText("기록은 저장됐어요").assertIsDisplayed()
        compose.onNodeWithText("목표 달성").assertDoesNotExist()
    }

    @Test fun readyShowsTheServerAveragePaceAndGoal() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(true))))
        compose.onNodeWithText("목표 달성").assertIsDisplayed()
        compose.onNodeWithText("평균 페이스").assertIsDisplayed()
        compose.onNodeWithContentDescription("페이스 킬로미터당 5분 55초").assertIsDisplayed()
        compose.onNodeWithText("데이터 없음", substring = true).assertDoesNotExist()
    }

    /** 9.4d / 9.4f: no goal reads as a free run; missing values are named instead of made up. */
    @Test fun readyWithoutGoalOrValuesShowsFreeRunAndWhatIsMissing() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, RunSummary(distanceMeters = 5020.0))))
        compose.onNodeWithText("자유 러닝").assertIsDisplayed()
        compose.onNodeWithText("목표", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("페이스 측정값 없음").assertIsDisplayed()
        compose.onNodeWithText("시간·심박 데이터 없음").assertIsDisplayed()
    }

    @Test fun missedGoalIsShownAsMissed() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary.copy(distanceMeters = 4200.0), GoalEvaluation(false))))
        compose.onNodeWithText("목표 미달").assertIsDisplayed()
        compose.onNodeWithText("4.20 km에서 종료").assertIsDisplayed()
    }

    /** 9.4e: a goal without the server's evaluation shows no success badge. */
    @Test fun unknownGoalShowsNoBadge() {
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(null))))
        compose.onNodeWithText("목표 평가 미확인").assertIsDisplayed()
        compose.onNodeWithText("목표 달성").assertDoesNotExist()
    }

    @Test fun reenteringFollowsTheCurrentState() {
        val control = launch(completed(RunResult(SaveStatus.ENDING)))
        compose.onNodeWithText("저장 확인 중").assertIsDisplayed()
        control.state.value = completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PROCESSING))
        compose.onNodeWithText("분석 중").assertIsDisplayed()
        control.state.value = completed(RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(true)))
        compose.onNodeWithText("목표 달성").assertIsDisplayed()
    }

    @Test fun interruptedRunKeepsItsOwnTitle() {
        launch(RunSnapshot(state = RunState.INTERRUPTED, result = RunResult(SaveStatus.SAVED, AnalysisStatus.FAILED)))
        compose.onNodeWithText("기록이 중단됐어요").assertIsDisplayed()
        compose.onNodeWithText("분석하지 못했어요").assertIsDisplayed()
    }

    /** 닫기 only leaves the app; it sends nothing that could cancel the save or analysis. */
    @Test fun closeLeavesTheApp() {
        var exits = 0
        launch(completed(RunResult(SaveStatus.SAVED, AnalysisStatus.PROCESSING)), onExit = { exits++ })
        compose.onNodeWithContentDescription("닫기").performClick()
        compose.runOnIdle { assertEquals(1, exits) }
    }
}
