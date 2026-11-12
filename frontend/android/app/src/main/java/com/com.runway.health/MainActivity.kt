package com.runway.health
import android.os.Bundle
import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.runway.health.watch.WatchSessionInbox

class MainActivity : ReactActivity() {
  private var runWindowRecovery: RunWindowRecovery? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    // react-native-screens cannot restore fragments after process death, so start fresh.
    super.onCreate(null)
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
    runWindowRecovery = RunWindowRecovery(window.decorView)
  }

  override fun onStop() {
    runWindowRecovery?.onBackground()
    super.onStop()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    runWindowRecovery?.onFocus(hasFocus, hasFocus && WatchSessionInbox(this).activeSessionId() != null)
  }

  override fun onDestroy() {
    runWindowRecovery?.dispose()
    super.onDestroy()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "RunwayHealth"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
