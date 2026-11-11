package com.runway.watch.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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
import com.runway.watch.ui.theme.px

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
        val free = base != null && snapshot.state in adjustable && !snapshot.pendingCommand && !requesting &&
            !snapshot.phoneRecording
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

/** Drawn range of the rhythm dots on the coaching faces (unconfirmed.md: 150–190 is the design's range). */
object BpmScale {
    const val LOW = 150
    const val HIGH = 190

    fun fraction(bpm: Int?): Float? = bpm?.takeIf { it in LOW..HIGH }?.let { (it - LOW).toFloat() / (HIGH - LOW) }
}

/**
 * 9.5 페이스 코칭: the last applied coaching guide (guide pace, target rhythm BPM, cue). '적용됨' only when the watch
 * really plays that BPM. The previous guide value and an auto-coaching on/off state are not delivered, so they are not
 * shown (TODO(S15P31E105-613): add when the contract carries them). 직접 조절 opens 9.5b.
 */
@Composable
internal fun PaceCoachingPage(
    snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onPause: () -> Unit, onManual: () -> Unit,
) {
    val view = PaceCoachingDisplay.from(snapshot)
    val status = RunStatusDisplay.from(snapshot)
    val guide = snapshot.coaching
    val canOpen = !view.currentRhythm.missing || guide != null
    WatchFace(
        rim = RunStatusDisplay.rim(status),
        ticks = BpmScale.fraction(snapshot.metrics.rhythm?.beatsPerMinute),
        pages = PageDots(count, index),
        handle = pauseHandle(status, onPause),
        focused = visible,
        bottomButton = { BottomButton("직접 조절", onManual, enabled = canOpen && !snapshot.phoneRecording, kind = ButtonKind.SECONDARY) },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(px(8)), verticalAlignment = Alignment.CenterVertically) {
            Caption("페이스 코칭")
            if (view.dummy) StatusChip(PaceCoachingDisplay.DUMMY_BADGE, announce = false)
        }
        if (view.serverLost) {
            StatusIcons(listOf(StatusItem(StatusKind.SERVER, StatusLevel.CHECKING, PaceCoachingDisplay.SERVER_LOST)))
            BodyText(PaceCoachingDisplay.SERVER_LOST)
        }
        if (guide == null) {
            Title("코칭 안내를 기다려요")
            InlineMetric(view.currentRhythm, sizePx = 44)
            return@WatchFace
        }
        LabeledValue("안내", view.guidePace)
        LabeledValue(MetricFormat.RHYTHM_LABEL, view.targetRhythm.copy(symbol = null, unit = null))
        view.cue?.let { BodyText(it, RunwayColors.Content, announce = true) }
        val line = view.status ?: if (snapshot.metrics.rhythm == guide.target) "✓ ${guide.target.beatsPerMinute} BPM 적용됨" else null
        line?.let { BodyText(it, RunwayColors.Content, announce = true) }
    }
}

@Composable
private fun LabeledValue(label: String, value: MetricText) {
    Row(horizontalArrangement = Arrangement.spacedBy(px(10)), verticalAlignment = Alignment.Bottom) {
        Caption(label)
        InlineMetric(value, sizePx = 48)
    }
}

/**
 * 9.5b 직접 조절 and its request states. A press only sends a request; the beat changes when the server-approved
 * command is applied. Requesting (9.5d) locks −/+ and names the sound still playing; a refusal (9.5e) keeps the
 * current BPM; an unknown result (9.5g) shows the chosen and the last confirmed value apart and never a success check.
 * 자동으로 돌아가기 (9.5f) is left out until an auto-return mode exists in the contract.
 */
@Composable
internal fun RhythmManualScreen(snapshot: RunSnapshot, onIntent: (RunIntent) -> Unit, onPause: () -> Unit) {
    val view = PaceCoachingDisplay.from(snapshot)
    val change = snapshot.bpmChange
    val current = snapshot.metrics.rhythm?.beatsPerMinute
    val requesting = change?.status == BpmChangeStatus.REQUESTING
    val shown = if (requesting) change!!.target.beatsPerMinute else current
    WatchFace(
        rim = RunStatusDisplay.rim(RunStatusDisplay.from(snapshot)),
        ticks = BpmScale.fraction(shown),
        handle = pauseHandle(RunStatusDisplay.from(snapshot), onPause),
    ) {
        val target = change?.target?.beatsPerMinute
        when (change?.status) {
            BpmChangeStatus.REQUESTING -> StatusChip("$target BPM 요청 중", ChipLead.BUSY)
            BpmChangeStatus.REJECTED -> BodyText("$target BPM 적용 안 됨", RunwayColors.Warning, strong = true, announce = true)
            BpmChangeStatus.UNKNOWN -> BodyText("$target BPM 적용 확인 불가", RunwayColors.Content, strong = true, announce = true)
            BpmChangeStatus.APPLIED, null -> BodyText("직접 조절 중", RunwayColors.Content, strong = true)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            AdjustButton("리듬 BPM 낮추기", "−", view.canDecrease) { onIntent(RunIntent.BPM_DOWN) }
            val text = MetricFormat.rhythm(shown?.let(::RhythmBpm))
            Column(Modifier.padding(horizontal = px(4)), horizontalAlignment = Alignment.CenterHorizontally) {
                // While requesting, the number is the asked value, not yet the beat: white, not mint.
                HeroNumber(text.value, 84, (if (requesting) "요청 " else "") + text.description,
                    color = when {
                        text.missing -> RunwayColors.ContentDim
                        requesting -> RunwayColors.Content
                        else -> RunwayColors.Primary
                    })
                Text(MetricFormat.RHYTHM_LABEL, style = RunwayType.Label, color = RunwayColors.ContentSecondary)
            }
            AdjustButton("리듬 BPM 높이기", "+", view.canIncrease) { onIntent(RunIntent.BPM_UP) }
        }
        when (change?.status) {
            BpmChangeStatus.REQUESTING -> current?.let { BodyText("지금 소리 $it BPM") }
            BpmChangeStatus.REJECTED -> current?.let { BodyText("$it BPM 유지") }
            BpmChangeStatus.UNKNOWN -> BodyText("선택 $target · 마지막 확인 ${current ?: MetricFormat.MISSING}")
            BpmChangeStatus.APPLIED -> BodyText("✓ $target BPM 적용됨", RunwayColors.Content)
            null -> Unit
        }
    }
}
