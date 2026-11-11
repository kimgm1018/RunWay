package com.runway.watch.ui

import com.runway.watch.run.*
import com.runway.watch.ui.format.MetricFormat
import org.junit.Assert.*
import org.junit.Test

/** 9.5 pace coaching page (S15P31E105-257): guide, dummy badge, −/+ limits and the BPM change status. */
class PaceCoachingDisplayTest {
    private val guide = CoachingGuide(358, RhythmBpm(165), Coaching.cue(165, 170), dummy = true)

    private fun snapshot(
        bpm: Int? = 170, change: BpmChange? = null, pending: Boolean = false, coaching: CoachingGuide? = guide,
        state: RunState = RunState.RUNNING, lost: Boolean = false,
    ) = RunSnapshot(
        state = state, pendingCommand = pending, metrics = RunMetrics(rhythm = bpm?.let(::RhythmBpm)),
        bpmChange = change, coaching = coaching, serverLinkLost = lost,
    )

    @Test fun showsTheGuidePaceTargetRhythmCueAndDummyBadge() {
        val v = PaceCoachingDisplay.from(snapshot())
        assertEquals("5’58”", v.guidePace.value)
        assertEquals("165", v.targetRhythm.value)
        assertEquals("목표 리듬 165 BPM", v.targetRhythm.description)
        assertEquals("리듬 BPM 165로 조정", v.cue)
        assertTrue(v.dummy)
        assertEquals("170", v.currentRhythm.value)
        assertEquals("리듬 170 BPM", v.currentRhythm.description)
        assertNull(v.status)
        assertFalse(v.serverLost)
    }

    @Test fun withoutAGuideTheValuesAreMissingAndNoBadgeIsShown() {
        val v = PaceCoachingDisplay.from(snapshot(coaching = null))
        assertEquals(MetricFormat.MISSING, v.guidePace.value)
        assertTrue(v.targetRhythm.missing)
        assertNull(v.cue)
        assertFalse(v.dummy)
        assertTrue(v.canIncrease)
    }

    @Test fun theDummyBadgeFollowsTheGuide() {
        assertFalse(PaceCoachingDisplay.from(snapshot(coaching = guide.copy(dummy = false))).dummy)
        assertEquals(Coaching.DUMMY_GUIDE, CoachingGuide(358, RhythmBpm(165), "x").dummy)
    }

    @Test fun cueSentenceKeepsOrAdjusts() {
        assertEquals("현재 페이스·리듬 유지", Coaching.cue(170, 170))
        assertEquals("리듬 BPM 165로 조정", Coaching.cue(165, 170))
        assertEquals("리듬 BPM 170으로 조정", Coaching.cue(170, 165))
        assertEquals("리듬 BPM 163으로 조정", Coaching.cue(163, null))
        assertEquals("리듬 BPM 176으로 조정", Coaching.cue(176, 170))
        assertEquals("리듬 BPM 171로 조정", Coaching.cue(171, 170))
    }

    @Test fun buttonsStopAtTheLimitsAndWhileARequestOrCommandWaits() {
        assertFalse(PaceCoachingDisplay.from(snapshot(bpm = 60)).canDecrease)
        assertTrue(PaceCoachingDisplay.from(snapshot(bpm = 60)).canIncrease)
        assertFalse(PaceCoachingDisplay.from(snapshot(bpm = 220)).canIncrease)
        assertTrue(PaceCoachingDisplay.from(snapshot(bpm = 220)).canDecrease)

        val requesting = PaceCoachingDisplay.from(snapshot(change = BpmChange(RhythmBpm(171), BpmChangeStatus.REQUESTING)))
        assertFalse(requesting.canIncrease || requesting.canDecrease)
        val pending = PaceCoachingDisplay.from(snapshot(pending = true))
        assertFalse(pending.canIncrease || pending.canDecrease)
        val ended = PaceCoachingDisplay.from(snapshot(state = RunState.COMPLETED))
        assertFalse(ended.canIncrease || ended.canDecrease)
        val none = PaceCoachingDisplay.from(snapshot(bpm = null, coaching = null))
        assertFalse(none.canIncrease || none.canDecrease)
    }

    @Test fun statusSaysRequestedAppliedRejectedOrUnknown() {
        fun status(s: BpmChangeStatus) = PaceCoachingDisplay.from(snapshot(change = BpmChange(RhythmBpm(171), s))).status
        assertEquals("리듬 BPM 171 요청 중", status(BpmChangeStatus.REQUESTING))
        assertEquals("리듬 BPM 171 적용됨", status(BpmChangeStatus.APPLIED))
        assertEquals("리듬 BPM 171 변경 거절", status(BpmChangeStatus.REJECTED))
        assertEquals("리듬 BPM 171 적용 확인 불가", status(BpmChangeStatus.UNKNOWN))
    }

    @Test fun serverLinkLossIsShown() {
        assertTrue(PaceCoachingDisplay.from(snapshot(lost = true)).serverLost)
        assertEquals("서버 연결 끊김", PaceCoachingDisplay.SERVER_LOST)
    }

    @Test fun rhythmIsAlwaysLabelledSoItIsNotReadAsHeartRate() {
        assertEquals("♪︎ 리듬 BPM 172", PaceCoachingDisplay.rhythmLabel(RhythmBpm(172)))
        assertEquals("♪︎ 리듬 BPM ${MetricFormat.MISSING}", PaceCoachingDisplay.rhythmLabel(null))
        assertEquals("심박", MetricFormat.HEART_LABEL)
        assertEquals("리듬 BPM", MetricFormat.RHYTHM_LABEL)
    }
}
