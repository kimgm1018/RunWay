package com.runway.watch.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.run.BpmChangeStatus
import com.runway.watch.run.Coaching
import com.runway.watch.run.RhythmBpm
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

data class PaceCoachingView(
    /** Guide pace of the last applied coaching; missing ("– –") until one is applied. */
    val guidePace: MetricText,
    /** Target rhythm BPM of that coaching. */
    val targetRhythm: MetricText,
    val cue: String?,
    /** Shows the "더미 안내" badge (D-10). */
    val dummy: Boolean,
    /** The rhythm BPM in effect now. */
    val currentRhythm: MetricText,
    val canDecrease: Boolean,
    val canIncrease: Boolean,
    /** Where the runner's last BPM change stands; null when there is nothing to report. */
    val status: String?,
    val serverLost: Boolean,
)

/** Derives 9.5 (pace coaching) from the snapshot only (S15P31E105-257). */
object PaceCoachingDisplay {
    const val DUMMY_BADGE = "더미 안내"
    const val SERVER_LOST = "서버 연결 끊김"

    private val adjustable = setOf(RunState.READY, RunState.RUNNING, RunState.PAUSED)

    fun from(snapshot: RunSnapshot): PaceCoachingView {
        val guide = snapshot.coaching
        val current = snapshot.metrics.rhythm
        val base = current?.beatsPerMinute ?: guide?.target?.beatsPerMinute
        val requesting = snapshot.bpmChange?.status == BpmChangeStatus.REQUESTING
        // 서버 승인 전에는 박자를 바꾸지 않으므로, 앞선 요청·명령이 확인될 때까지 다음 조절을 막는다.
        val free = base != null && snapshot.state in adjustable && !snapshot.pendingCommand && !requesting
        return PaceCoachingView(
            guidePace = MetricFormat.pace(guide?.paceSecondsPerKm).let { it.copy(description = "안내 ${it.description}") },
            targetRhythm = MetricFormat.rhythm(guide?.target).let { it.copy(description = "목표 ${it.description}") },
            cue = guide?.cue,
            dummy = guide?.dummy == true,
            currentRhythm = MetricFormat.rhythm(current),
            canDecrease = free && base!! - Coaching.BPM_STEP >= Coaching.MIN_BPM,
            canIncrease = free && base!! + Coaching.BPM_STEP <= Coaching.MAX_BPM,
            status = status(snapshot),
            serverLost = snapshot.serverLinkLost,
        )
    }

    fun status(snapshot: RunSnapshot): String? {
        val change = snapshot.bpmChange ?: return null
        val bpm = change.target.beatsPerMinute
        return when (change.status) {
            BpmChangeStatus.REQUESTING -> "리듬 BPM $bpm 요청 중"
            BpmChangeStatus.APPLIED -> "리듬 BPM $bpm 적용됨"
            BpmChangeStatus.REJECTED -> "리듬 BPM $bpm 변경 거절"
            BpmChangeStatus.UNKNOWN -> "리듬 BPM $bpm 적용 확인 불가"
        }
    }

    /** "♪ 리듬 BPM 172": the rhythm always carries its label so it is never read as heart rate (D-10). */
    fun rhythmLabel(rhythm: RhythmBpm?): String {
        val text = MetricFormat.rhythm(rhythm)
        return "${text.symbol}︎ ${MetricFormat.RHYTHM_LABEL} ${text.value}"
    }
}

/**
 * 9.5: guide pace, target rhythm BPM and the cue of the last applied coaching, plus −/+ to ask for a rhythm BPM
 * change. A press only sends a request; the beat changes when the server-approved command is applied.
 */
@Composable
internal fun PaceCoachingPage(snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onIntent: (RunIntent) -> Unit) {
    val view = PaceCoachingDisplay.from(snapshot)
    RoundScreen(spacing = 3.dp, focused = visible) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("페이스 코칭", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
            if (view.dummy) Chip(PaceCoachingDisplay.DUMMY_BADGE)
        }
        if (view.serverLost) StatusLine(PaceCoachingDisplay.SERVER_LOST to StatusTone.WARNING)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            Text("안내", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
            MetricValue(view.guidePace, 24)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            Text("목표 ${MetricFormat.RHYTHM_LABEL}", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
            MetricValue(view.targetRhythm.copy(symbol = null, unit = null), 13, emphasized = false)
        }
        view.cue?.let {
            Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = RunwayType.Body.copy(fontWeight = FontWeight.Bold), color = RunwayColors.Content, textAlign = TextAlign.Center)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundButton("리듬 BPM 낮추기", { onIntent(RunIntent.BPM_DOWN) }, kind = ButtonKind.SECONDARY, enabled = view.canDecrease, size = 40) {
                Text("−", style = RunwayType.Title, color = it)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(MetricFormat.RHYTHM_LABEL, style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
                MetricValue(view.currentRhythm.copy(unit = null), 20)
            }
            RoundButton("리듬 BPM 높이기", { onIntent(RunIntent.BPM_UP) }, kind = ButtonKind.SECONDARY, enabled = view.canIncrease, size = 40) {
                Text("+", style = RunwayType.Title, color = it)
            }
        }
        view.status?.let {
            Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = RunwayType.Caption, color = RunwayColors.ContentSecondary, textAlign = TextAlign.Center)
        }
        PageIndicator(count, index)
    }
}
