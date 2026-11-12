package com.runway.health

import android.view.View

/** Repaint the existing run window after its screen-off surface has been replaced. */
internal class RunWindowRecovery(private val root: View) {
  private var needsDraw = false
  private var disposed = false
  private val redraw = Runnable {
    if (!disposed && needsDraw && root.isAttachedToWindow && root.windowVisibility == View.VISIBLE) {
      needsDraw = false
      // A frame queued to the old surface can fail during screen-off. Request a traversal on the new surface;
      // keep the React root, navigation, GPS subscriptions and recording session intact.
      root.requestLayout()
      root.invalidate()
    }
  }

  fun onBackground() {
    root.removeCallbacks(redraw)
    needsDraw = true
  }

  fun onFocus(hasFocus: Boolean, runActive: Boolean) {
    root.removeCallbacks(redraw)
    if (!disposed && hasFocus && runActive && needsDraw) {
      // onResume may precede keyguard dismissal. Wait for window focus and the next animation frame.
      root.postOnAnimation(redraw)
    }
  }

  fun dispose() {
    disposed = true
    root.removeCallbacks(redraw)
  }
}
