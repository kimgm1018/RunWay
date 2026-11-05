package com.runway.watch.ui

import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Standby buttons by the kind of request in flight (S15P31E105-436). */
class StandbyDisplayTest {
    private fun view(pending: RunIntent? = null, state: RunState = RunState.READY) =
        StandbyDisplay.from(RunSnapshot(state, pendingCommand = pending != null, pendingIntent = pending))

    @Test fun readyRunCanStartOrCancel() {
        val v = view()
        assertEquals("시작", v.startLabel)
        assertTrue(v.startEnabled)
        assertFalse(v.startCaption)
        assertEquals("취소", v.cancelLabel)
        assertTrue(v.cancelEnabled)
    }

    @Test fun pendingCancelShowsCancelCheckAndNeverStartCheck() {
        val v = view(RunIntent.CANCEL)
        assertEquals("취소 확인 중", v.cancelLabel)
        assertFalse(v.cancelEnabled)
        assertEquals("시작", v.startLabel)
        assertFalse(v.startEnabled)
        assertFalse(v.startCaption)
    }

    @Test fun pendingStartShowsStartCheckAndHidesCancel() {
        val v = view(RunIntent.START)
        assertEquals("시작 확인 중", v.startLabel)
        assertFalse(v.startEnabled)
        assertTrue(v.startCaption)
        assertNull(v.cancelLabel)
    }

    @Test fun otherOrUnknownPendingIsNotCalledAStart() {
        for (pending in listOf<RunIntent?>(null, RunIntent.END)) {
            val v = StandbyDisplay.from(RunSnapshot(RunState.READY, pendingCommand = true, pendingIntent = pending))
            assertEquals("확인 중", v.startLabel)
            assertFalse(v.startEnabled)
            assertNull(v.cancelLabel)
        }
    }

    @Test fun cancelIsOnlyOfferedForAReadyRun() {
        assertNull(view(state = RunState.CANCELLED).cancelLabel)
    }
}
