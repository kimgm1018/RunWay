package com.runway.watch.ui

import com.runway.watch.run.*
import com.runway.watch.ui.format.MetricFormat
import org.junit.Assert.*
import org.junit.Test

/** Synthetic G10-shaped samples; no real ranking, pace calculation or delivery is involved. */
class GroupRunDisplayTest {
    private val standing = GroupStanding(rank = 2, aheadCount = 1, behindCount = 2, gapToAheadMeters = 35.0, gapToBehindMeters = 20.0)

    private fun snapshot(
        group: GroupStatus? = GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Known(standing)),
        metrics: RunMetrics = RunMetrics(paceSecondsPerKm = 342),
        phoneConnected: Boolean = true,
    ) = RunSnapshot(RunState.RUNNING, RunMode.GROUP, phoneConnected = phoneConnected, metrics = metrics, group = group)

    private fun standing(s: RunSnapshot) = GroupRunDisplay.position(s) as GroupPositionView.Standing

    private fun message(s: RunSnapshot) = (GroupRunDisplay.position(s) as GroupPositionView.Message).message

    @Test fun showsRankCountsAndGapsSeparately() {
        val v = standing(snapshot())
        assertEquals("2위", v.rank)
        assertEquals("현재 2위", v.rankDescription)
        assertEquals("/ 4명", v.total)
        assertEquals(GroupSide("앞 1명", "↑ 35m", "앞서 달리는 1명, 바로 앞 사람과 35미터"), v.ahead)
        assertEquals(GroupSide("뒤 2명", "↓ 20m", "뒤따르는 2명, 바로 뒤 사람과 20미터"), v.behind)
        assertFalse(v.delayed)
    }

    @Test fun leaderHasNobodyAheadAndNoGapThere() {
        val v = standing(snapshot(GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Known(
            GroupStanding(rank = 1, aheadCount = 0, behindCount = 3, gapToBehindMeters = 1234.0)))))
        assertEquals("1위", v.rank)
        assertEquals(GroupSide("앞 0명", null, "앞서 달리는 사람 없음"), v.ahead)
        assertEquals("↓ 1.23km", v.behind.gap)
    }

    @Test fun missingFieldsAreNeverFilledIn() {
        val v = standing(snapshot(GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Known(
            GroupStanding(aheadCount = 2, gapToAheadMeters = Double.NaN)))))
        assertEquals(MetricFormat.MISSING, v.rank)
        assertEquals("순위 없음", v.rankDescription)
        assertNull("no total without both counts", v.total)
        assertEquals("↑ ${MetricFormat.MISSING}", v.ahead.gap)
        assertEquals("뒤 ${MetricFormat.MISSING}", v.behind.count)
        assertNull(v.behind.gap)
    }

    @Test fun noStandingYetOrUnrankableShowsNoRank() {
        assertEquals("순위를 기다려요", message(snapshot(GroupStatus(GroupPhase.RUNNING, 340))).title)
        assertEquals("순위를 기다려요", message(snapshot(group = null)).title)
        val unavailable = message(snapshot(GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Unavailable)))
        assertEquals("순위를 계산할 수\n없어요", unavailable.title)
        // 9.8d: a server that cannot rank is not the runner's fault, so it is not a warning.
        assertFalse(unavailable.warning)
    }

    @Test fun lostLocationDropsTheLastStanding() {
        for (feed in listOf(FeedStatus.NO_SIGNAL, FeedStatus.STOPPED)) {
            val m = message(snapshot(metrics = RunMetrics(feeds = MetricFeeds(location = feed))))
            assertEquals(feed.name, "내 진행 데이터가\n없어요", m.title)
        }
    }

    @Test fun lateDataIsMarkedNotShownAsCurrent() {
        val cases = listOf(
            snapshot(GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Known(standing, delayed = true))),
            snapshot(metrics = RunMetrics(feeds = MetricFeeds(location = FeedStatus.DELAYED))),
            snapshot(phoneConnected = false),
        )
        for (s in cases) {
            val v = standing(s)
            assertTrue(v.delayed)
            assertEquals("현재 2위, 지연", v.rankDescription)
            assertTrue(v.ahead.description.endsWith(", 지연"))
        }
    }

    @Test fun sharedPaceComparesWithOwnLivePace() {
        val v = GroupRunDisplay.pace(snapshot()) as GroupPaceView.Pace
        assertEquals("5’40”", v.pace.value)
        assertEquals("공동 페이스 킬로미터당 5분 40초", v.pace.description)
        assertEquals("내 5’42” · +2”", v.mine!!.text)
        assertEquals("내 페이스 킬로미터당 5분 42초, 공동 페이스보다 2초 느림", v.mine!!.description)
        assertEquals("내 5’30” · −10”", (GroupRunDisplay.pace(snapshot(metrics = RunMetrics(paceSecondsPerKm = 330))) as GroupPaceView.Pace).mine!!.text)
        assertNull(v.change)
    }

    @Test fun ownPaceIsLeftOutWhileNotLive() {
        val delayed = snapshot(metrics = RunMetrics(paceSecondsPerKm = 342, feeds = MetricFeeds(location = FeedStatus.DELAYED)))
        assertNull((GroupRunDisplay.pace(delayed) as GroupPaceView.Pace).mine)
        assertNull((GroupRunDisplay.pace(snapshot(metrics = RunMetrics())) as GroupPaceView.Pace).mine)
    }

    @Test fun noSharedPaceWaitsInsteadOfGuessing() {
        val v = GroupRunDisplay.pace(snapshot(GroupStatus(GroupPhase.RUNNING, null, GroupPosition.Known(standing))))
        assertEquals("공동 페이스를 기다려요", (v as GroupPaceView.Message).message.title)
        assertTrue(GroupRunDisplay.pace(snapshot(group = null)) is GroupPaceView.Message)
    }

    @Test fun paceChangeShowsOnThePacePage() {
        val changed = snapshot(GroupStatus(GroupPhase.RUNNING, 355, GroupPosition.Known(standing), notice = GroupNotice.PaceChanged(340, 355)))
        assertEquals("이전 5’40” → 새 5’55”", (GroupRunDisplay.pace(changed) as GroupPaceView.Pace).change!!.text)
        assertNull("no spread without the group value", standing(changed).spread)
    }

    @Test fun leaderToLastSpreadIsTheGroupsValue() {
        val spread = GroupStatus(GroupPhase.RUNNING, 340, GroupPosition.Known(standing), leaderToLastGapMeters = 180.0)
        assertEquals(GroupLine("선두–후미 180m", "선두와 후미 간격 180미터"), standing(snapshot(spread)).spread)
        assertNull((GroupRunDisplay.pace(snapshot(spread)) as GroupPaceView.Pace).change)

        // Not this runner's value, so it stays while their own rank cannot be shown.
        val noRank = snapshot(spread.copy(position = GroupPosition.Unavailable))
        assertEquals("선두–후미 180m", (GroupRunDisplay.position(noRank) as GroupPositionView.Message).spread!!.text)
        val noLocation = snapshot(spread, metrics = RunMetrics(feeds = MetricFeeds(location = FeedStatus.NO_SIGNAL)))
        assertEquals("선두–후미 180m", (GroupRunDisplay.position(noLocation) as GroupPositionView.Message).spread!!.text)

        assertEquals("선두와 후미 간격 180미터, 지연", standing(snapshot(spread, phoneConnected = false)).spread!!.description)
        assertNull(standing(snapshot(spread.copy(leaderToLastGapMeters = Double.NaN))).spread)
    }

    @Test fun groupEndsStopRankAndForcedEndIsNotAFinish() {
        val forced = snapshot(GroupStatus(GroupPhase.FORCE_FINISHED, 340, GroupPosition.Known(standing)))
        val m = message(forced)
        assertEquals("그룹장이 그룹런을\n종료했어요", m.title)
        assertTrue(m.warning)
        assertFalse(m.title.contains("완주") || m.description.contains("완주") || m.description.contains("달성"))
        assertTrue(GroupRunDisplay.pace(forced) is GroupPaceView.Message)

        val finished = snapshot(GroupStatus(GroupPhase.FINISHED, 340, GroupPosition.Known(standing)))
        assertEquals("그룹런이 끝났어요", message(finished).title)
    }

    @Test fun groupStateNeverChangesTheRunnersOwnValues() {
        val before = RunStatusDisplay.from(snapshot())
        val after = RunStatusDisplay.from(snapshot(GroupStatus(GroupPhase.FORCE_FINISHED, 355, GroupPosition.Unavailable)))
        assertEquals(before, after)
    }
}
