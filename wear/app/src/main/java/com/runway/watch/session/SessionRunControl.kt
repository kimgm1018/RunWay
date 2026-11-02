package com.runway.watch.session

import com.runway.watch.run.AnalysisStatus
import com.runway.watch.run.RunControl
import com.runway.watch.run.RunIntent
import com.runway.watch.run.RunResult
import com.runway.watch.run.RunSnapshot
import com.runway.watch.run.RunState
import com.runway.watch.run.SaveStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * The existing watch screens read the session controller through [RunControl]. The run state shown is always the
 * server-confirmed one; a request in flight, a refusal or an unconfirmed command is a one-line [RunSnapshot.notice].
 * Live metrics stay empty until the measurement batches arrive (S15P31E105-311).
 */
class SessionRunControl(
    private val controller: WatchSessionController,
    private val scope: CoroutineScope,
) : RunControl {
    private val state = MutableStateFlow(toSnapshot(controller.state.value))
    override val snapshot: StateFlow<RunSnapshot> = state

    init {
        scope.launch { controller.state.collect { state.value = toSnapshot(it) } }
    }

    override fun send(intent: RunIntent) {
        val request = when (intent) {
            RunIntent.START -> WatchRequest.START
            RunIntent.PAUSE -> WatchRequest.PAUSE
            RunIntent.RESUME -> WatchRequest.RESUME
            RunIntent.END -> WatchRequest.END
            RunIntent.CANCEL -> WatchRequest.CANCEL
            // The Data Layer reconnects by itself; there is nothing to request.
            RunIntent.RECONNECT_PHONE -> return
        }
        scope.launch { controller.request(request) }
    }

    companion object {
        private val verb = mapOf("START" to "시작", "PAUSE" to "일시정지", "RESUME" to "재개", "END" to "종료", "CANCEL" to "취소")

        fun toSnapshot(session: WatchSessionState) = RunSnapshot(
            state = session.confirmed,
            phoneConnected = session.problem != WatchProblem.PhoneUnreachable,
            pendingCommand = session.pending != null && session.problem == null,
            notice = notice(session),
            result = result(session),
        )

        /** 서버가 종료를 저장했으면 저장 완료·분석 대기(분석 계산은 S15P31E105-312), 종료를 확인하지 못했으면 저장 미확인. */
        fun result(session: WatchSessionState): RunResult? = when {
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
