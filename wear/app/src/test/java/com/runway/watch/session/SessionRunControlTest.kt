package com.runway.watch.session

import com.runway.watch.run.AnalysisStatus
import com.runway.watch.run.RunIntent
import com.runway.watch.run.SaveStatus
import com.runway.watch.run.RunState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The watch screens read the controller through the existing RunControl (S15P31E105-256 [D] part 2). */
class SessionRunControlTest {

    private class Recorder : SessionSender {
        val types = mutableListOf<String>()
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            val json = JSONObject(String(bytes, Charsets.UTF_8))
            types += json.getString("type") + (json.getJSONObject("payload").optString("action").let { if (it.isEmpty()) "" else ":$it" })
            return true
        }
    }

    private object NoopGateway : ExerciseGateway {
        override suspend fun start() = Unit
        override suspend fun pause() = Unit
        override suspend fun resume() = Unit
        override suspend fun end() = Unit
    }

    private val sender = Recorder()
    private val controller = WatchSessionController(InMemorySessionStore(), NoopGateway, sender, sleep = {}, jitter = { 0 })
    private val control = SessionRunControl(controller, CoroutineScope(Dispatchers.Unconfined))

    private fun message(type: String, payload: String) = decodeSessionMessage(
        """{"protocolVersion":1,"type":"$type","messageId":"p:1","replyTo":null,"senderDeviceId":null,"sessionId":201,"payload":$payload}""".toByteArray(),
    )!!

    @Test
    fun `before the phone prepares a session the watch shows nothing to start`() {
        assertNull(control.snapshot.value.state)
        assertFalse(control.snapshot.value.pendingCommand)
    }

    @Test
    fun `the snapshot follows the confirmed state and shows a request in flight`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        assertEquals(RunState.READY, control.snapshot.value.state)

        control.send(RunIntent.START)
        assertTrue(control.snapshot.value.pendingCommand)
        assertEquals("시작 확인 중", control.snapshot.value.notice)
        assertEquals(RunState.READY, control.snapshot.value.state)

        controller.onMessage(message("START_AUTHORIZED", """{"commandId":501,"expectedVersion":1,"targetBpm":null,"coachingId":null}"""))
        controller.onMessage(message("COMMAND_RECEIVED", """{"commandId":501,"persisted":true,"stateVersion":2}"""))
        assertEquals(RunState.RUNNING, control.snapshot.value.state)
        assertFalse(control.snapshot.value.pendingCommand)
        assertNull(control.snapshot.value.notice)
    }

    @Test
    fun `watch buttons become requests to the phone`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        control.send(RunIntent.CANCEL)

        assertEquals(listOf("SESSION_PREPARED", "COMMAND_REQUEST:CANCEL"), sender.types)
    }

    @Test
    fun `problems become notices the runner can read`() = runBlocking {
        controller.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        control.send(RunIntent.CANCEL)
        controller.onMessage(message("ERROR", """{"code":"COMMAND_PENDING","retryable":false,"failedType":"COMMAND_REQUEST"}"""))

        assertEquals("휴대폰에서 처리하지 못했어요", control.snapshot.value.notice)
        assertEquals(
            "시작 여부를 확인할 수 없어요",
            SessionRunControl.notice(WatchSessionState(pending = null, problem = WatchProblem.Unconfirmed("START"))),
        )
        assertEquals(
            "워치가 일시정지하지 못했어요",
            SessionRunControl.notice(WatchSessionState(problem = WatchProblem.Rejected("PAUSE", "INVALID_STATE"))),
        )
        assertEquals(
            "휴대폰 연결이 없어요",
            SessionRunControl.notice(WatchSessionState(problem = WatchProblem.PhoneUnreachable)),
        )
    }

    @Test
    fun aServerSavedEndShowsSavedWithTheAnalysisPending() {
        val snapshot = SessionRunControl.toSnapshot(WatchSessionState(sessionId = "201", confirmed = RunState.COMPLETED, stateVersion = 4))
        assertEquals(SaveStatus.SAVED, snapshot.result?.save)
        assertEquals(AnalysisStatus.PENDING, snapshot.result?.analysis)
    }

    @Test
    fun anUnconfirmedEndShowsTheSaveAsUnconfirmed() {
        val snapshot = SessionRunControl.toSnapshot(
            WatchSessionState(sessionId = "201", confirmed = RunState.PAUSED, stateVersion = 3, problem = WatchProblem.Unconfirmed("END")),
        )
        assertEquals(SaveStatus.UNCONFIRMED, snapshot.result?.save)
    }

    @Test
    fun aRunningSessionHasNoResult() {
        val snapshot = SessionRunControl.toSnapshot(WatchSessionState(sessionId = "201", confirmed = RunState.RUNNING, stateVersion = 2))
        assertNull(snapshot.result)
    }
}
