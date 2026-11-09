package com.runway.watch.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.clearAndSetSemantics
import com.runway.watch.run.RecordComparison
import com.runway.watch.run.RunSnapshot
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.HeroSize
import com.runway.watch.ui.theme.px
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
        /** Elapsed times now and in the past run at the same distance, shown as two cells. */
        val now: String = "",
        val past: String = "",
        val distance: String = "",
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
        val amount = if (seconds < 60) "${seconds}”" else "%d’%02d”".format(seconds / 60, seconds % 60)
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
            now = now.value,
            past = past.value,
            distance = distance.value,
        )
    }
}

/**
 * 9.6 / 9.6b: once a comparison is chosen the page stays in every state and the run goes on even if it stops. Without
 * a comparison the pager leaves this page out.
 */
@Composable
internal fun RecordComparePage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onPause: () -> Unit = {}) {
    val status = RunStatusDisplay.from(snapshot)
    WatchFace(rim = RunStatusDisplay.rim(status), pages = PageDots(count, index), handle = pauseHandle(status, onPause), focused = visible) {
        when (val view = RecordCompareDisplay.from(snapshot)) {
            is RecordCompareView.Gap -> GapBody(view)
            is RecordCompareView.Message -> MessageBody(view, waiting = snapshot.comparison == RecordComparison.Waiting ||
                snapshot.comparison is RecordComparison.Result)
            // Only for the frame in which a comparison is dropped, before the pager loses this page.
            null -> {}
        }
    }
}

@Composable
private fun GapBody(view: RecordCompareView.Gap) {
    Caption(if (view.distance.isNotEmpty()) "${view.distance} km 지점 · ${view.caption.removeSuffix(" 기록과 비교")} 기록과" else view.caption)
    // The gap is the key number; ahead/behind is said by the sign and the words, not by color.
    HeroNumber(view.gap, HeroSize.PACE, view.description)
    BodyText(view.description.removePrefix("지난 기록보다 "), RunwayColors.Content, strong = true)
    GapBar(view.marker)
    CellRow {
        ValueCell(view.now, "지금", view.detailDescription)
        ValueCell(view.past, "지난 기록", "")
    }
}

/** The past run is the dim dot in the middle; "now" moves right when ahead, left when behind. */
@Composable
private fun GapBar(marker: Float, modifier: Modifier = Modifier) {
    Canvas(modifier.width(px(170)).height(px(12)).clearAndSetSemantics { }) {
        val y = size.height / 2
        drawLine(RunwayColors.Line, Offset(y, y), Offset(size.width - y, y), size.height * .5f, StrokeCap.Round)
        drawCircle(RunwayColors.ContentDim, size.height * .43f, Offset(size.width / 2, y))
        val x = (size.width * marker).coerceIn(y, size.width - y)
        drawCircle(RunwayColors.Background, size.height * .62f, Offset(x, y))
        drawCircle(RunwayColors.Content, size.height * .5f, Offset(x, y))
    }
}

/** 9.6b waits with the request steps; the other states say why there is no gap. */
@Composable
private fun MessageBody(view: RecordCompareView.Message, waiting: Boolean) {
    Caption("기록 비교")
    Title(view.title, if (view.warning) RunwayColors.Warning else RunwayColors.Content, announce = true)
    if (waiting) StepIndicator(listOf(Step("요청", StepState.DONE), Step("서버 계산", StepState.ACTIVE), Step("표시", StepState.WAITING)))
    else BodyText(view.description)
}
