package com.runway.watch.session

import androidx.wear.ongoing.SerializationHelper
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** S15P31E105-617: the run is an Ongoing Activity only while this watch records it. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RunOngoingTest {
    @Test fun runningAndPausedAreOngoing() {
        assertEquals(OngoingRun.RUNNING, OngoingRun.of(RunSnapshot(RunState.RUNNING)))
        assertEquals(OngoingRun.PAUSED, OngoingRun.of(RunSnapshot(RunState.PAUSED)))
    }

    @Test fun otherStatesAreNotOngoing() {
        listOf(null, RunState.READY, RunState.COMPLETED, RunState.CANCELLED, RunState.INTERRUPTED).forEach {
            assertEquals("$it", OngoingRun.NONE, OngoingRun.of(RunSnapshot(it)))
        }
    }

    @Test fun handOverAndLostMeasurementEndTheOngoingRun() {
        assertEquals(OngoingRun.NONE, OngoingRun.of(RunSnapshot(RunState.RUNNING, phoneRecording = true)))
        assertEquals(OngoingRun.NONE, OngoingRun.of(RunSnapshot(RunState.PAUSED, measurementLost = true)))
    }

    @Test fun notificationCarriesOngoingActivityOnlyForAnOngoingRun() {
        val context = RuntimeEnvironment.getApplication()
        val running = RunNotification.build(context, OngoingRun.RUNNING)
        assertTrue(SerializationHelper.hasOngoingActivity(running))
        assertFalse(SerializationHelper.hasOngoingActivity(RunNotification.build(context, OngoingRun.NONE)))
    }
}
