package com.runway.watch.run

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Debug builds only: applies intents to synthetic data at once so screens and back navigation can
 * be checked on an emulator. No sensors, phone or server are involved. 256 replaces this with the
 * real controller. Each app launch starts a fresh run, so leaving the result screen with BACK and
 * reopening the app returns to standby (the real flow waits for the phone to prepare the next run).
 */
object RunControls {
    fun create(): RunControl = SimulatedRunControl()
}

class SimulatedRunControl(
    initial: RunSnapshot = RunSnapshot(
        state = RunState.READY, title = "민락수변공원 출발 5.0km",
        metrics = RunMetrics(
            distanceMeters = 2384.0, elapsedMs = 852_000, paceSecondsPerKm = 356, guidePaceSecondsPerKm = 358,
            heartRate = HeartRate(152), cadenceSpm = 171, rhythm = RhythmBpm(172), goalProgress = .476f,
        ),
        comparison = RecordComparison.Result(2384.0, currentElapsedMs = 852_000, pastElapsedMs = 873_000, targetLabel = "10.13"),
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
            RunIntent.RECONNECT_PHONE -> current.copy(phoneConnected = true)
        }
    }
}
