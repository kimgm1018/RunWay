package com.runway.health.watch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** BATCH_DATA relay (S15P31E105-311, watch-mobile-server-integration.md 6장·9.3). Synthetic values only. */
class WatchBatchesTest {
  private val id = "00000000-0000-4000-8000-000000000101"
  // Number spellings the phone must not rewrite: the watch hashed exactly this text.
  private val body =
    """{"deviceId":101,"id":"$id","items":[{"cadenceSpm":null,"elapsedDurationSec":1,"gradePercent":null,"heartRateBpm":142.5,""" +
      """"isHrMeasured":true,"measuredAt":"2026-10-27T01:00:01Z","routeProgressM":null,"speedMps":0.001,"totalDistanceM":12345678.9,"type":"METRIC_SAMPLE"}],""" +
      """"payloadHash":"${"a".repeat(64)}","schemaVersion":"1","sessionId":5001}"""

  private fun envelope(payload: String = body, sessionId: Long = 5001, type: String = "BATCH_DATA") =
    """{"protocolVersion":1,"type":"$type","messageId":"watch:7","replyTo":null,"senderDeviceId":null,"sessionId":$sessionId,"payload":$payload}"""
      .toByteArray(Charsets.UTF_8)

  @Test
  fun `decodes BATCH_DATA and keeps the body text unchanged`() {
    val batch = decodeBatchMessage(envelope())
    assertNotNull(batch)
    assertEquals(id, batch!!.batchId)
    assertEquals("101", batch.deviceId)
    assertEquals("5001", batch.sessionId)
    assertEquals("watch:7", batch.messageId)
    assertEquals(1, batch.itemCount)
    assertEquals(body, batch.body)
  }

  @Test
  fun `rejects other types, mismatched sessions, bad ids and empty items`() {
    assertNull(decodeBatchMessage(envelope(type = "BATCH_RECEIVED")))
    assertNull(decodeBatchMessage(envelope(sessionId = 5002)))
    assertNull(decodeBatchMessage(envelope(body.replace(id, "not-a-uuid"))))
    assertNull(decodeBatchMessage(envelope(body.replace("\"deviceId\":101", "\"deviceId\":\"101\""))))
    assertNull(decodeBatchMessage(envelope("""{"deviceId":101,"id":"$id","items":[],"sessionId":5001}""")))
    assertNull(decodeBatchMessage(ByteArray(33 * 1024) { 'x'.code.toByte() }))
  }

  @Test
  fun `raw member finds the value wherever it sits`() {
    assertEquals("""{"a":[1,{"b":"}"}]}""", rawMember("""{"payload":{"a":[1,{"b":"}"}]},"z":1}""", "payload"))
    assertEquals("2.50", rawMember("""{"x":"payload","payload":2.50}""", "payload"))
    assertNull(rawMember("""{"other":{"payload":1}}""", "payload"))
  }

  @Test
  fun `stores before the receipt, answers a resend from the store and commits once`() {
    val store = WatchBatchStore(Files.createTempDirectory("batches").toFile())
    val incoming = decodeBatchMessage(envelope())!!

    val stored = store.arrive(incoming) as BatchArrival.Stored
    assertEquals(BatchStatus.RECEIVED, stored.batch.status)
    assertEquals(listOf(id), store.open().map { it.batchId })
    val receipt = JSONObject(String(batchReceived("phone:1", stored.batch), Charsets.UTF_8))
    assertEquals("BATCH_RECEIVED", receipt.getString("type"))
    assertEquals("watch:7", receipt.getString("replyTo"))
    assertEquals(1, receipt.getJSONObject("payload").getInt("receivedCount"))

    assertTrue(store.arrive(incoming) is BatchArrival.Known)
    assertNull(store.commit(id, 2))
    val committed = store.commit(id, 1)!!
    assertEquals(BatchStatus.COMMITTED, committed.status)
    assertNull(committed.body)
    assertTrue(store.open().isEmpty())
    val ack = JSONObject(String(batchCommitted("phone:2", committed), Charsets.UTF_8)).getJSONObject("payload")
    assertEquals("COMMITTED", ack.getString("status"))
    assertEquals(1, ack.getInt("acceptedCount"))
    // 저장된 batch의 재전송에는 같은 저장 확인으로 답한다.
    assertEquals(BatchStatus.COMMITTED, (store.arrive(incoming) as BatchArrival.Known).batch.status)
  }

  @Test
  fun `a different body under the same id is a conflict and a refused batch answers with its error`() {
    val store = WatchBatchStore(Files.createTempDirectory("batches").toFile())
    store.arrive(decodeBatchMessage(envelope())!!)
    assertEquals(BatchArrival.Conflict, store.arrive(decodeBatchMessage(envelope(body.replace("142.5", "150")))!!))

    val failed = store.fail(id, "INVALID_BATCH")!!
    assertEquals(BatchStatus.FAILED, failed.status)
    val error = JSONObject(String(batchError("phone:3", failed), Charsets.UTF_8))
    assertEquals("ERROR", error.getString("type"))
    assertEquals("watch:7", error.getString("replyTo"))
    assertEquals("BATCH_DATA", error.getJSONObject("payload").getString("failedType"))
    assertEquals(false, error.getJSONObject("payload").getBoolean("retryable"))
  }

  @Test
  fun `holds at most 64 unconfirmed batches per producing device`() {
    val store = WatchBatchStore(Files.createTempDirectory("batches").toFile())
    repeat(MAX_OPEN_BATCHES) { n ->
      val nid = "00000000-0000-4000-8000-%012d".format(n)
      assertTrue(store.arrive(decodeBatchMessage(envelope(body.replace(id, nid)))!!) is BatchArrival.Stored)
    }
    assertEquals(BatchArrival.Full, store.arrive(decodeBatchMessage(envelope())!!))
  }

  @Test
  fun `takeover block freezes the stored batches and refuses new ones until opened again`() {
    val dir = Files.createTempDirectory("batches").toFile()
    val store = WatchBatchStore(dir)
    val first = decodeBatchMessage(envelope())!!
    store.arrive(first)

    val frozen = store.block("5001")
    assertEquals(listOf(id), frozen.map { it.batchId })
    // A resend of a frozen batch is still answered from the store.
    assertTrue(store.arrive(first) is BatchArrival.Known)
    val later = "00000000-0000-4000-8000-000000000102"
    val next = decodeBatchMessage(envelope(body.replace(id, later)))!!
    assertEquals(BatchArrival.Blocked, store.arrive(next))
    assertNull(store.get(later))
    // The block survives a restart (a new store on the same directory).
    assertTrue(WatchBatchStore(dir).isBlocked("5001"))

    store.unblock("5001")
    assertTrue(store.arrive(next) is BatchArrival.Stored)
  }
}
