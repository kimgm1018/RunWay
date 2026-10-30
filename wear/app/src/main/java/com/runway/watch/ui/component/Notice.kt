package com.runway.watch.ui.component

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

/**
 * Guidance state (9.1b connection problem, 9.4b/9.4c sync, 9.6b no record): mark + title +
 * description + optional actions, the watch counterpart of the phone EmptyState.
 */
@Composable
fun Notice(
    title: String,
    description: String? = null,
    tone: StatusTone = StatusTone.NORMAL,
    actions: @Composable RowScope.() -> Unit = {},
) {
    RoundScreen(spacing = 6.dp) {
        val color = if (tone == StatusTone.WARNING) RunwayColors.Warning else RunwayColors.ContentSecondary
        Box(Modifier.size(32.dp).border(2.dp, color, CircleShape), contentAlignment = Alignment.Center) {
            Text(if (tone == StatusTone.WARNING) "!" else "i", style = RunwayType.Title, color = color)
        }
        Text(title, style = RunwayType.Title, color = RunwayColors.Content, textAlign = TextAlign.Center)
        description?.let { Text(it, style = RunwayType.Body, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), content = actions)
    }
}
