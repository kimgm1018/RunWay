package com.runway.health.watch

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * Keeps JS timers running while a run is active and the phone screen is off (S15P31E105-533).
 *
 * React Native stops firing JS timers when the activity is paused (screen off) unless a headless JS task is running
 * (JavaTimerManager). Device test: with the screen off the 5 s server poll stopped and the app's own request timeout
 * never fired, so a watch pause waited 93 s for a stalled request. While the run foreground service is on, one empty
 * headless task ([TASK_KEY], registered in index.js) keeps timers alive; it ends when the service stops.
 */
class RunTimersKeeper(private val app: ReactApplicationContext) {
  @Volatile private var taskId: Int? = null

  fun set(active: Boolean) {
    UiThreadUtil.runOnUiThread {
      try {
        val tasks = HeadlessJsTaskContext.getInstance(app)
        val current = taskId
        if (active && (current == null || !tasks.isTaskRunning(current))) {
          taskId = tasks.startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true))
          diag("timers kept on")
        } else if (!active && current != null) {
          taskId = null
          if (tasks.isTaskRunning(current)) tasks.finishTask(current)
          diag("timers kept off")
        }
      } catch (e: Exception) {
        // No JS instance yet or headless tasks unavailable: the run continues; timers just pause with the screen.
        diag("timers keep failed ${e.javaClass.simpleName}")
      }
    }
  }

  companion object {
    const val TASK_KEY = "RunWayKeepTimers"
  }
}
