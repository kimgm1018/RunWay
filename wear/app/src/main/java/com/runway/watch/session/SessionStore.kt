package com.runway.watch.session

import android.content.Context
import org.json.JSONObject
import java.time.Instant

/**
 * The session and version the phone asked the watch to prepare (SESSION_PREPARE). [deviceId] is this watch's
 * user_devices.id from the same message; batches carry it as their producer (S15P31E105-311).
 */
data class Prepared(val sessionId: String, val stateVersion: Long, val ready: Boolean, val deviceId: String? = null)

/** EXECUTING is written before the exercise call so a crash mid-call is never re-executed (9.4). */
enum class OutcomeResult { EXECUTING, APPLIED, REJECTED, UNKNOWN }

data class CommandOutcome(
    val sessionId: String,
    val commandId: String,
    val action: String,
    val result: OutcomeResult,
    val appliedAt: Instant?,
    val reasonCode: String?,
    val persisted: Boolean,
    val stateVersion: Long?,
)

/** Watch-side record of prepared sessions and per-command results. Survives app restarts. */
interface SessionStore {
    fun prepared(): Prepared?
    fun savePrepared(prepared: Prepared)
    fun outcome(commandId: String): CommandOutcome?
    fun saveOutcome(outcome: CommandOutcome)
    fun markPersisted(commandId: String, stateVersion: Long?)
    fun nextMessageId(): String
}

class InMemorySessionStore : SessionStore {
    private var prepared: Prepared? = null
    private val outcomes = linkedMapOf<String, CommandOutcome>()
    private var seq = 0L

    @Synchronized override fun prepared() = prepared
    @Synchronized override fun savePrepared(prepared: Prepared) { this.prepared = prepared }
    @Synchronized override fun outcome(commandId: String) = outcomes[commandId]
    @Synchronized override fun saveOutcome(outcome: CommandOutcome) { outcomes[outcome.commandId] = outcome }
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
                )
            }
        } catch (_: Exception) {
            null
        }
    }

    override fun savePrepared(prepared: Prepared) = synchronized(LOCK) {
        val json = JSONObject().put("sessionId", prepared.sessionId).put("stateVersion", prepared.stateVersion).put("ready", prepared.ready)
            .put("deviceId", prepared.deviceId ?: JSONObject.NULL)
        check(prefs.edit().putString(KEY_PREPARED, json.toString()).commit())
    }

    override fun outcome(commandId: String): CommandOutcome? = synchronized(LOCK) { readOutcomes()[commandId] }

    override fun saveOutcome(outcome: CommandOutcome) = synchronized(LOCK) {
        writeOutcomes(readOutcomes().apply { remove(outcome.commandId); put(outcome.commandId, outcome) })
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
                .put("stateVersion", o.stateVersion ?: JSONObject.NULL))
        }
        check(prefs.edit().putString(KEY_OUTCOMES, json.toString()).commit())
    }

    private companion object {
        val LOCK = Any()
        const val KEY_PREPARED = "prepared"
        const val KEY_OUTCOMES = "outcomes"
        const val KEY_SEQ = "seq"
        const val MAX_OUTCOMES = 32
    }
}
