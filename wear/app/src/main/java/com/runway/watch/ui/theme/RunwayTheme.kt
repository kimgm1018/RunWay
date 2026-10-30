package com.runway.watch.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.MaterialTheme
import com.runway.watch.R

/**
 * Colors follow frontend/DESIGN.md 1-1 (dark area of the phone screens): no mint, emphasis by
 * brightness inversion, warning #E2876F. Watch screens are always black.
 */
object RunwayColors {
    val Background = Color(0xFF000000)
    val Content = Color(0xFFE8EEF4)
    val ContentSecondary = Content.copy(alpha = .62f)
    val ContentDim = Content.copy(alpha = .42f)
    val Line = Content.copy(alpha = .18f)

    /** Inverted primary button: light fill, dark text. */
    val Primary = Color(0xFFE8EEF4)
    val OnPrimary = Color(0xFF02050E)
    val PrimaryDisabled = Color(0xFFEEF4F5).copy(alpha = .12f)

    /** Secondary round button: faint fill with a 25% outline (DESIGN.md 2-5 보조). */
    val Secondary = Color(0xFFEEF4F5).copy(alpha = .10f)
    val SecondaryOutline = Color(0xFFEEF4F5).copy(alpha = .25f)

    val Warning = Color(0xFFE2876F)
    val OnWarning = Color(0xFF02050E)
}

private val Barlow = FontFamily(
    Font(R.font.barlow_regular, FontWeight.Normal),
    Font(R.font.barlow_medium, FontWeight.Medium),
)

object RunwayType {
    /** Numbers use Barlow like the phone; tabular figures keep ticking values from jittering. */
    fun number(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontFamily = Barlow, fontWeight = weight, fontSize = size.sp, lineHeight = size.sp,
        fontFeatureSettings = "tnum",
    )

    val Caption = TextStyle(fontSize = 10.sp, lineHeight = 13.sp, fontWeight = FontWeight.Medium)
    val Body = TextStyle(fontSize = 11.sp, lineHeight = 15.sp)
    val Title = TextStyle(fontSize = 15.sp, lineHeight = 19.sp, fontWeight = FontWeight.Bold)
    val Button = TextStyle(fontSize = 12.sp, lineHeight = 14.sp, fontWeight = FontWeight.Bold)
}

@Composable
fun RunwayWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
