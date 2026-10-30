package com.runway.watch.run

/**
 * Server save of the finished run (WAT-006). Only the server save ACK counts; a phone receipt
 * alone stays [ENDING]. [UNCONFIRMED] is the timeout or failure case (2 minutes after the end).
 */
enum class SaveStatus { ENDING, SAVED, UNCONFIRMED }

/** `analysis.status` of S02 for a new run. LEGACY never reaches the watch result screen. */
enum class AnalysisStatus { PENDING, PROCESSING, READY, FAILED }

/** Final summary values from H02. Missing values stay null and are shown as missing. */
data class RunSummary(
    val distanceMeters: Double? = null,
    val elapsedMs: Long? = null,
    val averagePaceSecondsPerKm: Int? = null,
    val averageHeartRate: HeartRate? = null,
)

/** First goal evaluation (REC-004). [achieved] is null when the server gave no evaluation. */
data class GoalEvaluation(val achieved: Boolean?)

/**
 * What the run controller knows after the end. Analysis starts only after the server save, so
 * [analysis] is ignored until [save] is [SaveStatus.SAVED].
 */
data class RunResult(
    val save: SaveStatus = SaveStatus.ENDING,
    val analysis: AnalysisStatus? = null,
    val summary: RunSummary? = null,
    /** Null when the runner set no goal. */
    val goal: GoalEvaluation? = null,
)

enum class ResultPhase { ENDING, SAVE_UNCONFIRMED, ANALYSIS_PENDING, ANALYZING, ANALYSIS_FAILED, READY }

object RunResults {
    /** No result yet means the end is still being processed, never that it was saved. */
    fun phase(result: RunResult?): ResultPhase = when (result?.save) {
        null, SaveStatus.ENDING -> ResultPhase.ENDING
        SaveStatus.UNCONFIRMED -> ResultPhase.SAVE_UNCONFIRMED
        SaveStatus.SAVED -> when (result.analysis) {
            null, AnalysisStatus.PENDING -> ResultPhase.ANALYSIS_PENDING
            AnalysisStatus.PROCESSING -> ResultPhase.ANALYZING
            AnalysisStatus.FAILED -> ResultPhase.ANALYSIS_FAILED
            AnalysisStatus.READY -> ResultPhase.READY
        }
    }

    /** Final values only once the analysis is READY; before that nothing is shown as final. */
    fun finalSummary(result: RunResult?): RunSummary? =
        if (phase(result) == ResultPhase.READY) result?.summary ?: RunSummary() else null

    /** Goal evaluation only when a goal was set and the analysis is READY. */
    fun finalGoal(result: RunResult?): GoalEvaluation? =
        if (phase(result) == ResultPhase.READY) result?.goal else null
}
