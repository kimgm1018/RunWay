package com.runway.watch.run

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Release builds have no run controller until 256; the app only shows the waiting screen. */
object RunControls {
    fun create(): RunControl = object : RunControl {
        override val snapshot: StateFlow<RunSnapshot> = MutableStateFlow(RunSnapshot())
        override fun send(intent: RunIntent) = Unit
    }
}
