package com.runway.watch.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import com.runway.watch.ui.theme.LocalFaceScale
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.px
import com.runway.watch.ui.theme.largeFont
import kotlin.math.cos
import kotlin.math.sin

/**
 * The four rim arcs (tokens.md layout.rim_arcs), each 0..1 or null for an empty track. Only values that really exist
 * are passed: tl = goal distance progress. tr (goal time), bl (heart rate) and br (cadence) have no contract or
 * reference range yet, so they stay empty tracks instead of reading as a completion score (unconfirmed.md).
 */
data class RimValues(
    val tl: Float? = null,
    val tr: Float? = null,
    val bl: Float? = null,
    val br: Float? = null,
    /** Frozen, not live (paused, delayed values). */
    val dim: Boolean = false,
)

data class PageDots(val count: Int, val current: Int)

enum class HandleIcon { PAUSE, STOP, BUSY, MORE }

/** Right edge handle (layout.edge_handle). [enabled] false while a request is in flight. */
data class HandleSpec(val icon: HandleIcon, val label: String, val enabled: Boolean, val onClick: () -> Unit)

private const val DESIGN = 454f
private const val C = DESIGN / 2

/**
 * One round watch face of the design: rim, optional pace dots and page dots, side icons, the content box in the
 * middle, the right handle and the bottom button. Content stays in the design's content box (top 72, bottom 84 or 104
 * with a button, sides 70 of 454) and scrolls by touch or bezel when a large font does not fit.
 *
 * With a large font the bottom button is the taller EdgeButton size, so the box keeps clear of it.
 *
 * TalkBack order (handoff 접근성): content (status → key number → secondary) → page position → bottom button → handle.
 */
@Composable
fun WatchFace(
    modifier: Modifier = Modifier,
    rim: RimValues = RimValues(),
    /** Pace dots 0..1; null hides them (no live value or out of the drawn range, 9.2c). */
    ticks: Float? = null,
    pages: PageDots? = null,
    handle: HandleSpec? = null,
    focused: Boolean = true,
    top: Int = 72,
    bottomButton: (@Composable BoxScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier.fillMaxSize().background(RunwayColors.Background).semantics { isTraversalGroup = true }) {
        val scale = minOf(maxWidth, maxHeight) / 227.dp
        CompositionLocalProvider(LocalFaceScale provides scale) {
            Canvas(Modifier.fillMaxSize()) { drawFace(rim, ticks, pages, showRightIcons = handle == null) }
            val scroll = rememberScrollState()
            val focus = remember { FocusRequester() }
            Box(
                Modifier.fillMaxSize()
                    .padding(top = px(top), bottom = when {
                        bottomButton == null -> px(84)
                        // EdgeButton heights are fixed dp (ExtraSmall 46, Small 56) plus its own padding, not scaled with the face.
                        largeFont() -> 66.dp
                        else -> maxOf(px(104), 54.dp)
                    }, start = px(70), end = px(70))
                    .semantics { traversalIndex = 0f },
            ) {
                Column(
                    Modifier.align(Alignment.Center).fillMaxWidth()
                        .rotaryScrollable(RotaryScrollableDefaults.behavior(scroll), focus)
                        .verticalScroll(scroll),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(px(8), Alignment.CenterVertically),
                    content = content,
                )
            }
            if (pages != null && pages.count > 1) {
                Box(
                    Modifier.align(Alignment.TopCenter).size(px(60), px(40))
                        .semantics { contentDescription = "${pages.count}쪽 중 ${pages.current + 1}쪽"; traversalIndex = 1f },
                )
            }
            if (bottomButton != null) {
                Box(Modifier.align(Alignment.BottomCenter).semantics { traversalIndex = 2f }) { bottomButton() }
            }
            if (handle != null) {
                EdgeHandle(handle, Modifier.align(Alignment.CenterEnd).semantics { traversalIndex = 3f })
            }
            LaunchedEffect(focused) {
                if (focused) {
                    // Wait one frame so the focus target is attached (inside the swipe-to-dismiss box).
                    withFrameNanos { }
                    focus.requestFocus()
                }
            }
        }
    }
}

/** Point at [r] design px and [deg] clockwise from 12 o'clock, like FrRim.dc.html. */
private fun DrawScope.point(r: Float, deg: Float, s: Float): Offset {
    val a = Math.toRadians(deg.toDouble())
    return Offset(((C + r * sin(a)) * s).toFloat(), ((C - r * cos(a)) * s).toFloat())
}

private fun DrawScope.drawFace(rim: RimValues, ticks: Float?, pages: PageDots?, showRightIcons: Boolean) {
    val s = size.minDimension / DESIGN
    translate((size.width - DESIGN * s) / 2, (size.height - DESIGN * s) / 2) {
        // Inner disk with a faint outline (r=190).
        drawCircle(RunwayColors.Line.copy(alpha = .10f), 190 * s, Offset(C * s, C * s), style = Stroke(2 * s))
        ticks?.let { drawTicks(it.coerceIn(0f, 1f), s) }
        drawRim(rim, s)
        drawSideIcons(s, showRightIcons)
        if (pages != null && pages.count > 1) drawPageDots(pages, s)
    }
}

private fun DrawScope.drawTicks(fraction: Float, s: Float) {
    val n = 41
    for (i in 0 until n) {
        val p = point(172f, -130f + 260f * i / (n - 1), s)
        val on = i.toFloat() / (n - 1) <= fraction
        drawCircle(
            if (on) RunwayColors.RimGauge.copy(alpha = .8f) else Color.White.copy(alpha = .14f),
            (if (on) 5f else 4f) / 2 * s, p,
        )
    }
}

private val QUADRANT_START = floatArrayOf(-78f, 22f, 102f, 202f)
private const val SPAN = 56f
private const val R = 208f

private fun DrawScope.drawRim(rim: RimValues, s: Float) {
    val topLeft = Offset((C - R) * s, (C - R) * s)
    val arcSize = Size(2 * R * s, 2 * R * s)
    val stroke = Stroke(8 * s, cap = StrokeCap.Round)
    val values = listOf(rim.tl, rim.tr, rim.br, rim.bl)
    for (i in 0..3) {
        val start = QUADRANT_START[i]
        drawArc(RunwayColors.RimTrack, start - 90f, SPAN, false, topLeft, arcSize, style = stroke)
        val f = values[i]?.coerceIn(0f, 1f) ?: continue
        if (f <= .001f) continue
        val alpha = if (rim.dim) .4f else .85f
        drawArc(RunwayColors.RimGauge.copy(alpha = alpha), start - 90f, SPAN * f, false, topLeft, arcSize, style = stroke)
        val knob = point(R, start + SPAN * f, s)
        drawCircle(RunwayColors.Background.copy(alpha = alpha), 8.5f * s, knob)
        drawCircle(RunwayColors.RimGauge.copy(alpha = alpha), 7f * s, knob)
    }
}

private fun DrawScope.drawPageDots(pages: PageDots, s: Float) {
    for (i in 0 until pages.count) {
        val p = point(R, (i - (pages.count - 1) / 2f) * 7f, s)
        val current = i == pages.current
        drawCircle(if (current) Color.White else Color.White.copy(alpha = .4f), (if (current) 6f else 4f) * s, p)
    }
}

/** Flag and heart on the left; clock and cadence on the right only when no handle covers them (FrRim showRight). */
private fun DrawScope.drawSideIcons(s: Float, right: Boolean) {
    val k = 18f / 24f * s
    val muted = Color.White.copy(alpha = .4f)
    val line = Stroke(2 * k, cap = StrokeCap.Round, join = StrokeJoin.Round)
    fun at(x: Float, y: Float, block: DrawScope.() -> Unit) = translate(x * s, y * s) { block() }
    fun p(x: Float, y: Float) = Offset(x * k, y * k)
    at(15f, 196f) {
        drawPath(Path().apply {
            moveTo(6 * k, 21 * k); lineTo(6 * k, 4 * k); lineTo(17 * k, 4 * k); lineTo(15 * k, 8 * k)
            lineTo(17 * k, 12 * k); lineTo(6 * k, 12 * k)
        }, muted, style = line)
    }
    at(15f, 240f) { drawPath(heartPath(k), RunwayColors.Heart.copy(alpha = .6f), style = line) }
    if (!right) return
    at(421f, 196f) {
        drawCircle(muted, 8.5f * k, p(12f, 12f), style = line)
        drawPath(Path().apply { moveTo(12 * k, 7.5f * k); lineTo(12 * k, 12 * k); lineTo(15 * k, 14 * k) }, muted, style = line)
    }
    at(421f, 240f) {
        drawOval(muted, p(5.5f, 3.9f), Size(6 * k, 9.2f * k), style = line)
        drawOval(muted, p(12.5f, 10.9f), Size(6 * k, 9.2f * k), style = line)
    }
}

/** Heart outline in a 24-unit box scaled by [k]. */
internal fun heartPath(k: Float) = Path().apply {
    moveTo(12 * k, 20 * k)
    cubicTo(12 * k, 20 * k, 4.5f * k, 15.5f * k, 4.5f * k, 9.8f * k)
    cubicTo(4.5f * k, 6.2f * k, 9.5f * k, 4.6f * k, 12 * k, 7.6f * k)
    cubicTo(14.5f * k, 4.6f * k, 19.5f * k, 6.2f * k, 19.5f * k, 9.8f * k)
    cubicTo(19.5f * k, 15.5f * k, 12 * k, 20 * k, 12 * k, 20 * k)
    close()
}
