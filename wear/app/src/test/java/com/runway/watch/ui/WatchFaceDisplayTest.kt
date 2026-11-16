package com.runway.watch.ui

import com.runway.watch.run.ControlProblem
import com.runway.watch.run.ControlProblemKind
import com.runway.watch.run.FeedStatus
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.GroupPosition
import com.runway.watch.run.GroupStanding
import com.runway.watch.run.GroupStatus
import com.runway.watch.run.MetricFeeds
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunMetrics
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.ui.component.StatusKind
import com.runway.watch.ui.component.StatusLevel
import org.junit.Assert.*
import org.junit.Test

/** S15P31E105-613: what the confirmed watch design derives from the snapshot. */
class WatchFaceDisplayTest {
    @Test fun paceDotsCoverOnlyTheDrawnRange() {
        assertEquals(0f, PaceScale.fraction(480)!!, 0f)
        assertEquals(1f, PaceScale.fraction(240)!!, 0f)
        assertEquals(.5f, PaceScale.fraction(360)!!, .001f)
        assertNull(PaceScale.fraction(520))
        assertTrue(PaceScale.outOfRange(520))
        assertFalse(PaceScale.outOfRange(null))
    }

    @Test fun outOfRangeKeepsTheNumberAndDropsTheDots() {
        val view = RunStatusDisplay.from(RunSnapshot(RunState.RUNNING, metrics = RunMetrics(paceSecondsPerKm = 520)))
        assertEquals("8’40”", view.pace.text.value)
        assertNull(view.paceTicks)
        assertTrue(view.paceOutOfRange)
    }

    @Test fun lateLocationShowsNoDotsAndIsNotOutOfRange() {
        val late = RunSnapshot(RunState.RUNNING, metrics = RunMetrics(paceSecondsPerKm = 355, feeds = MetricFeeds(location = FeedStatus.DELAYED)))
        val view = RunStatusDisplay.from(late)
        assertNull(view.paceTicks)
        assertFalse(view.paceOutOfRange)
        assertEquals(RunStatusDisplay.LOCATION_LAST_PACE, RunStatusDisplay.locationLine(view))
        assertEquals(listOf(StatusKind.GPS to StatusLevel.CHECKING), RunStatusDisplay.statusItems(view).map { it.kind to it.level })
    }

    @Test fun onlyTheGoalDistanceFillsTheRim() {
        val rim = RunStatusDisplay.rim(RunStatusDisplay.from(RunSnapshot(RunState.RUNNING, metrics = RunMetrics(goalProgress = .4f))))
        assertEquals(.4f, rim.tl!!, 0f)
        // Goal time, heart rate and cadence have no contract or range yet: empty tracks.
        assertNull(rim.tr); assertNull(rim.bl); assertNull(rim.br)
        assertNull(RunStatusDisplay.rim(RunStatusDisplay.from(RunSnapshot(RunState.RUNNING))).tl)
    }

    @Test fun normalSourcesShowNoStatusIcon() {
        assertTrue(RunStatusDisplay.statusItems(RunStatusDisplay.from(RunSnapshot(RunState.RUNNING))).isEmpty())
        val lost = RunStatusDisplay.from(RunSnapshot(RunState.RUNNING, phoneConnected = false))
        assertEquals(listOf(StatusKind.PHONE to StatusLevel.PROBLEM), RunStatusDisplay.statusItems(lost).map { it.kind to it.level })
    }

    @Test fun rhythmDotsUseTheDesignRange() {
        assertEquals(.5f, BpmScale.fraction(170)!!, .001f)
        assertNull(BpmScale.fraction(200))
    }

    @Test fun startFailedOnlyForARefusedOrRejectedStart() {
        val ready = RunSnapshot(RunState.READY)
        assertTrue(StandbyDisplay.startFailed(ready.copy(problem = ControlProblem(ControlProblemKind.REFUSED, RunIntent.START))))
        assertTrue(StandbyDisplay.startFailed(ready.copy(problem = ControlProblem(ControlProblemKind.REJECTED, RunIntent.START))))
        assertFalse(StandbyDisplay.startFailed(ready.copy(problem = ControlProblem(ControlProblemKind.REFUSED, RunIntent.CANCEL))))
        assertFalse(StandbyDisplay.startFailed(ready.copy(problem = ControlProblem(ControlProblemKind.UNCONFIRMED, RunIntent.START))))
        assertFalse(StandbyDisplay.startFailed(ready.copy(problem = ControlProblem(ControlProblemKind.REFUSED, RunIntent.START), pendingCommand = true)))
    }

    @Test fun aSharedRankCountsTheTiedRunners() {
        fun standing(rankedCount: Int?) = GroupRunDisplay.position(RunSnapshot(RunState.RUNNING, RunMode.GROUP, group = GroupStatus(
            GroupPhase.RUNNING, 340, GroupPosition.Known(GroupStanding(rank = 3, aheadCount = 2, behindCount = 4)), rankedCount = rankedCount,
        ))) as GroupPositionView.Standing
        assertEquals(2, standing(8).tie)
        assertNull(standing(7).tie)
        assertNull(standing(null).tie)
    }
}
