package com.runway.watch.session

import android.content.Context
import org.json.JSONObject
import java.time.Instant

/**
 * The session and version the phone asked the watch to prepare (SESSION_PREPARE). [deviceId] is this watch's
 * user_devices.id from the same message; batches carry it as their producer (S15P31E105-311). [groupRunId] is set when
 * the session is a group run participant's (S15P31E105-420), so a restarted watch still shows the group pages.
 * [clockOffsetMs] is the server clock offset the START result of this session used (null before START). Every later
 * control result of the run uses the same offset so the server's intervals equal the watch's (S15P31E105-839).
 */
data class Prepared(
    val sessionId: String,
    val stateVersion: Long,
    val ready: Boolean,
    val deviceId: String? = null,
    val groupRunId: String? = null,
    val clockOffsetMs: Long? = null,
)

/**
 * EXECUTING is written before the exercise call so a crash mid-call is never re-executed (9.4). IGNORED is only for
 * coaching: the guide was not applied (stale, version mismatch, not running) and that decision is kept (S15P31E105-257).
 */
enum class OutcomeResult { EXECUTING, APPLIED, REJECTED, UNKNOWN, IGNORED }

data class CommandOutcome(
    val sessionId: String,
    val commandId: String,
    val action: String,
    val result: OutcomeResult,
    val appliedAt: Instant?,
    val reasonCode: String?,
    val persisted: Boolean,
    val stateVersion: Long?,
    /** COACHING only: the AI coaching record the command applies (S15P31E105-257). */
    val coachingId: String? = null,
    /** SET_BPM / COACHING: the rhythm BPM the command sets. */
    val targetBpm: Int? = null,
    /** Applied START only: whether the watch exercise turned GPS on (S15P31E105-864); null when unknown. */
    val gps: Boolean? = null,
)

/** Watch-side record of prepared sessions and per-command results. Survives app restarts. */
interface SessionStore {
    fun prepared(): Prepared?
    fun savePrepared(prepared: Prepared)
    fun outcome(commandId: String): CommandOutcome?
    fun saveOutcome(outcome: CommandOutcome)

    /**
     * Saves [outcome] only when its commandId has no result yet, in one step, and returns the result that was already
     * there (null when [outcome] was saved). Used so the first handling of a coaching command decides once (9.4).
     */
    fun saveOutcomeIfAbsent(outcome: CommandOutcome): CommandOutcome?
    fun markPersisted(commandId: String, stateVersion: Long?)

    /** True once a coachingId was taken for application; the same coaching is never applied again (9.5). */
    fun coachingUsed(coachingId: String): Boolean
    fun markCoachingUsed(coachingId: String)
    fun nextMessageId(): String
}

class InMemorySessionStore : SessionStore {
    private var prepared: Prepared? = null
    private val outcomes = linkedMapOf<String, CommandOutcome>()
    private val coachings = linkedSetOf<String>()
    private var seq = 0L

    @Synchronized override fun prepared() = prepared
    @Synchronized override fun savePrepared(prepared: Prepared) { this.prepared = prepared }
    @Synchronized override fun outcome(commandId: String) = outcomes[commandId]
    @Synchronized override fun saveOutcome(outcome: CommandOutcome) { outcomes[outcome.commandId] = outcome }
    @Synchronized override fun saveOutcomeIfAbsent(outcome: CommandOutcome): CommandOutcome? =
        outcomes[outcome.commandId] ?: run { outcomes[outcome.commandId] = outcome; null }
    @Synchronized override fun coachingUsed(coachingId: String) = coachingId in coachings
    @Synchronized override fun markCoachingUsed(coachingId: String) { coachings += coachingId }
    @Synchronized override fun markPersisted(commandId: String, stateVersion: Long?) {
        outcomes[commandId]?.let { outcomes[commandId] = it.copy(persisted = true, stateVersion = stateVersion) }
    }
    @Synchronized override fun nextMessageId() = "watch:${++seq}"
}

/** SharedPreferences store. Keeps the latest [MAX_OUTCOMES] command results; older ones belong to finished runs. */
class PrefsSessionStore(context: Context) : SessionStore {
    private val prefs = context.applicationContext.getSharedPreferences("watch_run_session", Context.MODE_PRIVATE)

    override fun prepared(): Prepared? = synchronized(LOCK) {
        val json = prefs.getString(KEY_PREPARED, null) ?: return null
        try {
            JSONObject(json).let {
                Prepared(
                    it.getString("sessionId"), it.getLong("stateVersion"), it.getBoolean("ready"),
                    if (it.isNull("deviceId")) null else it.optString("deviceId").takeIf { id -> id.isNotEmpty() },
                    if (!it.has("groupRunId") || it.isNull("groupRunId")) null else it.optString("groupRunId").takeIf { id -> id.isNotEmpty() },
                    if (!it.has("clockOffsetMs") || it.isNull("clockOffsetMs")) null else it.getLong("clockOffsetMs"),
                )
            }
        } catch (_: Exception) {
            null
        }
    }

    override fun savePrepared(prepared: Prepared) = synchronized(LOCK) {
        val json = JSONObject().put("sessionId", prepared.sessionId).put("stateVersion", prepared.stateVersion).put("ready", prepared.ready)
            .put("deviceId", prepared.deviceId ?: JSONObject.NULL)
            .put("groupRunId", prepared.groupRunId ?: JSONObject.NULL)
            .put("clockOffsetMs", prepared.clockOffsetMs ?: JSONObject.NULL)
        check(prefs.edit().putString(KEY_PREPARED, json.toString()).commit())
    }

    override fun outcome(commandId: String): CommandOutcome? = synchronized(LOCK) { readOutcomes()[commandId] }

    override fun saveOutcome(outcome: CommandOutcome) = synchronized(LOCK) {
        writeOutcomes(readOutcomes().apply { remove(outcome.commandId); put(outcome.commandId, outcome) })
    }

    override fun saveOutcomeIfAbsent(outcome: CommandOutcome): CommandOutcome? = synchronized(LOCK) {
        val outcomes = readOutcomes()
        outcomes[outcome.commandId]?.let { return@synchronized it }
        outcomes[outcome.commandId] = outcome
        writeOutcomes(outcomes)
        null
    }

    override fun coachingUsed(coachingId: String): Boolean = synchronized(LOCK) { coachingId in readCoachings() }

    override fun markCoachingUsed(coachingId: String) = synchronized(LOCK) {
        val ids = readCoachings().apply { remove(coachingId); add(coachingId) }
        val json = org.json.JSONArray().apply { ids.toList().takeLast(MAX_COACHINGS).forEach { put(it) } }
        check(prefs.edit().putString(KEY_COACHINGS, json.toString()).commit())
    }

    private fun readCoachings(): LinkedHashSet<String> = try {
        val json = org.json.JSONArray(prefs.getString(KEY_COACHINGS, "[]")!!)
        (0 until json.length()).mapTo(linkedSetOf()) { json.getString(it) }
    } catch (_: Exception) {
        linkedSetOf()
    }

    override fun markPersisted(commandId: String, stateVersion: Long?) = synchronized(LOCK) {
        val outcomes = readOutcomes()
        val current = outcomes[commandId] ?: return@synchronized
        outcomes[commandId] = current.copy(persisted = true, stateVersion = stateVersion)
        writeOutcomes(outcomes)
    }

    override fun nextMessageId(): String = synchronized(LOCK) {
        val next = prefs.getLong(KEY_SEQ, 0L) + 1
        check(prefs.edit().putLong(KEY_SEQ, next).commit())
        "watch:$next"
    }

    private fun readOutcomes(): LinkedHashMap<String, CommandOutcome> {
        val result = linkedMapOf<String, CommandOutcome>()
        val json = try { JSONObject(prefs.getString(KEY_OUTCOMES, "{}")!!) } catch (_: Exception) { JSONObject() }
        json.keys().forEach { key ->
            try {
                val o = json.getJSONObject(key)
                result[key] = CommandOutcome(
                    sessionId = o.getString("sessionId"),
                    commandId = key,
                    action = o.getString("action"),
                    result = OutcomeResult.valueOf(o.getString("result")),
                    appliedAt = if (o.isNull("appliedAt")) null else Instant.parse(o.getString("appliedAt")),
                    reasonCode = if (o.isNull("reasonCode")) null else o.getString("reasonCode"),
                    persisted = o.getBoolean("persisted"),
                    stateVersion = if (o.isNull("stateVersion")) null else o.getLong("stateVersion"),
                    coachingId = if (!o.has("coachingId") || o.isNull("coachingId")) null else o.getString("coachingId"),
                    targetBpm = if (!o.has("targetBpm") || o.isNull("targetBpm")) null else o.getInt("targetBpm"),
                    gps = if (!o.has("gps") || o.isNull("gps")) null else o.getBoolean("gps"),
                )
            } catch (_: Exception) {
                // A damaged entry is dropped; the phone can still ask again and gets UNKNOWN only for EXECUTING.
            }
        }
        return result
    }

    private fun writeOutcomes(outcomes: Map<String, CommandOutcome>) {
        val json = JSONObject()
        outcomes.values.toList().takeLast(MAX_OUTCOMES).forEach { o ->
            json.put(o.commandId, JSONObject()
                .put("sessionId", o.sessionId)
                .put("action", o.action)
                .put("result", o.result.name)
                .put("appliedAt", o.appliedAt?.toString() ?: JSONObject.NULL)
                .put("reasonCode", o.reasonCode ?: JSONObject.NULL)
                .put("persisted", o.persisted)
                .put("stateVersion", o.stateVersion ?: JSONObject.NULL)
                .put("coachingId", o.coachingId ?: JSONObject.NULL)
                .put("targetBpm", o.targetBpm ?: JSONObject.NULL)
                .put("gps", o.gps ?: JSONObject.NULL))
        }
        check(prefs.edit().putString(KEY_OUTCOMES, json.toString()).commit())
    }

    private companion object {
        val LOCK = Any()
        const val KEY_PREPARED = "prepared"
        const val KEY_OUTCOMES = "outcomes"
        const val KEY_SEQ = "seq"
        const val KEY_COACHINGS = "used_coachings"
        const val MAX_OUTCOMES = 32
        // Coaching comes about every 2 minutes; this covers several hours of one run.
        const val MAX_COACHINGS = 256
    }
}
