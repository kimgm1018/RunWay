package com.runway.health.watch

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Watch measurement batches relayed to W07 (S15P31E105-311, watch-mobile-server-integration.md 6장·9.3).
 * The phone keeps the watch's batch id and body byte for byte, stores it before BATCH_RECEIVED, and sends
 * BATCH_COMMITTED only after W07 answered COMMITTED. Never log bodies: they hold health values.
 */
const val DATA_PATH_PREFIX = "/runway/v1/data/"
const val BATCH_PATH = "/runway/v1/data/batch"
const val BATCH_RECEIVED_PATH = "/runway/v1/data/batch-received"
const val BATCH_COMMITTED_PATH = "/runway/v1/data/batch-committed"

private const val MAX_BATCH_MESSAGE_BYTES = 32 * 1024
private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

/** Unconfirmed batches the phone holds per producing device (6장: 64). */
const val MAX_OPEN_BATCHES = 64

enum class BatchStatus { RECEIVED, COMMITTED, FAILED }

data class RelayBatch(
  val batchId: String,
  val sessionId: String,
  val deviceId: String,
  /** BATCH_DATA messageId; replies point at it. */
  val messageId: String,
  /** W07 body exactly as the watch wrote it. Dropped once COMMITTED. */
  val body: String?,
  val itemCount: Int,
  val status: BatchStatus,
  val acceptedCount: Int? = null,
  val errorCode: String? = null,
)

/** A decoded BATCH_DATA: envelope fields plus the payload text cut from the raw message, not re-serialized. */
data class IncomingBatch(val messageId: String, val sessionId: String, val batchId: String, val deviceId: String, val body: String, val itemCount: Int)

/** Null for anything the phone must not relay: wrong version or type, too large, ids that do not match. */
fun decodeBatchMessage(bytes: ByteArray): IncomingBatch? {
  if (bytes.size > MAX_BATCH_MESSAGE_BYTES) return null
  return try {
    val text = String(bytes, Charsets.UTF_8)
    val json = JSONObject(text)
    if (json.optInt("protocolVersion", -1) != 1 || json.optString("type") != "BATCH_DATA") return null
    val messageId = json.optString("messageId").takeIf { it.isNotEmpty() && it.length <= 200 } ?: return null
    val sessionId = positiveId(json, "sessionId") ?: return null
    val body = rawMember(text, "payload") ?: return null
    val payload = JSONObject(body)
    val batchId = payload.optString("id").takeIf { UUID_PATTERN.matches(it) } ?: return null
    val deviceId = positiveId(payload, "deviceId") ?: return null
    if (positiveId(payload, "sessionId") != sessionId) return null
    val items = payload.optJSONArray("items") ?: return null
    if (items.length() < 1) return null
    IncomingBatch(messageId, sessionId, batchId, deviceId, body, items.length())
  } catch (_: Exception) {
    null
  }
}

private fun positiveId(json: JSONObject, name: String): String? {
  if (!json.has(name) || json.isNull(name)) return null
  val value = json.opt(name)
  if (value !is Int && value !is Long) return null
  return (value as Number).toLong().takeIf { it > 0 }?.toString()
}

/**
 * The raw text of a top-level member of a JSON object, so numbers keep the exact spelling the watch hashed.
 * Expects already-validated JSON (the caller parsed it first).
 */
fun rawMember(text: String, name: String): String? {
  var i = text.indexOf('{')
  if (i < 0) return null
  i++
  var depth = 1
  var key: String? = null
  var valueStart = -1
  var expectKey = true
  while (i < text.length) {
    val c = text[i]
    when {
      c == '"' -> {
        val end = stringEnd(text, i)
        if (depth == 1 && expectKey) key = JSONObject("{\"k\":${text.substring(i, end + 1)}}").getString("k")
        i = end
      }
      c == ':' && depth == 1 -> {
        expectKey = false
        valueStart = i + 1
      }
      c == '{' || c == '[' -> depth++
      c == '}' || c == ']' -> {
        depth--
        if (depth == 0) return if (key == name && valueStart >= 0) text.substring(valueStart, i).trim() else null
      }
      c == ',' && depth == 1 -> {
        if (key == name && valueStart >= 0) return text.substring(valueStart, i).trim()
        expectKey = true
        key = null
        valueStart = -1
      }
    }
    i++
  }
  return null
}

private fun stringEnd(text: String, start: Int): Int {
  var i = start + 1
  while (i < text.length) {
    when (text[i]) {
      '\\' -> i++
      '"' -> return i
    }
    i++
  }
  throw IllegalArgumentException("unterminated string")
}

/** BATCH_RECEIVED: stored on the phone, not a server save (9.3). */
fun batchReceived(messageId: String, batch: RelayBatch): ByteArray =
  encodeSessionMessage(
    "BATCH_RECEIVED", messageId, batch.messageId, null, batch.sessionId,
    JSONObject().put("batchId", batch.batchId).put("status", "RECEIVED").put("receivedCount", batch.itemCount).toString(),
  )

/** BATCH_COMMITTED with W07's acceptedCount (9.3). */
fun batchCommitted(messageId: String, batch: RelayBatch): ByteArray =
  encodeSessionMessage(
    "BATCH_COMMITTED", messageId, batch.messageId, null, batch.sessionId,
    JSONObject().put("batchId", batch.batchId).put("status", "COMMITTED").put("acceptedCount", batch.acceptedCount ?: batch.itemCount).toString(),
  )

/** ERROR for a batch W07 refused for good (400/403/409/413/422): the watch stops resending it. */
fun batchError(messageId: String, batch: RelayBatch): ByteArray =
  encodeSessionMessage(
    "ERROR", messageId, batch.messageId, null, batch.sessionId,
    JSONObject().put("code", batch.errorCode ?: "UNKNOWN").put("retryable", false).put("failedType", "BATCH_DATA").toString(),
  )

/** What a BATCH_DATA arrival means for the relay. */
sealed interface BatchArrival {
  /** First time: stored, reply RECEIVED and upload. */
  data class Stored(val batch: RelayBatch) : BatchArrival
  /** Resend of a known batch: reply by its status; upload again only while it is RECEIVED. */
  data class Known(val batch: RelayBatch) : BatchArrival
  /** Same id, different session/device/body: never stored over the first one. */
  data object Conflict : BatchArrival
  data object Full : BatchArrival
  /** A new batch for a session whose intake is closed for the phone takeover (S08 TAKE_OVER_PHONE): not stored, not acked. */
  data object Blocked : BatchArrival
}

/**
 * One file per batch under filesDir, written to a temp file and renamed. Committed entries keep only their ACK so a
 * resend gets the same answer (MC-11); the oldest of those go past [MAX_KEPT_COMMITTED].
 */
class WatchBatchStore(private val dir: File) {
  constructor(context: Context) : this(File(context.applicationContext.filesDir, "watch_batches"))

  init {
    dir.mkdirs()
  }

  fun arrive(incoming: IncomingBatch): BatchArrival = synchronized(LOCK) {
    val existing = read(incoming.batchId)
    if (existing != null) {
      val same = existing.sessionId == incoming.sessionId && existing.deviceId == incoming.deviceId &&
        (existing.body == null || existing.body == incoming.body) && existing.itemCount == incoming.itemCount
      return if (same) BatchArrival.Known(existing) else BatchArrival.Conflict
    }
    if (incoming.sessionId in readBlocked()) return BatchArrival.Blocked
    if (all().count { it.deviceId == incoming.deviceId && it.status == BatchStatus.RECEIVED } >= MAX_OPEN_BATCHES) {
      return BatchArrival.Full
    }
    val batch = RelayBatch(incoming.batchId, incoming.sessionId, incoming.deviceId, incoming.messageId, incoming.body, incoming.itemCount, BatchStatus.RECEIVED)
    write(batch)
    BatchArrival.Stored(batch)
  }

  fun get(batchId: String): RelayBatch? = synchronized(LOCK) { read(batchId) }

  /**
   * Phone takeover step 1 (sessions.md 폰의 데이터 저장·요청 순서, S15P31E105-464): closes new batch intake for [sessionId]
   * and returns, under the same lock, every batch of that session already stored and still waiting for W07. A batch
   * arriving after this point is neither stored nor acked. The closed state survives a restart.
   */
  fun block(sessionId: String): List<RelayBatch> = synchronized(LOCK) {
    writeBlocked(readBlocked() + sessionId)
    all().filter { it.sessionId == sessionId && it.status == BatchStatus.RECEIVED }
  }

  /** Opens intake again: only when the takeover was not requested or was refused with WATCH kept, or the run ended. */
  fun unblock(sessionId: String) = synchronized(LOCK) {
    val blocked = readBlocked()
    if (sessionId in blocked) writeBlocked(blocked - sessionId)
  }

  fun isBlocked(sessionId: String): Boolean = synchronized(LOCK) { sessionId in readBlocked() }

  /** Batches still waiting for W07, oldest first. */
  fun open(): List<RelayBatch> = synchronized(LOCK) { all().filter { it.status == BatchStatus.RECEIVED } }

  /** Records the W07 ACK; false when it does not match the stored batch. */
  fun commit(batchId: String, acceptedCount: Int): RelayBatch? = synchronized(LOCK) {
    val batch = read(batchId) ?: return null
    if (batch.status == BatchStatus.COMMITTED) return batch
    if (acceptedCount != batch.itemCount) return null
    val committed = batch.copy(status = BatchStatus.COMMITTED, body = null, acceptedCount = acceptedCount)
    write(committed)
    prune()
    committed
  }

  fun fail(batchId: String, code: String): RelayBatch? = synchronized(LOCK) {
    val batch = read(batchId) ?: return null
    if (batch.status != BatchStatus.RECEIVED) return batch
    batch.copy(status = BatchStatus.FAILED, errorCode = code).also { write(it) }
  }

  private fun all(): List<RelayBatch> =
    dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty().sortedBy { it.lastModified() }.mapNotNull { decode(it) }

  private fun prune() {
    val committed = dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty()
      .mapNotNull { f -> decode(f)?.takeIf { it.status == BatchStatus.COMMITTED }?.let { f } }
      .sortedBy { it.lastModified() }
    committed.dropLast(MAX_KEPT_COMMITTED).forEach { it.delete() }
  }

  private fun readBlocked(): Set<String> = try {
    val file = File(dir, BLOCKED_FILE)
    if (!file.exists()) emptySet() else file.readText(Charsets.UTF_8).split(',').filter { it.isNotBlank() }.toSet()
  } catch (_: Exception) {
    emptySet()
  }

  private fun writeBlocked(sessions: Set<String>) {
    val target = File(dir, BLOCKED_FILE)
    val temp = File(dir, "$BLOCKED_FILE.tmp")
    temp.writeText(sessions.joinToString(","), Charsets.UTF_8)
    if (!temp.renameTo(target)) {
      target.delete()
      check(temp.renameTo(target)) { "batch store write failed" }
    }
  }

  private fun read(batchId: String): RelayBatch? = decode(File(dir, "${batchId.lowercase()}.json"))

  private fun write(batch: RelayBatch) {
    val json = JSONObject()
      .put("batchId", batch.batchId)
      .put("sessionId", batch.sessionId)
      .put("deviceId", batch.deviceId)
      .put("messageId", batch.messageId)
      .put("body", batch.body ?: JSONObject.NULL)
      .put("itemCount", batch.itemCount)
      .put("status", batch.status.name)
      .put("acceptedCount", batch.acceptedCount ?: JSONObject.NULL)
      .put("errorCode", batch.errorCode ?: JSONObject.NULL)
    val target = File(dir, "${batch.batchId.lowercase()}.json")
    val temp = File(dir, "${batch.batchId.lowercase()}.tmp")
    temp.writeText(json.toString(), Charsets.UTF_8)
    if (!temp.renameTo(target)) {
      target.delete()
      check(temp.renameTo(target)) { "batch store write failed" }
    }
  }

  private fun decode(file: File): RelayBatch? = try {
    if (!file.exists()) null else JSONObject(file.readText(Charsets.UTF_8)).let { o ->
      RelayBatch(
        batchId = o.getString("batchId"),
        sessionId = o.getString("sessionId"),
        deviceId = o.getString("deviceId"),
        messageId = o.getString("messageId"),
        body = if (o.isNull("body")) null else o.getString("body"),
        itemCount = o.getInt("itemCount"),
        status = BatchStatus.valueOf(o.getString("status")),
        acceptedCount = if (o.isNull("acceptedCount")) null else o.getInt("acceptedCount"),
        errorCode = if (o.isNull("errorCode")) null else o.getString("errorCode"),
      )
    }
  } catch (_: Exception) {
    null
  }

  private companion object {
    val LOCK = Any()
    const val MAX_KEPT_COMMITTED = 256
    const val BLOCKED_FILE = "blocked_sessions"
  }
}

/** The event handed to JS for an upload: ids as strings, the body as the exact text to send. */
fun batchJsEvent(batch: RelayBatch): String =
  JSONObject()
    .put("type", "BATCH_DATA")
    .put("sessionId", batch.sessionId)
    .put("batchId", batch.batchId)
    .put("deviceId", batch.deviceId)
    .put("itemCount", batch.itemCount)
    .put("body", batch.body)
    .toString()
