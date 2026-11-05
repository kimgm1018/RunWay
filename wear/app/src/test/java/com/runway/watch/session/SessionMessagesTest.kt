package com.runway.watch.session

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** watch-mobile-server-integration.md 9.1·9.3·9.6 — the watch side of the run-session messages (S15P31E105-256). */
class SessionMessagesTest {

    private fun envelope(type: String, payload: String, sessionId: String = "201", version: Int = 1) =
        """{"protocolVersion":$version,"type":"$type","messageId":"102:32","replyTo":"101:31","senderDeviceId":102,"sessionId":$sessionId,"payload":$payload}"""
            .toByteArray(Charsets.UTF_8)

    @Test
    fun `decodes the 9_6 START_AUTHORIZED example`() {
        val message = decodeSessionMessage(
            envelope("START_AUTHORIZED", """{"commandId":501,"expectedVersion":1,"targetBpm":null,"coachingId":null}"""),
        )

        assertNotNull(message)
        assertEquals("START_AUTHORIZED", message!!.type)
        assertEquals("102:32", message.messageId)
        assertEquals("101:31", message.replyTo)
        assertEquals("201", message.sessionId)
        assertEquals("501", message.commandId())
        assertEquals(1L, message.payload.getLong("expectedVersion"))
    }

    @Test
    fun `keeps int64 ids as text`() {
        val message = decodeSessionMessage(
            envelope("COMMAND_REQUEST", """{"phase":"APPLY","action":"PAUSE","expectedVersion":2,"targetBpm":null,"commandId":9007199254740993,"coachingId":null}""", "9007199254740993"),
        )!!

        assertEquals("9007199254740993", message.sessionId)
        assertEquals("9007199254740993", message.commandId())
    }

    @Test
    fun `rejects wrong version, unknown or phone-only types, size and missing session`() {
        assertNull(decodeSessionMessage(envelope("START_AUTHORIZED", "{}", version = 2)))
        assertNull(decodeSessionMessage(envelope("BATCH_DATA", "{}")))
        assertNull(decodeSessionMessage(envelope("COMMAND_RESULT", "{}")))
        assertNull(decodeSessionMessage(envelope("SESSION_PREPARE", """{"pad":"${"x".repeat(33 * 1024)}"}""")))
        assertNull(decodeSessionMessage("""{"protocolVersion":1,"type":"SESSION_PREPARE","messageId":"1","payload":{}}""".toByteArray()))
        assertNull(decodeSessionMessage("not json".toByteArray()))
    }

    @Test
    fun `a COMMAND_REQUEST in REQUEST phase is the watch's own and is not accepted`() {
        assertNull(decodeSessionMessage(envelope("COMMAND_REQUEST", """{"phase":"REQUEST","action":"PAUSE","expectedVersion":2,"targetBpm":null}""")))
    }

    @Test
    fun `builds SESSION_PREPARED, START_REQUEST and COMMAND_REQUEST`() {
        val prepared = JSONObject(String(SessionMessages.prepared("w:1", "201", 3, ready = false, reasonCode = "NOT_PREPARED")))
        assertEquals("SESSION_PREPARED", prepared.getString("type"))
        assertEquals(201L, prepared.getLong("sessionId"))
        assertEquals(3L, prepared.getJSONObject("payload").getLong("stateVersion"))
        assertFalse(prepared.getJSONObject("payload").getBoolean("ready"))
        assertEquals("NOT_PREPARED", prepared.getJSONObject("payload").getString("reasonCode"))

        val start = JSONObject(String(SessionMessages.startRequest("w:2", "201", 3)))
        assertEquals("START_REQUEST", start.getString("type"))
        assertEquals(3L, start.getJSONObject("payload").getLong("expectedVersion"))

        val cancel = JSONObject(String(SessionMessages.commandRequest("w:3", "201", "CANCEL", 3)))
        val payload = cancel.getJSONObject("payload")
        assertEquals("REQUEST", payload.getString("phase"))
        assertEquals("CANCEL", payload.getString("action"))
        assertTrue(payload.isNull("targetBpm"))
    }

    @Test
    fun `COMMAND_RESULT keeps appliedAt and reasonCode keys and adds END upload fields`() {
        val applied = JSONObject(
            String(SessionMessages.commandResult("w:4", "102:32", "201", "501", "APPLIED", Instant.parse("2026-10-28T01:00:01Z"), null, end = false)),
        ).getJSONObject("payload")
        assertEquals(501L, applied.getLong("commandId"))
        assertEquals("2026-10-28T01:00:01Z", applied.getString("appliedAt"))
        assertTrue(applied.has("reasonCode") && applied.isNull("reasonCode"))
        assertFalse(applied.has("uploadComplete"))

        val unknown = JSONObject(
            String(SessionMessages.commandResult("w:5", null, "201", "502", "UNKNOWN", null, "EXERCISE_CALL_TIMEOUT", end = true)),
        ).getJSONObject("payload")
        assertTrue(unknown.isNull("appliedAt"))
        assertFalse(unknown.getBoolean("uploadComplete"))

        val ended = JSONObject(
            String(SessionMessages.commandResult("w:6", null, "201", "503", "APPLIED", Instant.parse("2026-10-28T01:30:00Z"), null, end = true)),
        ).getJSONObject("payload")
        assertEquals(0, ended.getInt("pendingBatchCount"))
        assertTrue(ended.getBoolean("uploadComplete"))
    }

    @Test
    fun `decodes COACHING_GUIDE with int64 ids, BPM range and UTC expiry`() {
        val guide = decodeSessionMessage(envelope(
            "COACHING_GUIDE",
            """{"commandId":9007199254740993,"coachingId":701,"expectedVersion":3,"targetBpm":165,"recommendedPaceSecPerKm":360,"expiresAt":"2026-10-28T01:02:00Z"}""",
        ))
        assertNotNull(guide)
        assertEquals("9007199254740993", guide!!.commandId())
        assertEquals("701", guide.coachingId())
        assertEquals(165, guide.bpm("targetBpm"))
        assertEquals(Instant.parse("2026-10-28T01:02:00Z"), guide.instant("expiresAt"))

        val odd = decodeSessionMessage(envelope("COACHING_GUIDE", """{"targetBpm":221,"currentBpm":165.5,"initialBpm":null,"expiresAt":"2026-10-28T10:02:00+09:00"}"""))!!
        assertNull(odd.bpm("targetBpm"))
        assertNull(odd.bpm("currentBpm"))
        assertNull(odd.bpm("initialBpm"))
        assertNull(odd.bpm("missing"))
        assertEquals(Instant.parse("2026-10-28T01:02:00Z"), odd.instant("expiresAt"))
        // COACHING_RESULT는 워치가 보내는 타입이라 받지 않는다.
        assertNull(decodeSessionMessage(envelope("COACHING_RESULT", "{}")))
    }

    @Test
    fun `builds SET_BPM REQUEST with targetBpm only for SET_BPM`() {
        val payload = JSONObject(String(SessionMessages.commandRequest("w:7", "201", "SET_BPM", 3, targetBpm = 165))).getJSONObject("payload")
        assertEquals("REQUEST", payload.getString("phase"))
        assertEquals("SET_BPM", payload.getString("action"))
        assertEquals(3L, payload.getLong("expectedVersion"))
        assertEquals(165, payload.getInt("targetBpm"))

        assertTrue(runCatching { SessionMessages.commandRequest("w:8", "201", "SET_BPM", 3) }.isFailure)
        assertTrue(runCatching { SessionMessages.commandRequest("w:9", "201", "SET_BPM", 3, targetBpm = 221) }.isFailure)
        assertTrue(runCatching { SessionMessages.commandRequest("w:10", "201", "PAUSE", 3, targetBpm = 165) }.isFailure)
    }

    @Test
    fun `builds COACHING_RESULT and STATE_QUERY`() {
        val applied = JSONObject(String(SessionMessages.coachingResult(
            "w:11", "phone:5", "201", "601", "701", "APPLIED", Instant.parse("2026-10-28T01:00:03Z"), null,
        )))
        assertEquals("COACHING_RESULT", applied.getString("type"))
        assertEquals("phone:5", applied.getString("replyTo"))
        val payload = applied.getJSONObject("payload")
        assertEquals(601L, payload.getLong("commandId"))
        assertEquals(701L, payload.getLong("coachingId"))
        assertEquals("2026-10-28T01:00:03Z", payload.getString("appliedAt"))
        assertTrue(payload.has("reasonCode") && payload.isNull("reasonCode"))

        val ignored = JSONObject(String(SessionMessages.coachingResult(
            "w:12", null, "201", "602", "702", "IGNORED", Instant.parse("2026-10-28T01:00:03Z"), "GUIDE_STALE",
        ))).getJSONObject("payload")
        assertTrue(ignored.isNull("appliedAt"))
        assertEquals("GUIDE_STALE", ignored.getString("reasonCode"))

        val query = JSONObject(String(SessionMessages.stateQuery("w:13", "201", Instant.parse("2026-10-28T01:00:00.123Z"))))
        assertEquals("STATE_QUERY", query.getString("type"))
        assertEquals("SERVER", query.getJSONObject("payload").getString("scope"))
        assertEquals("2026-10-28T01:00:00.123Z", query.getJSONObject("payload").getString("clientSendAt"))
    }
}
