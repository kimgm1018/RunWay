package com.runway.watch.session

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.Instant

/**
 * S15P31E105-839: 서버 운동시간은 START~PAUSE~RESUME~END의 appliedAt 간격으로 계산된다. 워치는 같은 간격을 Health Services로
 * 센다. 한 운동의 appliedAt이 서로 다른 시차로 보정되면(시작은 보정 없이, 일시정지는 보정해서) 두 화면의 운동시간이 그 시차만큼
 * 벌어지므로, 준비 때 시차를 먼저 추정하고 시작 때 쓴 시차를 그 운동의 모든 제어 결과에 그대로 쓴다.
 */
class RunClockOffsetTest {

    private object Gateway : ExerciseGateway {
        override suspend fun start() = Unit
        override suspend fun pause() = Unit
        override suspend fun resume() = Unit
        override suspend fun end() = Unit
        override suspend fun reattach() = true
    }

    private class FakeSender : SessionSender {
        val sent = mutableListOf<JSONObject>()
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            sent += JSONObject(String(bytes, Charsets.UTF_8))
            return true
        }
        fun last(type: String) = sent.last { it.getString("type") == type }
        fun count(type: String) = sent.count { it.getString("type") == type }
    }

    private var now = Instant.parse("2026-11-15T10:00:00Z")
    private val store = InMemorySessionStore()
    private val sender = FakeSender()

    private fun controller() = WatchSessionController(
        store, Gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000,
        clock = ServerClock(), elapsedMs = { 0 },
    )

    private fun message(type: String, payload: String, messageId: String = "phone:1") = decodeSessionMessage(
        """{"protocolVersion":1,"type":"$type","messageId":"$messageId","replyTo":null,"senderDeviceId":null,"sessionId":201,"payload":$payload}"""
            .toByteArray(),
    )!!

    private fun prepare(version: Long = 1) =
        message("SESSION_PREPARE", """{"stateVersion":$version,"deviceId":101,"goal":{},"initialBpm":null}""")
    private fun authorize(commandId: Long, version: Long) =
        message("START_AUTHORIZED", """{"commandId":$commandId,"expectedVersion":$version,"targetBpm":null,"coachingId":null}""")
    private fun apply(action: String, commandId: Long, version: Long) = message(
        "COMMAND_REQUEST",
        """{"phase":"APPLY","action":"$action","expectedVersion":$version,"targetBpm":null,"commandId":$commandId,"coachingId":null}""",
    )
    private fun saved(commandId: Long, version: Long) =
        message("COMMAND_RECEIVED", """{"commandId":$commandId,"persisted":true,"stateVersion":$version}""")

    /** Answers the last STATE_QUERY as a server whose clock is the watch's + [offsetMs], with a 200 ms round trip. */
    private suspend fun WatchSessionController.answerClock(offsetMs: Long, state: String = "READY", version: Long = 1) {
        val sentAt = Instant.parse(sender.last("STATE_QUERY").getJSONObject("payload").getString("clientSendAt"))
        val serverAt = sentAt.plusMillis(100 + offsetMs)
        val back = now
        now = sentAt.plusMillis(200)
        onMessage(
            message(
                "STATE_RESULT",
                """{"scope":"SERVER","recordingMode":"WATCH","state":"$state","stateVersion":$version,"currentBpm":null,""" +
                    """"pendingCommand":null,"lastCommand":null,"pendingBatchCount":0,""" +
                    """"clientSendAt":"$sentAt","serverReceiveAt":"$serverAt","serverSendAt":"$serverAt"}""",
                messageId = "phone:s${sender.count("STATE_QUERY")}",
            ),
        )
        now = maxOf(back, now)
    }

    private fun appliedAt(commandId: Long): Instant = Instant.parse(
        sender.sent.last { it.getString("type") == "COMMAND_RESULT" && it.getJSONObject("payload").getLong("commandId") == commandId }
            .getJSONObject("payload").getString("appliedAt"),
    )

    @Test
    fun `prepare asks the server clock so the start is already corrected`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        assertEquals(1, sender.count("STATE_QUERY"))
        assertEquals("SERVER", sender.last("STATE_QUERY").getJSONObject("payload").getString("scope"))
        c.answerClock(offsetMs = -3_000)

        now = now.plusSeconds(5)
        c.onMessage(authorize(501, 1))

        assertEquals(now.minusMillis(3_000), appliedAt(501))
    }

    @Test
    fun `a later estimate does not change the offset of the run, so server intervals equal watch intervals`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        c.answerClock(offsetMs = -3_000)
        val startWatch = now.plusSeconds(1)
        now = startWatch
        c.onMessage(authorize(501, 1))
        c.onMessage(saved(501, 2))
        // 달리는 중 새 추정(시차 −1 초, 더 좁은 오차는 아니어도 2분 뒤라 교체된다)이 와도 이 운동의 보정값은 바꾸지 않는다.
        now = startWatch.plusSeconds(150)
        c.answerClock(offsetMs = -1_000, state = "RUNNING", version = 2)

        val pauseWatch = startWatch.plusSeconds(176)
        now = pauseWatch
        c.onMessage(apply("PAUSE", 502, 2))

        assertEquals(Duration.between(startWatch, pauseWatch), Duration.between(appliedAt(501), appliedAt(502)))
        assertEquals(pauseWatch.minusMillis(3_000), appliedAt(502))
    }

    @Test
    fun `a start without any estimate keeps the watch clock for the whole run`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        // 준비 질의의 답이 시작보다 늦었다: 시작은 워치 시각 그대로 보고된다.
        val startWatch = now.plusSeconds(1)
        now = startWatch
        c.onMessage(authorize(501, 1))
        c.onMessage(saved(501, 2))
        assertEquals(startWatch, appliedAt(501))
        c.answerClock(offsetMs = -3_000, state = "RUNNING", version = 2)

        val pauseWatch = startWatch.plusSeconds(56)
        now = pauseWatch
        c.onMessage(apply("PAUSE", 502, 2))
        c.onMessage(saved(502, 3))
        now = pauseWatch.plusSeconds(20)
        c.onMessage(apply("RESUME", 503, 3))

        assertEquals(Duration.ofSeconds(56), Duration.between(appliedAt(501), appliedAt(502)))
        assertEquals(Duration.ofSeconds(20), Duration.between(appliedAt(502), appliedAt(503)))
    }

    @Test
    fun `a restarted watch keeps the run's offset`() = runBlocking {
        val first = controller()
        first.onMessage(prepare())
        first.answerClock(offsetMs = -3_000)
        val startWatch = now.plusSeconds(1)
        now = startWatch
        first.onMessage(authorize(501, 1))
        first.onMessage(saved(501, 2))

        val restarted = controller()
        restarted.onMessage(
            message(
                "STATE_RESULT",
                """{"scope":"SERVER","recordingMode":"WATCH","state":"RUNNING","stateVersion":2,"currentBpm":null,""" +
                    """"pendingCommand":null,"lastCommand":null,"pendingBatchCount":0,""" +
                    """"clientSendAt":null,"serverReceiveAt":null,"serverSendAt":null}""",
                messageId = "phone:r",
            ),
        )
        val pauseWatch = startWatch.plusSeconds(40)
        now = pauseWatch
        restarted.onMessage(apply("PAUSE", 502, 2))

        assertEquals(Duration.ofSeconds(40), Duration.between(appliedAt(501), appliedAt(502)))
    }

    @Test
    fun `preparing the same session again keeps the run's offset`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        c.answerClock(offsetMs = -3_000)
        c.onMessage(authorize(501, 1))
        c.onMessage(saved(501, 2))

        c.onMessage(prepare(version = 2))

        assertEquals(-3_000L, store.prepared()?.clockOffsetMs)
    }
}
