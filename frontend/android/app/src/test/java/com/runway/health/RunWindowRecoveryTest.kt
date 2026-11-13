package com.runway.health

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Looper
import android.view.View
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [29, 34])
class RunWindowRecoveryTest {
  private class DrawingView(context: Context) : View(context) {
    // A plain Robolectric Activity keeps its window GONE. Supply the visible native-window boundary explicitly.
    override fun getWindowVisibility() = View.VISIBLE
    var traversals = 0
    var invalidations = 0
    override fun requestLayout() {
      super.requestLayout()
      traversals++
    }
    override fun invalidate() {
      super.invalidate()
      invalidations++
    }
  }

  @Test fun aRunReturningFromScreenOffGetsAFreshDrawWithoutReplacingItsViews() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().visible().windowFocusChanged(true)
    try {
      val content = DrawingView(activity.get())
      activity.get().setContentView(content)
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
      content.traversals = 0
      content.invalidations = 0
      assertTrue(content.isAttachedToWindow)
      assertEquals("The resumed activity window must be visible", View.VISIBLE, content.windowVisibility)
      val recovery = RunWindowRecovery(content)
      recovery.onBackground()
      recovery.onFocus(false, true)
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(50))
      assertEquals(0, content.invalidations)
      recovery.onFocus(true, true)
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
      assertTrue("Focus must request a traversal for the replacement surface", content.traversals > 0)
      assertTrue("Focus must invalidate the existing view", content.invalidations > 0)
      assertSame(content, activity.get().findViewById<View>(android.R.id.content).let { (it as android.view.ViewGroup).getChildAt(0) })
      recovery.dispose()
    } finally {
      activity.pause().stop().destroy()
    }
  }

  @Test fun destroyCancelsThePendingDrawRequest() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().visible().windowFocusChanged(true)
    try {
      val root = DrawingView(activity.get())
      activity.get().setContentView(root)
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
      root.traversals = 0
      root.invalidations = 0
      val recovery = RunWindowRecovery(root)
      recovery.onBackground()
      recovery.onFocus(true, true)
      recovery.dispose()
      shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
      assertEquals(0, root.traversals)
      assertEquals(0, root.invalidations)
    } finally {
      activity.pause().stop().destroy()
    }
  }
}
