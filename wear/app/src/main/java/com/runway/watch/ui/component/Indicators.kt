package com.runway.watch.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

enum class StatusTone { NORMAL, WARNING }

/** "● GPS ● 폰" style line. Warning is the only colored tone; normal is secondary white. */
@Composable
fun StatusLine(vararg items: Pair<String, StatusTone>) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        for ((text, tone) in items) Text(
            "● $text", style = RunwayType.Caption, maxLines = 1,
            color = if (tone == StatusTone.WARNING) RunwayColors.Warning else RunwayColors.ContentSecondary,
        )
    }
}

/** Small inverted chip (일시정지 badge) or quiet chip (♪ BPM). */
@Composable
fun Chip(text: String, inverted: Boolean = false, description: String? = null) {
    Box(
        Modifier.clip(CircleShape).background(if (inverted) RunwayColors.Primary else RunwayColors.Secondary)
            .padding(horizontal = 9.dp, vertical = 3.dp)
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
    ) { Text(text, style = RunwayType.Caption, color = if (inverted) RunwayColors.OnPrimary else RunwayColors.Content, maxLines = 1) }
}

/** Page dots: current page is a 14dp bar, others 5dp dots (DESIGN.md 단계 표시). */
@Composable
fun PageIndicator(count: Int, current: Int) {
    Row(
        Modifier.semantics { contentDescription = "${count}쪽 중 ${current + 1}쪽" },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        repeat(count) { index ->
            Box(Modifier.size(width = if (index == current) 14.dp else 5.dp, height = 5.dp).clip(CircleShape)
                .background(if (index == current) RunwayColors.Content else RunwayColors.Line))
        }
    }
}

/**
 * Edge ring drawn just inside the round display. Distance progress while running, sync progress
 * on the result screen. Null progress draws only the track.
 */
@Composable
fun ProgressRing(progress: Float?, modifier: Modifier = Modifier, color: Color = RunwayColors.Content) {
    Canvas(modifier.fillMaxSize()) {
        val stroke = size.minDimension * .035f
        val inset = stroke / 2 + size.minDimension * .015f
        val arc = Size(size.width - inset * 2, size.height - inset * 2)
        drawArc(RunwayColors.Line, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(stroke))
        if (progress != null && progress > 0f) drawArc(color, -90f, 360f * progress.coerceAtMost(1f), false,
            Offset(inset, inset), arc, style = Stroke(stroke, cap = StrokeCap.Round))
    }
}
