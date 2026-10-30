package com.runway.watch.run

import kotlinx.coroutines.flow.StateFlow

/** Session states confirmed in docs/design/api/sessions.md. A pending command never changes them. */
enum class RunState { READY, RUNNING, PAUSED, COMPLETED, CANCELLED, INTERRUPTED }

enum class RunMode { PERSONAL, GROUP }

/** Measured wrist heart rate. Kept apart from [RhythmBpm] so the two are never shown interchangeably. */
@JvmInline value class HeartRate(val bpm: Int)

/** Step rhythm cue tempo. */
@JvmInline value class RhythmBpm(val beatsPerMinute: Int)

data class RunMetrics(
    val distanceMeters: Double? = null,
    val elapsedMs: Long? = null,
    val paceSecondsPerKm: Int? = null,
    val guidePaceSecondsPerKm: Int? = null,
    val heartRate: HeartRate? = null,
    val cadenceSpm: Int? = null,
    val rhythm: RhythmBpm? = null,
    /** Distance progress toward the goal, 0..1, or null when there is no distance goal. */
    val goalProgress: Float? = null,
    val feeds: MetricFeeds = MetricFeeds(),
)

/**
 * REC-005 comparison with one of the runner's own past runs, kept apart from the goal in [RunMetrics].
 * The watch only shows what it is given: choosing the record, computing the gap and how the result
 * reaches the watch are outside this model, and the delivery contract is not agreed yet.
 */
sealed interface RecordComparison {
    /** No past run was chosen for this run; the comparison page is left out. */
    data object NotSelected : RecordComparison
    /** A comparison was asked for but there is no past run it can use. */
    data object NoRecord : RecordComparison
    /** A past run is chosen but no result has arrived (yet, or any more). */
    data object Waiting : RecordComparison
    /** The chosen run can no longer be read (e.g. deleted mid-run); comparison stops, the run goes on. */
    data object Unavailable : RecordComparison

    /**
     * Times to reach the same [distanceMeters] now and in the past run. [targetLabel] names the past
     * run (e.g. its date); without it the run is treated as not compared (see [compared]).
     */
    data class Result(
        val distanceMeters: Double,
        val currentElapsedMs: Long,
        val pastElapsedMs: Long,
        val targetLabel: String? = null,
    ) : RecordComparison
}

/**
 * False when the run goes on without a comparison: nothing was chosen, or a result does not name the
 * past run. Then the watch shows nothing about comparing.
 */
val RecordComparison.compared: Boolean
    get() = when (this) {
        RecordComparison.NotSelected -> false
        is RecordComparison.Result -> !targetLabel.isNullOrBlank()
        else -> true
    }

data class RunSnapshot(
    /** Null until the phone has handed over a prepared session. */
    val state: RunState? = null,
    val mode: RunMode = RunMode.PERSONAL,
    val phoneConnected: Boolean = true,
    /** A command was accepted but its real application is not confirmed yet. */
    val pendingCommand: Boolean = false,
    val title: String? = null,
    val metrics: RunMetrics = RunMetrics(),
    val comparison: RecordComparison = RecordComparison.NotSelected,
    /** Group state for a [RunMode.GROUP] run; ignored for a personal run. Null until any arrives. */
    val group: GroupStatus? = null,
    /** Save, analysis and goal state after the end; null until the controller reports any. */
    val result: RunResult? = null,
)

/** User requests. Only these reach the run controller; screen changes follow the confirmed state. */
enum class RunIntent { START, PAUSE, RESUME, END, RECONNECT_PHONE }

interface RunControl {
    val snapshot: StateFlow<RunSnapshot>
    fun send(intent: RunIntent)
}
