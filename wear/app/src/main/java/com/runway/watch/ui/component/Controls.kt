package com.runway.watch.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import com.runway.watch.ui.theme.px
import com.runway.watch.ui.theme.largeFont
import androidx.compose.ui.text.font.FontWeight

enum class ButtonKind {
    /** Mint: start, resume, retry, close. */
    PRIMARY,
    /** Surface fill: a choice that is not the main action (직접 조절, 위치 없이 시작). */
    SECONDARY,
}

/** Minimum touch target on Wear OS. */
private val MIN_TOUCH = 48.dp

/**
 * Bottom primary button (layout.bottom_button). The design's 240×96px box is a 227dp Tizen-based value, so this is the
 * Wear Material3 EdgeButton, which follows the screen edge on any size. [busy] shows the spinner of a request in flight
 * and keeps the button off.
 */
@Composable
fun BottomButton(
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    kind: ButtonKind = ButtonKind.PRIMARY,
    busy: Boolean = false,
) {
    val on = enabled && !busy
    val primary = kind == ButtonKind.PRIMARY
    EdgeButton(
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = label },
        // A larger font gets the taller size, which allows two lines instead of cutting the label.
        buttonSize = if (largeFont()) EdgeButtonSize.Small else EdgeButtonSize.ExtraSmall,
        enabled = on,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (primary) RunwayColors.Primary else RunwayColors.Surface,
            contentColor = if (primary) RunwayColors.OnPrimary else RunwayColors.Content,
            disabledContainerColor = RunwayColors.Disabled,
            disabledContentColor = RunwayColors.OnDisabled,
        ),
    ) {
        if (busy) Spinner(RunwayColors.OnDisabled, 22)
        if (busy) Spacer(Modifier.width(px(8)))
        Text(label, style = RunwayType.Button, maxLines = 2, textAlign = TextAlign.Center)
    }
}

/**
 * 9.3b end confirmation: cancel on the left (pink), the action on the right (mint), split at the bottom edge
 * (layout.confirm_split_buttons). Each half is at least 48dp tall and wide.
 */
@Composable
fun ConfirmButtons(
    leftLabel: String,
    onLeft: () -> Unit,
    rightLabel: String,
    onRight: () -> Unit,
    rightEnabled: Boolean = true,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(px(4))) {
        SplitHalf(leftLabel, onLeft, true, RunwayColors.Warning, RunwayColors.OnWarning,
            RoundedCornerShape(topStart = px(24), topEnd = px(6)), Alignment.TopCenter)
        SplitHalf(rightLabel, onRight, rightEnabled, RunwayColors.Primary, RunwayColors.OnPrimary,
            RoundedCornerShape(topStart = px(6), topEnd = px(24)), Alignment.TopCenter)
    }
}

@Composable
private fun SplitHalf(
    label: String, onClick: () -> Unit, enabled: Boolean, fill: Color, content: Color,
    shape: RoundedCornerShape, align: Alignment,
) {
    Box(
        Modifier.width(maxOf(px(118), MIN_TOUCH)).height(maxOf(px(96), MIN_TOUCH)).clip(shape)
            .background(if (enabled) fill else RunwayColors.Disabled)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .padding(top = px(20)),
        contentAlignment = align,
    ) {
        // The halves have a fixed width at the screen edge, so their label keeps its size; TalkBack reads it in full.
        Text(label, style = RunwayType.fixedText(24, FontWeight.Bold), color = if (enabled) content else RunwayColors.OnDisabled, maxLines = 1)
    }
}

/**
 * Right edge handle (layout.edge_handle): visible 22×44dp, touch 48×48dp. ❚❚ asks to pause once, ■ opens the end
 * confirmation, ⋮ opens more. While a request is in flight it shows a spinner and is locked.
 */
@Composable
fun EdgeHandle(spec: HandleSpec, modifier: Modifier = Modifier) {
    val enabled = spec.enabled && spec.icon != HandleIcon.BUSY
    Box(
        modifier.size(maxOf(px(96), MIN_TOUCH))
            .semantics { contentDescription = spec.label }
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = spec.label, onClick = spec.onClick),
        contentAlignment = Alignment.CenterEnd,
    ) {
        val shape = RoundedCornerShape(topStart = px(44), bottomStart = px(44))
        Box(
            Modifier.size(px(44), px(88)).clip(shape).background(RunwayColors.Surface)
                .border(BorderStroke(1.dp, Color.White.copy(alpha = .22f)), shape)
                .padding(start = px(4)),
            contentAlignment = Alignment.Center,
        ) { HandleGlyph(spec.icon, if (enabled || spec.icon == HandleIcon.BUSY) RunwayColors.Content else RunwayColors.ContentDim) }
    }
}

@Composable
private fun HandleGlyph(icon: HandleIcon, color: Color) {
    if (icon == HandleIcon.BUSY) return Spinner(color, 22)
    Canvas(Modifier.size(px(22))) {
        val w = size.width
        when (icon) {
            HandleIcon.PAUSE -> {
                drawRoundRect(color, Offset(w * 6 / 24, w * 5 / 24), Size(w * 4 / 24, w * 14 / 24), CornerRadius(w * 1.2f / 24))
                drawRoundRect(color, Offset(w * 14 / 24, w * 5 / 24), Size(w * 4 / 24, w * 14 / 24), CornerRadius(w * 1.2f / 24))
            }
            HandleIcon.STOP -> drawRoundRect(color, Offset(w * 6 / 24, w * 6 / 24), Size(w * 12 / 24, w * 12 / 24), CornerRadius(w * 2 / 24))
            HandleIcon.MORE -> for (y in listOf(6f, 12f, 18f)) drawCircle(color, w * 2 / 24, Offset(w / 2, w * y / 24))
            HandleIcon.BUSY -> Unit
        }
    }
}

/** −/+ for the rhythm BPM (9.5b): a 33dp outlined circle inside a 48dp touch target. */
@Composable
fun AdjustButton(label: String, symbol: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(MIN_TOUCH).semantics { contentDescription = label }
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(px(66)).clip(CircleShape).background(RunwayColors.Surface)
                .border(BorderStroke(1.dp, Color.White.copy(alpha = if (enabled) .25f else .12f)), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.size(px(22))) {
                val w = size.width
                val c = if (enabled) RunwayColors.Content else RunwayColors.ContentDim
                drawLine(c, Offset(0f, w / 2), Offset(w, w / 2), w * .12f, StrokeCap.Round)
                if (symbol == "+") drawLine(c, Offset(w / 2, 0f), Offset(w / 2, w), w * .12f, StrokeCap.Round)
            }
        }
    }
}
