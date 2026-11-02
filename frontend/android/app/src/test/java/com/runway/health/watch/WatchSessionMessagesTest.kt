package com.runway.health.watch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** watch-mobile-server-integration.md 9.1·9.3·9.5 세션 메시지 (S15P31E105-256 AC-C1·C2). */
class WatchSessionMessagesTest {

  private fun envelope(type: String, payload: String, sessionId: String = "201", version: Int = 1, messageId: String = "101:33") =
    """{"protocolVersion":$version,"type":"$type","messageId":"$messageId","replyTo":"102:32","senderDeviceId":101,"sessionId":$sessionId,"payload":$payload}"""
      .toByteArray(Charsets.UTF_8)

  @Test
  fun `decodes COMMAND_RESULT and keeps int64 ids as text`() {
    val message = decodeSessionMessage(
      envelope(
        "COMMAND_RESULT",
        """{"commandId":9007199254740993,"result":"APPLIED","appliedAt":"2026-10-28T01:00:01Z","reasonCode":null}""",
        sessionId = "9007199254740993",
      ),
    )

    assertNotNull(message)
    assertEquals("COMMAND_RESULT", message!!.type)
    assertEquals("101:33", message.messageId)
    assertEquals("102:32", message.replyTo)
    assertEquals("101", message.senderDeviceId)
    assertEquals("9007199254740993", message.sessionId)
    val js = JSONObject(toJsEvent(message))
    assertEquals("9007199254740993", js.getString("sessionId"))
    assertEquals("9007199254740993", js.getJSONObject("payload").getString("commandId"))
  }

  @Test
  fun `rejects wrong protocolVersion, unknown type, over 32 KiB and missing sessionId`() {
    assertNull(decodeSessionMessage(envelope("COMMAND_RESULT", "{}", version = 2)))
    assertNull(decodeSessionMessage(envelope("BATCH_DATA", "{}")))
    assertNull(decodeSessionMessage(envelope("COMMAND_RESULT", """{"pad":"${"x".repeat(33 * 1024)}"}""")))
    assertNull(decodeSessionMessage("""{"protocolVersion":1,"type":"COMMAND_RESULT","messageId":"1","payload":{}}""".toByteArray()))
    assertNull(decodeSessionMessage("not json".toByteArray()))
  }

  @Test
  fun `encode matches the 9_6 START_AUTHORIZED example`() {
    val bytes = encodeSessionMessage(
      type = "START_AUTHORIZED",
      messageId = "102:32",
      replyTo = "101:31",
      senderDeviceId = "102",
      sessionId = "201",
      payloadJson = """{"commandId":501,"expectedVersion":1,"targetBpm":null,"coachingId":null}""",
    )
    val json = JSONObject(String(bytes, Charsets.UTF_8))

    assertEquals(1, json.getInt("protocolVersion"))
    assertEquals("START_AUTHORIZED", json.getString("type"))
    assertEquals("102:32", json.getString("messageId"))
    assertEquals("101:31", json.getString("replyTo"))
    assertEquals(102L, json.getLong("senderDeviceId"))
    assertEquals(201L, json.getLong("sessionId"))
    assertEquals(501L, json.getJSONObject("payload").getLong("commandId"))
    assertTrue(json.getJSONObject("payload").isNull("targetBpm"))
  }

  @Test(expected = IllegalArgumentException::class)
  fun `encode refuses messages over 32 KiB`() {
    encodeSessionMessage("SESSION_PREPARE", "1", null, null, "201", """{"pad":"${"x".repeat(33 * 1024)}"}""")
  }

  @Test
  fun `decodes COMMAND_REQUEST CANCEL`() {
    val message = decodeSessionMessage(
      envelope("COMMAND_REQUEST", """{"phase":"REQUEST","action":"CANCEL","expectedVersion":1,"targetBpm":null}"""),
    )

    assertEquals("CANCEL", message!!.payload.getString("action"))
  }

  @Test
  fun `mergeInbox keeps one message per messageId and at most 64`() {
    val first = decodeSessionMessage(envelope("COMMAND_RESULT", "{}", messageId = "a"))!!
    val again = decodeSessionMessage(envelope("COMMAND_RESULT", "{}", messageId = "a"))!!
    assertEquals(1, mergeInbox(mergeInbox(emptyList(), first), again).size)

    var inbox = emptyList<SessionEnvelope>()
    for (index in 0 until 70) {
      inbox = mergeInbox(inbox, decodeSessionMessage(envelope("COMMAND_RESULT", "{}", messageId = "m$index"))!!)
    }
    assertEquals(64, inbox.size)
    assertEquals("m6", inbox.first().messageId)
    assertEquals("m69", inbox.last().messageId)
  }

  @Test
  fun `retry delays are 0, 1000 to 1500 and 2000 to 2500`() {
    assertEquals(listOf(0L, 1000L, 2000L), retryDelaysMs { 0L })
    assertEquals(listOf(0L, 1500L, 2500L), retryDelaysMs { 500L })
  }

  @Test
  fun `foreground runs for READY, RUNNING, PAUSED or a pending command only`() {
    assertTrue(shouldRunForeground("READY", false))
    assertTrue(shouldRunForeground("RUNNING", false))
    assertTrue(shouldRunForeground("PAUSED", false))
    assertTrue(shouldRunForeground("COMPLETED", true))
    assertFalse(shouldRunForeground("COMPLETED", false))
    assertFalse(shouldRunForeground("CANCELLED", false))
    assertFalse(shouldRunForeground(null, false))
  }

  @Test
  fun `COMMAND_RECEIVED reply carries persisted false and null version`() {
    val message = decodeSessionMessage(
      envelope("COMMAND_RESULT", """{"commandId":501,"result":"APPLIED","appliedAt":"2026-10-28T01:00:01Z","reasonCode":null}"""),
    )!!
    val reply = JSONObject(String(localReceipt(message, "102:40", "102"), Charsets.UTF_8))

    assertEquals("COMMAND_RECEIVED", reply.getString("type"))
    assertEquals("101:33", reply.getString("replyTo"))
    assertEquals(501L, reply.getJSONObject("payload").getLong("commandId"))
    assertFalse(reply.getJSONObject("payload").getBoolean("persisted"))
    assertTrue(reply.getJSONObject("payload").isNull("stateVersion"))
  }
}
