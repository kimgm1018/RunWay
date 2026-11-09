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
 * The watch only shows what it is given: the phone chooses the record and the server computes the gap,
 * which arrives in STATE_RESULT(scope=SERVER).comparison (S15P31E105-422, SessionEnvelope.comparison).
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
    /** Which request [pendingCommand] is waiting for, so screens can tell e.g. start from cancel; null when unknown. */
    val pendingIntent: RunIntent? = null,
    val title: String? = null,
    val metrics: RunMetrics = RunMetrics(),
    val comparison: RecordComparison = RecordComparison.NotSelected,
    /** Group state for a [RunMode.GROUP] run; ignored for a personal run. Null until any arrives. */
    val group: GroupStatus? = null,
    /** Save, analysis and goal state after the end; null until the controller reports any. */
    val result: RunResult? = null,
    /** Request in flight, refusal or unconfirmed command, as one short line (S15P31E105-256); null when nothing to say. */
    val notice: String? = null,
    /** The runner's last rhythm BPM change request and where it stands (S15P31E105-257); null when none. */
    val bpmChange: BpmChange? = null,
    /** The last coaching guide the watch applied (S15P31E105-257); null until one is applied. */
    val coaching: CoachingGuide? = null,
    /** No server state reached the watch for 45 s during the run (D-8). Cleared when one arrives. */
    val serverLinkLost: Boolean = false,
    /** The app restarted mid-run and the watch exercise was gone: the watch no longer records (S15P31E105-445). */
    val measurementLost: Boolean = false,
    /** The run was handed to the phone (PHONE_FALLBACK): the watch no longer records or controls it (S15P31E105-464). */
    val phoneRecording: Boolean = false,
    /**
     * The controller's last refusal or unconfirmed request, as already kept for [notice] (S15P31E105-613). Screens use it
     * to tell a failed start (9.1d) from an unconfirmed one (9.1e, 9.3e); it never changes [state].
     */
    val problem: ControlProblem? = null,
)

/** How the last request ended when it did not simply apply. UNCONFIRMED is never shown as success or failure. */
enum class ControlProblemKind { REJECTED, REFUSED, UNCONFIRMED }

/** [intent] is the request it was about; null for a phone ERROR or an action without a run intent. */
data class ControlProblem(val kind: ControlProblemKind, val intent: RunIntent?)

/** Where a rhythm BPM change stands. Only APPLIED means the beat really changed. */
enum class BpmChangeStatus { REQUESTING, APPLIED, REJECTED, UNKNOWN }

data class BpmChange(val target: RhythmBpm, val status: BpmChangeStatus)

/**
 * A coaching guide as shown on the watch: guide pace, target rhythm BPM and a cue sentence made on the watch
 * (D-10). [dummy] marks guidance that does not come from the real AI yet.
 */
data class CoachingGuide(
    val paceSecondsPerKm: Int,
    val target: RhythmBpm,
    val cue: String,
    val dummy: Boolean = Coaching.DUMMY_GUIDE,
)

object Coaching {
    /**
     * Every coaching is shown with the "더미 안내" badge while the server sends dummy coaching (D-10).
     * Set to false (or remove) when the real AI coaching lands; this is the only switch.
     */
    const val DUMMY_GUIDE = true

    /** Rhythm BPM limits for SET_BPM (9.3 targetBpm 60~220) and the step of one −/+ press. */
    const val MIN_BPM = 60
    const val MAX_BPM = 220
    const val BPM_STEP = 1

    /** D-10: the cue sentence comes from the guide on the watch. Same BPM as before → keep, otherwise adjust. */
    fun cue(targetBpm: Int, previousBpm: Int?): String =
        if (previousBpm == targetBpm) "현재 페이스·리듬 유지" else "리듬 BPM $targetBpm${toParticle(targetBpm)} 조정"

    /** 으로/로 after a number read in Korean: 3(삼)·6(육)·0(십·백) end in a final consonant other than ㄹ. */
    private fun toParticle(n: Int) = if (n % 10 in setOf(0, 3, 6)) "으로" else "로"
}

/** User requests. Only these reach the run controller; screen changes follow the confirmed state. */
enum class RunIntent { START, PAUSE, RESUME, END, CANCEL, RECONNECT_PHONE, BPM_UP, BPM_DOWN }

interface RunControl {
    val snapshot: StateFlow<RunSnapshot>
    fun send(intent: RunIntent)
}
