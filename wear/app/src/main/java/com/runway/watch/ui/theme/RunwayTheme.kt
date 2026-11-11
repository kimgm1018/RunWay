package com.runway.watch.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.intl.LocaleList
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.MaterialTheme
import com.runway.watch.R

/**
 * Tokens of the confirmed watch design (Rajdhani version, S15P31E105-519 · docs/design/watch-handoff/spec/tokens.md).
 * Mint is only for the one key number and the bottom primary button, blue only for the rim gauge and the pace dots,
 * pink only for warnings, cancel and the heart. States always carry an icon or words as well as a color.
 */
object RunwayColors {
    val Background = Color(0xFF050D14)
    val Surface = Color(0xFF111D27)
    val Content = Color(0xFFFFFFFF)
    val ContentSecondary = Content.copy(alpha = .62f)
    val ContentDim = Content.copy(alpha = .45f)
    val Line = Content.copy(alpha = .18f)

    /** Mint: the key number and the bottom primary button. */
    val Primary = Color(0xFF4DFFD2)
    val OnPrimary = Color(0xFF000000)

    val Warning = Color(0xFFFF5C7A)
    val OnWarning = Color(0xFF000000)
    val Heart = Warning

    /** Blue: rim arcs, their knobs and the pace dots only. */
    val RimGauge = Color(0xFF4DC4FF)
    val RimTrack = RimGauge.copy(alpha = .2f)

    /** A button that waits for a request: surface fill, dimmed words. */
    val Disabled = Surface
    val OnDisabled = ContentSecondary
}

private val Rajdhani = FontFamily(
    Font(R.font.rajdhani_regular, FontWeight.Normal),
    Font(R.font.rajdhani_medium, FontWeight.Medium),
    Font(R.font.rajdhani_semibold, FontWeight.SemiBold),
    Font(R.font.rajdhani_bold, FontWeight.Bold),
)

/** Subset to ASCII and the 2,350 KS X 1001 syllables; any other glyph falls back to the system font. */
private val NotoSansKr = FontFamily(
    Font(R.font.notosanskr_regular, FontWeight.Normal),
    Font(R.font.notosanskr_medium, FontWeight.Medium),
    Font(R.font.notosanskr_bold, FontWeight.Bold),
)

/**
 * The design is drawn on a 454px circle = 227dp (1dp = 2px). Every size here is given in design px and turned into
 * dp/sp by the face scale, so a 192dp watch keeps the same proportions.
 */
val LocalFaceScale = compositionLocalOf { 1f }

/** Design px → dp on the current face. */
@Composable @ReadOnlyComposable
fun px(value: Number): Dp = (value.toFloat() / 2f * LocalFaceScale.current).dp

/** Design px → sp on the current face. Follows the user's font size. */
@Composable @ReadOnlyComposable
fun pxSp(value: Number): TextUnit = (value.toFloat() / 2f * LocalFaceScale.current).sp

/**
 * Design px → sp that does not grow with the font size. Only for the hero number, which is already the largest text
 * on the face and would push everything else off a round screen (handoff: 큰 숫자에 상한).
 */
@Composable @ReadOnlyComposable
fun heroSp(value: Number): TextUnit {
    val fontScale = LocalDensity.current.fontScale.coerceAtLeast(1f)
    return (value.toFloat() / 2f * LocalFaceScale.current / fontScale).sp
}

/** True when the user picked a larger font; layouts that would overflow switch to a stacked form. */
@Composable @ReadOnlyComposable
fun largeFont(): Boolean = LocalDensity.current.fontScale > 1.15f

object RunwayType {
    /** Numbers and Latin: Rajdhani with tabular figures so ticking values do not jitter. */
    @Composable @ReadOnlyComposable
    fun number(px: Int, weight: FontWeight = FontWeight.SemiBold, fixed: Boolean = false): TextStyle {
        val size = if (fixed) heroSp(px) else pxSp(px)
        return TextStyle(fontFamily = Rajdhani, fontWeight = weight, fontSize = size, lineHeight = size, fontFeatureSettings = "tnum")
    }

    /**
     * Hangul text: Noto Sans KR. Lines break between words (phrase), not between syllables, so a larger font or a
     * smaller watch never splits a word like 연결되/지.
     */
    @Composable @ReadOnlyComposable
    fun text(px: Int, weight: FontWeight = FontWeight.Normal): TextStyle =
        TextStyle(fontFamily = NotoSansKr, fontWeight = weight, fontSize = pxSp(px), lineHeight = pxSp(px * 1.3f), lineBreak = PhraseBreak,
            // Phrase breaking follows the text's locale, not the device's, so the copy is marked Korean.
            localeList = Korean)

    /** Like [text] but not growing with the font size: only for labels inside fixed-size controls (split buttons). */
    @Composable @ReadOnlyComposable
    fun fixedText(px: Int, weight: FontWeight = FontWeight.Normal): TextStyle =
        text(px, weight).copy(fontSize = heroSp(px), lineHeight = heroSp(px * 1.3f))

    private val PhraseBreak = LineBreak.Heading.copy(wordBreak = LineBreak.WordBreak.Phrase)
    private val Korean = LocaleList("ko-KR")

    /** title 30–34 bold */
    val Title @Composable @ReadOnlyComposable get() = text(32, FontWeight.Bold)
    /** status_strong 20–24 bold */
    val Status @Composable @ReadOnlyComposable get() = text(22, FontWeight.Bold)
    /** body_secondary / label: 16px in the drawings, raised to the 10sp (20px) floor of the common board. */
    val Body @Composable @ReadOnlyComposable get() = text(20)
    val Label @Composable @ReadOnlyComposable get() = text(20)
    val Chip @Composable @ReadOnlyComposable get() = text(22, FontWeight.Bold)
    val Button @Composable @ReadOnlyComposable get() = text(24, FontWeight.Bold)
}

/** Hero number sizes of tokens.md type_scale_px. */
object HeroSize {
    const val PACE = 104
    const val SINGLE = 150
    const val SHORT = 132
    const val LONG = 116

    /** 1 char 150, 2–4 chars 132, longer 116. Pace values use [PACE]. */
    fun forText(text: String): Int = when {
        text.length <= 1 -> SINGLE
        text.length <= 4 -> SHORT
        else -> LONG
    }
}

@Composable
fun RunwayWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
