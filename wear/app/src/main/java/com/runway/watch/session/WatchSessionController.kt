package com.runway.watch.session

import com.runway.watch.batch.NoUploads
import com.runway.watch.batch.RunUploads
import com.runway.watch.run.RunState
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import java.time.Instant

/** What the user pressed on the watch. Only a request is sent; nothing runs until the server approves. */
enum class WatchRequest { START, PAUSE, RESUME, END, CANCEL }

enum class PendingStage { REQUESTED, EXECUTING, AWAITING_SAVE }

data class PendingCommand(val action: String, val commandId: String?, val stage: PendingStage)

sealed interface WatchProblem {
    data class Rejected(val action: String, val reasonCode: String?) : WatchProblem
    /** Execution or its save could not be confirmed. Never shown as success or failure. */
    data class Unconfirmed(val action: String) : WatchProblem
    /** The phone could not process a watch request (ERROR message). */
    data class Refused(val code: String) : WatchProblem
    data object PhoneUnreachable : WatchProblem
}

/** [confirmed] changes only when the server saved (COMMAND_RECEIVED persisted=true or STATE_RESULT scope=SERVER). */
data class WatchSessionState(
    val sessionId: String? = null,
    val confirmed: RunState? = null,
    val stateVersion: Long = 0,
    val pending: PendingCommand? = null,
    val problem: WatchProblem? = null,
)

private val NEXT_STATE = mapOf(
    "START" to RunState.RUNNING,
    "PAUSE" to RunState.PAUSED,
    "RESUME" to RunState.RUNNING,
    "END" to RunState.COMPLETED,
)

private val ALLOWED_FROM = mapOf(
    "PAUSE" to setOf(RunState.RUNNING),
    "RESUME" to setOf(RunState.PAUSED),
    "END" to setOf(RunState.RUNNING, RunState.PAUSED),
)

/**
 * Runs approved commands once per commandId (S15P31E105-256 [D], watch-mobile-server-integration.md 9.4).
 * Results are stored before they are sent, so a resend after a restart is answered from the store.
 */
class WatchSessionController(
    private val store: SessionStore,
    private val gateway: ExerciseGateway,
    private val sender: SessionSender,
    private val now: () -> Instant = { Instant.now() },
    private val sleep: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    private val jitter: () -> Long = { kotlin.random.Random.nextLong(0, 501) },
    private val callTimeoutMs: Long = 15_000,
    private val uploads: RunUploads = NoUploads,
    private val keepAlive: RunKeepAlive = NoKeepAlive,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(
        store.prepared()?.let { WatchSessionState(sessionId = it.sessionId, confirmed = RunState.READY, stateVersion = it.stateVersion) }
            ?: WatchSessionState(),
    )
    val state: StateFlow<WatchSessionState> = _state

    suspend fun onMessage(message: SessionEnvelope) = mutex.withLock {
        when (message.type) {
            "SESSION_PREPARE" -> onPrepare(message)
            "START_AUTHORIZED" -> onCommand(message, "START")
            "COMMAND_REQUEST" -> onCommand(message, message.payload.optString("action"))
            "COMMAND_RECEIVED" -> onReceived(message)
            "STATE_RESULT" -> onServerState(message)
            "ERROR" -> _state.value = _state.value.copy(
                pending = null,
                problem = WatchProblem.Refused(message.payload.optString("code", "UNKNOWN")),
            )
        }
    }

    /** Sends a request for a watch button. False when another command is still waiting or there is no session. */
    suspend fun request(request: WatchRequest): Boolean = mutex.withLock {
        val current = _state.value
        val sessionId = current.sessionId ?: return@withLock false
        if (current.pending != null) return@withLock false
        val bytes = if (request == WatchRequest.START) {
            val prepared = store.prepared()?.takeIf { it.sessionId == sessionId && it.ready } ?: return@withLock false
            SessionMessages.startRequest(store.nextMessageId(), sessionId, prepared.stateVersion)
        } else {
            SessionMessages.commandRequest(store.nextMessageId(), sessionId, request.name, current.stateVersion)
        }
        val path = if (request == WatchRequest.START) SessionPaths.START_REQUEST else SessionPaths.COMMAND
        _state.value = current.copy(pending = PendingCommand(request.name, null, PendingStage.REQUESTED), problem = null)
        if (!sendWithRetry(path, bytes)) {
            _state.value = _state.value.copy(pending = null, problem = WatchProblem.PhoneUnreachable)
            return@withLock false
        }
        true
    }

    private suspend fun onPrepare(message: SessionEnvelope) {
        val version = message.payload.optLong("stateVersion", -1)
        if (version < 1) return
        // 측정 batch의 생산 기기 ID가 없으면 기록을 저장할 수 없으므로 준비하지 않는다(S15P31E105-311).
        val deviceId = message.deviceId()
        val ready = deviceId != null
        val reason = if (ready) null else "DEVICE_ID_MISSING"
        store.savePrepared(Prepared(message.sessionId, version, ready = ready, deviceId = deviceId))
        val current = _state.value
        _state.value = if (current.sessionId == message.sessionId && current.confirmed != null) {
            current.copy(stateVersion = maxOf(current.stateVersion, version))
        } else {
            WatchSessionState(sessionId = message.sessionId, confirmed = RunState.READY, stateVersion = version)
        }
        sendWithRetry(SessionPaths.PREPARED, SessionMessages.prepared(store.nextMessageId(), message.sessionId, version, ready, reason))
    }

    private suspend fun onCommand(message: SessionEnvelope, action: String) {
        val commandId = message.commandId() ?: return
        if (action !in NEXT_STATE) return
        val stored = store.outcome(commandId)
        if (stored != null) {
            // 같은 명령은 다시 실행하지 않는다. 실행 도중 끊겼다면 실제 적용 여부를 모르므로 UNKNOWN으로 남긴다.
            val outcome = if (stored.result == OutcomeResult.EXECUTING) {
                stored.copy(result = OutcomeResult.UNKNOWN, reasonCode = "EXERCISE_CALL_FAILED").also(store::saveOutcome)
            } else {
                stored
            }
            sendResult(message, outcome)
            return
        }
        val expected = message.payload.optLong("expectedVersion", -1)
        val reason = rejectionReason(message.sessionId, action, expected)
        if (reason != null) {
            val rejected = CommandOutcome(message.sessionId, commandId, action, OutcomeResult.REJECTED, null, reason, false, null)
            store.saveOutcome(rejected)
            sendResult(message, rejected)
            return
        }

        // 측정을 시작하기 전에 프로세스를 유지시켜 화면을 벗어나도 기록이 끊기지 않게 한다(S15P31E105-311).
        if (action == "START") keepAlive.start()
        store.saveOutcome(CommandOutcome(message.sessionId, commandId, action, OutcomeResult.EXECUTING, null, null, false, null))
        _state.value = _state.value.copy(pending = PendingCommand(action, commandId, PendingStage.EXECUTING), problem = null)
        val outcome = try {
            withTimeout(callTimeoutMs) {
                when (action) {
                    "START" -> gateway.start()
                    "PAUSE" -> gateway.pause()
                    "RESUME" -> gateway.resume()
                    else -> gateway.end()
                }
            }
            CommandOutcome(message.sessionId, commandId, action, OutcomeResult.APPLIED, now(), null, false, null)
        } catch (e: TimeoutCancellationException) {
            CommandOutcome(message.sessionId, commandId, action, OutcomeResult.UNKNOWN, null, "EXERCISE_CALL_TIMEOUT", false, null)
        } catch (e: ExerciseRejected) {
            CommandOutcome(message.sessionId, commandId, action, OutcomeResult.REJECTED, null, e.reasonCode, false, null)
        } catch (e: Exception) {
            CommandOutcome(message.sessionId, commandId, action, OutcomeResult.UNKNOWN, null, "EXERCISE_CALL_FAILED", false, null)
        }
        store.saveOutcome(outcome)
        if (outcome.result == OutcomeResult.APPLIED) {
            when (action) {
                "START" -> store.prepared()?.deviceId?.let { uploads.begin(message.sessionId, it) }
                // 종료 직후 남은 측정값을 마지막 batch로 보내고 서버 저장 확인을 기다린 뒤 결과를 보고한다(9.3 COMMAND_RESULT).
                "END" -> uploads.finish(message.sessionId)
            }
        }
        sendResult(message, outcome)
        // 종료가 적용되면 마지막 batch까지 보낸 뒤 유지를 푼다. 시작이 거절·미확인이면 측정이 없으므로 바로 푼다.
        if ((action == "END" && outcome.result == OutcomeResult.APPLIED) ||
            (action == "START" && outcome.result == OutcomeResult.REJECTED)
        ) {
            keepAlive.stop()
        }
    }

    /** 9.4: 준비 미확인·낮은 버전은 거절, 확정 상태에서 허용되지 않는 동작도 실행하지 않는다. */
    private fun rejectionReason(sessionId: String, action: String, expected: Long): String? {
        val current = _state.value
        if (action == "START") {
            val prepared = store.prepared()
            if (prepared == null || prepared.sessionId != sessionId || !prepared.ready) return "NOT_PREPARED"
            if (prepared.stateVersion != expected) return "VERSION_MISMATCH"
            return null
        }
        if (current.sessionId != sessionId) return "NOT_PREPARED"
        if (expected < current.stateVersion) return "VERSION_MISMATCH"
        if (current.confirmed !in ALLOWED_FROM.getValue(action)) return "INVALID_STATE"
        return null
    }

    private suspend fun sendResult(message: SessionEnvelope, outcome: CommandOutcome) {
        val wire = if (outcome.result == OutcomeResult.EXECUTING) "UNKNOWN" else outcome.result.name
        val end = outcome.action == "END"
        val bytes = SessionMessages.commandResult(
            store.nextMessageId(), message.messageId, outcome.sessionId, outcome.commandId,
            wire, outcome.appliedAt, outcome.reasonCode, end = end,
            pendingBatchCount = if (end) uploads.pendingCount(outcome.sessionId) else 0,
        )
        val delivered = sendWithRetry(SessionPaths.COMMAND_RESULT, bytes)
        val current = _state.value
        if (outcome.persisted) {
            _state.value = current.copy(pending = null)
            return
        }
        _state.value = current.copy(
            pending = PendingCommand(outcome.action, outcome.commandId, PendingStage.AWAITING_SAVE),
            problem = when {
                !delivered || outcome.result == OutcomeResult.UNKNOWN -> WatchProblem.Unconfirmed(outcome.action)
                outcome.result == OutcomeResult.REJECTED -> WatchProblem.Rejected(outcome.action, outcome.reasonCode)
                else -> null
            },
        )
    }

    private fun onReceived(message: SessionEnvelope) {
        if (!message.payload.optBoolean("persisted", false)) return
        val commandId = message.commandId() ?: return
        val version = if (message.payload.isNull("stateVersion")) null else message.payload.optLong("stateVersion")
        store.markPersisted(commandId, version)
        val outcome = store.outcome(commandId) ?: return
        val current = _state.value
        _state.value = current.copy(
            confirmed = if (outcome.result == OutcomeResult.APPLIED) NEXT_STATE[outcome.action] else current.confirmed,
            stateVersion = version ?: current.stateVersion,
            pending = if (current.pending?.commandId == commandId) null else current.pending,
            problem = if (outcome.result == OutcomeResult.UNKNOWN) WatchProblem.Unconfirmed(outcome.action) else current.problem,
        )
    }

    private suspend fun onServerState(message: SessionEnvelope) {
        if (message.payload.optString("scope") != "SERVER") return
        val state = try { RunState.valueOf(message.payload.optString("state")) } catch (_: Exception) { return }
        // 앱이 다시 시작된 뒤에도 서버가 운동 중이라고 하면 이 세션의 측정값을 계속 batch로 만든다.
        if (state == RunState.RUNNING || state == RunState.PAUSED) {
            keepAlive.start()
            store.prepared()?.takeIf { it.sessionId == message.sessionId }?.deviceId?.let { uploads.begin(message.sessionId, it) }
        } else if (state != RunState.READY) {
            keepAlive.stop()
        }
        _state.value = _state.value.copy(
            sessionId = message.sessionId,
            confirmed = state,
            stateVersion = message.payload.optLong("stateVersion", _state.value.stateVersion),
            pending = null,
            problem = null,
        )
    }

    private suspend fun sendWithRetry(path: String, bytes: ByteArray): Boolean {
        val delays = listOf(0L, 1_000L + jitter(), 2_000L + jitter())
        for (wait in delays) {
            if (wait > 0) sleep(wait)
            if (sender.send(path, bytes)) return true
        }
        return false
    }
}
