package com.runway.watchdemo.presentation

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text
import androidx.wear.compose.ui.tooling.preview.WearPreviewDevices
import com.runway.watchdemo.BuildConfig
import com.runway.watchdemo.presentation.theme.RunwayWatchDemoTheme
import com.runway.watchdemo.session.*
import com.runway.watchdemo.upload.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Read-only reference: team Notion wireframe, Galaxy Watch screens 9.2 / 9.3.
private val Accent = Color(0xFFA7F6EC)
private val Surface = Color(0xFF2B2F3D)
private val Muted = Color(0xFFA8ADC1)

/** Each primary task occupies one round screen. Only the system keyboard overlays it. */
@Composable
private fun Frame(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.Black).padding(start = 22.dp, end = 22.dp, top = 22.dp, bottom = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp), content = content)
}

@Composable
private fun Label(text: String, color: Color = Muted, size: Int = 10) {
    Text(text, color = color, fontSize = size.sp, lineHeight = (size + 2).sp,
        textAlign = TextAlign.Center, maxLines = 2)
}

@Composable
private fun Pill(text: String, modifier: Modifier = Modifier, enabled: Boolean = true,
    active: Boolean = false, danger: Boolean = false, height: Int = 26, textSize: Int = 11, onClick: () -> Unit) {
    val background = when { !enabled -> Surface.copy(alpha = .5f); active -> Accent; else -> Surface }
    val foreground = when { !enabled -> Muted.copy(alpha = .5f); active -> Color.Black; else -> Color.White }
    Box(modifier.height(height.dp).clip(CircleShape).background(background)
        .semantics { selected = active }.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 5.dp), contentAlignment = Alignment.Center) {
        Text(text, color = foreground, fontSize = textSize.sp, lineHeight = (textSize + 2).sp,
            fontWeight = if (active || danger) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
    }
}

@Composable
private fun Navigation(page: Int, change: (Int) -> Unit) {
    Row(Modifier.width(120.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        listOf("BPM", "기록", "전송").forEachIndexed { index, title ->
            Pill(title, Modifier.weight(1f), active = page == index, height = 24) { change(index) }
        }
    }
}

@Composable
fun WatchApp(onStart: () -> Unit, onStop: () -> Unit, onCue: (CueSettings) -> Unit) {
    val state by WatchRuntime.state.collectAsState()
    val records by WatchRuntime.history.collectAsState()
    val feedback by WatchRuntime.feedback.collectAsState()
    var page by rememberSaveable { mutableIntStateOf(0) }
    var editor by rememberSaveable { mutableStateOf("") }
    var recordIndex by rememberSaveable { mutableIntStateOf(0) }
    var record by remember { mutableStateOf<SessionRecord?>(null) }
    var metricPage by rememberSaveable { mutableIntStateOf(0) }
    var sending by remember { mutableStateOf(false) }
    val ui = rememberCoroutineScope()
    val metadata = records.getOrNull(recordIndex.coerceIn(0, (records.size - 1).coerceAtLeast(0)))
    LaunchedEffect(state.sessionId) { if (state.busy) { page = 1; recordIndex = 0 } }
    LaunchedEffect(state.sessionId, state.state, state.message) {
        if (state.sessionId != null && state.state in setOf(SessionState.FAILED, SessionState.INTERRUPTED)) {
            WatchRuntime.feedback.value = state.message
        }
    }
    LaunchedEffect(metadata?.id, metadata?.uploadState, state.busy) {
        record = if (metadata != null && !state.busy) withContext(Dispatchers.IO) {
            runCatching { WatchRuntime.store.load(metadata.id) }.getOrNull()
        } else null
    }
    BackHandler(editor.isNotEmpty() || page != 0 || feedback.isNotEmpty()) {
        when { feedback.isNotEmpty() -> WatchRuntime.feedback.value = ""; editor.isNotEmpty() -> editor = ""; else -> page = 0 }
    }
    RunwayWatchDemoTheme {
        when {
            feedback.isNotEmpty() -> Frame {
                Spacer(Modifier.weight(1f))
                Label("안내", Accent, 13)
                Text(feedback, modifier = Modifier.width(132.dp), color = Color.White, fontSize = 11.sp, lineHeight = 15.sp, textAlign = TextAlign.Center)
                Pill("확인", Modifier.width(104.dp), active = true) { WatchRuntime.feedback.value = "" }
                Spacer(Modifier.weight(1f))
            }
            editor == "details" -> DetailsScreen(state, record, WatchRuntime.settings.participantId) { editor = "" }
            editor.isNotEmpty() -> {
                val participant = editor == "participant"
                EntryScreen(participant, state.busy, onSave = { value ->
                    if (participant && !value.matches(Regex("[A-Za-z0-9_-]{1,40}"))) {
                        WatchRuntime.feedback.value = "영문·숫자·_-로 참가자 ID를 입력하세요"
                    } else {
                        if (participant) WatchRuntime.settings.participantId = value else WatchRuntime.settings.endpoint = value
                        editor = ""
                    }
                }, onBack = { editor = "" })
            }
            else -> Frame {
                Navigation(page) { page = it }
                when (page) {
                    0 -> BpmScreen(state, WatchRuntime.settings.participantId, onCue,
                        onStart = { if (state.busy) page = 1 else onStart() },
                        onParticipant = { editor = "participant" })
                    1 -> {
                        if (!state.busy) RecordSelector(metadata, recordIndex, records.size,
                            { recordIndex--; metricPage = 0 }, { recordIndex++; metricPage = 0 })
                        val live = state.busy
                        val points = if (live) state.latest else record?.samples?.groupBy { it.kind }
                            ?.mapValues { (_, values) -> values.maxBy { it.endElapsedMs } }.orEmpty()
                        val elapsedMs = if (live) state.durationMs else record?.let { (it.endedElapsedMs ?: it.startedElapsedMs) - it.startedElapsedMs } ?: 0
                        val synthetic = if (live) android.os.Build.MODEL.contains("sdk") || android.os.Build.FINGERPRINT.contains("generic") else record?.device?.synthetic == true
                        if (live) Label("${if (synthetic) "가상" else "●"} ${state.state?.let { stateLabel(it) }}  ${duration(elapsedMs)}", Accent)
                        MetricGrid(points, if (live) SystemClock.elapsedRealtime() else points.values.maxOfOrNull { it.endElapsedMs } ?: 0,
                            metricPage, if (live) state.support else record?.capabilities.orEmpty())
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Pill(if (metricPage == 0) "페이스·거리 ›" else "SPM·보폭 ›", Modifier.weight(1f), height = 18, textSize = 10) { metricPage = 1 - metricPage }
                            if (live) Label("${state.cue.bpm} BPM", Accent, 8)
                            Pill(if (live) "상태" else "상세", Modifier.width(34.dp), height = 18) { editor = "details" }
                        }
                        if (live) Pill(if (state.state == SessionState.STOPPING) "저장 중…" else "종료",
                            Modifier.width(104.dp), enabled = state.state != SessionState.STOPPING,
                            danger = true, height = 24, onClick = onStop)
                        else Label("${if (synthetic) "가상 · " else ""}${record?.let { stateLabel(it.state) } ?: "기록 없음"} · ${duration(elapsedMs)}")
                    }
                    2 -> {
                        RecordSelector(metadata, recordIndex, records.size, { recordIndex-- }, { recordIndex++ })
                        Spacer(Modifier.weight(1f))
                        Label(if (state.busy) "측정 종료 후 전송하세요" else metadata?.let { uploadLabel(it.uploadState) } ?: "저장된 기록이 없어요", Accent, 14)
                        Label(record?.let { "${duration((it.endedElapsedMs ?: it.startedElapsedMs) - it.startedElapsedMs)} · 데이터 ${it.samples.size}개" } ?: "달리기 기록을 먼저 만들어 주세요")
                        Spacer(Modifier.weight(1f))
                        val canUpload = metadata?.isFinal == true && !state.busy && !sending && metadata.uploadState !in setOf(UploadState.UPLOADING, UploadState.UPLOADED)
                        Pill(if (sending) "전송 중…" else if (metadata?.uploadState == UploadState.UPLOADED) "전송 완료" else "서버 전송",
                            Modifier.width(112.dp), enabled = canUpload, active = true) {
                            val id = metadata?.id ?: return@Pill
                            sending = true
                            // The request and its final state publication survive Activity recreation.
                            WatchRuntime.uploads.launch {
                                try {
                                    val result = UploadCoordinator(WatchRuntime.store, SessionUploader(BuildConfig.DEBUG)).upload(id, WatchRuntime.settings.endpoint)
                                    WatchRuntime.feedback.value = result.message
                                } catch (_: Exception) { WatchRuntime.feedback.value = "전송 실패 · 기록은 보존됩니다" }
                                finally { runCatching { WatchRuntime.refresh() }; sending = false }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Pill("서버 설정", enabled = !state.busy, height = 22) { editor = "server" }
                            Pill("파일 추출", enabled = metadata?.isFinal == true && !state.busy, height = 22) {
                                val id = metadata?.id ?: return@Pill
                                ui.launch {
                                    val ok = withContext(Dispatchers.IO) { runCatching { WatchRuntime.store.export(id) }.isSuccess }
                                    WatchRuntime.feedback.value = if (ok) "JSON 저장 완료 · PC에서 추출할 수 있습니다" else "파일 저장 실패 · 저장 공간을 확인하세요"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.BpmScreen(state: RecordingSnapshot, participant: String, onCue: (CueSettings) -> Unit,
    onStart: () -> Unit, onParticipant: () -> Unit) {
    val adjustable = state.state !in setOf(SessionState.STARTING, SessionState.STOPPING)
    Row(Modifier.fillMaxWidth().height(46.dp), horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically) {
        Pill("−1", Modifier.width(32.dp), enabled = adjustable, height = 32) { onCue(state.cue.copy(bpm = MetricMath.clampBpm(state.cue.bpm - 1))) }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(state.cue.bpm.toString(), color = Accent, fontSize = 30.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold)
            Text(if (participant.isBlank()) "참가자 ID" else participant.take(9) + " ✎", color = Muted,
                fontSize = 8.sp, lineHeight = 10.sp, maxLines = 1,
                modifier = Modifier.semantics { contentDescription = "참가자 변경" }
                    .clickable(enabled = !state.busy, role = Role.Button, onClick = onParticipant))
        }
        Pill("+1", Modifier.width(32.dp), enabled = adjustable, height = 32) { onCue(state.cue.copy(bpm = MetricMath.clampBpm(state.cue.bpm + 1))) }
    }
    Label("한 박자마다 한 걸음")
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (bpm in listOf(120, 140, 160)) Pill(bpm.toString(), Modifier.width(36.dp), enabled = adjustable,
            active = state.cue.bpm == bpm, height = 20) { onCue(state.cue.copy(bpm = bpm)) }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Pill("소리 ${if (state.cue.soundEnabled) "ON" else "OFF"}", enabled = adjustable, height = 20,
            active = state.cue.soundEnabled) { onCue(state.cue.copy(soundEnabled = !state.cue.soundEnabled)) }
        Pill("진동 ${if (state.cue.vibrationEnabled) "ON" else "OFF"}", enabled = adjustable, height = 20,
            active = state.cue.vibrationEnabled) { onCue(state.cue.copy(vibrationEnabled = !state.cue.vibrationEnabled)) }
    }
    Pill(if (participant.isBlank()) "참가자 설정" else if (state.busy) "기록 보기" else "기록 시작",
        Modifier.width(112.dp), enabled = adjustable, active = true, height = 22) {
        if (participant.isBlank()) onParticipant() else onStart()
    }
}

@Composable
private fun RecordSelector(record: SessionRecord?, index: Int, count: Int, previous: () -> Unit, next: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        Pill("‹", Modifier.width(26.dp), enabled = index > 0, height = 22, onClick = previous)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Label(record?.let { date(it.startedAtEpochMs) } ?: "기록 선택", size = 8)
            Text(record?.participantId ?: "—", color = Accent, fontSize = 8.sp, lineHeight = 9.sp,
                maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
        Pill("›", Modifier.width(26.dp), enabled = index + 1 < count, height = 22, onClick = next)
    }
}

@Composable
private fun MetricGrid(values: Map<MetricKind, MetricSample>, now: Long, page: Int, support: Map<String, String>) {
    val kinds = if (page == 0) listOf(MetricKind.CADENCE to "SPM", MetricKind.HEART_RATE to "심박 bpm",
        MetricKind.SPEED to "속도 m/s", MetricKind.STEP_LENGTH to "보폭 m")
        else listOf(MetricKind.SPEED to "페이스 /km", MetricKind.DISTANCE_TOTAL to "거리 m",
            MetricKind.STEPS_TOTAL to "걸음 수", MetricKind.CADENCE to "SPM")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        for (row in kinds.chunked(2)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((kind, label) in row) {
                val sample = values[kind]
                val full = if (page == 1 && kind == MetricKind.SPEED) MetricDisplay.pace(sample, now) else MetricDisplay.value(sample, now)
                val flags = listOfNotNull("추정".takeIf { sample?.source?.let { it.startsWith("estimated") || it.contains("steps_based") } == true }, "이전".takeIf { full.contains("이전") }).joinToString("·")
                Column(Modifier.weight(1f).height(32.dp).background(Surface, RoundedCornerShape(9.dp)).padding(vertical = 2.dp),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Label(label + if (flags.isEmpty()) "" else " · $flags", size = 8)
                    Text(if (full == "—") MetricDisplay.missingReason(support, kind) else full.substringBefore(" "),
                        color = Color.White, fontSize = if (full == "—") 10.sp else 16.sp, lineHeight = 17.sp,
                        fontWeight = FontWeight.Bold, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun DetailsScreen(state: RecordingSnapshot, record: SessionRecord?, participant: String, onBack: () -> Unit) {
    Frame {
        Label(if (state.busy) "측정 상태" else "기록 상세", Accent, 13)
        Text(if (state.busy) participant else record?.participantId ?: "기록 없음", color = Color.White,
            fontSize = 10.sp, lineHeight = 12.sp, maxLines = 2, textAlign = TextAlign.Center)
        if (state.busy) {
            Label(state.message, Color.White)
            for ((kind, label) in listOf(MetricKind.CADENCE to "SPM", MetricKind.HEART_RATE to "심박",
                MetricKind.SPEED to "속도", MetricKind.STEP_LENGTH to "직접 보폭")) {
                val status = MeasurementSupport.status(state.support, kind)
                val availability = state.support["${kind.name}.availability"]
                Label("$label: ${when {
                    status == SupportStatus.PERMISSION_DENIED -> "권한 필요"
                    status == SupportStatus.UNSUPPORTED -> "미지원"
                    availability != null && availability != "AVAILABLE" -> "측정 대기"
                    status == SupportStatus.SUPPORTED -> "지원"
                    else -> "확인 중"
                }}")
            }
        } else if (record != null) {
            Label(date(record.startedAtEpochMs))
            Label("${stateLabel(record.state)} · ${uploadLabel(record.uploadState)}", Accent)
            Text(when (record.endReason) {
                "user" -> "사용자가 종료한 기록입니다"
                "process_interrupted_end_time_is_last_record" -> "앱 중단 후 복구한 기록입니다. 종료 시각은 마지막 저장 시점입니다"
                else -> record.endReason.ifBlank { "종료 사유 없음" }
            }, color = Color.White, fontSize = 10.sp, lineHeight = 12.sp, maxLines = 3, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.weight(1f))
        Pill("뒤로", Modifier.width(92.dp), active = true, height = 22, onClick = onBack)
    }
}

@Composable
private fun EntryScreen(participant: Boolean, busy: Boolean, onSave: (String) -> Unit, onBack: () -> Unit) {
    var value by rememberSaveable(participant) { mutableStateOf(if (participant) WatchRuntime.settings.participantId else WatchRuntime.settings.endpoint) }
    val input = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            WearTextInput.result(result.data, if (participant) 40 else 2048)?.let { value = it }
        }
    }
    Frame {
        Spacer(Modifier.weight(1f))
        Label(if (participant) "참가자 ID" else "업로드 서버", Accent, 14)
        Label(if (participant) "영문·숫자·_- 1~40자" else "전체 URL · 준비 전에는 비워두세요")
        if (value.isNotEmpty()) Label(value.take(45), Color.White, 11)
        Pill("입력하기", Modifier.width(116.dp), enabled = !busy) {
            try { input.launch(WearTextInput.intent(if (participant) "참가자 ID" else "업로드 URL", value)) }
            catch (_: Exception) { WatchRuntime.feedback.value = "입력기를 열지 못했습니다. 워치의 키보드 설정을 확인하세요" }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill("뒤로", Modifier.width(52.dp), onClick = onBack)
            Pill("저장", Modifier.width(60.dp), enabled = !busy, active = true) { onSave(value.trim()) }
        }
        Spacer(Modifier.weight(1f))
    }
}

private fun date(epoch: Long) = DateTimeFormatter.ofPattern("MM/dd HH:mm:ss").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(epoch))
private fun duration(ms: Long) = "%d:%02d".format(ms.coerceAtLeast(0) / 60000, ms.coerceAtLeast(0) / 1000 % 60)
private fun stateLabel(state: SessionState) = when (state) {
    SessionState.STARTING -> "연결 중"; SessionState.RUNNING -> "측정 중"; SessionState.STOPPING -> "저장 중"
    SessionState.COMPLETED -> "완료"; SessionState.INTERRUPTED -> "중단됨"; SessionState.FAILED -> "실패"
}
private fun uploadLabel(state: UploadState) = when (state) {
    UploadState.PENDING -> "전송 대기"; UploadState.UPLOADING -> "전송 중"; UploadState.UPLOADED -> "전송 완료"; UploadState.FAILED -> "다시 전송 가능"
}

@WearPreviewDevices
@Composable
fun DefaultPreview() {
    RunwayWatchDemoTheme { Frame { Navigation(0) {}; BpmScreen(RecordingSnapshot(), "runner01", {}, {}, {}) } }
}
