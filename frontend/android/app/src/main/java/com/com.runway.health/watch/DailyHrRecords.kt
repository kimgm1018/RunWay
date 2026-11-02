package com.runway.health.watch

import android.content.Context
import org.json.JSONObject
import java.time.LocalDate

/** Watch daily heart-rate estimate kept on the phone until upload (S15P31E105-281). */
data class DailyHrRecord(
  val metricDate: String,
  val revision: Int,
  val estimatedRestingHrBpm: Double,
  val method: String,
  val validSampleCount: Int,
  val computedAt: String,
  val uploadedRevision: Int?,
  /** Revision W06 rejected (record error, 400·413·422); resending the same content cannot succeed. */
  val rejectedRevision: Int? = null,
)

/** A parsed DAILY_HR_SUMMARY with the envelope messageId needed for the reply. */
data class DailyHrSummaryMessage(val messageId: String, val record: DailyHrRecord)

const val SUMMARY_PATH = "/runway/v1/health/daily-hr"
const val RECEIVED_PATH = "/runway/v1/health/daily-hr-received"
const val CONSENT_PATH = "/runway/v1/state/health-consent"
const val CONSENT_AGREE = "AGREEE"
const val CONSENT_DISAGREE = "DISAGREE"
private const val MAX_BYTES = 32 * 1024
private const val PROTOCOL_VERSION = 1
private const val MAX_KEEP_DAYS = 7L
private const val UPLOADED_KEEP_DAYS = 1L

/** Keeps the highest revision per date; a newer revision keeps the existing upload marker and is sent again even if the older one was rejected. */
fun merge(existing: DailyHrRecord?, incoming: DailyHrRecord): DailyHrRecord = when {
  existing == null -> incoming
  incoming.revision > existing.revision -> incoming.copy(uploadedRevision = existing.uploadedRevision)
  else -> existing
}

/** Records are kept only while consent is AGREEE; returns null (do not store or ack) otherwise. */
fun consentedMerge(consent: String?, existing: DailyHrRecord?, incoming: DailyHrRecord): DailyHrRecord? =
  if (consent == CONSENT_AGREE) merge(existing, incoming) else null

/**
 * Uploaded records are kept for today and yesterday; any record older than 7 days is dropped even if not uploaded.
 * An unparseable date is kept rather than failing the write.
 */
fun retainRecord(record: DailyHrRecord, today: LocalDate): Boolean {
  val date = try {
    LocalDate.parse(record.metricDate)
  } catch (_: Exception) {
    return true
  }
  return when {
    date < today.minusDays(MAX_KEEP_DAYS) -> false
    (record.uploadedRevision == record.revision || record.rejectedRevision == record.revision) &&
      date < today.minusDays(UPLOADED_KEEP_DAYS) -> false
    else -> true
  }
}

/** Publish only a changed consent or one whose earlier publish failed; repeats would wake the watch for nothing. */
fun needsConsentPublish(saved: String?, delivered: Boolean, incoming: String): Boolean = saved != incoming || !delivered

/** Returns null for anything malformed (design doc 9.1, 9.9). */
fun parseSummary(bytes: ByteArray): DailyHrSummaryMessage? = try {
  if (bytes.size > MAX_BYTES) null else {
    val json = JSONObject(String(bytes, Charsets.UTF_8))
    val messageId = json.get("messageId") as? String
    if (json.getInt("protocolVersion") != PROTOCOL_VERSION || json.getString("type") != "DAILY_HR_SUMMARY" || messageId == null) null else {
      val p = json.getJSONObject("payload")
      val record = DailyHrRecord(
        metricDate = LocalDate.parse(p.getString("metricDate")).toString(),
        revision = p.getInt("revision"),
        estimatedRestingHrBpm = p.getDouble("estimatedRestingHrBpm"),
        method = p.get("method") as? String ?: throw IllegalArgumentException(),
        validSampleCount = p.getInt("validSampleCount"),
        computedAt = p.get("computedAt") as? String ?: throw IllegalArgumentException(),
        uploadedRevision = null,
      )
      if (record.revision < 1 || record.validSampleCount < 1 || !record.estimatedRestingHrBpm.isFinite()) null
      else DailyHrSummaryMessage(messageId, record)
    }
  }
} catch (_: Exception) {
  null
}

fun receivedReply(messageId: String, replyTo: String, date: String, revision: Int): ByteArray = JSONObject()
  .put("protocolVersion", PROTOCOL_VERSION)
  .put("type", "DAILY_HR_RECEIVED")
  .put("messageId", messageId)
  .put("replyTo", replyTo)
  .put("senderDeviceId", JSONObject.NULL)
  .put("sessionId", JSONObject.NULL)
  .put("payload", JSONObject().put("metricDate", date).put("revision", revision))
  .toString()
  .toByteArray(Charsets.UTF_8)

/** SharedPreferences store shared by the listener service and the RN module. Writes use commit(). */
class DailyHrPrefs(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("watch_daily_hr", Context.MODE_PRIVATE)

  fun upsert(incoming: DailyHrRecord): DailyHrRecord = upsertWith(incoming) { existing -> merge(existing, incoming) }!!

  /** Consent check and write share one lock so a withdrawal cannot interleave; null means not stored. */
  fun upsertIfConsented(incoming: DailyHrRecord): DailyHrRecord? =
    upsertWith(incoming) { existing -> consentedMerge(consent(), existing, incoming) }

  private fun upsertWith(incoming: DailyHrRecord, decide: (DailyHrRecord?) -> DailyHrRecord?): DailyHrRecord? = synchronized(LOCK) {
    val records = readRecords()
    val existing = records[incoming.metricDate]
    val merged = decide(existing) ?: return null
    if (merged !== existing) writeRecords(records + (merged.metricDate to merged))
    merged
  }

  fun all(): List<DailyHrRecord> = synchronized(LOCK) { readRecords().values.sortedBy { it.metricDate } }

  fun markUploaded(date: String, revision: Int) = synchronized(LOCK) {
    val records = readRecords()
    val record = records[date]
    if (record != null && record.revision == revision) writeRecords(records + (date to record.copy(uploadedRevision = revision)))
  }

  /** Persists a W06 rejection so the same revision is not resent after an app restart. */
  fun markRejected(date: String, revision: Int) = synchronized(LOCK) {
    val records = readRecords()
    val record = records[date]
    if (record != null && record.revision == revision) writeRecords(records + (date to record.copy(rejectedRevision = revision)))
  }

  fun clear() = synchronized(LOCK) { check(prefs.edit().remove(KEY_RECORDS).commit()) }

  /** Saving DISAGREE also removes stored records in the same commit (withdrawal is atomic). */
  fun saveConsent(access: String) = synchronized(LOCK) {
    val edit = prefs.edit().putString(KEY_CONSENT, access).putBoolean(KEY_CONSENT_DELIVERED, false)
    if (access != CONSENT_AGREE) edit.remove(KEY_RECORDS)
    check(edit.commit())
  }

  fun consent(): String? = prefs.getString(KEY_CONSENT, null)

  fun consentDelivered(): Boolean = prefs.getBoolean(KEY_CONSENT_DELIVERED, false)

  /** Marks delivery only if consent did not change while the publish was in flight. */
  fun markConsentDelivered(access: String) = synchronized(LOCK) {
    if (consent() == access) check(prefs.edit().putBoolean(KEY_CONSENT_DELIVERED, true).commit())
  }

  /** Phone envelope messageId, `phone:<n>`, persisted so it keeps increasing across restarts. */
  fun nextMessageId(): String = synchronized(LOCK) {
    val next = prefs.getLong(KEY_SEQ, 0L) + 1
    check(prefs.edit().putLong(KEY_SEQ, next).commit())
    "phone:$next"
  }

  private fun readRecords(): Map<String, DailyHrRecord> {
    val json = JSONObject(prefs.getString(KEY_RECORDS, null) ?: return emptyMap())
    return json.keys().asSequence().associateWith { date ->
      val r = json.getJSONObject(date)
      DailyHrRecord(
        metricDate = date,
        revision = r.getInt("revision"),
        estimatedRestingHrBpm = r.getDouble("estimatedRestingHrBpm"),
        method = r.getString("method"),
        validSampleCount = r.getInt("validSampleCount"),
        computedAt = r.getString("computedAt"),
        uploadedRevision = if (r.has("uploadedRevision")) r.getInt("uploadedRevision") else null,
        rejectedRevision = if (r.has("rejectedRevision")) r.getInt("rejectedRevision") else null,
      )
    }
  }

  /** Called only under LOCK; applies [retainRecord] in the same commit. */
  private fun writeRecords(records: Map<String, DailyHrRecord>) {
    val json = JSONObject()
    val today = LocalDate.now()
    records.values.filter { retainRecord(it, today) }.forEach { r ->
      json.put(r.metricDate, JSONObject()
        .put("revision", r.revision)
        .put("estimatedRestingHrBpm", r.estimatedRestingHrBpm)
        .put("method", r.method)
        .put("validSampleCount", r.validSampleCount)
        .put("computedAt", r.computedAt)
        .apply {
          r.uploadedRevision?.let { put("uploadedRevision", it) }
          r.rejectedRevision?.let { put("rejectedRevision", it) }
        })
    }
    check(prefs.edit().putString(KEY_RECORDS, json.toString()).commit())
  }

  private companion object {
    val LOCK = Any()
    const val KEY_RECORDS = "records"
    const val KEY_CONSENT = "consent"
    const val KEY_CONSENT_DELIVERED = "consent_delivered"
    const val KEY_SEQ = "next_message_seq"
  }
}
