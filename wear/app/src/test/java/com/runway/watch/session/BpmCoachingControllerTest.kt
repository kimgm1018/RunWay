package com.runway.watch.session

import com.runway.watch.cue.RhythmPlayer
import com.runway.watch.run.RunState
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

/**
 * S15P31E105-257: rhythm BPM changes run only after server approval, coaching guides are decided once per commandId,
 * the server clock comes from STATE_QUERY round trips, and the server link is watched while running.
 */
class BpmCoachingControllerTest {

    private object Gateway : ExerciseGateway {
        override suspend fun start() = Unit
        override suspend fun pause() = Unit
        override suspend fun resume() = Unit
        override suspend fun end() = Unit
        override suspend fun reattach() = true
    }

    private class FakeSender : SessionSender {
        val sent = mutableListOf<Pair<String, JSONObject>>()
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            sent += path to JSONObject(String(bytes, Charsets.UTF_8))
            return true
        }
        fun all(type: String) = sent.filter { it.second.getString("type") == type }
        fun last(type: String) = all(type).last().second
        fun count(type: String) = all(type).size
    }

    private class FakePlayer : RhythmPlayer {
        val calls = mutableListOf<String>()
        override fun play(bpm: Int) { calls += "play:$bpm" }
        override fun stop() { calls += "stop" }
    }

    private var now = Instant.parse("2026-10-28T01:00:00Z")
    private var elapsed = 0L
    private val store = InMemorySessionStore()
    private val sender = FakeSender()
    private val player = FakePlayer()

    private class BrokenGateway : ExerciseGateway {
        override suspend fun start() = Unit
        override suspend fun pause(): Unit = throw IllegalStateException("pause failed")
        override suspend fun resume() = Unit
        override suspend fun end(): Unit = throw IllegalStateException("end failed")
        override suspend fun reattach() = true
    }

    private fun controller(gateway: ExerciseGateway = Gateway) = WatchSessionController(
        store, gateway, sender, now = { now }, sleep = {}, jitter = { 0 }, callTimeoutMs = 1_000,
        player = player, clock = ServerClock(), elapsedMs = { elapsed },
    )

    private fun message(type: String, payload: String, messageId: String = "phone:1") = decodeSessionMessage(
        """{"protocolVersion":1,"type":"$type","messageId":"$messageId","replyTo":null,"senderDeviceId":null,"sessionId":201,"payload":$payload}"""
            .toByteArray(),
    )!!

    private fun prepare(initialBpm: Int? = 170) =
        message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":${initialBpm ?: "null"}}""")
    private fun apply(action: String, commandId: Long, version: Long, bpm: Int? = null) = message(
        "COMMAND_REQUEST",
        """{"phase":"APPLY","action":"$action","expectedVersion":$version,"targetBpm":${bpm ?: "null"},"commandId":$commandId,"coachingId":null}""",
    )
    private fun saved(commandId: Long, version: Long) =
        message("COMMAND_RECEIVED", """{"commandId":$commandId,"persisted":true,"stateVersion":$version}""")
    private fun guide(commandId: Long, coachingId: Long, version: Long, bpm: Int = 165, expiresAt: String = "2026-10-28T01:02:00Z") =
        message(
            "COACHING_GUIDE",
            """{"commandId":$commandId,"coachingId":$coachingId,"expectedVersion":$version,"targetBpm":$bpm,"recommendedPaceSecPerKm":360,"expiresAt":"$expiresAt"}""",
            messageId = "phone:g$commandId",
        )
    private fun serverState(
        state: String, version: Long, bpm: Int?, clientSendAt: String? = null, serverIn: String? = null, serverOut: String? = null,
        rhythm: Boolean? = null,
    ) =
        message(
            "STATE_RESULT",
            """{"scope":"SERVER","recordingMode":"WATCH","state":"$state","stateVersion":$version,"currentBpm":${bpm ?: "null"},""" +
                (if (rhythm == null) "" else """"rhythmCueEnabled":$rhythm,""") +
                """"pendingCommand":null,"lastCommand":null,"pendingBatchCount":0,""" +
                """"clientSendAt":${clientSendAt.q()},"serverReceiveAt":${serverIn.q()},"serverSendAt":${serverOut.q()}}""",
        )
    private fun String?.q() = if (this == null) "null" else "\"$this\""

    /** Prepared with initialBpm 170, started and saved at version 2. START sends a STATE_QUERY. */
    private suspend fun WatchSessionController.running() {
        onMessage(prepare())
        onMessage(message("START_AUTHORIZED", """{"commandId":501,"expectedVersion":1,"targetBpm":null,"coachingId":null}"""))
        onMessage(saved(501, 2))
    }

    /** Answers the last STATE_QUERY: server clock is watch + 3 s, 200 ms round trip (error bound 100 ms). */
    private suspend fun WatchSessionController.answerClock(
        state: String = "RUNNING", version: Long = 2, bpm: Int? = 170, rhythm: Boolean? = null,
    ) {
        val sentAt = Instant.parse(sender.last("STATE_QUERY").getJSONObject("payload").getString("clientSendAt"))
        val serverIn = sentAt.plusMillis(3_100)
        now = sentAt.plusMillis(200)
        onMessage(serverState(state, version, bpm, sentAt.toString(), serverIn.toString(), serverIn.toString(), rhythm))
    }

    private fun lastCoaching() = sender.last("COACHING_RESULT").getJSONObject("payload")
    private fun lastResult() = sender.last("COMMAND_RESULT").getJSONObject("payload")

    // ---- BPM 안내 설정(S15P31E105-706) ----

    @Test
    fun `with the BPM guide off a coaching guide is applied without sound, pace and BPM are kept`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock(rhythm = false)
        assertFalse(c.state.value.rhythmCueEnabled)
        assertEquals("stop", player.calls.last())
        player.calls.clear()

        c.onMessage(guide(601, 9001, 2, bpm = 165))

        assertEquals("APPLIED", lastCoaching().getString("result"))
        assertEquals(165, c.state.value.currentBpm)
        assertEquals(AppliedCoaching("601", "9001", 165, 360, previousBpm = 170), c.state.value.coaching)
        assertTrue(player.calls.none { it.startsWith("play") })
    }

    @Test
    fun `turning the BPM guide on or off mid-run takes effect on the next server snapshot, even at the same version`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock(rhythm = false)
        assertEquals("stop", player.calls.last())

        c.onMessage(serverState("RUNNING", 2, 170, rhythm = true))
        assertTrue(c.state.value.rhythmCueEnabled)
        assertEquals("play:170", player.calls.last())

        c.onMessage(serverState("RUNNING", 2, 170, rhythm = false))
        assertEquals("stop", player.calls.last())

        // 값이 없는 스냅샷(이전 폰 앱)은 마지막 값을 유지한다.
        c.onMessage(serverState("RUNNING", 2, 170))
        assertFalse(c.state.value.rhythmCueEnabled)
        assertTrue(player.calls.takeLast(1).none { it.startsWith("play") })
    }

    @Test
    fun `a BPM the runner changed by hand plays even with the BPM guide off`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock(rhythm = false)

        c.onMessage(apply("SET_BPM", 502, 2, bpm = 175))

        assertEquals("APPLIED", lastResult().getString("result"))
        assertTrue(c.state.value.rhythmCueEnabled)
        assertEquals("play:175", player.calls.last())
    }

    @Test
    fun `without the field the beat plays as before`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock()
        assertTrue(c.state.value.rhythmCueEnabled)
        player.calls.clear()
        c.onMessage(guide(601, 9001, 2, bpm = 165))
        assertEquals(listOf("play:165"), player.calls)
    }

    // ---- SET_BPM ----

    @Test
    fun `a BPM button sends only a request with targetBpm and changes nothing before approval`() = runBlocking {
        val c = controller()
        c.running()
        player.calls.clear()

        assertTrue(c.requestBpm(171))
        val request = sender.last("COMMAND_REQUEST").getJSONObject("payload")
        assertEquals("REQUEST", request.getString("phase"))
        assertEquals("SET_BPM", request.getString("action"))
        assertEquals(2L, request.getLong("expectedVersion"))
        assertEquals(171, request.getInt("targetBpm"))
        assertEquals(170, c.state.value.currentBpm)
        assertEquals(BpmRequest(171, BpmRequestStatus.REQUESTING), c.state.value.bpmRequest)
        assertTrue(player.calls.isEmpty())

        // 앞선 요청이 확인되기 전에는 다음 요청을 보내지 않는다.
        assertFalse(c.requestBpm(172))
        assertFalse(c.request(WatchRequest.PAUSE))
        assertEquals(1, sender.count("COMMAND_REQUEST"))
    }

    @Test
    fun `out-of-range BPM and ended runs are not requested`() = runBlocking {
        val c = controller()
        c.running()
        assertFalse(c.requestBpm(59))
        assertFalse(c.requestBpm(221))
        c.onMessage(apply("END", 502, 2))
        c.onMessage(saved(502, 3))
        assertFalse(c.requestBpm(150))
        assertEquals(0, sender.count("COMMAND_REQUEST"))
    }

    @Test
    fun `an approved SET_BPM plays while running, is replayed without playing again, and frees the next request once saved`() = runBlocking {
        val c = controller()
        c.running()
        assertEquals(listOf("play:170"), player.calls)
        c.requestBpm(175)

        c.onMessage(apply("SET_BPM", 502, 2, bpm = 175))
        val result = lastResult()
        assertEquals("APPLIED", result.getString("result"))
        assertEquals(502L, result.getLong("commandId"))
        assertFalse(result.isNull("appliedAt"))
        assertEquals(listOf("play:170", "play:175"), player.calls)
        assertEquals(175, c.state.value.currentBpm)
        assertEquals(BpmRequestStatus.APPLIED, c.state.value.bpmRequest?.status)
        assertEquals(PendingStage.AWAITING_SAVE, c.state.value.pending?.stage)
        assertFalse(c.requestBpm(176))

        c.onMessage(apply("SET_BPM", 502, 2, bpm = 175))
        assertEquals(result.toString(), lastResult().toString())
        assertEquals(listOf("play:170", "play:175"), player.calls)

        c.onMessage(saved(502, 3))
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertEquals(3L, c.state.value.stateVersion)
        assertNull(c.state.value.pending)
        assertTrue(c.requestBpm(176))
    }

    @Test
    fun `READY and PAUSED keep the BPM without playing, resume plays the latest and pause stops`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        c.onMessage(apply("SET_BPM", 500, 1, bpm = 160))
        c.onMessage(saved(500, 2))
        assertEquals(160, c.state.value.currentBpm)
        assertTrue(player.calls.none { it.startsWith("play") })

        // 시작은 워치가 준비한 목표 버전(1) 기준으로 승인된다.
        c.onMessage(message("START_AUTHORIZED", """{"commandId":503,"expectedVersion":1,"targetBpm":null,"coachingId":null}"""))
        c.onMessage(saved(503, 3))
        assertEquals("play:160", player.calls.last())

        c.onMessage(apply("PAUSE", 504, 3))
        c.onMessage(saved(504, 4))
        assertEquals("stop", player.calls.last())
        c.onMessage(apply("SET_BPM", 505, 4, bpm = 150))
        c.onMessage(saved(505, 5))
        assertEquals("stop", player.calls.last())
        assertEquals(150, c.state.value.currentBpm)

        c.onMessage(apply("RESUME", 506, 5))
        assertEquals("play:150", player.calls.last())
        c.onMessage(saved(506, 6))
        c.onMessage(apply("END", 507, 6))
        assertEquals("stop", player.calls.last())
    }

    @Test
    fun `an old-version or invalid SET_BPM is rejected and a refused request shows as rejected`() = runBlocking {
        val c = controller()
        c.running()
        c.onMessage(apply("SET_BPM", 502, 1, bpm = 175))
        assertEquals("VERSION_MISMATCH", lastResult().getString("reasonCode"))
        assertEquals(BpmRequest(175, BpmRequestStatus.REJECTED), c.state.value.bpmRequest)
        c.onMessage(saved(502, 3))

        c.onMessage(apply("SET_BPM", 503, 3, bpm = 300))
        assertEquals("REJECTED", lastResult().getString("result"))
        assertEquals("INVALID_TARGET_BPM", lastResult().getString("reasonCode"))
        c.onMessage(saved(503, 4))
        assertEquals(170, c.state.value.currentBpm)

        assertTrue(c.requestBpm(171))
        c.onMessage(message("ERROR", """{"code":"VERSION_CONFLICT","retryable":false,"failedType":"COMMAND_REQUEST"}"""))
        assertEquals(BpmRequest(171, BpmRequestStatus.REJECTED), c.state.value.bpmRequest)
        assertNull(c.state.value.pending)
        assertEquals(listOf("play:170"), player.calls)
    }

    @Test
    fun `a SET_BPM interrupted mid-apply is reported UNKNOWN`() = runBlocking {
        store.saveOutcome(CommandOutcome("201", "502", "SET_BPM", OutcomeResult.EXECUTING, null, null, false, null, targetBpm = 175))
        val c = controller()
        c.running()
        c.onMessage(apply("SET_BPM", 502, 2, bpm = 175))
        assertEquals("UNKNOWN", lastResult().getString("result"))
        assertEquals("APPLY_INTERRUPTED", lastResult().getString("reasonCode"))
        assertEquals(WatchProblem.Unconfirmed("SET_BPM"), c.state.value.problem)
        assertEquals(170, c.state.value.currentBpm)
    }

    // ---- COACHING_GUIDE ----

    @Test
    fun `a fresh guide is applied once with a server-time appliedAt and blocks the next command until saved`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock()
        player.calls.clear()

        c.onMessage(guide(601, 9001, 2, bpm = 165))
        val result = lastCoaching()
        assertEquals("COACHING_RESULT", sender.last("COACHING_RESULT").getString("type"))
        assertEquals(SessionPaths.COACHING_RESULT, sender.all("COACHING_RESULT").last().first)
        assertEquals("phone:g601", sender.last("COACHING_RESULT").getString("replyTo"))
        assertEquals(601L, result.getLong("commandId"))
        assertEquals(9001L, result.getLong("coachingId"))
        assertEquals("APPLIED", result.getString("result"))
        assertTrue(result.isNull("reasonCode"))
        // 워치 시각 + 추정 시차(3초)
        assertEquals(now.plusSeconds(3).toString(), result.getString("appliedAt"))
        assertEquals(listOf("play:165"), player.calls)
        assertEquals(165, c.state.value.currentBpm)
        assertEquals(AppliedCoaching("601", "9001", 165, 360, previousBpm = 170), c.state.value.coaching)

        assertFalse(c.requestBpm(166))
        assertFalse(c.request(WatchRequest.PAUSE))
        c.onMessage(saved(601, 3))
        assertNull(c.state.value.pending)
        assertEquals(3L, c.state.value.stateVersion)
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertTrue(c.request(WatchRequest.PAUSE))
    }

    @Test
    fun `an expired guide is ignored as GUIDE_STALE, judged with the error bound`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock()
        player.calls.clear()
        // 서버 추정 시각 = now + 3s, 오차 0.1s. 만료가 그 사이에 있으면 적용하지 않는다.
        val expires = now.plusSeconds(3).plusMillis(50).toString()
        c.onMessage(guide(601, 9001, 2, expiresAt = expires))

        val result = lastCoaching()
        assertEquals("IGNORED", result.getString("result"))
        assertEquals("GUIDE_STALE", result.getString("reasonCode"))
        assertTrue(result.isNull("appliedAt"))
        assertTrue(player.calls.isEmpty())
        assertEquals(170, c.state.value.currentBpm)
        assertNull(c.state.value.coaching)
        // IGNORED도 서버 저장 확인 전에는 다음 명령을 막는다.
        assertFalse(c.requestBpm(171))
        c.onMessage(saved(601, 3))
        assertTrue(c.requestBpm(171))
    }

    @Test
    fun `a guide for another version, while paused or without a clock estimate is ignored`() = runBlocking {
        val c = controller()
        c.running()
        // 시차 추정 없음
        c.onMessage(guide(601, 9001, 2))
        assertEquals("GUIDE_STALE", lastCoaching().getString("reasonCode"))
        c.onMessage(saved(601, 3))

        c.answerClock(version = 3)
        c.onMessage(guide(602, 9002, 2))
        assertEquals("IGNORED", lastCoaching().getString("result"))
        assertEquals("GUIDE_STALE", lastCoaching().getString("reasonCode"))
        c.onMessage(saved(602, 4))

        c.onMessage(apply("PAUSE", 603, 4))
        c.onMessage(saved(603, 5))
        c.onMessage(guide(604, 9004, 5))
        assertEquals("IGNORED", lastCoaching().getString("result"))
        assertTrue(player.calls.none { it == "play:165" })
        assertEquals("stop", player.calls.last())
        assertEquals(170, c.state.value.currentBpm)
        assertNull(c.state.value.coaching)
    }

    @Test
    fun `a stored result is sent again unchanged, APPLIED even after expiry and after a restart`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock()
        c.onMessage(guide(601, 9001, 2, bpm = 165))
        val first = lastCoaching().toString()

        now = now.plusSeconds(600)
        c.onMessage(guide(601, 9001, 2, bpm = 165))
        assertEquals(first, lastCoaching().toString())

        val restarted = controller()
        restarted.onMessage(guide(601, 9001, 2, bpm = 165))
        assertEquals(first, lastCoaching().toString())
        assertEquals(1, player.calls.count { it == "play:165" })
        assertEquals(3, sender.count("COACHING_RESULT"))
    }

    @Test
    fun `an ignored result stays IGNORED when the guide comes again in time`() = runBlocking {
        val c = controller()
        c.running()
        c.onMessage(guide(601, 9001, 2))
        assertEquals("IGNORED", lastCoaching().getString("result"))
        c.answerClock()
        c.onMessage(guide(601, 9001, 2))
        assertEquals("IGNORED", lastCoaching().getString("result"))
        assertEquals(170, c.state.value.currentBpm)
    }

    @Test
    fun `the same coachingId is never applied twice`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock()
        c.onMessage(guide(601, 9001, 2, bpm = 165))
        c.onMessage(saved(601, 3))
        c.onMessage(guide(602, 9001, 3, bpm = 150))

        assertEquals("IGNORED", lastCoaching().getString("result"))
        assertEquals("GUIDE_STALE", lastCoaching().getString("reasonCode"))
        assertEquals(165, c.state.value.currentBpm)
    }

    @Test
    fun `a guide interrupted mid-apply is reported UNKNOWN and not applied again`() = runBlocking {
        store.saveOutcome(CommandOutcome("201", "601", "COACHING", OutcomeResult.EXECUTING, null, null, false, null, "9001", 165))
        val c = controller()
        c.running()
        c.answerClock()
        c.onMessage(guide(601, 9001, 2, bpm = 165))

        assertEquals("UNKNOWN", lastCoaching().getString("result"))
        assertTrue(lastCoaching().isNull("appliedAt"))
        assertEquals(WatchProblem.Unconfirmed("COACHING"), c.state.value.problem)
        assertEquals(170, c.state.value.currentBpm)
    }

    @Test
    fun `the first decision is saved atomically, so a concurrent duplicate gets the same result`() {
        val outcome = CommandOutcome("201", "601", "COACHING", OutcomeResult.IGNORED, null, "GUIDE_STALE", false, null, "9001", 165)
        assertNull(store.saveOutcomeIfAbsent(outcome))
        val applied = outcome.copy(result = OutcomeResult.APPLIED, reasonCode = null)
        assertEquals(outcome, store.saveOutcomeIfAbsent(applied))
        assertEquals(outcome, store.outcome("601"))
    }

    // ---- server link and clock ----

    @Test
    fun `no server state for 45 s during a run shows the link lost until one arrives`() = runBlocking {
        val c = controller()
        c.running()
        elapsed = 44_999
        c.tick()
        assertFalse(c.state.value.serverLinkLost)
        elapsed = 45_000
        c.tick()
        assertTrue(c.state.value.serverLinkLost)

        // 폰의 주기 전송(clientSendAt=null)도 연결 증거다.
        c.onMessage(serverState("RUNNING", 2, 170))
        assertFalse(c.state.value.serverLinkLost)
        elapsed = 89_999
        c.tick()
        assertFalse(c.state.value.serverLinkLost)
    }

    @Test
    fun `the link is not watched outside a run`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        elapsed = 100_000
        c.tick()
        assertFalse(c.state.value.serverLinkLost)
        // 준비 때 시차 추정용 질의 한 번뿐이고(S15P31E105-839), 운동 밖의 tick은 묻지 않는다.
        assertEquals(1, sender.count("STATE_QUERY"))
    }

    @Test
    fun `STATE_QUERY goes out at prepare and start, every 60 s with an estimate and every 10 s without`() = runBlocking {
        val c = controller()
        // 준비 때 한 번(S15P31E105-839), 시작 때 한 번.
        c.running()
        val query = sender.last("STATE_QUERY")
        assertEquals(SessionPaths.STATE_QUERY, sender.all("STATE_QUERY").last().first)
        assertEquals("SERVER", query.getJSONObject("payload").getString("scope"))
        assertEquals(2, sender.count("STATE_QUERY"))

        elapsed = 9_999; c.tick()
        assertEquals(2, sender.count("STATE_QUERY"))
        elapsed = 10_000; c.tick()
        assertEquals(3, sender.count("STATE_QUERY"))

        c.answerClock()
        elapsed = 69_999; c.tick()
        assertEquals(3, sender.count("STATE_QUERY"))
        elapsed = 70_000; c.tick()
        assertEquals(4, sender.count("STATE_QUERY"))
    }

    @Test
    fun `server snapshots older than the confirmed version are discarded, newer ones restore BPM and playback`() = runBlocking {
        val c = controller()
        c.running()
        c.onMessage(serverState("RUNNING", 5, 180))
        assertEquals(180, c.state.value.currentBpm)
        assertEquals("play:180", player.calls.last())

        c.onMessage(serverState("PAUSED", 4, 150))
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertEquals(180, c.state.value.currentBpm)
        assertEquals(5L, c.state.value.stateVersion)

        c.onMessage(serverState("PAUSED", 6, 180))
        assertEquals("stop", player.calls.last())
    }

    @Test
    fun `after a restart the server state resumes the beat at its BPM`() = runBlocking {
        store.savePrepared(Prepared("201", 1, ready = true, deviceId = "101"))
        val c = controller()
        c.onMessage(serverState("RUNNING", 4, 168))
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertEquals(listOf("play:168"), player.calls)
        c.onMessage(serverState("COMPLETED", 5, 168))
        assertEquals("stop", player.calls.last())
    }

    @Test
    fun `a same-version push does not clear a command still in flight`() = runBlocking {
        val c = controller()
        c.running()
        c.onMessage(apply("SET_BPM", 502, 2, bpm = 175))
        c.onMessage(serverState("RUNNING", 2, 170))
        assertEquals(175, c.state.value.currentBpm)
        assertEquals(PendingStage.AWAITING_SAVE, c.state.value.pending?.stage)
    }

    @Test
    fun `a watch request the phone never answers is released as unconfirmed after 60 s`() = runBlocking {
        val c = controller()
        c.running()
        c.answerClock()

        assertTrue(c.requestBpm(171))
        // 같은 버전의 서버 상태는 아직 처리 중일 수 있는 요청을 풀지 않는다.
        elapsed += 15_000
        c.onMessage(serverState("RUNNING", 2, 170))
        c.tick()
        assertEquals(PendingStage.REQUESTED, c.state.value.pending?.stage)
        assertFalse(c.requestBpm(172))

        elapsed += WatchSessionController.REQUEST_TIMEOUT_MS - 15_000
        c.tick()
        assertNull(c.state.value.pending)
        assertEquals(WatchProblem.Unconfirmed("SET_BPM"), c.state.value.problem)
        assertEquals(BpmRequest(171, BpmRequestStatus.UNKNOWN), c.state.value.bpmRequest)
        assertEquals(170, c.state.value.currentBpm)
        assertTrue(c.request(WatchRequest.PAUSE))
    }

    @Test
    fun `a request answered by the phone in time is not released by the timeout`() = runBlocking {
        val c = controller()
        c.running()
        assertTrue(c.request(WatchRequest.PAUSE))
        elapsed += 30_000
        c.tick()
        c.onMessage(apply("PAUSE", 502, 2))
        elapsed += WatchSessionController.REQUEST_TIMEOUT_MS
        c.tick()
        assertEquals(PendingStage.AWAITING_SAVE, c.state.value.pending?.stage)
        assertNull(c.state.value.problem)
    }

    @Test
    fun `an unconfirmed pause or end stops the beat, a newer RUNNING state plays it again`() = runBlocking {
        val c = controller(BrokenGateway())
        c.running()
        assertEquals("play:170", player.calls.last())

        c.onMessage(apply("PAUSE", 502, 2))
        assertEquals("UNKNOWN", lastResult().getString("result"))
        assertEquals("stop", player.calls.last())
        c.onMessage(message("COMMAND_RECEIVED", """{"commandId":502,"persisted":true,"stateVersion":2}"""))

        // 일시정지가 실제로 적용되지 않았다면 이후 서버 상태 버전이 바뀔 때 다시 재생한다.
        c.onMessage(serverState("RUNNING", 3, 170))
        assertEquals("play:170", player.calls.last())

        c.onMessage(apply("END", 503, 3))
        assertEquals("UNKNOWN", lastResult().getString("result"))
        assertEquals("stop", player.calls.last())
    }

    @Test
    fun `initialBpm sets the first BPM only`() = runBlocking {
        val c = controller()
        c.onMessage(prepare(initialBpm = 165))
        assertEquals(165, c.state.value.currentBpm)
        c.onMessage(apply("SET_BPM", 500, 1, bpm = 150))
        c.onMessage(saved(500, 2))
        c.onMessage(prepare(initialBpm = 165))
        assertEquals(150, c.state.value.currentBpm)
    }

    @Test
    fun `clock offset comes from the reply round trip`() = runBlocking {
        val clock = ServerClock()
        val t0 = Instant.parse("2026-10-28T01:00:00Z")
        clock.querySent(t0)
        val estimate = clock.onReply(t0, t0.plusMillis(1_100), t0.plusMillis(1_110), t0.plusMillis(200))!!
        assertEquals(Duration.ofMillis(1_005), estimate.offset)
        assertEquals(Duration.ofMillis(95), estimate.errorBound)
    }
}
