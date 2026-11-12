package com.runway.health.watch

import android.Manifest
import android.app.Application
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.PowerManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [29, 34])
class RunForegroundServiceTest {
  @Test fun foregroundRunKeepsCpuAwakeWithoutKeepingScreenOn() {
    val controller = Robolectric.buildService(RunForegroundService::class.java).create()
    try {
      controller.startCommand(0, 1)
      val lock = ShadowPowerManager.getLatestWakeLock()
      assertNotNull("A foreground notification alone does not keep the CPU awake", lock)
      assertTrue(lock.isHeld)
      assertEquals(PowerManager.PARTIAL_WAKE_LOCK, ReflectionHelpers.getField<Int>(lock, "mFlags") and 0xffff)
    } finally {
      controller.destroy()
    }
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test fun repeatedStartsAndLocationTypeUpdatesShareOneLockReleasedAtEnd() {
    val controller = Robolectric.buildService(RunForegroundService::class.java).create()
    val service = controller.get()
    try {
      controller.startCommand(0, 1)
      val first = ShadowPowerManager.getLatestWakeLock()
      shadowOf(service).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
      service.onStartCommand(Intent(service, RunForegroundService::class.java)
        .putExtra(RunForegroundService.EXTRA_LOCATION, true), 0, 2)
      assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION, service.foregroundServiceType)
      controller.startCommand(0, 3)
      assertNotNull(first)
      assertSame(first, ShadowPowerManager.getLatestWakeLock())
      assertTrue(first.isHeld)
    } finally {
      controller.destroy()
    }
    assertFalse(ShadowPowerManager.getLatestWakeLock().isHeld)
  }

  @Test fun creatingServiceWithoutStartingRunDoesNotHoldCpu() {
    val controller = Robolectric.buildService(RunForegroundService::class.java).create()
    controller.destroy()
    assertNull(ShadowPowerManager.getLatestWakeLock())
  }

  @Test fun rejectedForegroundStartDoesNotAcquireCpuLock() {
    val controller = Robolectric.buildService(RunForegroundService::class.java).create()
    try {
      shadowOf(controller.get()).setThrowInStartForeground(SecurityException("denied"))
      assertThrows(SecurityException::class.java) { controller.startCommand(0, 1) }
      assertNull(ShadowPowerManager.getLatestWakeLock())
    } finally {
      controller.destroy()
    }
  }
}
