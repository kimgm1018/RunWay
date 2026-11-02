package com.runway.watch.session

import org.json.JSONObject
import java.time.Instant

/**
 * Watch side of the run-session messages (watch-mobile-server-integration.md 9.1–9.6, S15P31E105-256).
 * The watch executes only commands the server approved and the phone relayed. Never log payload values.
 */
object SessionPaths {
    const val PREFIX = "/runway/v1/session/"
    const val PREPARE = "/runway/v1/session/prepare"
    const val PREPARED = "/runway/v1/session/prepared"
    const val START_REQUEST = "/runway/v1/session/start-request"
    const val START_AUTHORIZED = "/runway/v1/session/start-authorized"
    const val COMMAND = "/runway/v1/session/command"
    const val COMMAND_RESULT = "/runway/v1/session/command-result"
    const val COMMAND_RECEIVED = "/runway/v1/session/command-received"
    const val STATE_RESULT = "/runway/v1/session/state-result"
    const val ERROR = "/runway/v1/error"
}

private const val MAX_BYTES = 32 * 1024
private const val PROTOCOL_VERSION = 1

/** Types the watch accepts. A COMMAND_REQUEST is accepted only in APPLY phase (REQUEST is what the watch sends). */
private val INCOMING_TYPES = setOf("SESSION_PREPARE", "START_AUTHORIZED", "COMMAND_REQUEST", "COMMAND_RECEIVED", "STATE_RESULT", "ERROR")

data class SessionEnvelope(
    val type: String,
    val messageId: String,
    val replyTo: String?,
    val sessionId: String,
    val payload: JSONObject,
) {
    /** Server command id as text so int64 values are never rounded. */
    fun commandId(): String? = payload.idText("commandId")
}

private fun JSONObject.idText(name: String): String? =
    if (!has(name) || isNull(name)) null else opt(name).let { if (it is Number) it.toLong().toString() else it.toString() }

fun decodeSessionMessage(bytes: ByteArray): SessionEnvelope? {
    if (bytes.size > MAX_BYTES) return null
    return try {
        val json = JSONObject(String(bytes, Charsets.UTF_8))
        if (json.optInt("protocolVersion", -1) != PROTOCOL_VERSION) return null
        val type = json.optString("type")
        if (type !in INCOMING_TYPES) return null
        val payload = json.optJSONObject("payload") ?: return null
        if (type == "COMMAND_REQUEST" && payload.optString("phase") != "APPLY") return null
        val messageId = json.optString("messageId").takeIf { it.isNotEmpty() && it.length <= 200 } ?: return null
        val sessionId = json.idText("sessionId")?.takeIf { it.toLongOrNull()?.let { id -> id > 0 } == true } ?: return null
        SessionEnvelope(
            type = type,
            messageId = messageId,
            replyTo = if (json.isNull("replyTo")) null else json.optString("replyTo"),
            sessionId = sessionId,
            payload = payload,
        )
    } catch (_: Exception) {
        null
    }
}

/** Builders for what the watch sends. Ids are written as JSON numbers as in the spec examples. */
object SessionMessages {
    fun prepared(messageId: String, sessionId: String, stateVersion: Long, ready: Boolean, reasonCode: String?): ByteArray =
        encode("SESSION_PREPARED", messageId, null, sessionId, JSONObject()
            .put("stateVersion", stateVersion)
            .put("ready", ready)
            .put("reasonCode", reasonCode ?: JSONObject.NULL))

    fun startRequest(messageId: String, sessionId: String, expectedVersion: Long): ByteArray =
        encode("START_REQUEST", messageId, null, sessionId, JSONObject().put("expectedVersion", expectedVersion))

    /** Watch button → phone. action: PAUSE, RESUME, END or CANCEL (9.3, CANCEL added 2026-11-02). */
    fun commandRequest(messageId: String, sessionId: String, action: String, expectedVersion: Long): ByteArray =
        encode("COMMAND_REQUEST", messageId, null, sessionId, JSONObject()
            .put("phase", "REQUEST")
            .put("action", action)
            .put("expectedVersion", expectedVersion)
            .put("targetBpm", JSONObject.NULL))

    /**
     * The real result of an approved command. appliedAt only for APPLIED; reasonCode key always present.
     * END adds the upload fields: no watch batches exist yet (D-3, S15P31E105-311), so a real end has none pending.
     */
    fun commandResult(
        messageId: String,
        replyTo: String?,
        sessionId: String,
        commandId: String,
        result: String,
        appliedAt: Instant?,
        reasonCode: String?,
        end: Boolean,
    ): ByteArray {
        val payload = JSONObject()
            .put("commandId", commandId.toLong())
            .put("result", result)
            .put("appliedAt", if (result == "APPLIED" && appliedAt != null) appliedAt.toString() else JSONObject.NULL)
            .put("reasonCode", reasonCode ?: JSONObject.NULL)
        if (end) {
            val applied = result == "APPLIED"
            payload.put("pendingBatchCount", 0).put("uploadComplete", applied)
        }
        return encode("COMMAND_RESULT", messageId, replyTo, sessionId, payload)
    }

    private fun encode(type: String, messageId: String, replyTo: String?, sessionId: String, payload: JSONObject): ByteArray {
        val bytes = JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("type", type)
            .put("messageId", messageId)
            .put("replyTo", replyTo ?: JSONObject.NULL)
            .put("senderDeviceId", JSONObject.NULL)
            .put("sessionId", sessionId.toLong())
            .put("payload", payload)
            .toString()
            .toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_BYTES) { "session message too large" }
        return bytes
    }
}
