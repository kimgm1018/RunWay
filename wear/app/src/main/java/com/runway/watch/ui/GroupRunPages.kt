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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.wear.compose.material3.Text
import com.runway.watch.run.*
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import com.runway.watch.ui.theme.HeroSize
import com.runway.watch.ui.theme.px
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
    data class Pace(
        val pace: MetricText,
        val mine: GroupLine?,
        val change: GroupLine?,
        /** The leader's widened-group notice (S15P31E105-629); null for other runners or while the group is close. */
        val gap: GroupLine? = null,
    ) : GroupPaceView
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
        /** Runners sharing this rank, this runner included (9.8b); null when not tied or unknown. */
        val tie: Int? = null,
        /** The leader's widened-group notice (S15P31E105-629); shown in place of [spread], which it includes. */
        val gap: GroupLine? = null,
    ) : GroupPositionView
    data class Message(val message: GroupMessage, val spread: GroupLine? = null, val gap: GroupLine? = null) : GroupPositionView
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
        return GroupPaceView.Pace(
            shared.copy(description = "공동 ${shared.description}"), mine(snapshot, group.guidePaceSecondsPerKm!!), change, group.gapNotice?.let(::gap),
        )
    }

    fun position(snapshot: RunSnapshot): GroupPositionView {
        val group = status(snapshot)
        ended(group)?.let { return GroupPositionView.Message(it) }
        val location = snapshot.metrics.feeds.location
        val gap = group.gapNotice?.let(::gap)
        if (location == FeedStatus.NO_SIGNAL || location == FeedStatus.STOPPED) return GroupPositionView.Message(
            GroupMessage("내 진행 데이터가\n없어요", "지금은 순위에서 빠져 있어요", warning = true), spread(group, !snapshot.phoneConnected), gap)
        return when (val p = group.position) {
            GroupPosition.Waiting -> GroupPositionView.Message(GroupMessage("순위를 기다려요", "받는 대로\n바로 보여 드려요"), spread(group, !snapshot.phoneConnected), gap)
            GroupPosition.Unavailable ->
                GroupPositionView.Message(GroupMessage("순위를 계산할 수\n없어요", "순위·간격 정보를 받지 못했어요"), spread(group, !snapshot.phoneConnected), gap)
            is GroupPosition.Known -> {
                // Own location only dims this runner's standing; the spread is the server's group value.
                val late = p.delayed || !snapshot.phoneConnected
                standing(p.standing, late || location == FeedStatus.DELAYED, spread(group, late), group.rankedCount).copy(gap = gap)
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
        val amount = if (seconds < 60) "${seconds}”" else "%d’%02d”".format(seconds / 60, seconds % 60)
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
        return GroupLine("이전 ${from.value} → 새 ${to.value}", "공동 페이스 변경, ${from.description}에서 ${to.description}로")
    }

    /** The leader's widened-group notice (S15P31E105-629): who is at the back when known, else a generic line. */
    private fun gap(notice: GroupNotice.GapWidened): GroupLine {
        val distance = meters(notice.meters.toDouble())
        val spoken = spokenMeters(notice.meters.toDouble())
        return notice.memberName?.let {
            GroupLine("${it}님이 뒤처졌어요 ($distance)", "그룹 간격 알림, ${it}님이 뒤처졌어요, 선두와 후미 $spoken")
        } ?: GroupLine("그룹이 벌어졌어요 ($distance)", "그룹 간격 알림, 그룹이 벌어졌어요, 선두와 후미 $spoken")
    }

    /** First-to-last distance of the whole group; shown in every running state since it is not this runner's. */
    private fun spread(group: GroupStatus, delayed: Boolean): GroupLine? =
        group.leaderToLastGapMeters?.takeIf { !it.isNaN() && it >= 0 }?.let {
            GroupLine("선두–후미 ${meters(it)}", "선두와 후미 간격 ${spokenMeters(it)}" + if (delayed) ", 지연" else "")
        }

    private fun standing(s: GroupStanding, delayed: Boolean, spread: GroupLine?, rankedCount: Int? = null): GroupPositionView.Standing {
        val rank = s.rank?.takeIf { it > 0 }
        val ahead = s.aheadCount?.takeIf { it >= 0 }
        val behind = s.behindCount?.takeIf { it >= 0 }
        val late = if (delayed) ", 지연" else ""
        return GroupPositionView.Standing(
            rank = rank?.let { "${it}위" } ?: MetricFormat.MISSING,
            rankDescription = (rank?.let { "현재 ${it}위" } ?: "순위 없음") + late,
            // The ranked runners the phone counted from G10; without it only when both counts arrived (a tie counts
            // neither ahead nor behind, so that is a lower bound). The watch does not guess the number of runners.
            total = when {
                ahead != null && behind != null -> "/ ${maxOf(rankedCount ?: 0, ahead + behind + 1)}명"
                rankedCount != null -> "/ ${rankedCount}명"
                else -> null
            },
            ahead = side("앞", "앞서 달리는", "↑", ahead, s.gapToAheadMeters, late),
            behind = side("뒤", "뒤따르는", "↓", behind, s.gapToBehindMeters, late),
            delayed = delayed,
            spread = spread,
            // Runners at one distance share a rank and count neither ahead nor behind (G10), so the ones left over
            // from the ranked count are this runner's tie.
            tie = if (rank != null && ahead != null && behind != null && rankedCount != null)
                (rankedCount - ahead - behind).takeIf { it > 1 } else null,
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

/**
 * 9.7 공동 페이스: the group's shared guide pace as the key number and the server's change notice. The runner's own
 * rhythm BPM fits their stride and lives on the status page; the update time is left out until the server sends one.
 */
@Composable
internal fun GroupPacePage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onPause: () -> Unit = {}) {
    val status = RunStatusDisplay.from(snapshot)
    WatchFace(rim = RunStatusDisplay.rim(status), pages = PageDots(count, index), handle = pauseHandle(status, onPause), focused = visible) {
        when (val view = GroupRunDisplay.pace(snapshot)) {
            is GroupPaceView.Pace -> {
                Caption("공동 페이스")
                HeroMetric(view.pace, HeroSize.PACE, unit = null)
                view.change?.let { Line(it, RunwayColors.Content, announce = true, strong = true) }
                // S15P31E105-629: the leader's widened-group notice takes the own-pace line's place to fit the face.
                view.gap?.let { Line(it, RunwayColors.Warning, announce = true, strong = true) }
                    ?: view.mine?.let { Line(it, RunwayColors.ContentSecondary) }
            }
            is GroupPaceView.Message -> MessageBody(view.message, "공동 페이스")
        }
    }
}

/**
 * 9.8 진행 순서·간격: rank and the gaps to the runners just ahead and behind, as the server ranked them (GRP-008). A gap
 * is the difference in course progress, not a straight-line or map distance.
 */
@Composable
internal fun GroupPositionPage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onPause: () -> Unit = {}) {
    val status = RunStatusDisplay.from(snapshot)
    WatchFace(rim = RunStatusDisplay.rim(status), pages = PageDots(count, index), handle = pauseHandle(status, onPause), focused = visible) {
        when (val view = GroupRunDisplay.position(snapshot)) {
            is GroupPositionView.Standing -> StandingBody(view)
            is GroupPositionView.Message -> {
                val location = snapshot.metrics.feeds.location
                val ended = GroupRunDisplay.status(snapshot).phase.let { it == GroupPhase.FINISHED || it == GroupPhase.FORCE_FINISHED }
                val noMe = !ended && (location == FeedStatus.NO_SIGNAL || location == FeedStatus.STOPPED)
                if (noMe) StatusIcons(listOf(StatusItem(StatusKind.GPS, StatusLevel.PROBLEM, "위치 수신 없음")))
                MessageBody(view.message, if (noMe) null else "진행 순서")
                view.gap?.let { Line(it, RunwayColors.Warning, announce = true, strong = true) }
                    ?: view.spread?.let { Line(it, RunwayColors.ContentSecondary) }
            }
        }
    }
}

@Composable
private fun StandingBody(view: GroupPositionView.Standing) {
    // A late standing is the last one received: marked and grey, never shown as current (9.8c). The time it was
    // last confirmed needs a server timestamp, which G10 does not carry yet.
    if (view.delayed) StatusChip("순위 갱신 지연")
    Row(
        Modifier.clearAndSetSemantics { contentDescription = view.rankDescription + (view.total?.let { ", 전체 ${it.removePrefix("/ ")}" } ?: "") },
        verticalAlignment = Alignment.Bottom,
    ) {
        val number = view.rank.removeSuffix("위")
        // One step smaller when a chip has to fit above or below it (9.8b, 9.8c).
        HeroNumber(number, if (view.delayed || view.tie != null) HeroSize.PACE else HeroSize.forText(number).coerceAtMost(HeroSize.SHORT), view.rankDescription,
            color = if (view.delayed || view.rank == MetricFormat.MISSING) RunwayColors.ContentDim else RunwayColors.Primary)
        Text((if (view.rank == MetricFormat.MISSING) "" else "위 ") + (view.total ?: ""), Modifier.padding(start = px(6), bottom = px(16)),
            style = RunwayType.number(36), color = RunwayColors.ContentSecondary, maxLines = 1)
    }
    view.tie?.let { StatusChip("공동 순위 · ${it}명") }
    CellRow {
        SideCell(view.ahead, "바로 앞", view.delayed)
        SideCell(view.behind, "바로 뒤", view.delayed)
    }
    // S15P31E105-629: the leader's widened-group notice includes the first-to-last distance, so it replaces that line.
    view.gap?.let { Line(it, RunwayColors.Warning, announce = true, strong = true) }
        ?: view.spread?.let { Line(it, RunwayColors.ContentSecondary) }
}

/** Gap to the nearest runner on one side; nobody there reads 없음, someone without a delivered gap "– –". */
@Composable
private fun SideCell(side: GroupSide, label: String, delayed: Boolean) {
    val value = side.gap?.substringAfter(' ') ?: if (side.count.endsWith(" 0명")) "없음" else MetricFormat.MISSING
    ValueCell(value, label, side.description, valueColor = if (delayed) RunwayColors.ContentDim else RunwayColors.Content)
}

/** Notices are read out once by TalkBack when they change; they stay in the page, not a separate inbox. */
@Composable
private fun Line(line: GroupLine, color: Color, announce: Boolean = false, strong: Boolean = false) {
    Text(
        line.text,
        Modifier.semantics {
            contentDescription = line.description
            if (announce) liveRegion = LiveRegionMode.Polite
        },
        style = RunwayType.number(if (strong) 32 else 28, if (strong) FontWeight.Bold else FontWeight.SemiBold), color = color,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun MessageBody(message: GroupMessage, caption: String?) {
    caption?.let { Caption(it) }
    Title(message.title, if (message.warning) RunwayColors.Warning else RunwayColors.Content, announce = true)
    // Korean wraps per syllable by default, so the copy breaks between words explicitly.
    BodyText(message.description)
}
