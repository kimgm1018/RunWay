package com.runway.watch.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.runway.watch.navigation.RunDetail
import com.runway.watch.readiness.CheckState
import com.runway.watch.run.FeedStatus
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunSnapshot
import com.runway.watch.ui.component.*
import com.runway.watch.ui.format.MetricFormat
import com.runway.watch.ui.format.MetricText
import com.runway.watch.ui.theme.HeroSize
import com.runway.watch.ui.theme.RunwayColors
import com.runway.watch.ui.theme.RunwayType
import androidx.wear.compose.material3.Text
import com.runway.watch.ui.theme.largeFont
import com.runway.watch.ui.theme.px

/** A metric as shown while running. [delayed] values are the last ones received and are dimmed. */
data class LiveMetric(val text: MetricText, val delayed: Boolean = false, val status: FeedStatus = FeedStatus.LIVE)

data class RunStatusView(
    val pace: LiveMetric,
    val distance: LiveMetric,
    val elapsed: LiveMetric,
    val heartRate: LiveMetric,
    val cadence: LiveMetric,
    /** The watch lost the phone: control results cannot be confirmed (9.2d). */
    val phoneLost: Boolean,
    /**
     * The watch reports no internet. Saving cannot be confirmed meanwhile; the run is not said to
     * continue offline or to be recovered later (online MVP).
     */
    val offline: Boolean,
    /** False for a free run: the distance arc keeps only its track, so no remaining distance or achievement is implied. */
    val hasGoal: Boolean,
    /** Null while location is not arriving, so the arc keeps only its track. */
    val ringProgress: Float?,
    /** A request (pause) is accepted but not applied yet; the run is not shown as paused. */
    val pending: Boolean,
    /** No server state for 45 s during the run (S15P31E105-257, D-8; 9.2e). */
    val serverLost: Boolean = false,
    /** The watch stopped recording after an app restart; the phone carries the run on (S15P31E105-445). */
    val measurementLost: Boolean = false,
    /** The run was handed to the phone: the face says so and the handle does not ask to pause (S15P31E105-464). */
    val phoneRecording: Boolean = false,
    /** Rhythm text, always labelled "리듬 BPM" so it is never read as heart rate (D-10). */
    val rhythmLabel: String = "",
    /** Pace dots 0..1 over the drawn 8’00”–4’00” range; null when there is no live pace or it is outside (9.2c). */
    val paceTicks: Float? = null,
    /** A live pace the dots cannot show (9.2c): the number stays, the dots go out. */
    val paceOutOfRange: Boolean = false,
)

/** The drawn range of the pace dots (tokens.md pace_ticks: 8’00” → 4’00”). A user-based range is a design follow-up. */
object PaceScale {
    const val SLOWEST = 480
    const val FASTEST = 240

    fun fraction(secondsPerKm: Int?): Float? = secondsPerKm?.takeIf { it in FASTEST..SLOWEST }
        ?.let { (SLOWEST - it).toFloat() / (SLOWEST - FASTEST) }

    fun outOfRange(secondsPerKm: Int?): Boolean = secondsPerKm != null && secondsPerKm > 0 && secondsPerKm !in FASTEST..SLOWEST
}

/** Derives 9.2 from the snapshot only. Values that did not arrive are never filled in. */
object RunStatusDisplay {
    /** One status line on the round face, so shorter than the control-page notice (S15P31E105-445). */
    const val MEASUREMENT_LOST = "측정 끊김 · 폰에서 이어가기"
    /** The run was handed to the phone (S15P31E105-464). */
    const val PHONE_RECORDING = "폰에서 기록 중이에요"
    const val PHONE_LOST = "제어 결과를 확인할 수 없어요"
    const val SERVER_DELAY = "기록 비교·그룹 정보가 멈췄어요"
    const val OFFLINE = "오프라인 · 저장 미확인"
    const val OUT_OF_RANGE = "페이스 눈금 범위 밖"
    /** Location late with a pace kept: the dimmed number is the last one received (S15P31E105-849 A안). */
    const val LOCATION_LAST_PACE = "위치 지연 · 마지막 페이스"
    const val LOCATION_LATE = "위치 지연 · 페이스 대기"
    const val LOCATION_NO_SIGNAL = "위치 수신 없음"
    const val LOCATION_STOPPED = "위치 수집 중단"

    fun from(snapshot: RunSnapshot, online: CheckState = CheckState.UNKNOWN): RunStatusView {
        val m = snapshot.metrics
        val feeds = m.feeds
        val pace = live(MetricFormat.pace(m.paceSecondsPerKm), feeds.location, "페이스")
        val livePace = m.paceSecondsPerKm.takeIf { feeds.location == FeedStatus.LIVE && !pace.text.missing }
        return RunStatusView(
            pace = pace,
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
            paceTicks = PaceScale.fraction(livePace),
            paceOutOfRange = PaceScale.outOfRange(livePace),
        )
    }

    /** Rim of the running faces: tl = goal distance progress only (see [RimValues]). Dimmed while location is late. */
    fun rim(view: RunStatusView): RimValues =
        RimValues(tl = view.ringProgress, dim = view.distance.delayed)

    /**
     * The one line the status face shows while location is not live (S15P31E105-849 A안). Heart rate and cadence states
     * are not repeated here; they stay in the heart-rate·cadence detail. Null while location is live.
     */
    fun locationLine(view: RunStatusView): String? = when (view.distance.status) {
        FeedStatus.LIVE -> null
        FeedStatus.DELAYED -> if (view.pace.text.missing) LOCATION_LATE else LOCATION_LAST_PACE
        FeedStatus.NO_SIGNAL -> LOCATION_NO_SIGNAL
        FeedStatus.STOPPED -> LOCATION_STOPPED
    }

    /** Label under the distance while location is not live: a late value is the last one confirmed, never current. */
    fun distanceLabel(view: RunStatusView): String = if (view.distance.delayed) "km · 마지막 확인" else "km"

    /** Words for a source state in its detail. Only an existing feed state; no seconds-ago without a timestamp. */
    fun feedLabel(status: FeedStatus): String = when (status) {
        FeedStatus.LIVE -> "정상"
        FeedStatus.DELAYED -> "지연"
        FeedStatus.NO_SIGNAL -> "수신 없음"
        FeedStatus.STOPPED -> "수집 중단"
    }

    private fun label(status: FeedStatus): String? = when (status) {
        FeedStatus.LIVE -> null
        FeedStatus.DELAYED -> "지연"
        FeedStatus.NO_SIGNAL -> "미수신"
        FeedStatus.STOPPED -> "수집 중단"
    }

    private fun live(text: MetricText, status: FeedStatus, name: String): LiveMetric = when (status) {
        FeedStatus.LIVE -> LiveMetric(text)
        FeedStatus.DELAYED -> if (text.missing) LiveMetric(text, status = status)
        else LiveMetric(text.copy(description = "${text.description}, 지연"), delayed = true, status = status)
        // A value kept from before the source dropped is not a measurement now.
        FeedStatus.NO_SIGNAL, FeedStatus.STOPPED ->
            LiveMetric(text.copy(value = MetricFormat.MISSING, missing = true, description = "$name ${label(status)}"), status = status)
    }

    /** Status icons for the sources with a problem or being checked; normal sources stay hidden. */
    fun statusItems(view: RunStatusView): List<StatusItem> = buildList {
        if (view.phoneLost) add(StatusItem(StatusKind.PHONE, StatusLevel.PROBLEM, "휴대폰 연결 끊김"))
        if (view.serverLost) add(StatusItem(StatusKind.SERVER, StatusLevel.CHECKING, "서버 연결 지연"))
        else if (view.offline) add(StatusItem(StatusKind.SERVER, StatusLevel.PROBLEM, "인터넷 연결 없음"))
        when (view.distance.status) {
            FeedStatus.LIVE -> Unit
            FeedStatus.DELAYED -> add(StatusItem(StatusKind.GPS, StatusLevel.CHECKING, "위치 지연"))
            else -> add(StatusItem(StatusKind.GPS, StatusLevel.PROBLEM, "위치 ${feedLabel(view.distance.status)}"))
        }
        when (view.heartRate.status) {
            FeedStatus.LIVE -> Unit
            FeedStatus.DELAYED -> add(StatusItem(StatusKind.HEART, StatusLevel.CHECKING, "심박 지연"))
            else -> add(StatusItem(StatusKind.HEART, StatusLevel.PROBLEM, "심박 ${feedLabel(view.heartRate.status)}"))
        }
    }
}

/** Right handle while running: ❚❚ asks to pause once; locked with a spinner while any request waits. */
internal fun pauseHandle(view: RunStatusView, onPause: () -> Unit): HandleSpec? = when {
    view.phoneRecording -> null
    view.pending -> HandleSpec(HandleIcon.BUSY, "요청 확인 중", false, onPause)
    else -> HandleSpec(HandleIcon.PAUSE, "일시정지", true, onPause)
}

/**
 * 9.2 운동 현황: pace as the key number over the pace dots, distance and time below. The upper-left arc is goal distance
 * progress. Tapping a value opens its detail (9.2-1~3); the heart mark on the left edge opens heart rate and cadence
 * (9.2-4). Link and sensor problems stay on this page as icons and one line (no forced screen change). While location
 * is not live the face keeps this layout with one location line in place of the icons (S15P31E105-849 A안); heart
 * rate and cadence states are read in their detail instead of being repeated here.
 */
@Composable
internal fun RunStatusPage(
    snapshot: RunSnapshot, count: Int, index: Int, visible: Boolean, onPause: () -> Unit,
    online: CheckState = CheckState.UNKNOWN, onDetail: (RunDetail) -> Unit = {},
) {
    val view = RunStatusDisplay.from(snapshot, online)
    val location = RunStatusDisplay.locationLine(view)
    val linkProblem = view.phoneLost || view.serverLost || view.offline
    Box(Modifier.fillMaxSize()) {
        WatchFace(
            rim = RunStatusDisplay.rim(view),
            ticks = view.paceTicks,
            pages = PageDots(count, index),
            handle = pauseHandle(view, onPause),
            focused = visible,
        ) {
            // The location line already names the GPS state, so its icons would only repeat it; a link problem keeps them.
            if (location == null || linkProblem) StatusIcons(RunStatusDisplay.statusItems(view))
            StatusBoard(view, location, linkProblem, onDetail)
        }
        // Heart mark on the left edge: a 48dp target for 9.2-4.
        Box(
            Modifier.align(Alignment.CenterStart).padding(top = px(36)).size(48.dp)
                .clickable(role = Role.Button, onClickLabel = "심박·케이던스 보기") { onDetail(RunDetail.BODY) }
                .semantics { contentDescription = "심박·케이던스 보기" },
        )
    }
}

@Composable
private fun StatusBoard(view: RunStatusView, location: String?, linkProblem: Boolean, onDetail: (RunDetail) -> Unit) {
    when {
        view.phoneLost -> BodyText(RunStatusDisplay.PHONE_LOST, RunwayColors.Warning, strong = true, announce = true)
        view.serverLost -> BodyText(RunStatusDisplay.SERVER_DELAY, announce = true)
        view.offline -> BodyText(RunStatusDisplay.OFFLINE, announce = true)
        location != null -> BodyText(location, RunwayColors.Warning, announce = true)
    }
    Box(Modifier.clickable(role = Role.Button, onClickLabel = "페이스 자세히") { onDetail(RunDetail.PACE) }) {
        HeroMetric(view.pace.text, HeroSize.PACE, unit = null, dim = view.pace.delayed)
    }
    if (view.paceOutOfRange) Caption(RunStatusDisplay.OUT_OF_RANGE)
    if (linkProblem) return
    Divider()
    if (location == null) CellRow {
        InlineMetric(view.distance.text,
            modifier = Modifier.clickable(role = Role.Button, onClickLabel = "거리 자세히") { onDetail(RunDetail.DISTANCE) })
        InlineMetric(view.elapsed.text,
            modifier = Modifier.clickable(role = Role.Button, onClickLabel = "운동 시간 자세히") { onDetail(RunDetail.TIME) })
    } else if (largeFont()) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(px(4))) {
        // Stacked labelled cells do not fit a large font: the grey distance and the line above tell it is the last one.
        InlineMetric(view.distance.text.copy(description = view.distance.text.description + if (view.distance.delayed) ", 마지막 확인" else ""),
            color = RunwayColors.ContentDim,
            modifier = Modifier.clickable(role = Role.Button, onClickLabel = "거리 자세히") { onDetail(RunDetail.DISTANCE) })
        InlineMetric(view.elapsed.text,
            modifier = Modifier.clickable(role = Role.Button, onClickLabel = "운동 시간 자세히") { onDetail(RunDetail.TIME) })
    } else CellRow {
        // Labelled cells: the distance is the last one confirmed (grey) or "– –", told apart from the running time.
        Box(Modifier.clickable(role = Role.Button, onClickLabel = "거리 자세히") { onDetail(RunDetail.DISTANCE) }) {
            ValueCell(view.distance.text.value, RunStatusDisplay.distanceLabel(view),
                view.distance.text.description + if (view.distance.delayed) ", 마지막 확인" else "", valueColor = RunwayColors.ContentDim)
        }
        Box(Modifier.clickable(role = Role.Button, onClickLabel = "운동 시간 자세히") { onDetail(RunDetail.TIME) }) {
            ValueCell(view.elapsed.text.value, "운동 시간", view.elapsed.text.description)
        }
    }
}

/**
 * 9.2-1~4: one value large, opened from the status page. Not a page: no page dots, back returns to the page it came
 * from. The handle stays so pausing never needs a detour.
 */
@Composable
internal fun RunDetailScreen(
    snapshot: RunSnapshot, detail: RunDetail, onClose: () -> Unit = {}, onPause: () -> Unit,
) {
    val view = RunStatusDisplay.from(snapshot)
    // A tap anywhere but the pause handle goes back to the status page, as back does (S15P31E105-658).
    WatchFace(modifier = Modifier.clickable(role = Role.Button, onClickLabel = "현황으로 돌아가기", onClick = onClose), rim = RunStatusDisplay.rim(view), ticks = if (detail == RunDetail.PACE) view.paceTicks else null,
        handle = pauseHandle(view, onPause)) {
        when (detail) {
            RunDetail.PACE -> {
                HeroMetric(view.pace.text, HeroSize.PACE, unit = null, dim = view.pace.delayed)
                if (view.paceOutOfRange) Caption(RunStatusDisplay.OUT_OF_RANGE)
                GuideLine(snapshot)
            }
            RunDetail.DISTANCE -> HeroMetric(view.distance.text, HeroSize.SHORT, dim = view.distance.delayed)
            RunDetail.TIME -> HeroMetric(view.elapsed.text, HeroSize.forText(view.elapsed.text.value))
            RunDetail.BODY -> {
                // Each source keeps its own state here, so the status face does not have to repeat them (S15P31E105-849).
                // One step smaller while a state line has to fit under a value on the round face.
                val size = if (view.heartRate.status == FeedStatus.LIVE && view.cadence.status == FeedStatus.LIVE) 88 else 68
                InlineHero(view.heartRate.text, "bpm", RunwayColors.Primary, size)
                FeedState(view.heartRate, warn = true)
                Divider(180)
                InlineHero(view.cadence.text, null, RunwayColors.Content, size)
                FeedState(view.cadence)
            }
            RunDetail.RHYTHM -> Unit
        }
        if (detail == RunDetail.DISTANCE && view.distance.status != FeedStatus.LIVE) Caption(RunStatusDisplay.feedLabel(view.distance.status))
    }
}

/** A source's state under its value, only when it is not live; an off heart sensor is a warning like the heart mark. */
@Composable
private fun FeedState(metric: LiveMetric, warn: Boolean = false) {
    if (metric.status == FeedStatus.LIVE) return
    Text(RunStatusDisplay.feedLabel(metric.status), style = RunwayType.Label,
        color = if (warn && metric.status != FeedStatus.DELAYED) RunwayColors.Warning else RunwayColors.ContentSecondary)
}

@Composable
private fun InlineHero(text: MetricText, unit: String?, color: Color, sizePx: Int = 88) {
    InlineMetric(text, sizePx = sizePx, unit = unit ?: text.unit, color = if (text.missing) RunwayColors.ContentDim else color)
}

/**
 * "안내 6’00” 리듬 172 BPM" under the pace detail. A group run shows the group's shared pace instead, so the runner never
 * sees two guide paces at once.
 */
@Composable
private fun GuideLine(snapshot: RunSnapshot) {
    val group = snapshot.mode == RunMode.GROUP
    val pace = MetricFormat.pace(if (group) GroupRunDisplay.status(snapshot).guidePaceSecondsPerKm else snapshot.metrics.guidePaceSecondsPerKm)
    val rhythm = MetricFormat.rhythm(snapshot.metrics.rhythm)
    Row(horizontalArrangement = Arrangement.spacedBy(px(6)), verticalAlignment = Alignment.Bottom) {
        Caption(if (group) "공동" else "안내")
        InlineMetric(pace, sizePx = 36)
        Caption("리듬")
        InlineMetric(rhythm.copy(symbol = null, unit = null), sizePx = 36)
    }
}
