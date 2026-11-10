package com.runway.watch.cue

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

/**
 * GRP-006·WAT-005 (S15P31E105-604): one vibration when the group's shared pace changed. The session controller calls it
 * only for a change the phone relayed, once per change; the watch never decides a change itself.
 * The leader's widened-group notice (S15P31E105-629) uses the same single buzz; both on one update buzz once.
 */
fun interface GroupPaceAlert {
    fun paceChanged()
}

/** No output: tests. */
object NoGroupPaceAlert : GroupPaceAlert {
    override fun paceChanged() = Unit
}

/**
 * A single buzz. No vibrator, or a failure, only skips the buzz; the change is still shown. [quiet] keeps the rhythm
 * beat from cutting it short.
 */
class WatchGroupPaceAlert(context: Context, private val quiet: HapticQuiet) : GroupPaceAlert {
    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
        context.applicationContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.applicationContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

    override fun paceChanged() {
        try {
            quiet.hold(VIBRATION_MS + QUIET_MARGIN_MS)
            vibrator?.takeIf { it.hasVibrator() }?.vibrate(VibrationEffect.createOneShot(VIBRATION_MS, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (e: Exception) {
            Log.w(TAG, "group pace alert failed: ${e.javaClass.simpleName}")
        }
    }

    private companion object {
        const val TAG = "GroupPaceAlert"
        const val VIBRATION_MS = 400L
        // The beat's next buzz waits a little past the alert so the two are felt apart.
        const val QUIET_MARGIN_MS = 200L
    }
}
