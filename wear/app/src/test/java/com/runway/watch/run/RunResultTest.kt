package com.runway.watch.run

import org.junit.Assert.*
import org.junit.Test

class RunResultTest {
    private val summary = RunSummary(5020.0, 1_781_000, 355, HeartRate(156))

    @Test fun noReportIsStillEndingNeverSaved() {
        assertEquals(ResultPhase.ENDING, RunResults.phase(null))
        assertEquals(ResultPhase.ENDING, RunResults.phase(RunResult()))
    }

    @Test fun analysisIsIgnoredUntilTheServerSaveIsConfirmed() {
        val early = RunResult(SaveStatus.ENDING, AnalysisStatus.READY, summary, GoalEvaluation(true))
        assertEquals(ResultPhase.ENDING, RunResults.phase(early))
        assertNull(RunResults.finalSummary(early))
        assertNull(RunResults.finalGoal(early))
        assertEquals(ResultPhase.SAVE_UNCONFIRMED, RunResults.phase(early.copy(save = SaveStatus.UNCONFIRMED)))
    }

    @Test fun eachAnalysisStatusHasItsOwnPhaseAfterTheSave() {
        val saved = RunResult(SaveStatus.SAVED)
        assertEquals(ResultPhase.ANALYSIS_PENDING, RunResults.phase(saved))
        assertEquals(ResultPhase.ANALYSIS_PENDING, RunResults.phase(saved.copy(analysis = AnalysisStatus.PENDING)))
        assertEquals(ResultPhase.ANALYZING, RunResults.phase(saved.copy(analysis = AnalysisStatus.PROCESSING)))
        assertEquals(ResultPhase.ANALYSIS_FAILED, RunResults.phase(saved.copy(analysis = AnalysisStatus.FAILED)))
        assertEquals(ResultPhase.READY, RunResults.phase(saved.copy(analysis = AnalysisStatus.READY)))
    }

    @Test fun finalValuesAndGoalOnlyWhenReady() {
        val ready = RunResult(SaveStatus.SAVED, AnalysisStatus.READY, summary, GoalEvaluation(false))
        assertEquals(summary, RunResults.finalSummary(ready))
        assertEquals(GoalEvaluation(false), RunResults.finalGoal(ready))
        for (status in listOf(AnalysisStatus.PENDING, AnalysisStatus.PROCESSING, AnalysisStatus.FAILED)) {
            assertNull(RunResults.finalSummary(ready.copy(analysis = status)))
            assertNull(RunResults.finalGoal(ready.copy(analysis = status)))
        }
    }

    @Test fun readyWithoutValuesStaysMissingAndWithoutGoalShowsNoGoal() {
        val ready = RunResult(SaveStatus.SAVED, AnalysisStatus.READY)
        assertEquals(RunSummary(), RunResults.finalSummary(ready))
        assertNull(RunResults.finalGoal(ready))
    }
}
