package com.runway.watch.session

import com.runway.watch.run.AnalysisReport
import com.runway.watch.run.AnalysisStatus
import com.runway.watch.run.GoalEvaluation
import com.runway.watch.run.GroupNotice
import com.runway.watch.run.GroupPhase
import com.runway.watch.run.GroupStanding
import com.runway.watch.run.HeartRate
import com.runway.watch.run.RecordComparison
import com.runway.watch.run.RunSummary
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

    /** G12 group end: the participant's server-approved END relayed by the phone (9.3 SERVER_END, S15P31E105-420). */
    const val SERVER_END = "/runway/v1/session/server-end"

    /** G10 group standing relayed by the phone (9.3 GROUP_STATUS, S15P31E105-420). */
    const val GROUP_PREFIX = "/runway/v1/group/"
    const val GROUP_STATUS = "/runway/v1/group/status"

    /** Display-only live values for the phone screen (9.3 LIVE_METRICS, S15P31E105-549). No ACK, never uploaded. */
    const val LIVE_METRICS = "/runway/v1/data/live"
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
    // S15P31E105-420: group end command and G10 group standing relayed by the phone.
    "SERVER_END", "GROUP_STATUS",
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

    /** SESSION_PREPARE/GROUP_STATUS.groupRunId: the group run this session belongs to; null for a personal run (S15P31E105-420). */
    fun groupRunId(): String? = payload.idText("groupRunId")?.takeIf { it.toLongOrNull()?.let { id -> id > 0 } == true }

    /**
     * GROUP_STATUS (S15P31E105-420): the phone's copy of G10 for this runner. Null when the group or the phase is
     * missing or unknown, so the message is ignored. A standing without a positive rank, or with a negative count or
     * gap, is dropped as a whole rather than shown half made up.
     */
    fun groupUpdate(): GroupUpdate? {
        val group = groupRunId() ?: return null
        val phase = try { GroupPhase.valueOf(payload.optString("phase")) } catch (_: Exception) { return null }
        val standing = payload.optJSONObject("standing")?.let { s ->
            val rank = s.wholeNumber("rank")?.takeIf { it >= 1 } ?: return@let null
            val ahead = s.nullableWhole("aheadCount") ?: return@let null
            val behind = s.nullableWhole("behindCount") ?: return@let null
            val gapAhead = s.nullableDistance("gapToAheadM") ?: return@let null
            val gapBehind = s.nullableDistance("gapToBehindM") ?: return@let null
            GroupStanding(rank.toInt(), ahead.value?.toInt(), behind.value?.toInt(), gapAhead.value, gapBehind.value)
        }
        return GroupUpdate(
            groupRunId = group,
            phase = phase,
            guidePaceSecondsPerKm = payload.wholeNumber("guidePaceSecPerKm")?.takeIf { it > 0 }?.toInt(),
            standing = standing,
            stale = payload.optBoolean("stale", true),
            leaderToLastGapMeters = payload.nullableDistance("leaderToLastGapM")?.value,
            updatedAt = instant("updatedAt"),
            rankedCount = payload.wholeNumber("rankedCount")?.takeIf { it >= 1 }?.toInt(),
            paceChanged = payload.optJSONObject("paceChanged")?.let { c ->
                val from = c.wholeNumber("from")?.takeIf { it > 0 }?.toInt() ?: return@let null
                val to = c.wholeNumber("to")?.takeIf { it > 0 }?.toInt() ?: return@let null
                GroupNotice.PaceChanged(from, to).takeIf { from != to }
            },
            gapWidened = gapWidened(),
            gapWidenedNew = payload.optJSONObject("gapWidened")?.optBoolean("isNew", false) == true && gapWidened() != null,
        )
    }

    /** GROUP_STATUS.gapWidened (S15P31E105-629); a missing or negative distance drops it. A blank name is no name. */
    private fun gapWidened(): GroupNotice.GapWidened? = payload.optJSONObject("gapWidened")?.let { g ->
        val meters = g.wholeNumber("gapM")?.takeIf { it >= 0 }?.toInt() ?: return@let null
        val name = if (!g.has("memberName") || g.isNull("memberName")) null else g.optString("memberName").trim().takeIf { it.isNotEmpty() }
        GroupNotice.GapWidened(meters, name)
    }

    /**
     * STATE_RESULT(scope=SERVER).analysis (S15P31E105-663, integration doc STATE_RESULT): the server's analysis status and,
     * only when READY, the H02 summary the phone relayed. Null when the field is absent (an older phone), the status is
     * unknown or LEGACY. Nothing is computed here; a missing or invalid value stays null and is shown as missing.
     */
    fun analysis(): AnalysisReport? {
        val a = payload.optJSONObject("analysis") ?: return null
        val status = when (a.optString("status")) {
            "PENDING" -> AnalysisStatus.PENDING
            "PROCESSING" -> AnalysisStatus.PROCESSING
            "READY" -> AnalysisStatus.READY
            "FAILED" -> AnalysisStatus.FAILED
            else -> return null
        }
        if (status != AnalysisStatus.READY) return AnalysisReport(status)
        val s = a.optJSONObject("summary") ?: return AnalysisReport(status)
        val distance = s.nullableDistance("distanceM")?.value
        val moving = s.wholeNumber("movingDurationSec")
        val pace = (s.opt("averagePaceSecPerKm") as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 }?.let { Math.round(it).toInt() }
        val heart = (s.opt("averageHeartRate") as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 }?.let { HeartRate(Math.round(it).toInt()) }
        val achieved = if (s.has("goalAchieved") && !s.isNull("goalAchieved")) s.opt("goalAchieved") as? Boolean else null
        return AnalysisReport(
            status = status,
            summary = RunSummary(distanceMeters = distance, elapsedMs = moving?.let { it * 1000 }, averagePaceSecondsPerKm = pace, averageHeartRate = heart),
            goal = achieved?.let { GoalEvaluation(it) },
        )
    }

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

/** A field that may be null: [value] is null for null/absent; the wrapper itself is null when the value is invalid. */
private data class NullableField<T>(val value: T?)

private fun JSONObject.nullableWhole(name: String): NullableField<Long>? =
    if (!has(name) || isNull(name)) NullableField(null) else wholeNumber(name)?.let { NullableField(it) }

private fun JSONObject.nullableDistance(name: String): NullableField<Double>? =
    if (!has(name) || isNull(name)) NullableField(null)
    else (opt(name) as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }?.let { NullableField(it) }

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

    /**
     * 9.3 LIVE_METRICS (S15P31E105-549): the values the watch screen shows now, so the phone shows the same ones without
     * waiting for the next batch. Display only: no ACK, no retry, never stored or uploaded. A value not measured is null.
     */
    fun liveMetrics(
        messageId: String,
        sessionId: String,
        measuredAt: Instant?,
        paceSecPerKm: Int?,
        heartRateBpm: Int?,
        cadenceSpm: Int?,
        distanceM: Double?,
        activeSec: Long?,
    ): ByteArray = encode("LIVE_METRICS", messageId, null, sessionId, JSONObject()
        .put("measuredAt", measuredAt?.toString() ?: JSONObject.NULL)
        .put("paceSecPerKm", paceSecPerKm ?: JSONObject.NULL)
        .put("heartRateBpm", heartRateBpm ?: JSONObject.NULL)
        .put("cadenceSpm", cadenceSpm ?: JSONObject.NULL)
        .put("distanceM", distanceM ?: JSONObject.NULL)
        .put("activeSec", activeSec ?: JSONObject.NULL))

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

/**
 * One GROUP_STATUS (S15P31E105-420). [standing] is null when the server did not rank this runner; [stale] is G10's
 * own flag for this runner. [updatedAt] is G10 updatedAt and orders updates: an older one never replaces a newer one.
 */
data class GroupUpdate(
    val groupRunId: String,
    val phase: GroupPhase,
    val guidePaceSecondsPerKm: Int?,
    val standing: GroupStanding?,
    val stale: Boolean,
    val leaderToLastGapMeters: Double?,
    val updatedAt: Instant?,
    /** Runners G10 ranked now; null when not sent (older phone). */
    val rankedCount: Int? = null,
    /**
     * GROUP_STATUS.paceChanged (S15P31E105-604): the shared pace change the phone saw between two G10 reads it made in a
     * row. Null on the first read, null→value, the same value, or a resend; the watch alerts only when this is set.
     */
    val paceChanged: GroupNotice.PaceChanged? = null,
    /**
     * GROUP_STATUS.gapWidened (S15P31E105-629): sent only to the group leader while the group stays stretched past the
     * phone's threshold. [gapWidenedNew] is true only on the update where it crossed; the watch buzzes only then.
     */
    val gapWidened: GroupNotice.GapWidened? = null,
    val gapWidenedNew: Boolean = false,
)
