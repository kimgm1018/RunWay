package com.runway.watch.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import com.runway.watch.ui.theme.RunwayColors

/**
 * One task per round screen. Content stays inside the circle's inscribed square (14.6% inset per
 * side) and scrolls by touch or bezel when it does not fit, instead of being clipped at the edge.
 * Only the [focused] screen takes bezel input; pager pages composed off screen must pass false.
 */
@Composable
fun RoundScreen(
    modifier: Modifier = Modifier,
    background: @Composable BoxScope.() -> Unit = {},
    spacing: Dp = 4.dp,
    focused: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val scroll = rememberScrollState()
    val focus = remember { FocusRequester() }
    BoxWithConstraints(modifier.fillMaxSize().background(RunwayColors.Background)) {
        background()
        val inset = maxWidth * 0.146f
        Column(
            Modifier.align(Alignment.Center)
                .rotaryScrollable(RotaryScrollableDefaults.behavior(scroll), focus)
                .verticalScroll(scroll)
                .padding(horizontal = inset, vertical = inset * 0.6f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(spacing, Alignment.CenterVertically),
            content = content,
        )
    }
    // Wait one frame so the focus target is attached; inside the swipe-to-dismiss box the effect
    // can start before layout and requestFocus() would throw.
    LaunchedEffect(focused) {
        if (focused) {
            withFrameNanos { }
            focus.requestFocus()
        }
    }
}
