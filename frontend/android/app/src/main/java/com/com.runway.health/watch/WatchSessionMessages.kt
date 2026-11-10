package com.runway.health.watch

import org.json.JSONObject

/**
 * Watch ↔ phone run-session messages (watch-mobile-server-integration.md 9.1–9.5, S15P31E105-256).
 * The phone only relays: the server decides and the watch executes. Never log payload values or exception messages.
 */
const val SESSION_PATH_PREFIX = "/runway/v1/session/"
const val PREPARE_PATH = "/runway/v1/session/prepare"
const val PREPARED_PATH = "/runway/v1/session/prepared"
const val START_REQUEST_PATH = "/runway/v1/session/start-request"
const val START_AUTHORIZED_PATH = "/runway/v1/session/start-authorized"
const val COMMAND_PATH = "/runway/v1/session/command"
const val COMMAND_RESULT_PATH = "/runway/v1/session/command-result"
const val COMMAND_RECEIVED_PATH = "/runway/v1/session/command-received"
const val STATE_QUERY_PATH = "/runway/v1/session/state-query"
const val STATE_RESULT_PATH = "/runway/v1/session/state-result"
const val ERROR_PATH = "/runway/v1/error"
// S15P31E105-257: server coaching to the watch and its real result back (9.2).
const val COACHING_GUIDE_PATH = "/runway/v1/coaching/guide"
const val COACHING_RESULT_PATH = "/runway/v1/coaching/result"
// S15P31E105-420: G10 group standing relayed to the watch (9.2 GROUP_STATUS).
const val GROUP_STATUS_PATH = "/runway/v1/group/status"

private const val MAX_SESSION_BYTES = 32 * 1024
private const val SESSION_PROTOCOL_VERSION = 1
private const val MAX_INBOX = 64

/** Types the phone accepts from the watch. */
private val INCOMING_TYPES =
  setOf("SESSION_PREPARED", "START_REQUEST", "COMMAND_REQUEST", "COMMAND_RESULT", "COACHING_RESULT", "STATE_QUERY", "ERROR")

/** Server ids stay text so int64 values are never rounded on the way to JS. */
private val ID_FIELDS = setOf("commandId", "coachingId")

data class SessionEnvelope(
  val type: String,
  val messageId: String,
  val replyTo: String?,
  val senderDeviceId: String?,
  val sessionId: String,
  val payload: JSONObject,
)

private fun JSONObject.idText(name: String): String? =
  if (!has(name) || isNull(name)) null else opt(name).let { if (it is Number) it.toLong().toString() else it.toString() }

/** Returns null for anything the phone must not relay: wrong version, unknown type, too large, or missing ids. */
fun decodeSessionMessage(bytes: ByteArray): SessionEnvelope? {
  if (bytes.size > MAX_SESSION_BYTES) return null
  return try {
    val json = JSONObject(String(bytes, Charsets.UTF_8))
    if (json.optInt("protocolVersion", -1) != SESSION_PROTOCOL_VERSION) return null
    val type = json.optString("type")
    if (type !in INCOMING_TYPES) return null
    val messageId = json.optString("messageId").takeIf { it.isNotEmpty() && it.length <= 200 } ?: return null
    val sessionId = json.idText("sessionId")?.takeIf { it.toLongOrNull()?.let { id -> id > 0 } == true } ?: return null
    val payload = json.optJSONObject("payload") ?: return null
    SessionEnvelope(
      type = type,
      messageId = messageId,
      replyTo = if (json.isNull("replyTo")) null else json.optString("replyTo"),
      senderDeviceId = json.idText("senderDeviceId"),
      sessionId = sessionId,
      payload = payload,
    )
  } catch (_: Exception) {
    null
  }
}

/** Builds an envelope; ids are written as JSON numbers as the spec examples show. */
fun encodeSessionMessage(
  type: String,
  messageId: String,
  replyTo: String?,
  senderDeviceId: String?,
  sessionId: String,
  payloadJson: String,
): ByteArray {
  val json = JSONObject()
    .put("protocolVersion", SESSION_PROTOCOL_VERSION)
    .put("type", type)
    .put("messageId", messageId)
    .put("replyTo", replyTo ?: JSONObject.NULL)
    .put("senderDeviceId", senderDeviceId?.toLong() ?: JSONObject.NULL)
    .put("sessionId", sessionId.toLong())
    .put("payload", JSONObject(payloadJson))
  val bytes = json.toString().toByteArray(Charsets.UTF_8)
  require(bytes.size <= MAX_SESSION_BYTES) { "session message too large" }
  return bytes
}

/** The event handed to JS: same envelope, with ids as strings. */
fun toJsEvent(message: SessionEnvelope): String {
  val payload = JSONObject(message.payload.toString())
  for (name in ID_FIELDS) {
    payload.idText(name)?.let { payload.put(name, it) }
  }
  return JSONObject()
    .put("type", message.type)
    .put("messageId", message.messageId)
    .put("replyTo", message.replyTo ?: JSONObject.NULL)
    .put("senderDeviceId", message.senderDeviceId ?: JSONObject.NULL)
    .put("sessionId", message.sessionId)
    .put("payload", payload)
    .toString()
}

/** LIVE_METRICS (S15P31E105-549): display-only values the watch screen shows now. Not stored, not acked, not uploaded. */
const val LIVE_METRICS_PATH = "/runway/v1/data/live"

private val LIVE_FIELDS = listOf("measuredAt", "paceSecPerKm", "heartRateBpm", "cadenceSpm", "distanceM", "activeSec")

/** The JS event for a LIVE_METRICS message, with only the known display fields; null when it is not one. */
fun liveJsEvent(bytes: ByteArray): String? = try {
  if (bytes.size > MAX_SESSION_BYTES) null else {
    val json = JSONObject(String(bytes, Charsets.UTF_8))
    val payload = json.optJSONObject("payload")
    // 워치는 정수 ID를 보낸다. 숫자로 오면 정수로 읽어 "7.0" 같은 문자열이 되지 않게 한다.
    val sessionId = when (val raw = json.opt("sessionId")) {
      is Number -> raw.toLong().toString()
      is String -> raw
      else -> null
    }
    if (json.optString("type") != "LIVE_METRICS" || payload == null || sessionId.isNullOrBlank()) null else {
      val values = JSONObject()
      for (name in LIVE_FIELDS) values.put(name, payload.opt(name) ?: JSONObject.NULL)
      JSONObject().put("type", "LIVE_METRICS").put("sessionId", sessionId).put("payload", values).toString()
    }
  }
} catch (_: Exception) {
  null
}

/** Paths JS may send on: the session paths (SERVER_END included), ERROR, COACHING_GUIDE and GROUP_STATUS (9.2). */
fun isSendablePath(path: String): Boolean =
  path.startsWith(SESSION_PATH_PREFIX) || path == ERROR_PATH || path == COACHING_GUIDE_PATH || path == GROUP_STATUS_PATH

/** Watch paths stored in the session inbox: the session paths and COACHING_RESULT. */
fun isSessionInboxPath(path: String): Boolean =
  path.startsWith(SESSION_PATH_PREFIX) || path == COACHING_RESULT_PATH

/** Results the phone acknowledges with COMMAND_RECEIVED(persisted=false) first; COACHING_RESULT included (9.4). */
fun needsLocalReceipt(type: String): Boolean = type == "COMMAND_RESULT" || type == "COACHING_RESULT"

/** COMMAND_RECEIVED(persisted=false): stored on the phone, not yet saved on the server (9.3). */
fun localReceipt(result: SessionEnvelope, messageId: String, senderDeviceId: String?): ByteArray {
  val payload = JSONObject()
    .put("commandId", result.payload.idText("commandId")?.toLong() ?: JSONObject.NULL)
    .put("persisted", false)
    .put("stateVersion", JSONObject.NULL)
  return encodeSessionMessage("COMMAND_RECEIVED", messageId, result.messageId, senderDeviceId, result.sessionId, payload.toString())
}

/** One entry per messageId (a resend replaces nothing); the oldest go first past the cap. */
fun mergeInbox(existing: List<SessionEnvelope>, incoming: SessionEnvelope): List<SessionEnvelope> {
  if (existing.any { it.messageId == incoming.messageId }) return existing
  return (existing + incoming).takeLast(MAX_INBOX)
}

/** First try at once, then 1 s and 2 s plus up to 500 ms jitter (9.5: at most 3 tries). */
fun retryDelaysMs(jitter: () -> Long): List<Long> = listOf(0L, 1000L + jitter(), 2000L + jitter())

/** The run service stays up from a prepared session until it ends, or while a command still waits for its result. */
fun shouldRunForeground(state: String?, hasPendingCommand: Boolean): Boolean =
  hasPendingCommand || state == "READY" || state == "RUNNING" || state == "PAUSED"
