package com.runway.watch.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import com.runway.watch.ui.theme.largeFont
import com.runway.watch.ui.theme.px

/**
 * A request in flight. Drawn still on purpose: a looping animation keeps the screen busy for TalkBack and UI tests,
 * and the words next to it already say the request is waiting.
 */
@Composable
fun Spinner(color: Color, sizePx: Int = 24) {
    Canvas(Modifier.size(px(sizePx)).semantics { }) {
        val w = size.width
        val stroke = w * .12f
        val inset = stroke / 2
        drawArc(color.copy(alpha = .3f), 0f, 360f, false, Offset(inset, inset), Size(w - stroke, w - stroke), style = Stroke(stroke))
        drawArc(color, -90f, 90f, false, Offset(inset, inset), Size(w - stroke, w - stroke), style = Stroke(stroke, cap = StrokeCap.Round))
    }
}

/**
 * The one key number of a face (mint). Its size does not follow the font size (handoff: 큰 숫자에 상한); TalkBack reads
 * [description], which names the value and its unit.
 */
@Composable
fun HeroNumber(
    value: String,
    sizePx: Int,
    description: String,
    unit: String? = null,
    color: Color = RunwayColors.Primary,
    modifier: Modifier = Modifier,
) {
    Row(modifier.clearAndSetSemantics { contentDescription = description }, verticalAlignment = Alignment.Bottom) {
        Text(value, style = RunwayType.number(sizePx, FontWeight.Medium, fixed = true), color = color, maxLines = 1, softWrap = false)
        unit?.let {
            Text(it, Modifier.padding(start = px(4), bottom = px(sizePx / 10)), style = RunwayType.number(36, FontWeight.SemiBold, fixed = true),
                color = RunwayColors.ContentSecondary, maxLines = 1)
        }
    }
}

/** Hero for a [MetricText]: missing values are dimmed "– –", never a made-up number. */
@Composable
fun HeroMetric(text: MetricText, sizePx: Int, unit: String? = text.unit, dim: Boolean = false) =
    HeroNumber(text.value, sizePx, text.description, unit,
        color = if (text.missing || dim) RunwayColors.ContentDim else RunwayColors.Primary)

/** "3.42 km": a secondary value with its unit inline (white, not mint). */
@Composable
fun InlineMetric(text: MetricText, sizePx: Int = 52, unit: String? = text.unit, color: Color? = null, modifier: Modifier = Modifier) {
    Row(modifier.clearAndSetSemantics { contentDescription = text.description }, verticalAlignment = Alignment.Bottom) {
        text.symbol?.let {
            Text(it + "︎", style = RunwayType.number(sizePx * 3 / 4), color = if (it == "♥") RunwayColors.Heart else RunwayColors.ContentSecondary,
                modifier = Modifier.padding(end = px(4)))
        }
        Text(text.value, style = RunwayType.number(sizePx), color = color ?: if (text.missing) RunwayColors.ContentDim else RunwayColors.Content,
            maxLines = 1, softWrap = false)
        unit?.let {
            Text(it, Modifier.padding(start = px(4)), style = RunwayType.number(sizePx * 2 / 3, FontWeight.Medium),
                color = RunwayColors.ContentSecondary, maxLines = 1)
        }
    }
}

/** A value with a small label under it ("5.01 / km", "174 / 선택값"). */
@Composable
fun ValueCell(value: String, label: String, description: String, valueColor: Color = RunwayColors.Content, labelColor: Color = RunwayColors.ContentSecondary) {
    Column(Modifier.clearAndSetSemantics { if (description.isNotEmpty()) contentDescription = description }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = RunwayType.number(44), color = valueColor, maxLines = 1, softWrap = false)
        Text(label, style = RunwayType.Label, color = labelColor, maxLines = 1)
    }
}

/** Two cells side by side, or stacked with a large font. */
@Composable
fun CellRow(content: @Composable () -> Unit) {
    if (largeFont()) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(px(4))) { content() }
    else Row(horizontalArrangement = Arrangement.spacedBy(px(44)), verticalAlignment = Alignment.Bottom) { content() }
}

/** Thin divider of the run status board. */
@Composable
fun Divider(widthPx: Int = 220) {
    Canvas(Modifier.width(px(widthPx)).height(px(2))) { drawRect(RunwayColors.Line) }
}

@Composable
fun Title(text: String, color: Color = RunwayColors.Content, announce: Boolean = false) {
    Text(text, if (announce) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier,
        style = RunwayType.Title, color = color, textAlign = TextAlign.Center)
}

@Composable
fun BodyText(text: String, color: Color = RunwayColors.ContentSecondary, strong: Boolean = false, announce: Boolean = false) {
    Text(text, if (announce) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier,
        style = if (strong) RunwayType.Status else RunwayType.Body, color = color, textAlign = TextAlign.Center)
}

@Composable
fun Caption(text: String) = Text(text, style = RunwayType.Label, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center)

enum class ChipLead { NONE, CHECK, BUSY }

/** Outlined status chip (일시정지됨, 목표 달성, 일시정지 요청 중). White only; the words carry the state. */
@Composable
fun StatusChip(text: String, lead: ChipLead = ChipLead.NONE, announce: Boolean = true) {
    Row(
        Modifier.semantics { if (announce) liveRegion = LiveRegionMode.Polite }
            .border(BorderStroke(1.dp, RunwayColors.Content), CircleShape)
            .padding(horizontal = px(18), vertical = px(4)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(px(8)),
    ) {
        when (lead) {
            ChipLead.CHECK -> Canvas(Modifier.size(px(20))) { drawCheck(RunwayColors.Content, size.width) }
            ChipLead.BUSY -> Spinner(RunwayColors.Content, 20)
            ChipLead.NONE -> Unit
        }
        Text(text, style = RunwayType.Chip, color = RunwayColors.Content, maxLines = 2, textAlign = TextAlign.Center)
    }
}

private fun DrawScope.drawCheck(color: Color, w: Float) = drawPath(Path().apply {
    moveTo(w * 4.1f / 24, w * 12 / 24); lineTo(w * 9.1f / 24, w * 17 / 24); lineTo(w * 19.9f / 24, w * 6 / 24)
}, color, style = Stroke(w * 3f / 24, cap = StrokeCap.Round, join = StrokeJoin.Round))

enum class StepState { DONE, ACTIVE, WAITING, FAILED, UNKNOWN }

data class Step(val label: String, val state: StepState)

private fun StepState.spoken() = when (this) {
    StepState.DONE -> "완료"
    StepState.ACTIVE -> "진행 중"
    StepState.WAITING -> "대기"
    StepState.FAILED -> "실패"
    StepState.UNKNOWN -> "확인 안 됨"
}

/**
 * Three-step progress (요청 → 서버 확인 → 기기 실행, 저장 확인 → 분석 → 결과 …). A step is shown done only once it is
 * confirmed; an unknown outcome is a dashed "?" rather than a check or a failure. With a large font the steps stack.
 */
@Composable
fun StepIndicator(steps: List<Step>) {
    val description = steps.joinToString(", ") { "${it.label} ${it.state.spoken()}" }
    val modifier = Modifier.clearAndSetSemantics { contentDescription = description; liveRegion = LiveRegionMode.Polite }
    if (largeFont()) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(px(6))) {
            steps.forEach { step ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(px(10))) {
                    StepMark(step.state)
                    StepLabel(step)
                }
            }
        }
        return
    }
    val markPx = with(LocalDensity.current) { px(MARK_PX).toPx() }
    Box(modifier.fillMaxWidth()) {
        // One line through the middle of the marks, from the first to the last; each mark covers it with its own disk.
        Canvas(Modifier.matchParentSize()) {
            val cell = size.width / steps.size
            drawLine(RunwayColors.Line, Offset(cell / 2, markPx / 2), Offset(size.width - cell / 2, markPx / 2), 2.dp.toPx())
        }
        Row(Modifier.fillMaxWidth()) {
            steps.forEach { step ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(px(6))) {
                    StepMark(step.state)
                    StepLabel(step)
                }
            }
        }
    }
}

private const val MARK_PX = 28

@Composable
private fun StepLabel(step: Step) {
    val (color, weight) = when (step.state) {
        StepState.DONE -> RunwayColors.Content to FontWeight.Normal
        StepState.ACTIVE, StepState.UNKNOWN -> RunwayColors.Content to FontWeight.Bold
        StepState.WAITING -> RunwayColors.ContentDim to FontWeight.Normal
        StepState.FAILED -> RunwayColors.Warning to FontWeight.Bold
    }
    Text(step.label, style = RunwayType.text(20, weight), color = color, maxLines = 1, softWrap = false)
}

@Composable
private fun StepMark(state: StepState) {
    Canvas(Modifier.size(px(MARK_PX))) {
        val w = size.width
        val stroke = w * .11f
        val r = w / 2 - stroke / 2
        drawCircle(RunwayColors.Background, w / 2)
        when (state) {
            StepState.DONE -> {
                drawCircle(RunwayColors.Content, w / 2)
                translate(w * .2f, w * .2f) { drawCheck(RunwayColors.Background, w * .6f) }
            }
            StepState.ACTIVE -> {
                drawCircle(RunwayColors.Content.copy(alpha = .3f), r, style = Stroke(stroke))
                drawArc(RunwayColors.Content, -90f, 100f, false, Offset(stroke / 2, stroke / 2), Size(w - stroke, w - stroke),
                    style = Stroke(stroke, cap = StrokeCap.Round))
            }
            StepState.WAITING -> drawCircle(RunwayColors.Content.copy(alpha = .3f), r, style = Stroke(stroke))
            StepState.FAILED -> {
                drawCircle(RunwayColors.Warning, w / 2)
                drawLine(RunwayColors.OnWarning, Offset(w / 2, w * .25f), Offset(w / 2, w * .58f), stroke, StrokeCap.Round)
                drawCircle(RunwayColors.OnWarning, stroke * .6f, Offset(w / 2, w * .74f))
            }
            StepState.UNKNOWN -> {
                drawCircle(RunwayColors.Content, r, style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(w * .12f, w * .1f))))
                drawPath(Path().apply {
                    moveTo(w * .38f, w * .38f); cubicTo(w * .38f, w * .24f, w * .62f, w * .24f, w * .62f, w * .38f)
                    cubicTo(w * .62f, w * .48f, w * .5f, w * .48f, w * .5f, w * .58f)
                }, RunwayColors.Content, style = Stroke(stroke * .8f, cap = StrokeCap.Round))
                drawCircle(RunwayColors.Content, stroke * .5f, Offset(w / 2, w * .72f))
            }
        }
    }
}

enum class StatusKind { PHONE, SERVER, GPS, HEART }

enum class StatusLevel {
    /** Being checked or late: dashed, white. */
    CHECKING,
    /** Not working: slashed, pink. */
    PROBLEM,
}

data class StatusItem(val kind: StatusKind, val level: StatusLevel, val description: String)

/**
 * Data source icons (phone, server, GPS, heart sensor). Only sources with a problem or being checked are shown; a
 * normal source is hidden. Each icon is a shape plus dash/slash, so color is never the only cue.
 */
@Composable
fun StatusIcons(items: List<StatusItem>) {
    if (items.isEmpty()) return
    Row(
        Modifier.clearAndSetSemantics { contentDescription = items.joinToString(", ") { it.description } },
        horizontalArrangement = Arrangement.spacedBy(px(16)),
    ) { items.forEach { StatusIcon(it.kind, it.level) } }
}

@Composable
fun StatusIcon(kind: StatusKind, level: StatusLevel, sizePx: Int = 30) {
    Canvas(Modifier.size(px(sizePx))) {
        val k = size.width / 24f
        val color = if (level == StatusLevel.PROBLEM) RunwayColors.Warning else Color.White.copy(alpha = .8f)
        val dash = if (level == StatusLevel.CHECKING) PathEffect.dashPathEffect(floatArrayOf(3 * k, 2.4f * k)) else null
        val line = Stroke(2 * k, cap = StrokeCap.Round, join = StrokeJoin.Round, pathEffect = dash)
        when (kind) {
            StatusKind.PHONE -> drawRoundRect(color, Offset(7 * k, 3 * k), Size(10 * k, 18 * k),
                androidx.compose.ui.geometry.CornerRadius(2 * k), style = line)
            StatusKind.SERVER -> drawPath(Path().apply {
                moveTo(7 * k, 18 * k); lineTo(17 * k, 18 * k)
                cubicTo(20.5f * k, 18 * k, 21.5f * k, 13 * k, 18 * k, 11.8f * k)
                cubicTo(17.6f * k, 7 * k, 10.5f * k, 5.8f * k, 9 * k, 10.4f * k)
                cubicTo(5 * k, 10.4f * k, 3.6f * k, 18 * k, 7 * k, 18 * k)
                close()
            }, color, style = line)
            StatusKind.GPS -> {
                drawCircle(color, 6.5f * k, Offset(12 * k, 12 * k), style = line)
                drawCircle(color, 2.2f * k, Offset(12 * k, 12 * k))
                for ((a, b) in listOf(Offset(12f, 2f) to Offset(12f, 5f), Offset(12f, 19f) to Offset(12f, 22f),
                    Offset(2f, 12f) to Offset(5f, 12f), Offset(19f, 12f) to Offset(22f, 12f))) {
                    drawLine(color, a * k, b * k, 2 * k, StrokeCap.Round)
                }
            }
            StatusKind.HEART -> drawPath(heartPath(k), color, style = line)
        }
        if (level == StatusLevel.PROBLEM) drawLine(color, Offset(4 * k, 4 * k), Offset(20 * k, 20 * k), 2.4f * k, StrokeCap.Round)
    }
}
