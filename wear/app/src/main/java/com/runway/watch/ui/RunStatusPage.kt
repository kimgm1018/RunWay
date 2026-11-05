package com.runway.watch.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Text
import com.runway.watch.readiness.CheckState
import com.runway.watch.run.FeedStatus
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType

/** A metric as shown while running. [delayed] values are the last ones received and are dimmed. */
data class LiveMetric(val text: MetricText, val delayed: Boolean = false)

data class RunStatusView(
    val pace: LiveMetric,
    val distance: LiveMetric,
    val elapsed: LiveMetric,
    val heartRate: LiveMetric,
    val cadence: LiveMetric,
    /**
     * The only status spelled out on the face. Sensor states show through the values alone (dimmed
     * or "– –") so a glance mid-run is not crowded; TalkBack still names each state.
     */
    val phoneLost: Boolean,
    /**
     * The watch reports no internet. Saving cannot be confirmed meanwhile; the run is not said to
     * continue offline or to be recovered later (online MVP).
     */
    val offline: Boolean,
    /** False for a free run: no ring, so no remaining distance or achievement is implied. */
    val hasGoal: Boolean,
    /** Null while location is not arriving, so the ring keeps only its track. */
    val ringProgress: Float?,
    /** A request (pause) is accepted but not applied yet; the run is not shown as paused. */
    val pending: Boolean,
    /** No server state for 45 s during the run (S15P31E105-257, D-8). */
    val serverLost: Boolean = false,
    /** The watch stopped recording after an app restart; the phone carries the run on (S15P31E105-445). */
    val measurementLost: Boolean = false,
    /** The run was handed to the phone: the face says so and tapping does not ask to pause (S15P31E105-464). */
    val phoneRecording: Boolean = false,
    /** Rhythm chip text, always labelled "리듬 BPM" so it is never read as heart rate (D-10). */
    val rhythmLabel: String = "",
)

/** Derives 9.2 from the snapshot only. Values that did not arrive are never filled in. */
object RunStatusDisplay {
    /** One status line on the round face, so shorter than the control-page notice (S15P31E105-445). */
    const val MEASUREMENT_LOST = "측정 끊김 · 폰에서 이어가기"
    /** The run was handed to the phone (S15P31E105-464). */
    const val PHONE_RECORDING = "폰에서 기록 중이에요"

    fun from(snapshot: RunSnapshot, online: CheckState = CheckState.UNKNOWN): RunStatusView {
        val m = snapshot.metrics
        val feeds = m.feeds
        return RunStatusView(
            pace = live(MetricFormat.pace(m.paceSecondsPerKm), feeds.location, "페이스"),
            distance = live(MetricFormat.distance(m.distanceMeters), feeds.location, "거리"),
            elapsed = LiveMetric(MetricFormat.duration(m.elapsedMs)),
            heartRate = live(MetricFormat.heartRate(m.heartRate), feeds.heartRate, "심박수"),
            cadence = live(MetricFormat.cadence(m.cadenceSpm), feeds.cadence, "케이던스"),
            phoneLost = !snapshot.phoneConnected,
            offline = online == CheckState.MISSING,
            hasGoal = m.goalProgress != null,
            ringProgress = m.goalProgress?.takeIf { feeds.location == FeedStatus.LIVE || feeds.location == FeedStatus.DELAYED },
            pending = snapshot.pendingCommand,
            serverLost = snapshot.serverLinkLost,
            measurementLost = snapshot.measurementLost,
            phoneRecording = snapshot.phoneRecording,
            rhythmLabel = PaceCoachingDisplay.rhythmLabel(m.rhythm),
        )
    }

    private fun label(status: FeedStatus): String? = when (status) {
        FeedStatus.LIVE -> null
        FeedStatus.DELAYED -> "지연"
        FeedStatus.NO_SIGNAL -> "미수신"
        FeedStatus.STOPPED -> "수집 중단"
    }

    private fun live(text: MetricText, status: FeedStatus, name: String): LiveMetric = when (status) {
        FeedStatus.LIVE -> LiveMetric(text)
        FeedStatus.DELAYED -> if (text.missing) LiveMetric(text) else LiveMetric(text.copy(description = "${text.description}, 지연"), delayed = true)
        // A value kept from before the source dropped is not a measurement now.
        FeedStatus.NO_SIGNAL, FeedStatus.STOPPED ->
            LiveMetric(text.copy(value = MetricFormat.MISSING, missing = true, description = "$name ${label(status)}"))
    }
}

/** 9.2: the edge ring is distance progress toward a goal; tapping the face asks to pause. */
@Composable
internal fun RunStatusPage(
    snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onPause: () -> Unit,
    online: CheckState = CheckState.UNKNOWN,
) {
    val view = RunStatusDisplay.from(snapshot, online)
    RoundScreen(
        Modifier.clickable(enabled = !view.pending && !view.phoneRecording, onClickLabel = "일시정지", role = Role.Button, onClick = onPause),
        background = { if (view.hasGoal) ProgressRing(view.ringProgress) }, spacing = 1.dp, focused = visible,
    ) {
        StatusHeader(view)
        Text("실제 페이스", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
        LiveValue(view.pace, 34)
        GuidePace(snapshot)
        Row(Modifier.padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                LiveValue(view.distance, 13)
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
                    Text(MetricFormat.HEART_LABEL, style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
                    LiveValue(view.heartRate, 13)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                LiveValue(view.elapsed, 13)
                LiveValue(view.cadence, 13)
            }
        }
        Chip(view.rhythmLabel, description = MetricFormat.rhythm(snapshot.metrics.rhythm).description)
        PageIndicator(count, index)
    }
}

/**
 * One line so the face never grows past the round screen: a pending request first (it lasts only
 * until confirmed), then the phone link, then the internet. No GPS item, since a GPS dot that never changes would
 * claim a fix the values may contradict.
 */
@Composable
private fun StatusHeader(view: RunStatusView) = when {
    view.pending -> Text("요청 확인 중", style = RunwayType.Caption, color = RunwayColors.Content, maxLines = 1)
    view.phoneRecording -> StatusLine(RunStatusDisplay.PHONE_RECORDING to StatusTone.NORMAL)
    view.measurementLost -> StatusLine(RunStatusDisplay.MEASUREMENT_LOST to StatusTone.WARNING)
    view.phoneLost -> StatusLine("폰 연결 끊김" to StatusTone.WARNING)
    view.serverLost -> StatusLine(PaceCoachingDisplay.SERVER_LOST to StatusTone.WARNING)
    view.offline -> StatusLine("오프라인 · 저장 미확인" to StatusTone.WARNING)
    else -> StatusLine("폰" to StatusTone.NORMAL)
}

@Composable
private fun LiveValue(metric: LiveMetric, size: Int) = MetricValue(metric.text, size, emphasized = !metric.delayed)

// Guide pace is the last applied coaching's (S15P31E105-257); details are on the pace coaching page. A group run
// shows the group's shared pace instead, so the runner never sees two guide paces at once.
@Composable
private fun GuidePace(snapshot: RunSnapshot) {
    val group = snapshot.mode == RunMode.GROUP
    val pace = if (group) GroupRunDisplay.status(snapshot).guidePaceSecondsPerKm else snapshot.metrics.guidePaceSecondsPerKm
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(if (group) "공동" else "안내", style = RunwayType.Caption, color = RunwayColors.ContentSecondary)
        MetricValue(MetricFormat.pace(pace), 11, emphasized = false)
    }
}
