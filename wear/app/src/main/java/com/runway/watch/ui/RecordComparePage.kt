package com.runway.watch.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.run.RecordComparison
import com.runway.watch.run.RunSnapshot
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import kotlin.math.abs

enum class CompareTrend { AHEAD, EVEN, BEHIND }

sealed interface RecordCompareView {
    /**
     * Gap to the past run at the same distance. [marker] places "now" on a bar whose middle is the
     * past run, further right when ahead.
     */
    data class Gap(
        val caption: String,
        val trend: CompareTrend,
        val gap: String,
        val headline: String,
        val description: String,
        val detail: String,
        val detailDescription: String,
        val marker: Float,
    ) : RecordCompareView

    /** No gap to show (9.6b and the other states); never a made-up value. */
    data class Message(val title: String, val description: String, val warning: Boolean = false) : RecordCompareView
}

/**
 * Derives 9.6 from the snapshot only. It reads [RunSnapshot.comparison] and never the goal, so a
 * gap to the past run is never mixed up with progress toward the goal, and losing the comparison
 * leaves the runner's own values and goal on 9.2 untouched.
 */
object RecordCompareDisplay {
    /** Gaps beyond this sit at the end of the bar. */
    private const val BAR_RANGE_MS = 60_000f

    /** Null for a run without a comparison: there is no page and nothing to say about comparing. */
    fun from(snapshot: RunSnapshot): RecordCompareView? = when (val c = snapshot.comparison) {
        RecordComparison.NotSelected -> null
        RecordComparison.NoRecord -> RecordCompareView.Message("비교할 기록이 없어요", "이번 러닝을 마치면\n다음부터 비교할 수 있어요")
        RecordComparison.Waiting -> waiting
        RecordComparison.Unavailable ->
            RecordCompareView.Message("비교를 멈췄어요", "비교 기록을 볼 수 없어요\n러닝은 계속 기록돼요", warning = true)
        is RecordComparison.Result -> if (c.targetLabel.isNullOrBlank()) null else gap(c, c.targetLabel) ?: waiting
    }

    private val waiting = RecordCompareView.Message("비교 결과를 기다려요", "받는 대로\n바로 보여 드려요")

    private fun gap(c: RecordComparison.Result, label: String): RecordCompareView.Gap? {
        if (c.currentElapsedMs < 0 || c.pastElapsedMs < 0) return null
        val distance = MetricFormat.distance(c.distanceMeters)
        if (distance.missing) return null
        val diffMs = c.currentElapsedMs - c.pastElapsedMs
        // Whole seconds, like the elapsed time, so a sub-second gap reads as even.
        val seconds = abs(diffMs) / 1000
        val trend = when {
            seconds == 0L -> CompareTrend.EVEN
            diffMs < 0 -> CompareTrend.AHEAD
            else -> CompareTrend.BEHIND
        }
        val amount = if (seconds < 60) "${seconds}″" else "%d′%02d″".format(seconds / 60, seconds % 60)
        val spoken = (if (seconds >= 60) "${seconds / 60}분 " else "") + "${seconds % 60}초"
        val now = MetricFormat.duration(c.currentElapsedMs)
        val past = MetricFormat.duration(c.pastElapsedMs)
        // From the shown seconds, so the dot never disagrees with the number (an even gap sits on the past run).
        val shownMs = seconds * 1000 * (if (diffMs < 0) -1 else 1)
        val offset = (-shownMs / BAR_RANGE_MS).coerceIn(-1f, 1f) * .4f
        return RecordCompareView.Gap(
            caption = "$label 기록과 비교",
            trend = trend,
            gap = when (trend) {
                CompareTrend.AHEAD -> "−$amount"
                CompareTrend.BEHIND -> "+$amount"
                CompareTrend.EVEN -> amount
            },
            headline = when (trend) {
                CompareTrend.AHEAD -> "지난번보다 빨라요"
                CompareTrend.BEHIND -> "지난번보다 느려요"
                CompareTrend.EVEN -> "지난번과 같아요"
            },
            description = when (trend) {
                CompareTrend.AHEAD -> "지난 기록보다 $spoken 빠름"
                CompareTrend.BEHIND -> "지난 기록보다 $spoken 느림"
                CompareTrend.EVEN -> "지난 기록과 같음"
            },
            // Two lines broken by meaning; a single line wraps mid-pair on the round screen.
            detail = "${distance.value}km 도달\n지금 ${now.value} · 지난 ${past.value}",
            detailDescription = "${distance.value} 킬로미터 도달, 지금 ${now.description.removePrefix("경과 시간 ")}, " +
                "지난 기록 ${past.description.removePrefix("경과 시간 ")}",
            marker = .5f + offset,
        )
    }
}

/**
 * 9.6 / 9.6b: once a comparison is chosen the page stays in every state and the run goes on even if
 * it stops. Without a comparison the pager leaves this page out.
 */
@Composable
internal fun RecordComparePage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean) {
    RoundScreen(spacing = 4.dp, focused = visible) {
        when (val view = RecordCompareDisplay.from(snapshot)) {
            is RecordCompareView.Gap -> GapBody(view)
            is RecordCompareView.Message -> MessageBody(view)
            // Only for the frame in which a comparison is dropped, before the pager loses this page.
            null -> {}
        }
        PageIndicator(count, index)
    }
}

/** Ahead is the bright content color, behind the warning coral (no mint, DESIGN.md 1-1); sign and words say it too. */
private fun CompareTrend.color(): Color = when (this) {
    CompareTrend.AHEAD -> RunwayColors.Content
    CompareTrend.EVEN -> RunwayColors.ContentSecondary
    CompareTrend.BEHIND -> RunwayColors.Warning
}

@Composable
private fun ColumnScope.GapBody(view: RecordCompareView.Gap) {
    val color = view.trend.color()
    Text(view.caption, style = RunwayType.Caption, color = color, maxLines = 1)
    Column(
        Modifier.clearAndSetSemantics { contentDescription = view.description },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(view.gap, style = RunwayType.number(46), color = color, maxLines = 1)
        Text(view.headline, style = RunwayType.Title, color = RunwayColors.Content, maxLines = 1)
    }
    GapBar(view.marker, color, Modifier.padding(vertical = 4.dp))
    Text(
        view.detail, Modifier.semantics { contentDescription = view.detailDescription },
        style = RunwayType.number(10), color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center,
    )
}

/** The past run is the dim dot in the middle; "now" moves right when ahead, left when behind. */
@Composable
private fun GapBar(marker: Float, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxWidth(.85f).height(14.dp)) {
        val y = size.height / 2
        drawLine(RunwayColors.Line, Offset(y, y), Offset(size.width - y, y), size.height * .43f, StrokeCap.Round)
        drawCircle(RunwayColors.ContentDim, size.height * .43f, Offset(size.width / 2, y))
        val x = (size.width * marker).coerceIn(y, size.width - y)
        drawCircle(RunwayColors.Background, size.height / 2, Offset(x, y))
        drawCircle(color, size.height * .36f, Offset(x, y))
    }
}

@Composable
private fun MessageBody(view: RecordCompareView.Message) {
    Text("기록 비교", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
    Icon(WatchIcon.CLOCK, if (view.warning) RunwayColors.Warning else RunwayColors.ContentSecondary, 26)
    Text(view.title, style = RunwayType.Title, color = RunwayColors.Content, textAlign = TextAlign.Center)
    // Korean wraps per syllable by default, so the copy breaks between words explicitly.
    Text(view.description, style = RunwayType.Body, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center)
}
