package com.runway.watch.dailyhr

import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject

/** One day's estimated daily heart rate, sent watch -> phone. */
data class DailyHrSummary(
    val metricDate: LocalDate,
    val revision: Int,
    val estimatedRestingHrBpm: Double,
    val method: String,
    val validSampleCount: Int,
    val computedAt: Instant,
    val collectionId: String? = null,
)

data class DailyHrReceipt(val metricDate: LocalDate, val revision: Int, val collectionId: String?)

/** Wire format for DAILY_HR_SUMMARY / DAILY_HR_RECEIVED (design doc 9.1, 9.9). */
object DailyHrMessages {
    const val SUMMARY_PATH = "/runway/v1/health/daily-hr"
    const val RECEIVED_PATH = "/runway/v1/health/daily-hr-received"
    const val CONSENT_PATH = "/runway/v1/state/health-consent"
    const val MAX_BYTES = 32 * 1024

    private const val PROTOCOL_VERSION = 1
    private const val SUMMARY_TYPE = "DAILY_HR_SUMMARY"
    private const val RECEIVED_TYPE = "DAILY_HR_RECEIVED"

    fun encodeSummary(messageId: String, s: DailyHrSummary): ByteArray {
        val payload = JSONObject()
            .put("collectionId", s.collectionId ?: JSONObject.NULL)
            .put("metricDate", s.metricDate.toString())
            .put("revision", s.revision)
            .put("estimatedRestingHrBpm", s.estimatedRestingHrBpm)
            .put("method", s.method)
            .put("validSampleCount", s.validSampleCount)
            .put("computedAt", s.computedAt.toString())
        val bytes = JSONObject()
            .put("protocolVersion", PROTOCOL_VERSION)
            .put("type", SUMMARY_TYPE)
            .put("messageId", messageId)
            .put("replyTo", JSONObject.NULL)
            .put("senderDeviceId", JSONObject.NULL)
            .put("sessionId", JSONObject.NULL)
            .put("payload", payload)
            .toString()
            .toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_BYTES) { "daily HR message exceeds $MAX_BYTES bytes" }
        return bytes
    }

    /** Returns the acknowledged collection, date and revision, or null for malformed input. */
    fun decodeReceived(bytes: ByteArray): DailyHrReceipt? = try {
        val json = JSONObject(String(bytes, Charsets.UTF_8))
        if (json.getInt("protocolVersion") != PROTOCOL_VERSION ||
            json.getString("type") != RECEIVED_TYPE
        ) {
            null
        } else {
            val payload = json.getJSONObject("payload")
            val revision = payload.getInt("revision")
            val collectionId = if (payload.has("collectionId") && !payload.isNull("collectionId")) {
                payload.getString("collectionId").also { require(it.isNotBlank()) }
            } else null
            if (revision < 1) null else DailyHrReceipt(LocalDate.parse(payload.getString("metricDate")), revision, collectionId)
        }
    } catch (_: Exception) {
        null
    }
}

/** Health data consent shared by the phone through a DataItem. */
data class HealthConsent(
    val agreed: Boolean,
    val updatedAt: Instant,
    val collectionId: String? = null,
    val collectionStartedAt: Instant? = null,
) {
    companion object
}

fun HealthConsent.Companion.fromDataMap(
    access: String?, updatedAt: String?, collectionId: String? = null, collectionStartedAt: String? = null,
): HealthConsent? {
    val agreed = when (access) {
        "AGREEE" -> true
        "DISAGREE" -> false
        else -> return null
    }
    val at = try {
        Instant.parse(updatedAt ?: return null)
    } catch (_: Exception) {
        return null
    }
    val id = collectionId?.takeIf { it.isNotBlank() }
    val startedAt = if (id != null) {
        try { Instant.parse(collectionStartedAt ?: return null) } catch (_: Exception) { return null }
    } else null
    return HealthConsent(agreed, at, id, startedAt)
}

/** Keeps [current] unless [incoming] is strictly newer; stale updates are ignored. */
fun newerConsent(current: HealthConsent?, incoming: HealthConsent): HealthConsent =
    if (current == null || incoming.updatedAt.isAfter(current.updatedAt)) incoming else current
