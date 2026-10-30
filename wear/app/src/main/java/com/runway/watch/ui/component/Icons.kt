package com.runway.watch.ui.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/** Minimal line icons drawn from the 9.x wireframe SVGs, so the module needs no icon library. */
enum class WatchIcon { PLAY, STOP, CHECK, CLOSE, CLOCK }

@Composable
fun Icon(icon: WatchIcon, color: Color, size: Int = 18) {
    Canvas(Modifier.size(size.dp)) {
        val w = this.size.width
        val stroke = Stroke(width = w * .12f, cap = StrokeCap.Round)
        when (icon) {
            WatchIcon.PLAY -> drawPath(Path().apply {
                moveTo(w * .3f, w * .17f); lineTo(w * .83f, w * .5f); lineTo(w * .3f, w * .83f); close()
            }, color)
            WatchIcon.STOP -> drawRoundRect(color, Offset(w * .2f, w * .2f), Size(w * .6f, w * .6f), CornerRadius(w * .08f))
            WatchIcon.CHECK -> drawPath(Path().apply {
                moveTo(w * .17f, w * .5f); lineTo(w * .38f, w * .71f); lineTo(w * .83f, w * .25f)
            }, color, style = stroke)
            WatchIcon.CLOSE -> {
                drawLine(color, Offset(w * .25f, w * .25f), Offset(w * .75f, w * .75f), stroke.width, StrokeCap.Round)
                drawLine(color, Offset(w * .75f, w * .25f), Offset(w * .25f, w * .75f), stroke.width, StrokeCap.Round)
            }
            WatchIcon.CLOCK -> {
                val thin = Stroke(width = w * .075f, cap = StrokeCap.Round)
                drawCircle(color, w * .375f, style = thin)
                drawPath(Path().apply {
                    moveTo(w * .5f, w * .29f); lineTo(w * .5f, w * .5f); lineTo(w * .625f, w * .58f)
                }, color, style = thin)
            }
        }
    }
}
