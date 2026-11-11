package com.runway.watch.session

import com.runway.watch.batch.UploadState
import com.runway.watch.run.AnalysisStatus
import com.runway.watch.run.BpmChange
import com.runway.watch.run.BpmChangeStatus
import com.runway.watch.run.Coaching
import com.runway.watch.run.CoachingGuide
import com.runway.watch.run.ControlProblem
import com.runway.watch.run.ControlProblemKind
import com.runway.watch.run.RhythmBpm
import com.runway.watch.run.GroupStatus
import com.runway.watch.run.RunMetrics
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunControl
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunResult
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.run.SaveStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch

/**
 * The existing watch screens read the session controller through [RunControl]. The run state shown is always the
 * server-confirmed one; a request in flight, a refusal or an unconfirmed command is a one-line [RunSnapshot.notice].
 * A batch whose server save could not be confirmed (S15P31E105-311) shows as 기록 저장 미확인 and keeps an ended run
 * from showing as saved.
 */
class SessionRunControl(
    private val controller: WatchSessionController,
    private val scope: CoroutineScope,
    private val uploads: StateFlow<UploadState> = MutableStateFlow(UploadState()),
    /** Measured values for the screen (S15P31E105-420); the same readings also go to the uploader. */
    private val live: LiveReadings = LiveReadings(),
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 },
) : RunControl {
    private val state = MutableStateFlow(toSnapshot(controller.state.value, uploads.value))
    override val snapshot: StateFlow<RunSnapshot> = state
    private var shownSession: String? = null

    init {
        // 측정값의 신선도(실시간·지연·신호 없음)는 시간이 지나면 바뀌므로 몇 초마다 다시 계산한다.
        val ticks = flow { while (true) { emit(Unit); delay(TICK_MS) } }
        scope.launch {
            combine(controller.state, uploads, live.latest, ticks) { s, u, l, _ ->
                // 새 세션은 지난 운동의 측정값을 보이지 않는다.
                if (s.sessionId != shownSession) {
                    shownSession = s.sessionId
                    if (l != LiveReadings.Latest()) live.reset()
                }
                toSnapshot(s, u, l, elapsedMs())
            }.collect { state.value = it }
        }
    }

    override fun send(intent: RunIntent) {
        if (intent == RunIntent.BPM_UP || intent == RunIntent.BPM_DOWN) {
            val target = nextBpm(controller.state.value, intent) ?: return
            scope.launch { controller.requestBpm(target) }
            return
        }
        val request = when (intent) {
            RunIntent.START -> WatchRequest.START
            RunIntent.PAUSE -> WatchRequest.PAUSE
            RunIntent.RESUME -> WatchRequest.RESUME
            RunIntent.END -> WatchRequest.END
            RunIntent.CANCEL -> WatchRequest.CANCEL
            // The Data Layer reconnects by itself; there is nothing to request.
            RunIntent.RECONNECT_PHONE, RunIntent.BPM_UP, RunIntent.BPM_DOWN -> return
        }
        scope.launch { controller.request(request) }
    }

    companion object {
        private val verb = mapOf(
            "START" to "시작", "PAUSE" to "일시정지", "RESUME" to "재개", "END" to "종료", "CANCEL" to "취소",
            "SET_BPM" to "BPM 변경", "COACHING" to "코칭 적용",
        )

        private const val TICK_MS = 5_000L

        /**
         * Measured values shown while this watch records the run (RUNNING/PAUSED and not handed to the phone). The time
         * runs on from the last active time only while RUNNING, so a pause freezes it.
         */
        fun metrics(session: WatchSessionState, latest: LiveReadings.Latest, nowMs: Long): RunMetrics {
            val base = RunMetrics(
                guidePaceSecondsPerKm = session.coaching?.paceSecPerKm,
                rhythm = session.currentBpm?.let(::RhythmBpm),
            )
            val recording = (session.confirmed == RunState.RUNNING || session.confirmed == RunState.PAUSED) &&
                !session.phoneRecording && !session.measurementLost
            if (!recording) return base
            val active = latest.activeSec?.let {
                val since = if (session.confirmed == RunState.RUNNING) (nowMs - it.receivedMs).coerceAtLeast(0) else 0
                it.value * 1000 + since
            }
            return base.copy(
                distanceMeters = latest.distanceMeters?.value,
                elapsedMs = active,
                paceSecondsPerKm = latest.pace?.value,
                heartRate = LiveReadings.heartRate(latest),
                cadenceSpm = latest.cadence?.value,
                feeds = LiveReadings.feeds(latest, nowMs),
            )
        }

        fun toSnapshot(
            session: WatchSessionState,
            upload: UploadState = UploadState(),
            latest: LiveReadings.Latest = LiveReadings.Latest(),
            nowMs: Long = 0,
        ) = RunSnapshot(
            state = session.confirmed,
            // 그룹 참가 세션이면 그룹 화면을 쓴다(S15P31E105-420). 그룹 값은 폰이 전달한 G10 그대로다.
            mode = if (session.groupRunId != null) RunMode.GROUP else RunMode.PERSONAL,
            group = if (session.groupRunId != null) session.group ?: GroupStatus() else null,
            phoneConnected = session.problem != WatchProblem.PhoneUnreachable,
            pendingCommand = session.pending != null && session.problem == null,
            pendingIntent = session.pending?.takeIf { session.problem == null }?.let { intentOf(it.action) },
            metrics = metrics(session, latest, nowMs),
            notice = notice(session) ?: if (upload.unconfirmed) "기록 저장을 확인할 수 없어요" else null,
            result = result(session, upload),
            bpmChange = session.bpmRequest?.let { BpmChange(RhythmBpm(it.targetBpm), BpmChangeStatus.valueOf(it.status.name)) },
            coaching = session.coaching?.let {
                CoachingGuide(it.paceSecPerKm, RhythmBpm(it.targetBpm), Coaching.cue(it.targetBpm, it.previousBpm))
            },
            serverLinkLost = session.serverLinkLost,
            measurementLost = session.measurementLost,
            phoneRecording = session.phoneRecording,
            comparison = session.comparison,
            problem = problem(session),
        )

        /** The same problem the notice line names, for screens that show it as a state (S15P31E105-613). */
        fun problem(session: WatchSessionState): ControlProblem? = when (val p = session.problem) {
            is WatchProblem.Rejected -> ControlProblem(ControlProblemKind.REJECTED, intentOf(p.action))
            is WatchProblem.Unconfirmed -> ControlProblem(ControlProblemKind.UNCONFIRMED, intentOf(p.action))
            is WatchProblem.Refused -> ControlProblem(ControlProblemKind.REFUSED, p.action?.let(::intentOf))
            WatchProblem.PhoneUnreachable, null -> null
        }

        /** The run intent a pending request action stands for; null for actions without one (BPM change, coaching). */
        private fun intentOf(action: String): RunIntent? = when (action) {
            WatchRequest.START.name -> RunIntent.START
            WatchRequest.PAUSE.name -> RunIntent.PAUSE
            WatchRequest.RESUME.name -> RunIntent.RESUME
            WatchRequest.END.name -> RunIntent.END
            WatchRequest.CANCEL.name -> RunIntent.CANCEL
            else -> null
        }

        /**
         * The BPM one −/+ press asks for: the current BPM (or the guide's when none is set yet) ± one step, within
         * 60–220. Null when there is nothing to change from, the limit is reached, or a command is still waiting.
         */
        fun nextBpm(session: WatchSessionState, intent: RunIntent): Int? {
            if (session.pending != null) return null
            val base = session.currentBpm ?: session.coaching?.targetBpm ?: return null
            val next = when (intent) {
                RunIntent.BPM_UP -> base + Coaching.BPM_STEP
                RunIntent.BPM_DOWN -> base - Coaching.BPM_STEP
                else -> return null
            }
            return next.takeIf { it in Coaching.MIN_BPM..Coaching.MAX_BPM }
        }

        /**
         * 서버가 종료를 저장했으면 저장 완료와 서버가 알려 준 분석 상태(분석 계산은 S15P31E105-312, 전달은 S15P31E105-663), 종료나 마지막 기록 저장을 확인하지 못했으면
         * 저장 미확인.
         */
        fun result(session: WatchSessionState, upload: UploadState = UploadState()): RunResult? = when {
            upload.unconfirmed && (session.confirmed == RunState.COMPLETED || session.pending?.action == "END") ->
                RunResult(save = SaveStatus.UNCONFIRMED)
            session.confirmed == RunState.COMPLETED -> RunResult(
                save = SaveStatus.SAVED,
                // 서버가 알려 준 분석 상태와 요약만 쓴다. 받은 것이 없으면 분석 대기이며 값을 만들지 않는다(S15P31E105-663).
                analysis = session.analysis?.status ?: AnalysisStatus.PENDING,
                summary = session.analysis?.summary,
                goal = session.analysis?.goal,
            )
            (session.problem as? WatchProblem.Unconfirmed)?.action == "END" -> RunResult(save = SaveStatus.UNCONFIRMED)
            else -> null
        }

        /** Shown while the watch cannot record the run after a restart; the phone's take-over is the way on (S15P31E105-445). */
        const val MEASUREMENT_LOST_NOTICE = "워치 측정이 끊겼어요. 휴대폰에서 이어가세요"

        /** Shown once the run was handed to the phone; the watch buttons for it are off (S15P31E105-464). */
        const val PHONE_RECORDING_NOTICE = "폰에서 기록 중이에요"

        fun notice(session: WatchSessionState): String? = if (session.phoneRecording) PHONE_RECORDING_NOTICE
        else if (session.measurementLost) MEASUREMENT_LOST_NOTICE else when (val problem = session.problem) {
            is WatchProblem.Unconfirmed -> "${verb[problem.action] ?: "명령"} 여부를 확인할 수 없어요"
            is WatchProblem.Rejected -> "워치가 ${verb[problem.action] ?: "명령"}하지 못했어요"
            is WatchProblem.Refused -> "휴대폰에서 처리하지 못했어요"
            WatchProblem.PhoneUnreachable -> "휴대폰 연결이 없어요"
            null -> session.pending?.let { "${verb[it.action] ?: "명령"} 확인 중" }
        }
    }
}
