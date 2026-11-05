package com.runway.watch.session

import com.runway.watch.batch.UploadState
import com.runway.watch.run.AnalysisStatus
import com.runway.watch.run.BpmChange
import com.runway.watch.run.BpmChangeStatus
import com.runway.watch.run.Coaching
import com.runway.watch.run.CoachingGuide
import com.runway.watch.run.RhythmBpm
import com.runway.watch.run.RunMetrics
import com.runway.watch.run.RunControl
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunResult
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.run.SaveStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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
) : RunControl {
    private val state = MutableStateFlow(toSnapshot(controller.state.value, uploads.value))
    override val snapshot: StateFlow<RunSnapshot> = state

    init {
        scope.launch { controller.state.combine(uploads) { s, u -> toSnapshot(s, u) }.collect { state.value = it } }
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

        fun toSnapshot(session: WatchSessionState, upload: UploadState = UploadState()) = RunSnapshot(
            state = session.confirmed,
            phoneConnected = session.problem != WatchProblem.PhoneUnreachable,
            pendingCommand = session.pending != null && session.problem == null,
            pendingIntent = session.pending?.takeIf { session.problem == null }?.let { intentOf(it.action) },
            metrics = RunMetrics(
                guidePaceSecondsPerKm = session.coaching?.paceSecPerKm,
                rhythm = session.currentBpm?.let(::RhythmBpm),
            ),
            notice = notice(session) ?: if (upload.unconfirmed) "기록 저장을 확인할 수 없어요" else null,
            result = result(session, upload),
            bpmChange = session.bpmRequest?.let { BpmChange(RhythmBpm(it.targetBpm), BpmChangeStatus.valueOf(it.status.name)) },
            coaching = session.coaching?.let {
                CoachingGuide(it.paceSecPerKm, RhythmBpm(it.targetBpm), Coaching.cue(it.targetBpm, it.previousBpm))
            },
            serverLinkLost = session.serverLinkLost,
        )

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
         * 서버가 종료를 저장했으면 저장 완료·분석 대기(분석 계산은 S15P31E105-312), 종료나 마지막 기록 저장을 확인하지 못했으면
         * 저장 미확인.
         */
        fun result(session: WatchSessionState, upload: UploadState = UploadState()): RunResult? = when {
            upload.unconfirmed && (session.confirmed == RunState.COMPLETED || session.pending?.action == "END") ->
                RunResult(save = SaveStatus.UNCONFIRMED)
            session.confirmed == RunState.COMPLETED -> RunResult(save = SaveStatus.SAVED, analysis = AnalysisStatus.PENDING)
            (session.problem as? WatchProblem.Unconfirmed)?.action == "END" -> RunResult(save = SaveStatus.UNCONFIRMED)
            else -> null
        }

        fun notice(session: WatchSessionState): String? = when (val problem = session.problem) {
            is WatchProblem.Unconfirmed -> "${verb[problem.action] ?: "명령"} 여부를 확인할 수 없어요"
            is WatchProblem.Rejected -> "워치가 ${verb[problem.action] ?: "명령"}하지 못했어요"
            is WatchProblem.Refused -> "휴대폰에서 처리하지 못했어요"
            WatchProblem.PhoneUnreachable -> "휴대폰 연결이 없어요"
            null -> session.pending?.let { "${verb[it.action] ?: "명령"} 확인 중" }
        }
    }
}
