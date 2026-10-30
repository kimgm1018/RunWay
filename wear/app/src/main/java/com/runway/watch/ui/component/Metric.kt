package com.runway.watch.ui.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

/**
 * Value with its symbol and unit. Missing values are dimmed but keep the unit; TalkBack reads one
 * description that names the metric (heart rate and rhythm BPM never sound alike).
 */
@Composable
fun MetricValue(text: MetricText, size: Int, modifier: Modifier = Modifier, emphasized: Boolean = true) {
    val valueColor = when {
        text.missing -> RunwayColors.ContentDim
        emphasized -> RunwayColors.Content
        else -> RunwayColors.ContentSecondary
    }
    val small = (size * .4f).toInt().coerceAtLeast(9)
    Row(
        modifier.clearAndSetSemantics { contentDescription = text.description },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        // U+FE0E keeps ♥/♪ as monochrome text glyphs; the emoji form would add color outside the palette.
        text.symbol?.let { Text(it + "︎", style = RunwayType.number(small + 2, FontWeight.Medium), color = valueColor) }
        Text(text.value, style = RunwayType.number(size), color = valueColor, maxLines = 1)
        text.unit?.let { Text(it, style = RunwayType.number(small), color = RunwayColors.ContentSecondary, maxLines = 1) }
    }
}
