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
}
