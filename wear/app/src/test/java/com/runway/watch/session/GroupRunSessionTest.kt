package com.runway.watch.session

import com.runway.watch.run.GroupNotice
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.GroupPosition
import com.runway.watch.run.GroupStanding
import com.runway.watch.run.RunMode
import com.runway.watch.run.RunState
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * S15P31E105-420: a group run participant's session on the watch. The phone prepares it with its groupRunId, relays the
 * leader's start (START_AUTHORIZED) and end (SERVER_END), and relays G10 as GROUP_STATUS. The watch shows it as given.
 */
class GroupRunSessionTest {

    private class FakeGateway : ExerciseGateway {
        val calls = mutableListOf<String>()
        override suspend fun start() { calls += "start" }
        override suspend fun pause() { calls += "pause" }
        override suspend fun resume() { calls += "resume" }
        override suspend fun end() { calls += "end" }
        override suspend fun reattach(): Boolean = true
        override suspend fun flush() { calls += "flush" }
    }

    private class FakeSender : SessionSender {
        val sent = mutableListOf<Pair<String, JSONObject>>()
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            sent += path to JSONObject(String(bytes, Charsets.UTF_8))
            return true
        }
        fun last(type: String) = sent.last { it.second.getString("type") == type }.second
        fun count(type: String) = sent.count { it.second.getString("type") == type }
    }

    private val store = InMemorySessionStore()
    private val gateway = FakeGateway()
    private val sender = FakeSender()
    private var clockMs = 0L

    private fun controller() = WatchSessionController(
        store, gateway, sender, now = { Instant.parse("2026-11-09T01:00:00Z") }, sleep = {}, jitter = { 0 },
        callTimeoutMs = 1_000, elapsedMs = { clockMs },
    )

    private fun message(type: String, payload: String, sessionId: String = "201", messageId: String = "phone:1") =
        decodeSessionMessage(
            """{"protocolVersion":1,"type":"$type","messageId":"$messageId","replyTo":null,"senderDeviceId":null,"sessionId":$sessionId,"payload":$payload}"""
                .toByteArray(),
        )!!

    private fun prepare(groupRunId: String? = "77", version: Long = 1) = message(
        "SESSION_PREPARE",
        """{"stateVersion":$version,"deviceId":101,"goal":{},"initialBpm":null,"groupRunId":${groupRunId ?: "null"}}""",
    )

    private fun authorize(commandId: Long, version: Long) =
        message("START_AUTHORIZED", """{"commandId":$commandId,"expectedVersion":$version,"targetBpm":null,"coachingId":null}""")

    private fun saved(commandId: Long, version: Long) =
        message("COMMAND_RECEIVED", """{"commandId":$commandId,"persisted":true,"stateVersion":$version}""")

    private fun serverEnd(commandId: Long, version: Long, messageId: String = "phone:9") = message(
        "SERVER_END",
        """{"commandId":$commandId,"expectedVersion":$version,"endedAt":"2026-11-09T01:30:00Z","reason":"GROUP_FORCE_FINISHED"}""",
        messageId = messageId,
    )

    private fun status(
        phase: String = "RUNNING",
        standing: String? = """{"rank":2,"aheadCount":1,"behindCount":3,"gapToAheadM":12.5,"gapToBehindM":40}""",
        stale: Boolean = false,
        pace: Int? = 360,
        updatedAt: String = "2026-11-09T01:05:00Z",
        groupRunId: String = "77",
        sessionId: String = "201",
    ) = message(
        "GROUP_STATUS",
        """{"groupRunId":$groupRunId,"phase":"$phase","guidePaceSecPerKm":${pace ?: "null"},"standing":${standing ?: "null"},""" +
            """"stale":$stale,"leaderToLastGapM":85.0,"updatedAt":"$updatedAt"}""",
        sessionId = sessionId,
    )

    private suspend fun WatchSessionController.groupRunning() {
        onMessage(prepare())
        onMessage(authorize(501, 1))
        onMessage(saved(501, 2))
    }

    @Test
    fun `a session prepared with a groupRunId shows the group pages and keeps it in the store`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())

        assertEquals("77", c.state.value.groupRunId)
        assertEquals("77", store.prepared()?.groupRunId)
        val snapshot = SessionRunControl.toSnapshot(c.state.value)
        assertEquals(RunMode.GROUP, snapshot.mode)
        assertEquals(GroupPhase.WAITING, snapshot.group?.phase)
        // 재시작한 워치도 저장된 준비 정보로 그룹 화면을 유지한다.
        assertEquals("77", controller().state.value.groupRunId)
    }

    @Test
    fun `a personal prepare stays personal and drops the previous group`() = runBlocking {
        val c = controller()
        c.onMessage(prepare())
        c.onMessage(status())
        c.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}""", sessionId = "202"))

        assertNull(c.state.value.groupRunId)
        assertNull(c.state.value.group)
        assertEquals(RunMode.PERSONAL, SessionRunControl.toSnapshot(c.state.value).mode)
    }

    @Test
    fun `the leader's start runs through the same approved START as a personal run`() = runBlocking {
        val c = controller()
        c.groupRunning()

        assertEquals(listOf("start"), gateway.calls)
        assertEquals(RunState.RUNNING, c.state.value.confirmed)
        assertEquals("77", c.state.value.groupRunId)
    }

    @Test
    fun `group status shows the server's standing, pace and spread as given`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status())

        val group = c.state.value.group!!
        assertEquals(GroupPhase.RUNNING, group.phase)
        assertEquals(360, group.guidePaceSecondsPerKm)
        assertEquals(85.0, group.leaderToLastGapMeters!!, 0.0)
        assertEquals(GroupPosition.Known(GroupStanding(2, 1, 3, 12.5, 40.0)), group.position)
    }

    @Test
    fun `an older update is a late event and never replaces a newer one`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status(updatedAt = "2026-11-09T01:05:00Z"))
        c.onMessage(status(standing = """{"rank":5,"aheadCount":4,"behindCount":0,"gapToAheadM":3,"gapToBehindM":null}""", updatedAt = "2026-11-09T01:04:57Z"))

        assertEquals(2, (c.state.value.group!!.position as GroupPosition.Known).standing.rank)
    }

    @Test
    fun `an update for another group or session is ignored`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status(groupRunId = "78"))
        c.onMessage(status(sessionId = "999"))

        assertNull(c.state.value.group)
    }

    @Test
    fun `a missing standing keeps the last one as delayed, or waits when there never was one`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status(standing = null, stale = true, updatedAt = "2026-11-09T01:05:00Z"))
        assertEquals(GroupPosition.Waiting, c.state.value.group!!.position)

        c.onMessage(status(updatedAt = "2026-11-09T01:05:03Z"))
        c.onMessage(status(standing = null, stale = true, updatedAt = "2026-11-09T01:05:06Z"))
        val position = c.state.value.group!!.position as GroupPosition.Known
        assertTrue(position.delayed)
        assertEquals(2, position.standing.rank)
    }

    @Test
    fun `a fresh update the server cannot rank shows as unavailable`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status(standing = null, stale = false))

        assertEquals(GroupPosition.Unavailable, c.state.value.group!!.position)
    }

    @Test
    fun `no relay for a while during the run marks the standing delayed`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status())
        clockMs += WatchSessionController.GROUP_LATE_MS - 1
        c.tick()
        assertEquals(false, (c.state.value.group!!.position as GroupPosition.Known).delayed)

        clockMs += 1
        c.tick()
        assertEquals(true, (c.state.value.group!!.position as GroupPosition.Known).delayed)

        c.onMessage(status(updatedAt = "2026-11-09T01:05:10Z"))
        assertEquals(false, (c.state.value.group!!.position as GroupPosition.Known).delayed)
    }

    @Test
    fun `a changed shared pace is shown as the server's change notice`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status(pace = 360, updatedAt = "2026-11-09T01:05:00Z"))
        assertNull(c.state.value.group!!.notice)

        c.onMessage(status(pace = 380, updatedAt = "2026-11-09T01:05:03Z"))
        assertEquals(GroupNotice.PaceChanged(360, 380), c.state.value.group!!.notice)
    }

    @Test
    fun `server end runs the approved end once, reports it and shows the group ended by the leader`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(serverEnd(601, 2))

        assertEquals(listOf("start", "end"), gateway.calls)
        val result = sender.last("COMMAND_RESULT").getJSONObject("payload")
        assertEquals(601L, result.getLong("commandId"))
        assertEquals("APPLIED", result.getString("result"))
        assertTrue(result.getBoolean("uploadComplete"))
        assertEquals("phone:9", sender.last("COMMAND_RESULT").getString("replyTo"))
        assertEquals(GroupPhase.FORCE_FINISHED, c.state.value.group!!.phase)

        // 같은 commandId의 재전달은 다시 실행하지 않고 저장된 결과로 답한다.
        c.onMessage(serverEnd(601, 2, messageId = "phone:10"))
        assertEquals(listOf("start", "end"), gateway.calls)
        assertEquals(3, sender.count("COMMAND_RESULT"))

        c.onMessage(saved(601, 3))
        assertEquals(RunState.COMPLETED, c.state.value.confirmed)
        // 늦게 온 진행 중 현황이 끝난 그룹을 다시 진행 중으로 돌리지 않는다.
        c.onMessage(status(phase = "RUNNING", updatedAt = "2026-11-09T01:31:00Z"))
        assertEquals(GroupPhase.FORCE_FINISHED, c.state.value.group!!.phase)
    }

    @Test
    fun `a finished group does not go back to running`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(status(phase = "FINISHED", updatedAt = "2026-11-09T01:05:00Z"))
        c.onMessage(status(phase = "RUNNING", updatedAt = "2026-11-09T01:05:03Z"))

        assertEquals(GroupPhase.FINISHED, c.state.value.group!!.phase)
    }

    @Test
    fun `server end for a personal run ends it without any group state`() = runBlocking {
        val c = controller()
        c.onMessage(prepare(groupRunId = null))
        c.onMessage(authorize(501, 1))
        c.onMessage(saved(501, 2))
        c.onMessage(serverEnd(601, 2))

        assertEquals(listOf("start", "end"), gateway.calls)
        assertNull(c.state.value.group)
    }

    @Test
    fun `the ranked runner count is kept so a tie is shown with everyone`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.onMessage(message(
            "GROUP_STATUS",
            """{"groupRunId":77,"phase":"RUNNING","guidePaceSecPerKm":360,"standing":{"rank":1,"aheadCount":0,"behindCount":0,""" +
                """"gapToAheadM":null,"gapToBehindM":null},"stale":false,"leaderToLastGapM":0,"updatedAt":"2026-11-09T01:05:00Z","rankedCount":2}""",
        ))
        assertEquals(2, c.state.value.group!!.rankedCount)
        val live = LiveReadings(elapsedMs = { clockMs }).apply {
            offer(listOf(com.runway.watch.batch.Reading(Instant.parse("2026-11-09T01:05:00Z"), 10, speedMps = 0.0)))
        }
        val view = com.runway.watch.ui.GroupRunDisplay.position(SessionRunControl.toSnapshot(c.state.value, latest = live.latest.value, nowMs = clockMs))
        assertEquals("/ 2명", (view as com.runway.watch.ui.GroupPositionView.Standing).total)
    }

    @Test
    fun `group status parsing drops an unknown phase and a half-valid standing`() {
        assertNull(status(phase = "PAUSED").groupUpdate())
        val bad = status(standing = """{"rank":0,"aheadCount":1,"behindCount":3,"gapToAheadM":1,"gapToBehindM":1}""").groupUpdate()!!
        assertNull(bad.standing)
        val negative = status(standing = """{"rank":1,"aheadCount":0,"behindCount":3,"gapToAheadM":null,"gapToBehindM":-2}""").groupUpdate()!!
        assertNull(negative.standing)
        val leader = status(standing = """{"rank":1,"aheadCount":0,"behindCount":3,"gapToAheadM":null,"gapToBehindM":20}""").groupUpdate()!!
        assertEquals(GroupStanding(1, 0, 3, null, 20.0), leader.standing)
        assertEquals(Instant.parse("2026-11-09T01:05:00Z"), leader.updatedAt)
    }

    @Test
    fun `a running group asks for held-back readings every ten seconds, a personal run does not`() = runBlocking {
        val c = controller()
        c.groupRunning()
        c.tick()
        clockMs += 5_000
        c.tick()
        clockMs += WatchSessionController.GROUP_FLUSH_MS - 5_000
        c.tick()
        assertEquals(2, gateway.calls.count { it == "flush" })

        val personal = FakeGateway()
        val p = WatchSessionController(
            InMemorySessionStore(), personal, FakeSender(), now = { Instant.parse("2026-11-09T01:00:00Z") }, sleep = {},
            jitter = { 0 }, callTimeoutMs = 1_000, elapsedMs = { clockMs },
        )
        p.onMessage(message("SESSION_PREPARE", """{"stateVersion":1,"deviceId":101,"goal":{},"initialBpm":null}"""))
        p.onMessage(authorize(501, 1))
        p.onMessage(saved(501, 2))
        p.tick()
        assertEquals(listOf("start"), personal.calls)
    }
}
