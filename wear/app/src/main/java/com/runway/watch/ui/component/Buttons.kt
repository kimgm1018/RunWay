package com.runway.watch.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

enum class ButtonKind { PRIMARY, SECONDARY, WARNING }

private data class ButtonColors(val fill: Color, val content: Color, val outline: Color?)

private fun colors(kind: ButtonKind, enabled: Boolean) = when {
    !enabled -> ButtonColors(RunwayColors.PrimaryDisabled, RunwayColors.ContentDim, null)
    kind == ButtonKind.PRIMARY -> ButtonColors(RunwayColors.Primary, RunwayColors.OnPrimary, null)
    kind == ButtonKind.WARNING -> ButtonColors(RunwayColors.Warning, RunwayColors.OnWarning, null)
    else -> ButtonColors(RunwayColors.Secondary, RunwayColors.Content, RunwayColors.SecondaryOutline)
}

/** Minimum touch target on Wear OS is 48dp; round buttons never go below it. */
private const val MIN_TOUCH = 48

/**
 * Round icon button (start, resume, ✓, ✕). [label] is read by TalkBack and, when [caption] is
 * true, shown below the circle like the 9.3 pause screen.
 */
@Composable
fun RoundButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.PRIMARY,
    enabled: Boolean = true,
    size: Int = 52,
    caption: Boolean = false,
    icon: @Composable (Color) -> Unit,
) {
    val c = colors(kind, enabled)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Box(
            Modifier.size(maxOf(size, MIN_TOUCH).dp).clip(CircleShape).background(c.fill)
                .then(if (c.outline != null) Modifier.border(BorderStroke(1.dp, c.outline), CircleShape) else Modifier)
                .semantics { contentDescription = label }
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) { icon(c.content) }
        if (caption) Text(label, style = RunwayType.Caption, color = if (enabled) RunwayColors.ContentSecondary else RunwayColors.ContentDim)
    }
}

/** Text pill button (다시 연결, 다시 시도). */
@Composable
fun PillButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.PRIMARY,
    enabled: Boolean = true,
) {
    val c = colors(kind, enabled)
    Box(
        modifier.heightIn(min = MIN_TOUCH.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.clip(CircleShape).background(c.fill)
                .then(if (c.outline != null) Modifier.border(BorderStroke(1.dp, c.outline), CircleShape) else Modifier)
                .padding(horizontal = 14.dp, vertical = 8.dp),
        ) { Text(label, style = RunwayType.Button, color = c.content, maxLines = 1) }
    }
}
