package com.runway.watch.session

import com.runway.watch.run.RunState
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** The watch executes only approved commands, once per commandId, and confirms only after the server saved (AC-D1~D5). */
class WatchSessionControllerTest {

    private class FakeGateway : ExerciseGateway {
        val calls = mutableListOf<String>()
        var failure: Exception? = null
        var hangMs = 0L
        override suspend fun start() = call("start")
        override suspend fun pause() = call("pause")
        override suspend fun resume() = call("resume")
        override suspend fun end() = call("end")
        /** Whether Health Services still has this app's exercise after a restart; null throws. */
        var exerciseLeft: Boolean? = true
        override suspend fun reattach(): Boolean {
            calls += "reattach"
            return exerciseLeft ?: throw IllegalStateException("health services unavailable")
        }
        private suspend fun call(name: String) {
            calls += name
            if (hangMs > 0) delay(hangMs)
            failure?.let { throw it }
        }
    }

    private class FakeSender(var accept: Boolean = true) : SessionSender {
        val sent = mutableListOf<Pair<String, JSONObject>>()
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            sent += path to JSONObject(String(bytes, Charsets.UTF_8))
            return accept
        }
        fun last(type: String) = sent.last { it.second.getString("type") == type }.second
        fun count(type: String) = sent.count { it.second.getString("type") == type }
    }

    private val now = Instant.parse("2026-10-28T01:00:01Z")
    private val store = InMemorySessionStore()
    private val gateway = FakeGateway()
    private val sender = FakeSender()

    private fun controller(timeoutMs: Long = 1_000) =
        WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = timeoutMs)

    private fun message(type: String, payload: String, sessionId: String = "201", messageId: String = "phone:1") =
        decodeSessionMessage(
            """{"protocolVersion":1,"type":"$type","messageId":"$messageId","replyTo":null,"senderDeviceId":null,"sessionId":$sessionId,"payload":$payload}"""
                .toByteArray(),
        )!!

    private fun prepare(version: Long = 1) = message("SESSION_PREPARE", """{"stateVersion":$version,"deviceId":101,"goal":{},"initialBpm":null}""")
    private fun authorize(commandId: Long, version: Long, sessionId: String = "201") =
        message("START_AUTHORIZED", """{"commandId":$commandId,"expectedVersion":$version,"targetBpm":null,"coachingId":null}""", sessionId)
    private fun apply(action: String, commandId: Long, version: Long) =
        message("COMMAND_REQUEST", """{"phase":"APPLY","action":"$action","expectedVersion":$version,"targetBpm":null,"commandId":$commandId,"coachingId":null}""")
    private fun saved(commandId: Long, version: Long) =
        message("COMMAND_RECEIVED", """{"commandId":$commandId,"persisted":true,"stateVersion":$version}""")

    private suspend fun WatchSessionController.running() {
        onMessage(prepare())
        onMessage(authorize(501, 1))
        onMessage(saved(501, 2))
    }

    @Test
    fun `prepare stores the version and answers ready`() = runBlocking {
        val c = controller()
        c.onMessage(prepare(3))

        assertEquals(Prepared("201", 3, ready = true, deviceId = "101"), store.prepared())
        val reply = sender.last("SESSION_PREPARED").getJSONObject("payload")
        assertEquals(3L, reply.getLong("stateVersion"))
        assertTrue(reply.getBoolean("ready"))
        assertEquals(RunState.READY, c.state.value.confirmed)
    }

    @Test
    fun `start runs only for the prepared version and is confirmed after the server saved`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        c.onMessage(authorize(501, 1))

        assertEquals(listOf("start"), gateway.calls)
        val result = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals("APPLIED", result.getString("result"))
        assertEquals("2026-10-28T01:00:01Z", result.getString("appliedAt"))
        // 실행했지만 서버 저장 전에는 확정 상태를 바꾸지 않는다.
        assertEquals(RunState.READY, c.state.value.confirmed)
        assertEquals(PendingStage.AWAITING_SAVE, c.state.value.pending?.stage)

        c.onMessage(saved(501, 2))
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertEquals(2L, c.state.value.stateVersion)
        assertNull(c.state.value.pending)
    }

    @Test
    fun `start for another version, before prepare or for another session is rejected without running`() = runBlocking {
        val c = controller()
        c.onMessage(authorize(500, 1))
        assertEquals("NOT_PREPARED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))

        c.onMessage(prepare(2))
        c.onMessage(authorize(501, 1))
        assertEquals("VERSION_MISMATCH", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))
        c.onMessage(authorize(502, 3))
        assertEquals("VERSION_MISMATCH", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))
        c.onMessage(authorize(503, 2, sessionId = "999"))
        assertEquals("NOT_PREPARED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))

        assertTrue(gateway.calls.isEmpty())
        assertEquals("REJECTED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("result"))
    }

    @Test
    fun `a repeated command is answered from the store without running again`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        c.onMessage(authorize(501, 1))
        // 앱이 다시 떠도 저장소의 결과로 답한다.
        val restarted = controller()
        restarted.onMessage(authorize(501, 1))

        assertEquals(listOf("start"), gateway.calls)
        assertEquals(2, sender.count("COMMAND_RESULT"))
        assertEquals(sender.sent[1].second.getJSONObject("payload").toString(), sender.last("COMMAND_RESULT").getJSONObject("payload").toString())
    }

    @Test
    fun `a command interrupted mid-run is reported UNKNOWN instead of running again`() = runBlocking {
        store.saveOutcome(CommandOutcome("201", "501", "START", OutcomeResult.EXECUTING, null, null, persisted = false, stateVersion = null))
        store.savePrepared(Prepared("201", 1, ready = true, deviceId = "101"))
        val c = controller()
        c.onMessage(authorize(501, 1))

        assertTrue(gateway.calls.isEmpty())
        val result = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals("UNKNOWN", result.getString("result"))
        assertTrue(result.isNull("appliedAt"))
    }

    @Test
    fun `exercise failures become UNKNOWN or REJECTED with reasons`() = runBlocking {
        val c = controller(timeoutMs = 50)
        c.onMessage(prepare())
        gateway.hangMs = 500
        c.onMessage(authorize(501, 1))
        assertEquals("EXERCISE_CALL_TIMEOUT", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))
        assertEquals(WatchProblem.Unconfirmed("START"), c.state.value.problem)

        gateway.hangMs = 0
        gateway.failure = IllegalStateException("boom")
        c.onMessage(prepare(2))
        c.onMessage(authorize(502, 2))
        assertEquals("EXERCISE_CALL_FAILED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))

        gateway.failure = ExerciseRejected("EXERCISE_IN_USE")
        c.onMessage(prepare(3))
        c.onMessage(authorize(503, 3))
        val rejected = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals("REJECTED", rejected.getString("result"))
        assertEquals("EXERCISE_IN_USE", rejected.getString("reasonCode"))
    }

    @Test
    fun `pause, resume and end follow the confirmed state and end reports the upload fields`() = runBlocking {
        val c = controller()
        c.running()

        c.onMessage(apply("PAUSE", 502, 2))
        c.onMessage(saved(502, 3))
        assertEquals(RunState.PAUSED, c.state.value.confirmed)
        c.onMessage(apply("RESUME", 503, 3))
        c.onMessage(saved(503, 4))
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        c.onMessage(apply("END", 504, 4))
        val end = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals(0, end.getInt("pendingBatchCount"))
        assertTrue(end.getBoolean("uploadComplete"))
        c.onMessage(saved(504, 5))

        assertEquals(RunState.COMPLETED, c.state.value.confirmed)
        assertEquals(listOf("start", "pause", "resume", "end"), gateway.calls)
    }

    @Test
    fun `a command not allowed in the confirmed state or with an older version is rejected`() = runBlocking {
        val c = controller()
        c.running()

        c.onMessage(apply("RESUME", 502, 2))
        assertEquals("INVALID_STATE", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))
        c.onMessage(apply("PAUSE", 503, 1))
        assertEquals("VERSION_MISMATCH", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))
        assertEquals(listOf("start"), gateway.calls)
    }

    @Test
    fun `buttons send requests only, and nothing else is sent until the server confirms`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())

        assertTrue(c.request(WatchRequest.START))
        val start = sender.last("START_REQUEST").getJSONObject("payload")
        assertEquals(1L, start.getLong("expectedVersion"))
        assertTrue(gateway.calls.isEmpty())
        assertFalse(c.request(WatchRequest.CANCEL))

        c.onMessage(authorize(501, 1))
        c.onMessage(saved(501, 2))
        assertTrue(c.request(WatchRequest.PAUSE))
        val pause = sender.last("COMMAND_REQUEST").getJSONObject("payload")
        assertEquals("REQUEST", pause.getString("phase"))
        assertEquals("PAUSE", pause.getString("action"))
        assertEquals(2L, pause.getLong("expectedVersion"))
        assertEquals(listOf("start"), gateway.calls)
    }

    @Test
    fun `cancel from the watch ends with the server state or the phone's error`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        assertTrue(c.request(WatchRequest.CANCEL))
        c.onMessage(message("ERROR", """{"code":"COMMAND_PENDING","retryable":false,"failedType":"COMMAND_REQUEST"}"""))
        assertEquals(WatchProblem.Refused("COMMAND_PENDING"), c.state.value.problem)
        assertNull(c.state.value.pending)

        assertTrue(c.request(WatchRequest.CANCEL))
        c.onMessage(message("STATE_RESULT", """{"scope":"SERVER","recordingMode":"WATCH","state":"CANCELLED","stateVersion":2,"currentBpm":null}"""))
        assertEquals(RunState.CANCELLED, c.state.value.confirmed)
        assertNull(c.state.value.pending)
    }

    @Test
    fun `a result that cannot be sent is retried three times and leaves the command unconfirmed`() = runBlocking {
        sender.accept = false
        val c = controller()
        c.onMessage(prepare())
        c.onMessage(authorize(501, 1))

        assertEquals(3, sender.count("COMMAND_RESULT"))
        assertEquals(WatchProblem.Unconfirmed("START"), c.state.value.problem)
        assertEquals(OutcomeResult.APPLIED, store.outcome("501")?.result)
    }

    private class FakeUploads(var pending: Int = 0) : com.runway.watch.batch.RunUploads {
        val calls = mutableListOf<String>()
        override suspend fun begin(sessionId: String, deviceId: String) { calls += "begin:$sessionId:$deviceId" }
        override suspend fun finish(sessionId: String): Int { calls += "finish:$sessionId"; return pending }
        override suspend fun pendingCount(sessionId: String) = pending
        override suspend fun retryFailed(sessionId: String) { calls += "retryFailed:$sessionId" }
        override suspend fun stop(sessionId: String) { calls += "stop:$sessionId" }
    }

    @Test
    fun `prepare without the watch device id is not ready and start is refused`() = runBlocking {
        val c = controller()
        c.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"goal":{},"initialBpm":null}"""))

        val reply = sender.last("SESSION_PREPARED").getJSONObject("payload")
        assertFalse(reply.getBoolean("ready"))
        assertEquals("DEVICE_ID_MISSING", reply.getString("reasonCode"))
        c.onMessage(authorize(501, 1))
        assertEquals("NOT_PREPARED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("reasonCode"))
        assertTrue(gateway.calls.isEmpty())
    }

    @Test
    fun `start begins the batches and end waits for them before reporting what is still unsaved`() = runBlocking {
        val uploads = FakeUploads()
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads)
        c.running()
        assertEquals(listOf("begin:201:101"), uploads.calls)

        uploads.pending = 2
        c.onMessage(apply("END", 504, 2))
        assertEquals(listOf("begin:201:101", "finish:201"), uploads.calls)
        val end = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals("APPLIED", end.getString("result"))
        assertEquals(2, end.getInt("pendingBatchCount"))
        assertFalse(end.getBoolean("uploadComplete"))

        // 같은 END를 다시 받으면 실행하지 않고, 그 사이 저장이 확인됐으면 0으로 보고한다.
        uploads.pending = 0
        c.onMessage(apply("END", 504, 2))
        val again = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals(0, again.getInt("pendingBatchCount"))
        assertTrue(again.getBoolean("uploadComplete"))
        assertEquals(listOf("start", "end"), gateway.calls)
    }

    // S15P31E105-446: 마지막 batch 저장 확인이 종료 대기(90초)보다 늦으면 폰은 409 UPLOAD_PENDING을 받는다.
    // 그 뒤 batch가 저장되면 워치가 같은 END 결과를 pendingBatchCount=0으로 다시 보고해 세션이 PAUSED에 남지 않게 한다.
    @Test
    fun `an applied end reported with unsaved batches is reported again once they are saved`() = runBlocking {
        val uploads = FakeUploads()
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads)
        c.running()
        uploads.pending = 2
        c.onMessage(message("COMMAND_REQUEST", """{"phase":"APPLY","action":"END","expectedVersion":2,"targetBpm":null,"commandId":504,"coachingId":null}""", messageId = "phone:9"))
        // START 결과 + END 결과(pendingBatchCount=2).
        assertEquals(2, sender.count("COMMAND_RESULT"))
        assertEquals(2, sender.last("COMMAND_RESULT").getJSONObject("payload").getInt("pendingBatchCount"))

        // 아직 남아 있으면 다시 보내지 않는다.
        c.tick()
        assertEquals(2, sender.count("COMMAND_RESULT"))

        uploads.pending = 0
        c.tick()
        assertEquals(3, sender.count("COMMAND_RESULT"))
        val again = sender.last("COMMAND_RESULT")
        assertEquals("phone:9", again.getString("replyTo"))
        val payload = again.getJSONObject("payload")
        assertEquals(504L, payload.getLong("commandId"))
        assertEquals("APPLIED", payload.getString("result"))
        assertEquals(0, payload.getInt("pendingBatchCount"))
        assertTrue(payload.getBoolean("uploadComplete"))
        assertEquals(listOf("start", "end"), gateway.calls)

        // 한 번만 다시 보낸다. 서버 저장이 확인되면 종료가 확정된다.
        c.tick()
        assertEquals(3, sender.count("COMMAND_RESULT"))
        c.onMessage(saved(504, 3))
        assertEquals(RunState.COMPLETED, c.state.value.confirmed)
        assertNull(c.state.value.pending)
    }

    // S15P31E105-446: 자동 재보고가 폰에 전달되지 않으면 10초 간격으로 다시 보낸다. 전달되면 멈춘다.
    @Test
    fun `a saved end re-report that did not reach the phone is sent again until it does`() = runBlocking {
        val uploads = FakeUploads()
        var elapsed = 0L
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads, elapsedMs = { elapsed })
        c.running()
        uploads.pending = 2
        c.onMessage(apply("END", 504, 2))
        uploads.pending = 0
        sender.accept = false
        c.tick()
        val tried = sender.count("COMMAND_RESULT")

        // 간격 전에는 다시 보내지 않는다.
        elapsed = WatchSessionController.REPORT_RETRY_MS - 1
        c.tick()
        assertEquals(tried, sender.count("COMMAND_RESULT"))

        sender.accept = true
        elapsed = WatchSessionController.REPORT_RETRY_MS
        c.tick()
        assertEquals(tried + 1, sender.count("COMMAND_RESULT"))
        val payload = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals(504L, payload.getLong("commandId"))
        assertEquals(0, payload.getInt("pendingBatchCount"))

        // 전달된 뒤에는 다시 보내지 않는다.
        elapsed += WatchSessionController.REPORT_RETRY_MS * 3
        c.tick()
        assertEquals(tried + 1, sender.count("COMMAND_RESULT"))
        assertEquals(listOf("start", "end"), gateway.calls)
    }

    @Test
    fun `an undelivered end re-report stops when another run is prepared`() = runBlocking {
        val uploads = FakeUploads()
        var elapsed = 0L
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads, elapsedMs = { elapsed })
        c.running()
        uploads.pending = 2
        c.onMessage(apply("END", 504, 2))
        uploads.pending = 0
        sender.accept = false
        c.tick()
        val tried = sender.count("COMMAND_RESULT")

        sender.accept = true
        c.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}""", sessionId = "202"))
        elapsed = WatchSessionController.REPORT_RETRY_MS
        c.tick()
        assertEquals(tried, sender.count("COMMAND_RESULT"))
    }

    @Test
    fun `an end already saved by the server is not reported again`() = runBlocking {
        val uploads = FakeUploads()
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads)
        c.running()
        c.onMessage(apply("END", 504, 2))
        c.onMessage(saved(504, 3))
        val results = sender.count("COMMAND_RESULT")

        c.tick()
        assertEquals(results, sender.count("COMMAND_RESULT"))
    }

    // S15P31E105-446: 재시도 상한으로 저장 미확인이 된 batch가 남으면 '다시 확인'(같은 END 재전송)이 영구히 실패했다.
    // 다시 받은 END는 운동을 다시 끝내지 않고, 남은 batch를 한 번 더(상한 3회) 보내게 한다.
    @Test
    fun `a resent end that is not saved yet retries the unsaved batches once more`() = runBlocking {
        val uploads = FakeUploads()
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads)
        c.running()
        uploads.pending = 1
        c.onMessage(apply("END", 504, 2))
        c.onMessage(apply("END", 504, 2))

        assertEquals(listOf("begin:201:101", "finish:201", "retryFailed:201"), uploads.calls)
        assertEquals(listOf("start", "end"), gateway.calls)

        // 저장이 확인된 END를 다시 받으면 batch를 건드리지 않는다.
        c.onMessage(saved(504, 3))
        c.onMessage(apply("END", 504, 2))
        assertEquals(listOf("begin:201:101", "finish:201", "retryFailed:201"), uploads.calls)
    }

    @Test
    fun `the run keeps the process alive from start until the applied end`() = runBlocking {
        val calls = mutableListOf<String>()
        val keepAlive = object : RunKeepAlive {
            override fun start() { calls += "start" }
            override fun stop() { calls += "stop" }
        }
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, keepAlive = keepAlive)
        c.running()
        assertEquals(listOf("start"), calls)
        c.onMessage(apply("END", 504, 2))
        assertEquals(listOf("start", "stop"), calls)
    }

    // S15P31E105-445: the app process restarts mid-run (debug reinstall, OS kill) and the phone's server push wakes it.
    private fun serverState(state: String, version: Long, mode: String = "WATCH") =
        message("STATE_RESULT", """{"scope":"SERVER","recordingMode":"$mode","state":"$state","stateVersion":$version,"currentBpm":null}""")

    private class KeepAliveCalls : RunKeepAlive {
        val calls = mutableListOf<String>()
        override fun start() { calls += "start" }
        override fun stop() { calls += "stop" }
    }

    /** A controller in a new process: the store survived, nothing else did. */
    private fun restarted(uploads: FakeUploads = FakeUploads(), keepAlive: RunKeepAlive = NoKeepAlive) = WatchSessionController(
        store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, uploads = uploads, keepAlive = keepAlive,
    )

    @Test
    fun `after a restart a running server state listens to the kept exercise again and resumes the batches`() = runBlocking {
        controller().running()
        gateway.calls.clear()
        val uploads = FakeUploads()
        val keepAlive = KeepAliveCalls()
        val c = restarted(uploads, keepAlive)

        c.onMessage(serverState("RUNNING", 2))
        assertEquals(listOf("reattach"), gateway.calls)
        assertEquals(listOf("begin:201:101"), uploads.calls)
        assertEquals(listOf("start"), keepAlive.calls)
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertFalse(c.state.value.measurementLost)

        // 이후 서버 상태마다 다시 붙이지 않고, 명령은 그대로 실행한다.
        c.onMessage(serverState("RUNNING", 2))
        c.onMessage(apply("PAUSE", 502, 2))
        assertEquals(listOf("reattach", "pause"), gateway.calls)
        assertEquals("APPLIED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("result"))
    }

    @Test
    fun `after a restart a paused run listens again but does not resume the measurement`() = runBlocking {
        val c = controller()
        c.running()
        c.onMessage(apply("PAUSE", 502, 2))
        c.onMessage(saved(502, 3))
        gateway.calls.clear()

        val again = restarted()
        again.onMessage(serverState("PAUSED", 3))
        assertEquals(listOf("reattach"), gateway.calls)
        assertEquals(RunState.PAUSED, again.state.value.confirmed)
        again.onMessage(apply("RESUME", 503, 3))
        assertEquals(listOf("reattach", "resume"), gateway.calls)
    }

    @Test
    fun `a run whose exercise is gone after a restart is never restarted and is pointed to the phone`() = runBlocking {
        controller().running()
        gateway.calls.clear()
        gateway.exerciseLeft = false
        val c = restarted()

        c.onMessage(serverState("PAUSED", 3))
        assertTrue(c.state.value.measurementLost)
        assertEquals(SessionRunControl.MEASUREMENT_LOST_NOTICE, SessionRunControl.notice(c.state.value))
        assertTrue(SessionRunControl.toSnapshot(c.state.value).measurementLost)
        // 새 서버 상태가 와도 안내는 남는다.
        c.onMessage(serverState("PAUSED", 3))
        assertTrue(c.state.value.measurementLost)

        // 재개는 실행하지 않고 거절해 성공으로 보이지 않는다.
        c.onMessage(apply("RESUME", 503, 3))
        val resume = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals("REJECTED", resume.getString("result"))
        assertEquals("EXERCISE_LOST", resume.getString("reasonCode"))

        // 종료는 끝낼 운동 없이 남은 기록을 보내고 결과를 보고한다.
        c.onMessage(apply("END", 504, 3))
        assertEquals("APPLIED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("result"))
        assertEquals(listOf("reattach"), gateway.calls)
    }

    @Test
    fun `a run whose exercise is gone can still be paused and ended so the record is saved`() = runBlocking {
        controller().running()
        gateway.calls.clear()
        gateway.exerciseLeft = false
        val c = restarted()
        c.onMessage(serverState("RUNNING", 2))
        assertTrue(c.state.value.measurementLost)

        // 멈출 운동이 없으니 서버 상태만 일시정지로 바꾸고, 폰의 일시정지 → 종료 길을 막지 않는다.
        c.onMessage(apply("PAUSE", 502, 2))
        assertEquals("APPLIED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("result"))
        c.onMessage(saved(502, 3))
        c.onMessage(apply("END", 504, 3))
        assertEquals("APPLIED", sender.last("COMMAND_RESULT").getJSONObject("payload").getString("result"))
        assertEquals(listOf("reattach"), gateway.calls)
    }

    @Test
    fun `the lost notice ends with the run or when the phone records it`() = runBlocking {
        controller().running()
        gateway.exerciseLeft = false
        val c = restarted()
        c.onMessage(serverState("RUNNING", 2))
        assertTrue(c.state.value.measurementLost)

        c.onMessage(serverState("RUNNING", 3, mode = "PHONE_FALLBACK"))
        assertFalse(c.state.value.measurementLost)
        c.onMessage(serverState("COMPLETED", 4, mode = "PHONE_FALLBACK"))
        assertFalse(c.state.value.measurementLost)
    }

    @Test
    fun `after a restart a run already handed to the phone is not attached on the watch`() = runBlocking {
        controller().running()
        gateway.calls.clear()
        val c = restarted()
        c.onMessage(serverState("RUNNING", 3, mode = "PHONE_FALLBACK"))
        // 다시 붙이지 않고, 남아 있을 수 있는 워치 운동만 끝낸다(S15P31E105-464).
        assertEquals(listOf("end"), gateway.calls)
        assertFalse(c.state.value.measurementLost)
        assertTrue(c.state.value.phoneRecording)
    }

    // S15P31E105-464 (sessions.md 전환 후 워치 처리): 폰으로 넘긴 운동은 워치가 측정·박자·batch를 멈추고 다시 시작하지 않는다.
    private class FakePlayer : com.runway.watch.cue.RhythmPlayer {
        val calls = mutableListOf<String>()
        override fun play(bpm: Int) { calls += "play:$bpm" }
        override fun stop() { calls += "stop" }
    }

    private fun bpmState(state: String, version: Long, mode: String, bpm: Int?) =
        message("STATE_RESULT", """{"scope":"SERVER","recordingMode":"$mode","state":"$state","stateVersion":$version,"currentBpm":${bpm ?: "null"}}""")

    @Test
    fun `a run handed to the phone stops the beat, the batches and the watch exercise`() = runBlocking {
        val uploads = FakeUploads()
        val keepAlive = KeepAliveCalls()
        val player = FakePlayer()
        val c = WatchSessionController(
            store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000,
            uploads = uploads, keepAlive = keepAlive, player = player,
        )
        c.running()
        c.onMessage(bpmState("RUNNING", 2, "WATCH", 170))
        assertEquals("play:170", player.calls.last())
        uploads.calls.clear()
        keepAlive.calls.clear()

        c.onMessage(bpmState("RUNNING", 3, "PHONE_FALLBACK", 170))
        assertEquals("stop", player.calls.last())
        assertEquals(listOf("stop:201"), uploads.calls)
        assertEquals(listOf("start", "end"), gateway.calls)
        assertEquals(listOf("stop"), keepAlive.calls)
        assertTrue(c.state.value.phoneRecording)
        assertEquals(SessionRunControl.PHONE_RECORDING_NOTICE, SessionRunControl.notice(c.state.value))
        assertTrue(SessionRunControl.toSnapshot(c.state.value).phoneRecording)
    }

    @Test
    fun `a reconnect or later snapshot of a run handed to the phone never restarts anything`() = runBlocking {
        val uploads = FakeUploads()
        val keepAlive = KeepAliveCalls()
        val player = FakePlayer()
        val c = WatchSessionController(
            store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000,
            uploads = uploads, keepAlive = keepAlive, player = player,
        )
        c.running()
        c.onMessage(bpmState("RUNNING", 3, "PHONE_FALLBACK", null))
        val plays = player.calls.count { it.startsWith("play") }
        uploads.calls.clear()
        keepAlive.calls.clear()
        gateway.calls.clear()

        // 재연결 뒤 같은 버전·더 높은 버전 스냅샷, 그리고 recordingMode가 빠진 스냅샷에도 폰 제어를 유지한다.
        c.onMessage(bpmState("RUNNING", 3, "PHONE_FALLBACK", null))
        c.onMessage(bpmState("PAUSED", 4, "PHONE_FALLBACK", null))
        c.onMessage(bpmState("RUNNING", 5, "PHONE_FALLBACK", 170))
        c.onMessage(bpmState("RUNNING", 6, "WATCH", 170))
        assertEquals(plays, player.calls.count { it.startsWith("play") })
        assertTrue(uploads.calls.isEmpty())
        assertTrue(keepAlive.calls.isEmpty())
        assertTrue(gateway.calls.isEmpty())
        assertTrue(c.state.value.phoneRecording)

        // 워치 버튼은 요청을 보내지 않고, 명령이 와도 실행하지 않는다.
        val requests = sender.count("COMMAND_REQUEST")
        assertFalse(c.request(WatchRequest.PAUSE))
        assertFalse(c.requestBpm(175))
        assertEquals(requests, sender.count("COMMAND_REQUEST"))
        c.onMessage(apply("RESUME", 503, 6))
        val resume = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals("REJECTED", resume.getString("result"))
        assertEquals("CONTROL_DEVICE_CHANGED", resume.getString("reasonCode"))
        assertTrue(gateway.calls.isEmpty())

        // 폰이 끝낸 뒤의 종료 상태는 지금처럼 결과로 보인다.
        c.onMessage(bpmState("COMPLETED", 7, "PHONE_FALLBACK", null))
        assertEquals(RunState.COMPLETED, c.state.value.confirmed)
        assertEquals(listOf("stop"), keepAlive.calls)
        assertTrue(gateway.calls.isEmpty())
    }

    @Test
    fun `a watch run keeps its beat and batches on later watch snapshots`() = runBlocking {
        val uploads = FakeUploads()
        val player = FakePlayer()
        val c = WatchSessionController(
            store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000,
            uploads = uploads, player = player,
        )
        c.running()
        c.onMessage(bpmState("RUNNING", 2, "WATCH", 170))
        c.onMessage(bpmState("RUNNING", 3, "WATCH", 170))
        assertEquals("play:170", player.calls.last())
        assertTrue(uploads.calls.none { it.startsWith("stop") })
        assertEquals(listOf("start"), gateway.calls)
        assertFalse(c.state.value.phoneRecording)
        assertNull(SessionRunControl.notice(c.state.value))
    }

    @Test
    fun `a failed exercise check is tried again on the next server state`() = runBlocking {
        controller().running()
        gateway.calls.clear()
        gateway.exerciseLeft = null
        val c = restarted()
        c.onMessage(serverState("RUNNING", 2))
        assertFalse(c.state.value.measurementLost)

        gateway.exerciseLeft = true
        c.onMessage(serverState("RUNNING", 2))
        c.onMessage(serverState("RUNNING", 2))
        assertEquals(listOf("reattach", "reattach"), gateway.calls)
    }

    @Test
    fun `a restarted watch asks for its stored session's server state until one arrives, for two minutes at most`() = runBlocking {
        controller().running()
        var elapsed = 0L
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, elapsedMs = { elapsed })
        sender.sent.clear()

        c.tick()
        val query = sender.last("STATE_QUERY")
        assertEquals(201L, query.getLong("sessionId"))
        assertEquals("SERVER", query.getJSONObject("payload").getString("scope"))
        elapsed = 5_000
        c.tick()
        assertEquals(1, sender.count("STATE_QUERY"))
        elapsed = 10_000
        c.tick()
        assertEquals(2, sender.count("STATE_QUERY"))

        // 서버 상태가 오면 운동을 다시 붙인다.
        c.onMessage(serverState("RUNNING", 2))
        assertEquals(listOf("start", "reattach"), gateway.calls)
    }

    @Test
    fun `a restarted watch stops asking once the server state arrived`() = runBlocking {
        val c0 = controller()
        c0.onMessage(prepare())
        var elapsed = 0L
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, elapsedMs = { elapsed })
        sender.sent.clear()
        c.tick()
        c.onMessage(serverState("READY", 1))
        elapsed = 30_000
        c.tick()
        assertEquals(1, sender.count("STATE_QUERY"))
        assertTrue(gateway.calls.isEmpty())
    }

    @Test
    fun `a restarted watch whose session the phone no longer runs stops asking after two minutes`() = runBlocking {
        controller().running()
        var elapsed = 0L
        val c = WatchSessionController(store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000, elapsedMs = { elapsed })
        sender.sent.clear()
        while (elapsed < 200_000) {
            c.tick()
            elapsed += 5_000
        }
        assertEquals(12, sender.count("STATE_QUERY"))
    }

    @Test
    fun `a run started in this process is not checked again on its server states`() = runBlocking {
        val c = controller()
        c.running()
        c.onMessage(serverState("RUNNING", 2))
        assertEquals(listOf("start"), gateway.calls)
    }
}
