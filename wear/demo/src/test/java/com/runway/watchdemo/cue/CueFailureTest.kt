package com.runway.watchdemo.cue

import android.app.Application
import com.runway.watchdemo.session.CueSettings
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CueFailureTest {
    @Test fun audioConstructionFailureIsReportedWithoutEscapingWorker() {
        val errors = CountDownLatch(1)
        val player = WatchCuePlayer(RuntimeEnvironment.getApplication(), createAudio = { error("audio unavailable") })
        try {
            player.start(CueSettings(vibrationEnabled = false), { fail("cue must not start") }, { errors.countDown() })
            assertTrue("audio constructor errors must reach controller", errors.await(3, TimeUnit.SECONDS))
        } finally { player.close() }
    }
}
