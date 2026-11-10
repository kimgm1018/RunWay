package com.runway.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.wear.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.runway.watch.navigation.WatchRoute
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.theme.RunwayType

/**
 * Ambient (always-on) state of the activity (S15P31E105-617). [tick] grows on each system ambient update (about once a
 * minute) and is the only moment the ambient screen takes new values.
 */
data class AmbientMode(val burnInProtection: Boolean = false, val lowBit: Boolean = false, val tick: Long = 0)

/**
 * What the ambient screen shows (S15P31E105-617). Only the key values of a run this watch records: state, elapsed time
 * in whole minutes (the screen changes once a minute, so seconds would be wrong most of the time) and distance. Other
 * screens keep only a short line, so the app never shows stale details or controls while dim.
 */
data class AmbientDisplay(val label: String, val elapsed: String? = null, val distance: String? = null) {
    companion object {
        fun of(snapshot: RunSnapshot, route: WatchRoute): AmbientDisplay {
            if (snapshot.phoneRecording) return AmbientDisplay("휴대폰에서 기록 중")
            if (snapshot.measurementLost) return AmbientDisplay("워치 측정 끊김")
            val label = when (route) {
                WatchRoute.RUNNING -> "러닝 중"
                WatchRoute.PAUSED, WatchRoute.END_CONFIRM -> "일시정지"
                WatchRoute.RESULT -> return AmbientDisplay(if (snapshot.state == RunState.INTERRUPTED) "러닝 중단" else "러닝 종료")
                else -> return AmbientDisplay("RunWay")
            }
            val distance = MetricFormat.distance(snapshot.metrics.distanceMeters)
            return AmbientDisplay(label, minutes(snapshot.metrics.elapsedMs), "${distance.value} ${distance.unit}")
        }

        /** Elapsed time without seconds: `14분`, `1시간 05분`; [MetricFormat.MISSING] when unknown. */
        fun minutes(ms: Long?): String {
            if (ms == null || ms < 0) return MetricFormat.MISSING
            val total = ms / 60_000
            return if (total >= 60) "%d시간 %02d분".format(total / 60, total % 60) else "${total}분"
        }

        /**
         * Burn-in protection: the content moves a few pixels each minute so no pixel stays lit in one place. Without it
         * the content stays put.
         */
        fun shift(mode: AmbientMode): IntOffset {
            if (!mode.burnInProtection) return IntOffset.Zero
            val steps = listOf(IntOffset(0, 0), IntOffset(6, 6), IntOffset(-6, 6), IntOffset(-6, -6), IntOffset(6, -6))
            return steps[(mode.tick % steps.size).toInt()]
        }
    }
}

/**
 * Low-power screen: black background, no filled areas, buttons or gauges; white text only (also on low-bit screens,
 * where greys turn into dithering). Tapping wakes the screen back to the page last seen.
 */
@Composable
internal fun AmbientScreen(display: AmbientDisplay, mode: AmbientMode) {
    val primary = Color.White
    val secondary = if (mode.lowBit) Color.White else Color(0xFFB0B0B0)
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        Column(
            Modifier.offset { AmbientDisplay.shift(mode) },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(display.label, style = RunwayType.Status, color = secondary)
            display.elapsed?.let { Text(it, style = RunwayType.text(44, FontWeight.Medium), color = primary) }
            display.distance?.let { Text(it, style = RunwayType.number(56, FontWeight.Normal), color = primary) }
        }
    }
}
