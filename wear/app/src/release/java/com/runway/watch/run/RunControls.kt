package com.runway.watch.run

import android.content.Context
import com.runway.watch.session.RunSessions

/** Release builds use the real controller: approved commands from the phone start and stop the exercise (S15P31E105-256). */
object RunControls {
    fun create(context: Context): RunControl = RunSessions.get(context).control
}
