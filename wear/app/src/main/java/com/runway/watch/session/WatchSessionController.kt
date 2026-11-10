package com.runway.watch.session

import com.runway.watch.batch.NoUploads
import com.runway.watch.batch.RunUploads
import com.runway.watch.cue.GroupPaceAlert
import com.runway.watch.cue.NoGroupPaceAlert
import com.runway.watch.cue.RhythmPlayer
import com.runway.watch.cue.SilentRhythm
import com.runway.watch.run.GroupNotice
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.GroupPosition
import com.runway.watch.run.GroupStatus
import com.runway.watch.run.RecordComparison
import com.runway.watch.run.RunState
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import java.time.Instant
import java.time.temporal.ChronoUnit

/** What the user pressed on the watch. Only a request is sent; nothing runs until the server approves. */
enum class WatchRequest { START, PAUSE, RESUME, END, CANCEL }

enum class PendingStage { REQUESTED, EXECUTING, AWAITING_SAVE }

data class PendingCommand(val action: String, val commandId: String?, val stage: PendingStage)

sealed interface WatchProblem {
    data class Rejected(val action: String, val reasonCode: String?) : WatchProblem
    /** Execution or its save could not be confirmed. Never shown as success or failure. */
    data class Unconfirmed(val action: String) : WatchProblem
    /** The phone could not process a watch request (ERROR message). [action] is the request it answered, when one was waiting. */
    data class Refused(val code: String, val action: String? = null) : WatchProblem
    data object PhoneUnreachable : WatchProblem
}

/** Where the runner's last rhythm BPM change stands (S15P31E105-257). */
enum class BpmRequestStatus { REQUESTING, APPLIED, REJECTED, UNKNOWN }

data class BpmRequest(val targetBpm: Int, val status: BpmRequestStatus)

/** The last coaching guide the watch actually applied. [previousBpm] is the BPM before it (for the cue sentence). */
data class AppliedCoaching(
    val commandId: String,
    val coachingId: String,
    val targetBpm: Int,
    val paceSecPerKm: Int,
    val previousBpm: Int?,
)

/**
 * [confirmed] changes only when the server saved (COMMAND_RECEIVED persisted=true or STATE_RESULT scope=SERVER).
 * [currentBpm] is the rhythm BPM of the last server-approved command the watch applied, or the server's value
 * (STATE_RESULT currentBpm / SESSION_PREPARE initialBpm). [serverLinkLost] is true when no server state arrived for
 * [WatchSessionController.LINK_TIMEOUT_MS] during a run (D-8). [measurementLost] is true when the app restarted
 * mid-run and the watch exercise was no longer there: the watch cannot record this run any more and points the runner
 * to the phone (S15P31E105-445). [phoneRecording] is true once the server says the run was handed to the phone
 * (recordingMode=PHONE_FALLBACK, S08): the watch stopped measuring, the beat and its batches for that session and runs
 * no command for it any more (S15P31E105-464).
 */
data class WatchSessionState(
    val sessionId: String? = null,
    val confirmed: RunState? = null,
    val stateVersion: Long = 0,
    val pending: PendingCommand? = null,
    val problem: WatchProblem? = null,
    val currentBpm: Int? = null,
    val bpmRequest: BpmRequest? = null,
    val coaching: AppliedCoaching? = null,
    val serverLinkLost: Boolean = false,
    val measurementLost: Boolean = false,
    val phoneRecording: Boolean = false,
    /** The server's record comparison from the last STATE_RESULT(scope=SERVER) (S15P31E105-422). */
    val comparison: RecordComparison = RecordComparison.NotSelected,
    /** The group run this session belongs to (SESSION_PREPARE.groupRunId); null for a personal run (S15P31E105-420). */
    val groupRunId: String? = null,
    /** The group as the phone relayed it from G10 (GROUP_STATUS); null until one arrives. Never computed here. */
    val group: GroupStatus? = null,
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
    // pace-coaching.md: READY/PAUSED keep the value only, RUNNING plays it; ended runs refuse a BPM change.
    "SET_BPM" to setOf(RunState.READY, RunState.RUNNING, RunState.PAUSED),
)

private const val SET_BPM = "SET_BPM"
private const val COACHING = "COACHING"
private const val GUIDE_STALE = "GUIDE_STALE"
private const val INVALID_GUIDE = "INVALID_GUIDE"
private const val INVALID_TARGET_BPM = "INVALID_TARGET_BPM"
private const val APPLY_INTERRUPTED = "APPLY_INTERRUPTED"
private const val CUE_FAILED = "CUE_PLAYBACK_FAILED"
private const val EXERCISE_LOST = "EXERCISE_LOST"
private const val CONTROL_DEVICE_CHANGED = "CONTROL_DEVICE_CHANGED"
private const val PHONE_FALLBACK = "PHONE_FALLBACK"

/**
 * Runs approved commands once per commandId (S15P31E105-256 [D], watch-mobile-server-integration.md 9.4).
 * Results are stored before they are sent, so a resend after a restart is answered from the store.
 * S15P31E105-257 adds SET_BPM, COACHING_GUIDE, the server clock estimate and the server-link timer.
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
    private val player: RhythmPlayer = SilentRhythm,
    private val clock: ServerClock = ServerClock(),
    /** Monotonic milliseconds for the link and query timers; never the wall clock. */
    private val elapsedMs: () -> Long = { System.nanoTime() / 1_000_000 },
    /** END-path diagnostics for device checks (S15P31E105-446): ids, stages, counts and durations only, never readings. */
    private val log: (String) -> Unit = {},
    /** One buzz per shared pace change the phone relayed (S15P31E105-604). */
    private val paceAlert: GroupPaceAlert = NoGroupPaceAlert,
) {
    private val mutex = Mutex()
    private val _state = MutableStateFlow(
        store.prepared()?.let {
            WatchSessionState(sessionId = it.sessionId, confirmed = RunState.READY, stateVersion = it.stateVersion, groupRunId = it.groupRunId)
        }
            ?: WatchSessionState(),
    )
    val state: StateFlow<WatchSessionState> = _state

    /** The exercise really runs on the watch (applied START/RESUME, or the server says RUNNING). Drives the beat. */
    private var exerciseRunning = false
    private var lastServerStateMs: Long? = null
    private var lastQueryMs: Long? = null
    /** When the current REQUESTED pending (no commandId yet) was sent; released after [REQUEST_TIMEOUT_MS]. */
    private var requestedAtMs: Long? = null
    /** The session whose exercise this process listens to (started here, or found again after a restart). */
    private var attachedSession: String? = null
    /**
     * The session stored before this process started, the process start, and whether a server state arrived since:
     * until then a restarted watch asks for that session's state itself.
     */
    private val restoredSession = _state.value.sessionId
    private val startedAtMs = elapsedMs()
    private var serverStateSeen = false
    /**
     * An applied END reported while watch batches still lacked the server save ACK (S15P31E105-446). The phone got
     * 409 UPLOAD_PENDING for it; once those batches are saved the same result is reported again with none left.
     * A re-report the phone did not take is sent again every [REPORT_RETRY_MS] until the server saves the END or
     * another run is prepared. Kept in memory only: after a restart the phone's 다시 확인 (the same END again) asks for it.
     */
    private var unsavedEnd: UnsavedEnd? = null
    /** The session this process already stopped for the phone take-over; later snapshots do not stop it again. */
    private var handedSession: String? = null

    /** G10 updatedAt of the last GROUP_STATUS applied, and when it arrived ([elapsedMs]); reset with the session. */
    private var groupUpdatedAt: Instant? = null
    private var groupReceivedMs: Long? = null
    private var groupFlushedMs: Long? = null
    /** The last pace change alerted, with its G10 updatedAt, so a resent GROUP_STATUS does not buzz again (S15P31E105-604). */
    private var groupAlerted: Pair<Instant?, GroupNotice.PaceChanged>? = null
    /** The last widened-group crossing alerted, with its G10 updatedAt, so a resend does not buzz again (S15P31E105-629). */
    private var groupGapAlerted: Pair<Instant?, GroupNotice.GapWidened>? = null

    private data class UnsavedEnd(
        val sessionId: String,
        val commandId: String,
        val replyTo: String?,
        /** [elapsedMs] of the last re-report that was not delivered; null before the first one. */
        val lastTryMs: Long? = null,
    )

    suspend fun onMessage(message: SessionEnvelope) = mutex.withLock {
        when (message.type) {
            "SESSION_PREPARE" -> onPrepare(message)
            "START_AUTHORIZED" -> onCommand(message, "START")
            "COMMAND_REQUEST" -> onCommand(message, message.payload.optString("action"))
            "COMMAND_RECEIVED" -> onReceived(message)
            "STATE_RESULT" -> onServerState(message)
            "COACHING_GUIDE" -> onCoachingGuide(message)
            "SERVER_END" -> onServerEnd(message)
            "GROUP_STATUS" -> onGroupStatus(message)
            "ERROR" -> {
                val current = _state.value
                // The phone or server refused the request, so the requested BPM was not approved.
                val bpm = current.bpmRequest?.takeIf { current.pending?.action == SET_BPM && it.status == BpmRequestStatus.REQUESTING }
                _state.value = current.copy(
                    pending = null,
                    problem = WatchProblem.Refused(message.payload.optString("code", "UNKNOWN"), current.pending?.action),
                    bpmRequest = bpm?.copy(status = BpmRequestStatus.REJECTED) ?: current.bpmRequest,
                )
            }
        }
    }

    /** Sends a request for a watch button. False when another command is still waiting or there is no session. */
    suspend fun request(request: WatchRequest): Boolean = mutex.withLock {
        val current = _state.value
        val sessionId = current.sessionId ?: return@withLock false
        // 폰으로 넘긴 운동은 폰이 제어한다. 워치 버튼은 요청을 보내지 않는다(S15P31E105-464).
        if (current.pending != null || current.phoneRecording) return@withLock false
        val bytes = if (request == WatchRequest.START) {
            val prepared = store.prepared()?.takeIf { it.sessionId == sessionId && it.ready } ?: return@withLock false
            SessionMessages.startRequest(store.nextMessageId(), sessionId, prepared.stateVersion)
        } else {
            SessionMessages.commandRequest(store.nextMessageId(), sessionId, request.name, current.stateVersion)
        }
        val path = if (request == WatchRequest.START) SessionPaths.START_REQUEST else SessionPaths.COMMAND
        _state.value = current.copy(pending = PendingCommand(request.name, null, PendingStage.REQUESTED), problem = null)
        requestedAtMs = elapsedMs()
        if (!sendWithRetry(path, bytes)) {
            _state.value = _state.value.copy(pending = null, problem = WatchProblem.PhoneUnreachable)
            return@withLock false
        }
        true
    }

    /**
     * Asks the phone to change the rhythm BPM (SET_BPM REQUEST). Nothing changes on the watch until the server-approved
     * APPLY arrives ("워치 버튼은 서버 승인 전 센서·박자를 변경하지 않는다"). False while any command — including a coaching
     * result — waits for its result or its server save, outside READY/RUNNING/PAUSED, or for a BPM outside 60–220.
     */
    suspend fun requestBpm(targetBpm: Int): Boolean = mutex.withLock {
        val current = _state.value
        val sessionId = current.sessionId ?: return@withLock false
        if (targetBpm !in BPM_RANGE || current.pending != null || current.phoneRecording) return@withLock false
        if (current.confirmed !in ALLOWED_FROM.getValue(SET_BPM)) return@withLock false
        val bytes = SessionMessages.commandRequest(store.nextMessageId(), sessionId, SET_BPM, current.stateVersion, targetBpm)
        _state.value = current.copy(
            pending = PendingCommand(SET_BPM, null, PendingStage.REQUESTED),
            problem = null,
            bpmRequest = BpmRequest(targetBpm, BpmRequestStatus.REQUESTING),
        )
        requestedAtMs = elapsedMs()
        if (!sendWithRetry(SessionPaths.COMMAND, bytes)) {
            _state.value = _state.value.copy(pending = null, problem = WatchProblem.PhoneUnreachable, bpmRequest = current.bpmRequest)
            return@withLock false
        }
        true
    }

    /**
     * Periodic check (RunSessions calls it every few seconds). While a run is active it marks the server link lost after
     * [LINK_TIMEOUT_MS] without a server STATE_RESULT, and sends STATE_QUERY(SERVER) for the clock estimate every
     * [QUERY_INTERVAL_MS], or every [QUERY_RETRY_MS] while there is no usable estimate (D-8).
     */
    suspend fun tick() = mutex.withLock {
        releaseStaleRequest()
        reportSavedEnd()
        markGroupLate()
        flushGroupReadings()
        val current = _state.value
        val sessionId = current.sessionId
        // S15P31E105-445: 재시작한 워치는 폰의 상태 전달을 기다리지 않고 저장된 세션의 서버 상태를 직접 묻는다.
        // 폰은 자기가 진행 중인 세션에만 답하므로, 끝난 세션이면 답이 없고 [RECOVER_WINDOW_MS] 뒤 묻기를 멈춘다.
        if (sessionId != null && sessionId == restoredSession && !serverStateSeen && !runActive(current)) {
            val nowMs = elapsedMs()
            val last = lastQueryMs
            if (nowMs - startedAtMs < RECOVER_WINDOW_MS && (last == null || nowMs - last >= QUERY_RETRY_MS)) {
                sendStateQuery(sessionId)
            }
            return@withLock
        }
        if (sessionId == null || !runActive(current)) {
            lastServerStateMs = null
            if (current.serverLinkLost) _state.value = current.copy(serverLinkLost = false)
            return@withLock
        }
        val nowMs = elapsedMs()
        val since = lastServerStateMs ?: nowMs.also { lastServerStateMs = it }
        if (nowMs - since >= LINK_TIMEOUT_MS && !current.serverLinkLost) _state.value = current.copy(serverLinkLost = true)
        val last = lastQueryMs
        val due = last == null || nowMs - last >= QUERY_INTERVAL_MS ||
            (clock.current(now()) == null && nowMs - last >= QUERY_RETRY_MS)
        if (due) sendStateQuery(sessionId)
    }

    /**
     * A watch request the phone never answered (no COMMAND_REQUEST, ERROR or newer server state) would otherwise lock every
     * button, because same-version server snapshots keep the pending request. After [REQUEST_TIMEOUT_MS] it is released as
     * unconfirmed: the phone may still have sent it, so it is never shown as refused, and the server rejects a duplicate.
     */
    private fun releaseStaleRequest() {
        val current = _state.value
        val pending = current.pending
        val since = requestedAtMs
        if (pending == null || pending.stage != PendingStage.REQUESTED || pending.commandId != null) {
            requestedAtMs = null
            return
        }
        if (since == null) {
            requestedAtMs = elapsedMs()
            return
        }
        if (elapsedMs() - since < REQUEST_TIMEOUT_MS) return
        requestedAtMs = null
        val bpm = current.bpmRequest?.takeIf { pending.action == SET_BPM && it.status == BpmRequestStatus.REQUESTING }
        _state.value = current.copy(
            pending = null,
            problem = WatchProblem.Unconfirmed(pending.action),
            bpmRequest = bpm?.copy(status = BpmRequestStatus.UNKNOWN) ?: current.bpmRequest,
        )
    }

    /**
     * Reports an applied END again once its last batches are saved, unless the server already saved the END or another
     * run was prepared. A re-report that did not reach the phone is tried again after [REPORT_RETRY_MS].
     */
    private suspend fun reportSavedEnd() {
        val end = unsavedEnd ?: return
        val stored = store.outcome(end.commandId)
        if (stored == null || stored.persisted || _state.value.sessionId != end.sessionId) {
            unsavedEnd = null
            return
        }
        if (uploads.pendingCount(end.sessionId) > 0) return
        val last = end.lastTryMs
        if (last != null && elapsedMs() - last < REPORT_RETRY_MS) return
        log("END ${end.commandId} batches saved, reporting again")
        if (!sendResult(end.replyTo, stored)) unsavedEnd = end.copy(lastTryMs = elapsedMs())
    }

    private fun runActive(state: WatchSessionState) =
        exerciseRunning || state.confirmed == RunState.RUNNING || state.confirmed == RunState.PAUSED

    private suspend fun sendStateQuery(sessionId: String) {
        val sentAt = now().truncatedTo(ChronoUnit.MILLIS)
        clock.querySent(sentAt)
        lastQueryMs = elapsedMs()
        // One attempt: the next tick asks again, and a late reply is still matched by its clientSendAt.
        sender.send(SessionPaths.STATE_QUERY, SessionMessages.stateQuery(store.nextMessageId(), sessionId, sentAt))
    }

    private suspend fun onPrepare(message: SessionEnvelope) {
        val version = message.payload.optLong("stateVersion", -1)
        if (version < 1) return
        // 측정 batch의 생산 기기 ID가 없으면 기록을 저장할 수 없으므로 준비하지 않는다(S15P31E105-311).
        val deviceId = message.deviceId()
        val ready = deviceId != null
        val reason = if (ready) null else "DEVICE_ID_MISSING"
        val groupRunId = message.groupRunId()
        store.savePrepared(Prepared(message.sessionId, version, ready = ready, deviceId = deviceId, groupRunId = groupRunId))
        val current = _state.value
        // initialBpm is only the first value; a later prepare never overwrites the BPM the runner changed (9.3).
        val initialBpm = message.bpm("initialBpm")
        _state.value = if (current.sessionId == message.sessionId && current.confirmed != null) {
            current.copy(
                stateVersion = maxOf(current.stateVersion, version),
                currentBpm = current.currentBpm ?: initialBpm,
                groupRunId = groupRunId,
                group = current.group.takeIf { groupRunId != null && groupRunId == current.groupRunId },
            )
        } else {
            resetGroup()
            WatchSessionState(
                sessionId = message.sessionId, confirmed = RunState.READY, stateVersion = version, currentBpm = initialBpm,
                groupRunId = groupRunId,
            )
        }
        sendWithRetry(SessionPaths.PREPARED, SessionMessages.prepared(store.nextMessageId(), message.sessionId, version, ready, reason))
    }

    private suspend fun onCommand(message: SessionEnvelope, action: String) {
        val commandId = message.commandId() ?: return
        if (action !in NEXT_STATE && action != SET_BPM) return
        val stored = store.outcome(commandId)
        if (stored != null) {
            if (stored.action == COACHING) return
            // 저장되지 않은 종료를 다시 묻는 것은 폰의 '다시 확인'이다. 재시도 상한에 걸린 batch를 한 번 더 보내게 한다(S15P31E105-446).
            if (stored.action == "END" && stored.result == OutcomeResult.APPLIED && !stored.persisted) {
                log("END $commandId asked again, retrying unsaved batches")
                uploads.retryFailed(stored.sessionId)
            }
            // 같은 명령은 다시 실행하지 않는다. 실행 도중 끊겼다면 실제 적용 여부를 모르므로 UNKNOWN으로 남긴다.
            sendResult(message.messageId, replayable(stored))
            return
        }
        val bpm = if (action == SET_BPM) message.bpm("targetBpm") else null
        val expected = message.payload.optLong("expectedVersion", -1)
        val reason = if (action == SET_BPM && bpm == null) INVALID_TARGET_BPM else rejectionReason(message.sessionId, action, expected)
        if (reason != null) {
            val rejected = CommandOutcome(message.sessionId, commandId, action, OutcomeResult.REJECTED, null, reason, false, null, targetBpm = bpm)
            store.saveOutcome(rejected)
            noteBpm(rejected)
            sendResult(message.messageId, rejected)
            return
        }

        // 측정을 시작하기 전에 프로세스를 유지시켜 화면을 벗어나도 기록이 끊기지 않게 한다(S15P31E105-311).
        if (action == "START") keepAlive.start()
        store.saveOutcome(CommandOutcome(message.sessionId, commandId, action, OutcomeResult.EXECUTING, null, null, false, null, targetBpm = bpm))
        _state.value = _state.value.copy(pending = PendingCommand(action, commandId, PendingStage.EXECUTING), problem = null)
        fun outcome(result: OutcomeResult, appliedAt: Instant?, code: String?) =
            CommandOutcome(message.sessionId, commandId, action, result, appliedAt, code, false, null, targetBpm = bpm)
        // 측정이 끊긴 운동은 워치에 멈추거나 끝낼 운동이 없다. 일시정지·종료는 서버 상태만 바꾸고, 종료는 남은 batch를
        // 보낸 뒤 결과를 보고한다. 폰에서 일시정지 후 종료하는 길이 막히지 않게 한다(S15P31E105-445).
        val lost = _state.value.measurementLost
        val startedMs = elapsedMs()
        if (action == "END") log("END $commandId received confirmed=${_state.value.confirmed} lost=$lost")
        val outcome = try {
            withTimeout(callTimeoutMs) {
                when (action) {
                    "START" -> gateway.start()
                    "PAUSE" -> if (!lost) gateway.pause()
                    "RESUME" -> gateway.resume()
                    SET_BPM -> applyBpm(bpm!!)
                    else -> if (!lost) gateway.end()
                }
            }
            // 실제 적용 시각은 서버 기준으로 보정한다(9.4). 추정이 없으면 워치 시각 그대로.
            outcome(OutcomeResult.APPLIED, clock.toServerTime(now()), null)
        } catch (e: TimeoutCancellationException) {
            outcome(OutcomeResult.UNKNOWN, null, "EXERCISE_CALL_TIMEOUT")
        } catch (e: ExerciseRejected) {
            outcome(OutcomeResult.REJECTED, null, e.reasonCode)
        } catch (e: Exception) {
            outcome(OutcomeResult.UNKNOWN, null, if (action == SET_BPM) CUE_FAILED else "EXERCISE_CALL_FAILED")
        }
        store.saveOutcome(outcome)
        if (action == "END") log("END $commandId exercise=${outcome.result} reason=${outcome.reasonCode} after=${elapsedMs() - startedMs}ms")
        if (outcome.result == OutcomeResult.APPLIED) {
            when (action) {
                "START" -> {
                    attachedSession = message.sessionId
                    _state.value = _state.value.copy(measurementLost = false)
                    store.prepared()?.deviceId?.let { uploads.begin(message.sessionId, it) }
                }
                // 종료 직후 남은 측정값을 마지막 batch로 보내고 서버 저장 확인을 기다린 뒤 결과를 보고한다(9.3 COMMAND_RESULT).
                "END" -> {
                    val left = uploads.finish(message.sessionId)
                    log("END $commandId batches left=$left after=${elapsedMs() - startedMs}ms")
                }
            }
            // 박자는 실제 운동이 진행 중일 때만 재생한다. 일시정지·종료에서 멈추고, 재개하면 최신 BPM으로 다시 재생한다(D-4).
            when (action) {
                "START", "RESUME" -> {
                    exerciseRunning = true
                    if (lastServerStateMs == null) lastServerStateMs = elapsedMs()
                    syncPlayback()
                }
            }
        }
        // 일시정지·종료는 거절되지 않았다면 미확인이어도 박자를 멈춘다. 박자는 보조 수단이므로 멈추는 쪽이 안전하고,
        // 실제로 계속 달리는 중이면 이후 더 높은 버전의 서버 상태나 재개 적용이 다시 재생한다.
        if ((action == "PAUSE" || action == "END") && outcome.result != OutcomeResult.REJECTED) {
            exerciseRunning = false
            syncPlayback()
        }
        noteBpm(outcome)
        sendResult(message.messageId, outcome)
        if (outcome.result == OutcomeResult.APPLIED && (action == "START" || action == "RESUME")) {
            // 시작·재개 때 서버 시각을 다시 추정해 코칭 만료 판단에 쓴다(D-8).
            sendStateQuery(message.sessionId)
        }
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
        // 폰으로 넘긴 운동의 명령은 워치에서 실행하지 않는다(S15P31E105-464, sessions.md 전환 후 워치 처리).
        if (current.phoneRecording) return CONTROL_DEVICE_CHANGED
        if (expected < current.stateVersion) return "VERSION_MISMATCH"
        if (current.confirmed !in ALLOWED_FROM.getValue(action)) return "INVALID_STATE"
        // 재시작 후 워치 운동이 사라졌으면 측정을 다시 시작할 수 없다. 재개를 성공으로 보이지 않게 거절한다(S15P31E105-445).
        if (current.measurementLost && action == "RESUME") return EXERCISE_LOST
        return null
    }

    /** A stored result to send again. One left EXECUTING by a crash is closed as UNKNOWN and never run again. */
    private fun replayable(stored: CommandOutcome): CommandOutcome {
        if (stored.result != OutcomeResult.EXECUTING) return stored
        val code = if (stored.action == SET_BPM || stored.action == COACHING) APPLY_INTERRUPTED else "EXERCISE_CALL_FAILED"
        return stored.copy(result = OutcomeResult.UNKNOWN, reasonCode = code).also(store::saveOutcome)
    }

    /** Applies an approved BPM: always kept, played only while the exercise runs. The same BPM keeps the beat. */
    private fun applyBpm(bpm: Int) {
        if (exerciseRunning) player.play(bpm)
        _state.value = _state.value.copy(currentBpm = bpm)
    }

    private fun syncPlayback() {
        val bpm = _state.value.currentBpm
        try {
            if (exerciseRunning && bpm != null) player.play(bpm) else player.stop()
        } catch (_: Exception) {
            // The cue is an aid; its failure never changes the run state.
        }
    }

    private fun noteBpm(outcome: CommandOutcome) {
        if (outcome.action != SET_BPM) return
        val bpm = outcome.targetBpm ?: return
        val status = when (outcome.result) {
            OutcomeResult.APPLIED -> BpmRequestStatus.APPLIED
            OutcomeResult.REJECTED, OutcomeResult.IGNORED -> BpmRequestStatus.REJECTED
            OutcomeResult.UNKNOWN, OutcomeResult.EXECUTING -> BpmRequestStatus.UNKNOWN
        }
        _state.value = _state.value.copy(bpmRequest = BpmRequest(bpm, status))
    }

    /**
     * COACHING_GUIDE (9.3/9.4, pace-coaching.md): a stored result for the same commandId is sent again unchanged, even
     * an APPLIED one after expiry. Only the first handling decides, and the decision is saved before anything runs:
     * applied only when RUNNING, expectedVersion is the confirmed version, the coachingId was never applied, and the
     * server time (estimate + error bound) is before expiresAt. Otherwise IGNORED / GUIDE_STALE.
     */
    private suspend fun onCoachingGuide(message: SessionEnvelope) {
        val commandId = message.commandId() ?: return
        val coachingId = message.coachingId() ?: return
        store.outcome(commandId)?.let { stored ->
            if (stored.action == COACHING && stored.coachingId != null) sendCoachingResult(message, replayable(stored))
            return
        }
        val target = message.bpm("targetBpm")
        val pace = (message.payload.opt("recommendedPaceSecPerKm") as? Number)?.toDouble()
            ?.takeIf { it.isFinite() && it > 0 }?.let { Math.round(it).toInt() }
        val expiresAt = message.instant("expiresAt")
        val current = _state.value
        val reason = when {
            target == null || pace == null || expiresAt == null -> INVALID_GUIDE
            current.sessionId != message.sessionId -> GUIDE_STALE
            current.confirmed != RunState.RUNNING || !exerciseRunning -> GUIDE_STALE
            message.payload.optLong("expectedVersion", -1) != current.stateVersion -> GUIDE_STALE
            store.coachingUsed(coachingId) -> GUIDE_STALE
            // 서버 시각 추정이 없거나 불확실하면 자동 적용하지 않는다(9.7).
            clock.latestServerTime(now())?.isBefore(expiresAt) != true -> GUIDE_STALE
            else -> null
        }
        fun outcome(result: OutcomeResult, appliedAt: Instant?, code: String?) =
            CommandOutcome(message.sessionId, commandId, COACHING, result, appliedAt, code, false, null, coachingId, target)
        if (reason != null) {
            val ignored = outcome(OutcomeResult.IGNORED, null, reason)
            sendCoachingResult(message, store.saveOutcomeIfAbsent(ignored)?.let(::replayable) ?: ignored)
            return
        }
        // 결정과 저장을 한 번에 한다: 같은 commandId가 겹쳐 와도 결과는 하나만 확정된다.
        store.saveOutcomeIfAbsent(outcome(OutcomeResult.EXECUTING, null, null))?.let { existing ->
            sendCoachingResult(message, replayable(existing))
            return
        }
        store.markCoachingUsed(coachingId)
        val previous = current.currentBpm
        _state.value = current.copy(pending = PendingCommand(COACHING, commandId, PendingStage.EXECUTING))
        val result = try {
            applyBpm(target!!)
            outcome(OutcomeResult.APPLIED, clock.toServerTime(now()), null)
        } catch (e: Exception) {
            outcome(OutcomeResult.UNKNOWN, null, CUE_FAILED)
        }
        store.saveOutcome(result)
        if (result.result == OutcomeResult.APPLIED) {
            _state.value = _state.value.copy(coaching = AppliedCoaching(commandId, coachingId, target!!, pace!!, previous), bpmRequest = null)
        }
        sendCoachingResult(message, result)
    }

    private suspend fun sendCoachingResult(message: SessionEnvelope, outcome: CommandOutcome) {
        val wire = if (outcome.result == OutcomeResult.EXECUTING) "UNKNOWN" else outcome.result.name
        val bytes = SessionMessages.coachingResult(
            store.nextMessageId(), message.messageId, outcome.sessionId, outcome.commandId, outcome.coachingId!!,
            wire, outcome.appliedAt, outcome.reasonCode,
        )
        val delivered = sendWithRetry(SessionPaths.COACHING_RESULT, bytes)
        val current = _state.value
        if (current.sessionId != outcome.sessionId) return
        // 코칭 결과가 서버에 저장되기 전에는 다음 사용자 명령을 보내지 않는다(9.4).
        _state.value = if (outcome.persisted) {
            if (current.pending?.commandId == outcome.commandId) current.copy(pending = null) else current
        } else {
            current.copy(
                pending = PendingCommand(COACHING, outcome.commandId, PendingStage.AWAITING_SAVE),
                problem = if (!delivered || outcome.result == OutcomeResult.UNKNOWN) WatchProblem.Unconfirmed(COACHING) else current.problem,
            )
        }
    }

    /** Sends a COMMAND_RESULT; returns whether the phone took it. */
    private suspend fun sendResult(replyTo: String?, outcome: CommandOutcome): Boolean {
        val wire = if (outcome.result == OutcomeResult.EXECUTING) "UNKNOWN" else outcome.result.name
        val end = outcome.action == "END"
        val pendingBatches = if (end) uploads.pendingCount(outcome.sessionId) else 0
        if (end) {
            unsavedEnd = if (outcome.result == OutcomeResult.APPLIED && !outcome.persisted && pendingBatches > 0) {
                UnsavedEnd(outcome.sessionId, outcome.commandId, replyTo)
            } else {
                null
            }
        }
        val bytes = SessionMessages.commandResult(
            store.nextMessageId(), replyTo, outcome.sessionId, outcome.commandId,
            wire, outcome.appliedAt, outcome.reasonCode, end = end,
            pendingBatchCount = pendingBatches,
        )
        val delivered = sendWithRetry(SessionPaths.COMMAND_RESULT, bytes)
        if (end) log("END ${outcome.commandId} result=$wire pending=$pendingBatches delivered=$delivered")
        val current = _state.value
        if (outcome.persisted) {
            _state.value = current.copy(pending = null)
            return delivered
        }
        _state.value = current.copy(
            pending = PendingCommand(outcome.action, outcome.commandId, PendingStage.AWAITING_SAVE),
            problem = when {
                !delivered || outcome.result == OutcomeResult.UNKNOWN -> WatchProblem.Unconfirmed(outcome.action)
                outcome.result == OutcomeResult.REJECTED -> WatchProblem.Rejected(outcome.action, outcome.reasonCode)
                else -> null
            },
        )
        return delivered
    }

    private fun onReceived(message: SessionEnvelope) {
        if (!message.payload.optBoolean("persisted", false)) return
        val commandId = message.commandId() ?: return
        val version = if (message.payload.isNull("stateVersion")) null else message.payload.optLong("stateVersion")
        store.markPersisted(commandId, version)
        val outcome = store.outcome(commandId) ?: return
        val current = _state.value
        _state.value = current.copy(
            // SET_BPM·COACHING은 운동 상태를 바꾸지 않는다.
            confirmed = if (outcome.result == OutcomeResult.APPLIED) NEXT_STATE[outcome.action] ?: current.confirmed else current.confirmed,
            stateVersion = version ?: current.stateVersion,
            pending = if (current.pending?.commandId == commandId) null else current.pending,
            problem = if (outcome.result == OutcomeResult.UNKNOWN) WatchProblem.Unconfirmed(outcome.action) else current.problem,
        )
    }

    /**
     * STATE_RESULT(scope=SERVER): a reply to our STATE_QUERY (clientSendAt set, used for the clock estimate) or the
     * phone's push on each server snapshot (D-8). Any of them proves the server link. A snapshot older than the
     * confirmed stateVersion is discarded; one at the same version does not clear a command still in flight.
     */
    private suspend fun onServerState(message: SessionEnvelope) {
        if (message.payload.optString("scope") != "SERVER") return
        serverStateSeen = true
        val receivedAt = now()
        val sentAt = message.instant("clientSendAt")
        val serverIn = message.instant("serverReceiveAt")
        val serverOut = message.instant("serverSendAt")
        if (sentAt != null && serverIn != null && serverOut != null) clock.onReply(sentAt, serverIn, serverOut, receivedAt)
        val state = try { RunState.valueOf(message.payload.optString("state")) } catch (_: Exception) { return }
        val current = _state.value
        val sameSession = current.sessionId == message.sessionId
        val version = message.payload.optLong("stateVersion", -1)
        if (sameSession && current.confirmed != null && version in 0 until current.stateVersion) {
            // 낮은 버전의 스냅샷은 버리지만, 서버와 연결돼 있다는 증거로는 쓴다.
            if (runActive(current)) lastServerStateMs = elapsedMs()
            if (current.serverLinkLost) _state.value = current.copy(serverLinkLost = false)
            return
        }
        val newer = !sameSession || current.confirmed == null || version > current.stateVersion || current.pending == null
        val active = state == RunState.RUNNING || state == RunState.PAUSED
        // 폰으로 기록을 넘긴 운동은 끝까지 폰이 제어한다(S08). 한 번 넘어간 세션은 이후 스냅샷과 상관없이 유지한다.
        val phone = message.payload.optString("recordingMode") == PHONE_FALLBACK || (sameSession && current.phoneRecording)
        val watchRecords = active && !phone
        val lost = sameSession && current.measurementLost && watchRecords
        // 앱이 다시 시작된 뒤에도 서버가 운동 중이라고 하면 이 세션의 측정값을 계속 batch로 만든다.
        if (phone && handedSession != message.sessionId) handOver(message.sessionId)
        if (!sameSession) resetGroup()
        if (watchRecords) {
            keepAlive.start()
            store.prepared()?.takeIf { it.sessionId == message.sessionId }?.deviceId?.let { uploads.begin(message.sessionId, it) }
        } else if (!active && state != RunState.READY) {
            keepAlive.stop()
        }
        _state.value = current.copy(
            sessionId = message.sessionId,
            confirmed = state,
            stateVersion = if (version >= 0) version else current.stateVersion,
            pending = if (newer) null else current.pending,
            problem = if (newer) null else current.problem,
            currentBpm = if (newer) message.bpm("currentBpm") else current.currentBpm,
            bpmRequest = if (sameSession) current.bpmRequest else null,
            coaching = if (sameSession) current.coaching else null,
            serverLinkLost = false,
            measurementLost = lost,
            phoneRecording = phone,
            // 기록 비교는 batch 저장마다 같은 버전으로 온다. 버전이 낮은 스냅샷은 위에서 이미 버렸다.
            comparison = message.comparison(),
            groupRunId = if (sameSession) current.groupRunId
            else store.prepared()?.takeIf { it.sessionId == message.sessionId }?.groupRunId,
            group = if (sameSession) current.group else null,
        )
        if (newer || phone) {
            exerciseRunning = state == RunState.RUNNING && !lost && !phone
            syncPlayback()
        }
        lastServerStateMs = if (active) elapsedMs() else null
        if (watchRecords && attachedSession != message.sessionId) reattach(message.sessionId)
    }

    /**
     * SERVER_END (9.3, S15P31E105-420): the group leader ended the group (G12) and the server approved this runner's END.
     * It runs exactly like an approved END: once per commandId, result via COMMAND_RESULT. The group then shows as
     * ended by the leader. A SERVER_END for another session or a personal run changes no group state.
     */
    private suspend fun onServerEnd(message: SessionEnvelope) {
        onCommand(message, "END")
        val current = _state.value
        if (current.sessionId == message.sessionId && current.groupRunId != null) {
            _state.value = current.copy(group = (current.group ?: GroupStatus()).copy(phase = GroupPhase.FORCE_FINISHED))
        }
    }

    /**
     * GROUP_STATUS (9.3, S15P31E105-420): G10 as the phone relayed it, applied only for this session's group. An update
     * older than the last one applied (G10 updatedAt) is a late event and dropped. Ranks and gaps are shown as given:
     * an unranked update keeps the last standing marked delayed, or waits when there never was one. An ended group
     * does not go back to running, and an end by the leader stays shown as such.
     */
    private fun onGroupStatus(message: SessionEnvelope) {
        val update = message.groupUpdate() ?: return
        val current = _state.value
        if (current.sessionId != message.sessionId || current.groupRunId == null || update.groupRunId != current.groupRunId) return
        val last = groupUpdatedAt
        if (last != null && update.updatedAt != null && update.updatedAt.isBefore(last)) return
        if (update.updatedAt != null) groupUpdatedAt = update.updatedAt
        groupReceivedMs = elapsedMs()
        val before = current.group ?: GroupStatus()
        val phase = when (before.phase) {
            GroupPhase.FORCE_FINISHED -> GroupPhase.FORCE_FINISHED
            GroupPhase.FINISHED -> if (update.phase == GroupPhase.FORCE_FINISHED) update.phase else before.phase
            else -> update.phase
        }
        val previous = (before.position as? GroupPosition.Known)?.standing
        val position = when {
            phase == GroupPhase.WAITING -> GroupPosition.Waiting
            update.standing != null && !update.stale -> GroupPosition.Known(update.standing)
            previous != null -> GroupPosition.Known(previous, delayed = true)
            update.stale -> GroupPosition.Waiting
            else -> GroupPosition.Unavailable
        }
        val newPace = update.guidePaceSecondsPerKm
        // 폰이 연속 조회에서 본 공동 페이스 변경만 알린다(S15P31E105-604). 워치는 변경을 판단하거나 새 페이스를 계산하지 않는다.
        // 첫 수신·재연결 뒤 값 차이는 paceChanged가 없어 조용히 반영되고, 같은 현황의 재전달은 다시 울리지 않는다.
        // 지난 변경 표시는 지금 공동 페이스로 바뀐 것일 때만 남긴다(조용히 바뀐 뒤 옛 변경을 보이지 않는다).
        val change = update.paceChanged?.takeIf { phase == GroupPhase.RUNNING && it.toSecondsPerKm == newPace }
        val notice = change ?: (before.notice as? GroupNotice.PaceChanged)
            ?.takeIf { phase == GroupPhase.RUNNING && it.toSecondsPerKm == newPace }
        var buzz = false
        if (change != null && groupAlerted != (update.updatedAt to change)) {
            groupAlerted = update.updatedAt to change
            buzz = true
        }
        // 그룹장 폰이 보낸 간격 벌어짐만 표시한다(S15P31E105-629). 넘은 순간(gapWidenedNew)의 현황에만 진동하고, 같은 현황의
        // 재전달은 다시 울리지 않는다. 폰이 더 보내지 않으면(다시 좁혀짐·지연) 표시를 지운다.
        val gap = update.gapWidened?.takeIf { phase == GroupPhase.RUNNING }
        if (gap != null && update.gapWidenedNew && groupGapAlerted != (update.updatedAt to gap)) {
            groupGapAlerted = update.updatedAt to gap
            buzz = true
        }
        // 같은 현황에 둘 다 오면 진동은 한 번만 울린다(연달아 울리면 뒤 진동이 앞 진동을 끊는다). 표시는 둘 다 남는다.
        if (buzz) paceAlert.paceChanged()
        _state.value = current.copy(
            group = GroupStatus(
                phase = phase,
                guidePaceSecondsPerKm = newPace,
                position = position,
                leaderToLastGapMeters = update.leaderToLastGapMeters,
                notice = notice,
                gapNotice = gap,
                rankedCount = update.rankedCount,
            ),
        )
    }

    /**
     * No GROUP_STATUS for [GROUP_LATE_MS] while the group runs (the phone relays G10 every few seconds): the standing
     * shown is the last one received, so it is marked delayed instead of current.
     */
    private fun markGroupLate() {
        val current = _state.value
        val group = current.group ?: return
        val known = group.position as? GroupPosition.Known ?: return
        val since = groupReceivedMs ?: return
        if (group.phase != GroupPhase.RUNNING || known.delayed || elapsedMs() - since < GROUP_LATE_MS) return
        _state.value = current.copy(group = group.copy(position = known.copy(delayed = true)))
    }

    /**
     * During a group run the ranking uses this watch's latest distance on the server, so readings the platform holds
     * back with the screen off are asked for every [GROUP_FLUSH_MS] (S15P31E105-420). Personal runs keep the batching.
     */
    private suspend fun flushGroupReadings() {
        val current = _state.value
        if (current.groupRunId == null || current.confirmed != RunState.RUNNING || current.phoneRecording || !exerciseRunning) {
            groupFlushedMs = null
            return
        }
        val nowMs = elapsedMs()
        val last = groupFlushedMs
        if (last != null && nowMs - last < GROUP_FLUSH_MS) return
        groupFlushedMs = nowMs
        try { gateway.flush() } catch (_: Exception) { /* throttled or failed: the next one asks again */ }
    }

    private fun resetGroup() {
        groupUpdatedAt = null
        groupReceivedMs = null
        groupAlerted = null
        groupGapAlerted = null
    }

    /**
     * S15P31E105-464 (sessions.md 전환 후 워치 처리): the run was handed to the phone. The beat stops, no new batch is
     * made (stored ones are still sent), the watch exercise is ended so it stops measuring, and the process is no longer
     * kept alive for it. Done once per session in this process; a reconnect or a later snapshot never restarts anything,
     * and nothing is run again on the watch's own. Ending the exercise may fail (none left after a restart); that is fine.
     */
    private suspend fun handOver(sessionId: String) {
        handedSession = sessionId
        exerciseRunning = false
        syncPlayback()
        uploads.stop(sessionId)
        log("PHONE_FALLBACK $sessionId stopping watch measurement")
        try {
            withTimeout(callTimeoutMs) { gateway.end() }
        } catch (_: Exception) {
            // 끝낼 운동이 없거나 확인할 수 없어도 워치는 더 측정하지 않는다.
        }
        if (attachedSession == sessionId) attachedSession = null
        keepAlive.stop()
    }

    /**
     * S15P31E105-445: the process restarted mid-run, so nothing listens to the exercise any more and no batch is made.
     * Listen again to the exercise Health Services kept. When it is gone, a new one is never started (distance and
     * time would restart from zero inside the same run): the beat and coaching stop and the runner is pointed to the
     * phone. A failed check is tried again on the next server state.
     */
    private suspend fun reattach(sessionId: String) {
        val attached = try {
            withTimeout(callTimeoutMs) { gateway.reattach() }
        } catch (_: Exception) {
            return
        }
        attachedSession = sessionId
        if (attached) return
        exerciseRunning = false
        syncPlayback()
        _state.value = _state.value.copy(measurementLost = true)
    }

    private suspend fun sendWithRetry(path: String, bytes: ByteArray): Boolean {
        val delays = listOf(0L, 1_000L + jitter(), 2_000L + jitter())
        for (wait in delays) {
            if (wait > 0) sleep(wait)
            if (sender.send(path, bytes)) return true
        }
        return false
    }

    companion object {
        /** No server STATE_RESULT for this long during a run shows 서버 연결 끊김 (D-8: pushes come at least every 15 s). */
        const val LINK_TIMEOUT_MS = 45_000L
        /** Clock re-estimate period while running (D-8). */
        const val QUERY_INTERVAL_MS = 60_000L
        /** Retry period while there is no usable clock estimate. */
        const val QUERY_RETRY_MS = 10_000L
        /** How long after a process start the watch keeps asking for the server state of its stored session. */
        const val RECOVER_WINDOW_MS = 120_000L
        /**
         * A watch request with no phone answer for this long is released as unconfirmed. Longer than the phone's worst
         * case for one request: three server calls of up to 15 s each plus the 1 s·2 s retry gaps.
         */
        const val REQUEST_TIMEOUT_MS = 60_000L
        /** Gap between re-reports of a saved END that did not reach the phone (S15P31E105-446). */
        const val REPORT_RETRY_MS = 10_000L
        /** No GROUP_STATUS for this long during a group run marks the standing delayed (S15P31E105-420). */
        const val GROUP_LATE_MS = 15_000L
        /** How often a group run asks Health Services for held-back readings (S15P31E105-420). */
        const val GROUP_FLUSH_MS = 10_000L
    }
}
