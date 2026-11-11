package com.runway.watch.run

import android.content.Context
import com.runway.watch.session.RunSessions

/**
 * Debug and release builds use the real controller: approved commands from the phone start and stop the exercise
 * (S15P31E105-256). Until the phone prepares a session the screens show standby, never synthetic values
 * (S15P31E105-658).
 */
object RunControls {
    fun create(context: Context): RunControl = RunSessions.get(context).control
}
