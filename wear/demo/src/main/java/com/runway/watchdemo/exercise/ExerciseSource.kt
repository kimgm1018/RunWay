package com.runway.watchdemo.exercise

import com.runway.watchdemo.session.MetricSample

sealed interface ExerciseSignal {
    data class Active(val support: Map<String, String>) : ExerciseSignal
    data class Ended(val reason: String) : ExerciseSignal
    data class Availability(val values: Map<String, String>) : ExerciseSignal
    data class Error(val message: String) : ExerciseSignal
}
interface ExerciseSource {
    fun start(onSamples: (List<MetricSample>) -> Unit, onState: (ExerciseSignal) -> Unit)
    fun stop()
    fun close()
}
