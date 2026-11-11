package com.runway.watch.run

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Test only (androidTest): applies intents to synthetic data at once so screens and back navigation can be checked
 * without sensors, a phone or a server. The product app never selects it: [RunControls] returns the real session
 * controller in every build type (S15P31E105-658).
 */
class SimulatedRunControl(
    initial: RunSnapshot = RunSnapshot(
        state = RunState.READY, title = "민락수변공원 출발 5.0km",
        metrics = RunMetrics(
            distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 356, guidePaceSecondsPerKm = 358,
            heartRate = HeartRate(152), cadenceSpm = 171, rhythm = RhythmBpm(172), goalProgress = .476f,
        ),
        comparison = RecordComparison.Result(2384.0, currentElapsedMs = 852_000, pastElapsedMs = 873_000, targetLabel = "10.13"),
        // S15P31E105-257: a dummy coaching guide as the server would send it.
        coaching = CoachingGuide(358, RhythmBpm(172), Coaching.cue(172, 172)),
    ),
) : RunControl {
    private val state = MutableStateFlow(initial)
    override val snapshot: StateFlow<RunSnapshot> = state

    override fun send(intent: RunIntent) {
        val current = state.value
        state.value = when (intent) {
            RunIntent.START -> if (current.state == RunState.READY) current.copy(state = RunState.RUNNING) else current
            RunIntent.PAUSE -> if (current.state == RunState.RUNNING) current.copy(state = RunState.PAUSED) else current
            RunIntent.RESUME -> if (current.state == RunState.PAUSED) current.copy(state = RunState.RUNNING) else current
            RunIntent.END -> if (current.state in setOf(RunState.RUNNING, RunState.PAUSED)) current.copy(state = RunState.COMPLETED) else current
            RunIntent.CANCEL -> if (current.state == RunState.READY) current.copy(state = RunState.CANCELLED) else current
            RunIntent.RECONNECT_PHONE -> current.copy(phoneConnected = true)
            // No server here: a BPM change is applied at once and shown as APPLIED.
            RunIntent.BPM_UP, RunIntent.BPM_DOWN -> {
                val base = current.metrics.rhythm?.beatsPerMinute ?: return
                val step = if (intent == RunIntent.BPM_UP) Coaching.BPM_STEP else -Coaching.BPM_STEP
                val next = (base + step).takeIf { it in Coaching.MIN_BPM..Coaching.MAX_BPM } ?: return
                current.copy(
                    metrics = current.metrics.copy(rhythm = RhythmBpm(next)),
                    bpmChange = BpmChange(RhythmBpm(next), BpmChangeStatus.APPLIED),
                )
            }
        }
    }
}
