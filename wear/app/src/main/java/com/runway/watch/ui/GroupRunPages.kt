package com.runway.watch.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.run.*
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import kotlin.math.abs

/** A line of text with what TalkBack reads for it. */
data class GroupLine(val text: String, val description: String)

/** No value to show (waiting, missing, ended); never a made-up rank, gap or pace. */
data class GroupMessage(val title: String, val description: String, val warning: Boolean = false)

sealed interface GroupPaceView {
    /**
     * 9.7: the shared guide pace as delivered. [mine] compares it with the runner's live pace and is
     * null while that pace is not live; [change] is the server's pace change notice.
     */
    data class Pace(val pace: MetricText, val mine: GroupLine?, val change: GroupLine?) : GroupPaceView
    data class Message(val message: GroupMessage) : GroupPaceView
}

/** One side of the runner: how many run ahead (or behind) and how far the nearest one is. */
data class GroupSide(val count: String, val gap: String?, val description: String)

sealed interface GroupPositionView {
    /** 9.8 with the server's standing. [delayed] values are the last ones received and are dimmed. */
    data class Standing(
        val rank: String,
        val rankDescription: String,
        val total: String?,
        val ahead: GroupSide,
        val behind: GroupSide,
        val delayed: Boolean,
        val spread: GroupLine?,
    ) : GroupPositionView
    data class Message(val message: GroupMessage, val spread: GroupLine? = null) : GroupPositionView
}

/**
 * Derives 9.7 / 9.8 from the snapshot only. Rank, gaps and the shared pace come from the server
 * (G10, GRP-004·008); the watch never ranks runners or computes a pace itself.
 */
object GroupRunDisplay {
    fun status(snapshot: RunSnapshot): GroupStatus = snapshot.group ?: GroupStatus()

    fun pace(snapshot: RunSnapshot): GroupPaceView {
        val group = status(snapshot)
        ended(group)?.let { return GroupPaceView.Message(it) }
        val shared = MetricFormat.pace(group.guidePaceSecondsPerKm)
        val change = (group.notice as? GroupNotice.PaceChanged)?.let(::change)
        if (shared.missing) return GroupPaceView.Message(GroupMessage("공동 페이스를 기다려요", "받는 대로\n바로 보여 드려요"))
        return GroupPaceView.Pace(shared.copy(description = "공동 ${shared.description}"), mine(snapshot, group.guidePaceSecondsPerKm!!), change)
    }

    fun position(snapshot: RunSnapshot): GroupPositionView {
        val group = status(snapshot)
        ended(group)?.let { return GroupPositionView.Message(it) }
        val location = snapshot.metrics.feeds.location
        if (location == FeedStatus.NO_SIGNAL || location == FeedStatus.STOPPED) return GroupPositionView.Message(
            GroupMessage("위치를 받지 못하고 있어요", "순위와 거리 차이를\n잠시 표시하지 않아요", warning = true), spread(group, !snapshot.phoneConnected))
        return when (val p = group.position) {
            GroupPosition.Waiting -> GroupPositionView.Message(GroupMessage("순위를 기다려요", "받는 대로\n바로 보여 드려요"), spread(group, !snapshot.phoneConnected))
            GroupPosition.Unavailable ->
                GroupPositionView.Message(GroupMessage("순위를 알 수 없어요", "러닝은 계속 기록돼요", warning = true), spread(group, !snapshot.phoneConnected))
            is GroupPosition.Known -> {
                // Own location only dims this runner's standing; the spread is the server's group value.
                val late = p.delayed || !snapshot.phoneConnected
                standing(p.standing, late || location == FeedStatus.DELAYED, spread(group, late))
            }
        }
    }

    /** Group ends are told apart: a forced end is the leader's call, never a completed goal. */
    private fun ended(group: GroupStatus): GroupMessage? = when (group.phase) {
        GroupPhase.FINISHED -> GroupMessage("그룹런이 끝났어요", "모두 달리기를 마쳤어요")
        GroupPhase.FORCE_FINISHED -> GroupMessage("그룹장이 그룹런을\n종료했어요", "종료 시점까지의\n기록만 반영돼요", warning = true)
        // These pages exist only while this runner runs, so a group still reported as waiting is just
        // late news: the values wait for it rather than claim the group has not left.
        GroupPhase.WAITING, GroupPhase.RUNNING -> null
    }

    private fun mine(snapshot: RunSnapshot, shared: Int): GroupLine? {
        if (snapshot.metrics.feeds.location != FeedStatus.LIVE) return null
        val own = MetricFormat.pace(snapshot.metrics.paceSecondsPerKm)
        if (own.missing) return null
        val diff = snapshot.metrics.paceSecondsPerKm!! - shared
        val seconds = abs(diff)
        val amount = if (seconds < 60) "${seconds}″" else "%d′%02d″".format(seconds / 60, seconds % 60)
        val spoken = (if (seconds >= 60) "${seconds / 60}분 " else "") + "${seconds % 60}초"
        return when {
            diff > 0 -> GroupLine("내 ${own.value} · +$amount", "내 ${own.description}, 공동 페이스보다 $spoken 느림")
            diff < 0 -> GroupLine("내 ${own.value} · −$amount", "내 ${own.description}, 공동 페이스보다 $spoken 빠름")
            else -> GroupLine("내 ${own.value} · 같음", "내 ${own.description}, 공동 페이스와 같음")
        }
    }

    private fun change(notice: GroupNotice.PaceChanged): GroupLine? {
        val from = MetricFormat.pace(notice.fromSecondsPerKm)
        val to = MetricFormat.pace(notice.toSecondsPerKm)
        if (from.missing || to.missing) return null
        return GroupLine("${from.value} → ${to.value} 변경", "공동 페이스 변경, ${from.description}에서 ${to.description}로")
    }

    /** First-to-last distance of the whole group; shown in every running state since it is not this runner's. */
    private fun spread(group: GroupStatus, delayed: Boolean): GroupLine? =
        group.leaderToLastGapMeters?.takeIf { !it.isNaN() && it >= 0 }?.let {
            GroupLine("선두–후미 ${meters(it)}", "선두와 후미 간격 ${spokenMeters(it)}" + if (delayed) ", 지연" else "")
        }

    private fun standing(s: GroupStanding, delayed: Boolean, spread: GroupLine?): GroupPositionView.Standing {
        val rank = s.rank?.takeIf { it > 0 }
        val ahead = s.aheadCount?.takeIf { it >= 0 }
        val behind = s.behindCount?.takeIf { it >= 0 }
        val late = if (delayed) ", 지연" else ""
        return GroupPositionView.Standing(
            rank = rank?.let { "${it}위" } ?: MetricFormat.MISSING,
            rankDescription = (rank?.let { "현재 ${it}위" } ?: "순위 없음") + late,
            // Only when both counts arrived; the watch does not guess the number of runners.
            total = if (ahead != null && behind != null) "/ ${ahead + behind + 1}명" else null,
            ahead = side("앞", "앞서 달리는", "↑", ahead, s.gapToAheadMeters, late),
            behind = side("뒤", "뒤따르는", "↓", behind, s.gapToBehindMeters, late),
            delayed = delayed,
            spread = spread,
        )
    }

    /** Nobody on that side has no gap at all; someone there without a delivered gap is "– –". */
    private fun side(short: String, long: String, arrow: String, count: Int?, gapMeters: Double?, late: String): GroupSide {
        if (count == null) return GroupSide("$short ${MetricFormat.MISSING}", null, "$short 인원 정보 없음$late")
        if (count == 0) return GroupSide("$short 0명", null, "$long 사람 없음$late")
        val valid = gapMeters?.takeIf { !it.isNaN() && it >= 0 }
        return GroupSide(
            "$short ${count}명", "$arrow ${valid?.let(::meters) ?: MetricFormat.MISSING}",
            "$long ${count}명, 바로 $short 사람과 " + (valid?.let(::spokenMeters) ?: "거리 없음") + late,
        )
    }

    private fun meters(value: Double): String =
        if (value < 1000) "${value.toLong()}m" else "${MetricFormat.distance(value).value}km"

    private fun spokenMeters(value: Double): String =
        if (value < 1000) "${value.toLong()}미터" else "${MetricFormat.distance(value).value}킬로미터"
}

/** 9.7: the shared guide pace is the same for everyone; the rhythm BPM fits the runner's own stride. */
@Composable
internal fun GroupPacePage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean) {
    RoundScreen(spacing = 3.dp, focused = visible) {
        Text("그룹 공동 페이스", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
        when (val view = GroupRunDisplay.pace(snapshot)) {
            is GroupPaceView.Pace -> {
                MetricValue(view.pace, 40)
                view.mine?.let { Line(it, RunwayColors.ContentSecondary) }
                view.change?.let { Line(it, RunwayColors.Content, announce = true) }
                val rhythm = MetricFormat.rhythm(snapshot.metrics.rhythm)
                Chip("${rhythm.symbol}︎ ${rhythm.value} ${rhythm.unit} · 내 보폭 맞춤", description = "${rhythm.description}, 내 보폭 맞춤")
            }
            is GroupPaceView.Message -> MessageBody(view.message)
        }
        PageIndicator(count, index)
    }
}

/** 9.8: rank and the runners just ahead and behind, as the server ranked them (GRP-008). */
@Composable
internal fun GroupPositionPage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean) {
    RoundScreen(spacing = 3.dp, focused = visible) {
        Text("그룹 위치", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
        when (val view = GroupRunDisplay.position(snapshot)) {
            is GroupPositionView.Standing -> StandingBody(view)
            is GroupPositionView.Message -> {
                MessageBody(view.message)
                view.spread?.let { Line(it, RunwayColors.ContentSecondary) }
            }
        }
        PageIndicator(count, index)
    }
}

@Composable
private fun ColumnScope.StandingBody(view: GroupPositionView.Standing) {
    val color = if (view.delayed) RunwayColors.ContentSecondary else RunwayColors.Content
    Row(
        Modifier.clearAndSetSemantics { contentDescription = view.rankDescription },
        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom,
    ) {
        Text(view.rank, style = RunwayType.number(40), color = if (view.rank == MetricFormat.MISSING) RunwayColors.ContentDim else color)
        view.total?.let { Text(it, Modifier.padding(bottom = 6.dp), style = RunwayType.Body, color = RunwayColors.ContentSecondary) }
    }
    if (view.delayed) Text("순위 지연", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Side(view.ahead, color)
        Side(view.behind, color)
    }
    view.spread?.let { Line(it, RunwayColors.ContentSecondary) }
}

@Composable
private fun Side(side: GroupSide, color: Color) {
    Column(Modifier.clearAndSetSemantics { contentDescription = side.description }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(side.count, style = RunwayType.Body, color = color, maxLines = 1)
        side.gap?.let { Text(it, style = RunwayType.number(13), color = color, maxLines = 1) }
    }
}

/** Notices are read out once by TalkBack when they change; they stay in the page, not a separate inbox. */
@Composable
private fun Line(line: GroupLine, color: Color, announce: Boolean = false) {
    Text(
        line.text,
        Modifier.semantics {
            contentDescription = line.description
            if (announce) liveRegion = LiveRegionMode.Polite
        },
        style = RunwayType.number(12), color = color,
        textAlign = TextAlign.Center, maxLines = 1,
    )
}

@Composable
private fun MessageBody(message: GroupMessage) {
    Text(message.title, style = RunwayType.Title, color = if (message.warning) RunwayColors.Warning else RunwayColors.Content,
        textAlign = TextAlign.Center)
    // Korean wraps per syllable by default, so the copy breaks between words explicitly.
    Text(message.description, style = RunwayType.Body, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center)
}
