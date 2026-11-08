package com.runway.watch.session

import com.runway.watch.run.RecordComparison
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

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
    const val STATE_QUERY = "/runway/v1/session/state-query"
    const val STATE_RESULT = "/runway/v1/session/state-result"
    const val ERROR = "/runway/v1/error"

    /** Server-approved coaching (S15P31E105-257): COACHING_GUIDE phone→watch, COACHING_RESULT watch→phone. */
    const val COACHING_PREFIX = "/runway/v1/coaching/"
    const val COACHING_GUIDE = "/runway/v1/coaching/guide"
    const val COACHING_RESULT = "/runway/v1/coaching/result"
}

/** 9.3 targetBpm range for SET_BPM and COACHING_GUIDE. */
val BPM_RANGE = 60..220

private const val MAX_BYTES = 32 * 1024
private const val PROTOCOL_VERSION = 1

/** Types the watch accepts. A COMMAND_REQUEST is accepted only in APPLY phase (REQUEST is what the watch sends). */
private val INCOMING_TYPES = setOf(
    "SESSION_PREPARE", "START_AUTHORIZED", "COMMAND_REQUEST", "COMMAND_RECEIVED", "STATE_RESULT", "ERROR",
    // S15P31E105-311: phone receipt and server save ACK of a watch batch.
    "BATCH_RECEIVED", "BATCH_COMMITTED",
    // S15P31E105-257: server-approved coaching relayed by the phone.
    "COACHING_GUIDE",
)

data class SessionEnvelope(
    val type: String,
    val messageId: String,
    val replyTo: String?,
    val sessionId: String,
    val payload: JSONObject,
) {
    /** Server command id as text so int64 values are never rounded. */
    fun commandId(): String? = payload.idText("commandId")

    /** COACHING_GUIDE.coachingId as text (int64). */
    fun coachingId(): String? = payload.idText("coachingId")

    /** An integer BPM field (targetBpm, currentBpm, initialBpm) within [BPM_RANGE]; null when absent, null, fractional or out of range. */
    fun bpm(name: String): Int? = if (!payload.has(name) || payload.isNull(name)) null
    else (payload.opt(name) as? Number)?.takeIf { it.toDouble() == it.toInt().toDouble() }?.toInt()?.takeIf { it in BPM_RANGE }

    /** Optional UTC time field; null when absent, null or not ISO-8601. */
    fun instant(name: String): Instant? = if (!payload.has(name) || payload.isNull(name)) null
    else parseInstant(payload.getString(name))

    /** SESSION_PREPARE.deviceId: this watch's server device id (S15P31E105-311), positive int64 as text. */
    /** BATCH_RECEIVED/BATCH_COMMITTED.batchId (UUID text, original spelling). */
    fun batchId(): String? = payload.optString("batchId").takeIf { it.isNotEmpty() && it.length <= 64 }

    fun deviceId(): String? = payload.idText("deviceId")?.takeIf { it.toLongOrNull()?.let { id -> id > 0 } == true }

    /**
     * STATE_RESULT(scope=SERVER).comparison: the server's S02 record comparison (S15P31E105-422, sessions.md "기록 비교").
     * Absent or null means no past run was chosen. The watch only shows it; nothing is computed here. An AVAILABLE
     * result with missing or negative values, or an unknown status, is shown as waiting rather than as a made-up gap.
     */
    fun comparison(): RecordComparison {
        val c = payload.optJSONObject("comparison") ?: return RecordComparison.NotSelected
        return when (c.optString("status")) {
            "WAITING" -> RecordComparison.Waiting
            "NO_RECORD" -> RecordComparison.NoRecord
            "UNAVAILABLE" -> RecordComparison.Unavailable
            "AVAILABLE" -> {
                val distance = c.wholeNumber("distanceM")
                val now = c.wholeNumber("currentElapsedSec")
                val past = c.wholeNumber("pastElapsedSec")
                if (distance == null || now == null || past == null) RecordComparison.Waiting
                else RecordComparison.Result(
                    distanceMeters = distance.toDouble(),
                    currentElapsedMs = now * 1000,
                    pastElapsedMs = past * 1000,
                    targetLabel = c.optString("targetStartedAt").takeIf { it.isNotEmpty() && !c.isNull("targetStartedAt") }
                        ?.let(::parseInstant)?.let(::dayLabel),
                )
            }
            else -> RecordComparison.Waiting
        }
    }
}

private val KOREA = ZoneId.of("Asia/Seoul")

/** The past run's day in Korea as "M.dd" (10.13), like the phone's 4.2 label. */
internal fun dayLabel(at: Instant): String = at.atZone(KOREA).let { "${it.monthValue}.%02d".format(it.dayOfMonth) }

/** A non-negative whole number field; null when absent, null, fractional or negative. */
private fun JSONObject.wholeNumber(name: String): Long? =
    if (!has(name) || isNull(name)) null
    else (opt(name) as? Number)?.takeIf { it.toDouble() == it.toLong().toDouble() }?.toLong()?.takeIf { it >= 0 }

/** UTC "…Z" or an ISO-8601 time with an offset; null when unreadable. */
internal fun parseInstant(text: String): Instant? = try {
    Instant.parse(text)
} catch (_: Exception) {
    try { java.time.OffsetDateTime.parse(text).toInstant() } catch (_: Exception) { null }
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

    /**
     * Watch button → phone. action: PAUSE, RESUME, END, CANCEL (9.3, CANCEL added 2026-11-02) or SET_BPM with
     * [targetBpm] in [BPM_RANGE] (S15P31E105-257); targetBpm is null for every other action.
     */
    fun commandRequest(messageId: String, sessionId: String, action: String, expectedVersion: Long, targetBpm: Int? = null): ByteArray {
        require((action == "SET_BPM") == (targetBpm != null)) { "targetBpm only for SET_BPM" }
        require(targetBpm == null || targetBpm in BPM_RANGE) { "targetBpm out of range" }
        return encode("COMMAND_REQUEST", messageId, null, sessionId, JSONObject()
            .put("phase", "REQUEST")
            .put("action", action)
            .put("expectedVersion", expectedVersion)
            .put("targetBpm", targetBpm ?: JSONObject.NULL))
    }

    /** STATE_QUERY for the server state; [clientSendAt] comes back in STATE_RESULT for the clock estimate (9.7). */
    fun stateQuery(messageId: String, sessionId: String, clientSendAt: Instant): ByteArray =
        encode("STATE_QUERY", messageId, null, sessionId, JSONObject()
            .put("scope", "SERVER")
            .put("clientSendAt", clientSendAt.toString()))

    /** Whether a COACHING_GUIDE was applied. appliedAt only for APPLIED; reasonCode key always present (9.3). */
    fun coachingResult(
        messageId: String,
        replyTo: String?,
        sessionId: String,
        commandId: String,
        coachingId: String,
        result: String,
        appliedAt: Instant?,
        reasonCode: String?,
    ): ByteArray = encode("COACHING_RESULT", messageId, replyTo, sessionId, JSONObject()
        .put("commandId", commandId.toLong())
        .put("coachingId", coachingId.toLong())
        .put("result", result)
        .put("appliedAt", if (result == "APPLIED" && appliedAt != null) appliedAt.toString() else JSONObject.NULL)
        .put("reasonCode", reasonCode ?: JSONObject.NULL))

    /**
     * The real result of an approved command. appliedAt only for APPLIED; reasonCode key always present.
     * END adds the upload fields (S15P31E105-311): [pendingBatchCount] watch batches still lack the server save ACK, and
     * uploadComplete is true only for an applied end with none left.
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
        pendingBatchCount: Int = 0,
    ): ByteArray {
        val payload = JSONObject()
            .put("commandId", commandId.toLong())
            .put("result", result)
            .put("appliedAt", if (result == "APPLIED" && appliedAt != null) appliedAt.toString() else JSONObject.NULL)
            .put("reasonCode", reasonCode ?: JSONObject.NULL)
        if (end) {
            val applied = result == "APPLIED"
            payload.put("pendingBatchCount", pendingBatchCount).put("uploadComplete", applied && pendingBatchCount == 0)
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
