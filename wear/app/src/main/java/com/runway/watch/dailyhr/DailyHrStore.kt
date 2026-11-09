package com.runway.watch.dailyhr

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Watch-local store for 1-minute HR buckets and estimates; shared by the passive service and the sync worker. */
class DailyHrStore(
    context: Context,
    private val zone: ZoneId = ZoneId.systemDefault(),
) : SQLiteOpenHelper(context.applicationContext, "daily_hr.db", null, 3) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(CREATE_MINUTES)
        db.execSQL("CREATE TABLE drops(reason TEXT PRIMARY KEY, count INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE transitions(epoch_ms INTEGER PRIMARY KEY, exercising INTEGER NOT NULL)")
        db.execSQL(
            "CREATE TABLE summaries(metric_date TEXT PRIMARY KEY, revision INTEGER NOT NULL, value REAL NOT NULL, " +
                "count INTEGER NOT NULL, method TEXT NOT NULL, computed_at TEXT NOT NULL, acked INTEGER NOT NULL)",
        )
        db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    }

    /**
     * v1 kept raw samples (dropped) and per-day summaries. Summaries are marked acked so they are not resent but the
     * next V2 estimate for the same date continues the revision and overwrites the phone's V1 record; prune removes
     * them later. Consent, state, counter and transitions stay.
     *
     * v3 (S15P31E105-314): the stored consent label is renamed from the old typo 'AGREEE' to 'AGREE'. Without it the
     * updated app would read a consented member as no consent and wipe unacked summaries and minutes. Only this
     * stored value is converted; messages from the phone still accept 'AGREE'/'DISAGREE' only.
     */
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        check(old in 1..2 && new == 3) { "Unsupported daily HR database version" }
        if (old == 1) {
            db.execSQL("DROP TABLE IF EXISTS samples")
            db.execSQL(CREATE_MINUTES)
            db.execSQL("UPDATE summaries SET acked=1")
        }
        db.execSQL("UPDATE meta SET value='AGREE' WHERE key='$KEY_CONSENT_ACCESS' AND value='AGREEE'")
    }

    /**
     * Adds each sample to its 1-minute bucket (sum and count). Raw writes re-check consent under the store lock,
     * so a batch racing a withdrawal's clearAll is dropped.
     */
    @Synchronized
    fun addSamples(samples: List<Pair<Long, Double>>, collectionId: String? = consent()?.collectionId) = inTransaction { db ->
        val current = consent()
        if (!canStore(current) || current?.collectionId != collectionId) return@inTransaction
        samples.forEach { (epochMs, bpm) ->
            if (current?.collectionStartedAt?.isAfter(Instant.ofEpochMilli(epochMs)) == true) return@forEach
            db.execSQL(
                "INSERT INTO minutes(minute_start_ms,bpm_sum,bpm_count) VALUES(?,?,1) ON CONFLICT(minute_start_ms) " +
                    "DO UPDATE SET bpm_sum = bpm_sum + excluded.bpm_sum, bpm_count = bpm_count + 1",
                arrayOf<Any>(Math.floorDiv(epochMs, MINUTE_MS) * MINUTE_MS, bpm),
            )
        }
    }

    @Synchronized
    fun addDrops(reason: DropReason, count: Int, collectionId: String? = consent()?.collectionId) {
        if (!canStore(consent()) || consent()?.collectionId != collectionId) return
        writableDatabase.execSQL(
            "INSERT INTO drops(reason,count) VALUES(?,?) ON CONFLICT(reason) DO UPDATE SET count = count + excluded.count",
            arrayOf<Any>(reason.name, count),
        )
    }

    @Synchronized
    fun dropCounts(): Map<DropReason, Int> = readableDatabase.rawQuery("SELECT reason,count FROM drops", null).use {
        buildMap { while (it.moveToNext()) put(DropReason.valueOf(it.getString(0)), it.getInt(1)) }
    }

    @Synchronized
    fun addTransition(t: ActivityTransition, collectionId: String? = consent()?.collectionId) {
        val current = consent()
        if (!canStore(current) || current?.collectionId != collectionId) return
        if (current?.collectionStartedAt?.isAfter(Instant.ofEpochMilli(t.epochMs)) == true) return
        writableDatabase.insertWithOnConflict(
            "transitions", null,
            ContentValues().apply { put("epoch_ms", t.epochMs); put("exercising", if (t.exercising) 1 else 0) },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    @Synchronized
    fun transitions(): List<ActivityTransition> =
        readableDatabase.rawQuery("SELECT epoch_ms,exercising FROM transitions ORDER BY epoch_ms", null).use {
            buildList { while (it.moveToNext()) add(ActivityTransition(it.getLong(0), it.getInt(1) == 1)) }
        }

    /** Minute start and mean bpm of every bucket starting in [fromMs, toMsExclusive). */
    @Synchronized
    fun minuteMeansBetween(fromMs: Long, toMsExclusive: Long): List<Pair<Long, Double>> = readableDatabase.rawQuery(
        "SELECT minute_start_ms, bpm_sum / bpm_count FROM minutes " +
            "WHERE minute_start_ms >= ? AND minute_start_ms < ? ORDER BY minute_start_ms",
        arrayOf(fromMs.toString(), toMsExclusive.toString()),
    ).use { buildList { while (it.moveToNext()) add(it.getLong(0) to it.getDouble(1)) } }

    /** Same value and count keeps the revision (and ack); anything else bumps it and needs a new ack. */
    @Synchronized
    fun saveEstimate(date: LocalDate, value: Double, count: Int, computedAt: Instant): DailyHrSummary {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val existing = db.rawQuery(
                "SELECT revision,value,count FROM summaries WHERE metric_date=?", arrayOf(date.toString()),
            ).use { if (it.moveToFirst()) Triple(it.getInt(0), it.getDouble(1), it.getInt(2)) else null }
            val revision = when {
                existing == null -> 1
                existing.second == value && existing.third == count -> existing.first
                else -> existing.first + 1
            }
            if (existing == null || revision != existing.first) {
                db.insertWithOnConflict(
                    "summaries", null,
                    ContentValues().apply {
                        put("metric_date", date.toString()); put("revision", revision); put("value", value)
                        put("count", count); put("method", METHOD); put("computed_at", computedAt.toString())
                        put("acked", 0)
                    },
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
            val saved = db.rawQuery(
                "SELECT $SUMMARY_COLUMNS FROM summaries WHERE metric_date=?", arrayOf(date.toString()),
            ).use { it.moveToFirst(); readSummary(it) }
            db.setTransactionSuccessful()
            return saved
        } finally {
            db.endTransaction()
        }
    }

    private fun readSummary(c: Cursor) = DailyHrSummary(
        metricDate = LocalDate.parse(c.getString(0)),
        revision = c.getInt(1),
        estimatedRestingHrBpm = c.getDouble(2),
        method = c.getString(4),
        validSampleCount = c.getInt(3),
        computedAt = Instant.parse(c.getString(5)),
        // Epoch changes clear summaries in the same transaction; snapshot it while holding the store lock.
        collectionId = getMeta(readableDatabase, KEY_COLLECTION_ID),
    )

    @Synchronized
    fun pending(): List<DailyHrSummary> = readableDatabase.rawQuery(
        "SELECT $SUMMARY_COLUMNS FROM summaries WHERE acked=0 ORDER BY metric_date", null,
    ).use { buildList { while (it.moveToNext()) add(readSummary(it)) } }

    /** Checks collection and exact revision under one lock, so an old ACK cannot acknowledge a new account. */
    @Synchronized
    fun markAcked(date: LocalDate, revision: Int, collectionId: String? = null) {
        if (consent()?.collectionId != collectionId) return
        writableDatabase.execSQL(
            "UPDATE summaries SET acked=1 WHERE metric_date=? AND revision=?",
            arrayOf<Any>(date.toString(), revision),
        )
    }

    @Synchronized
    fun nextMessageId(): String {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val next = (getMeta(db, KEY_MESSAGE_COUNTER)?.toLongOrNull() ?: 0L) + 1
            setMeta(db, KEY_MESSAGE_COUNTER, next.toString())
            db.setTransactionSuccessful()
            return "watch:$next"
        } finally {
            db.endTransaction()
        }
    }

    /**
     * Deletes minutes and transitions older than [RETENTION_MS] before [now] (keeping the latest transition before
     * the cutoff so an exercise interval spanning it stays intact) and acked summaries dated before today - 2 days.
     * Unacked summaries are never deleted.
     */
    @Synchronized
    fun prune(now: Instant) = inTransaction { db ->
        val cutoff = (now.toEpochMilli() - RETENTION_MS).toString()
        db.delete("minutes", "minute_start_ms < ?", arrayOf(cutoff))
        db.delete(
            "transitions",
            "epoch_ms < ? AND epoch_ms < (SELECT MAX(epoch_ms) FROM transitions WHERE epoch_ms < ?)",
            arrayOf(cutoff, cutoff),
        )
        val oldestKept = localDate(now.toEpochMilli(), zone).minusDays(SUMMARY_KEEP_DAYS)
        db.delete("summaries", "acked=1 AND metric_date < ?", arrayOf(oldestKept.toString()))
    }

    /** Wipes collected data; consent, collection state and the message counter survive. */
    @Synchronized
    fun clearAll() = inTransaction { db ->
        listOf("minutes", "drops", "transitions", "summaries").forEach { db.delete(it, null, null) }
    }

    @Synchronized
    fun saveConsent(c: HealthConsent) = inTransaction { db ->
        val current = consent()
        if (newerConsent(current, c) != c) return@inTransaction
        if (current?.collectionId != c.collectionId) {
            listOf("minutes", "drops", "transitions", "summaries").forEach { db.delete(it, null, null) }
        }
        setMeta(db, KEY_CONSENT_ACCESS, if (c.agreed) "AGREE" else "DISAGREE")
        setMeta(db, KEY_CONSENT_UPDATED_AT, c.updatedAt.toString())
        setMetaOrRemove(db, KEY_COLLECTION_ID, c.collectionId)
        setMetaOrRemove(db, KEY_COLLECTION_STARTED_AT, c.collectionStartedAt?.toString())
    }

    @Synchronized
    fun consent(): HealthConsent? {
        val db = readableDatabase
        return HealthConsent.fromDataMap(
            getMeta(db, KEY_CONSENT_ACCESS), getMeta(db, KEY_CONSENT_UPDATED_AT),
            getMeta(db, KEY_COLLECTION_ID), getMeta(db, KEY_COLLECTION_STARTED_AT),
        )
    }

    @Synchronized
    fun saveState(s: CollectionState) = inTransaction { db -> setMeta(db, KEY_STATE, s.name) }

    @Synchronized
    fun state(): CollectionState =
        getMeta(readableDatabase, KEY_STATE)?.let { name -> CollectionState.values().firstOrNull { it.name == name } }
            ?: CollectionState.OFF_NO_CONSENT

    private fun getMeta(db: SQLiteDatabase, key: String): String? =
        db.rawQuery("SELECT value FROM meta WHERE key=?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0) else null }

    private fun setMetaOrRemove(db: SQLiteDatabase, key: String, value: String?) {
        if (value == null) db.delete("meta", "key=?", arrayOf(key)) else setMeta(db, key, value)
    }

    private fun setMeta(db: SQLiteDatabase, key: String, value: String) {
        db.insertWithOnConflict(
            "meta", null,
            ContentValues().apply { put("key", key); put("value", value) },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    private inline fun inTransaction(block: (SQLiteDatabase) -> Unit) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            block(db)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    companion object {
        private const val KEY_MESSAGE_COUNTER = "message_counter"
        private const val KEY_COLLECTION_ID = "collection_id"
        private const val KEY_COLLECTION_STARTED_AT = "collection_started_at"
        private const val KEY_CONSENT_ACCESS = "consent_access"
        private const val KEY_CONSENT_UPDATED_AT = "consent_updated_at"
        private const val KEY_STATE = "collection_state"
        private const val SUMMARY_COLUMNS = "metric_date,revision,value,count,method,computed_at"
        private const val CREATE_MINUTES =
            "CREATE TABLE minutes(minute_start_ms INTEGER PRIMARY KEY, bpm_sum REAL NOT NULL, bpm_count INTEGER NOT NULL)"
        private const val RETENTION_MS = 48 * 3_600_000L
        private const val SUMMARY_KEEP_DAYS = 2L

        @Volatile private var instance: DailyHrStore? = null

        /** One process-wide store so the service, workers and listener share one connection and lock. */
        fun get(context: Context): DailyHrStore = instance ?: synchronized(this) {
            instance ?: DailyHrStore(context.applicationContext).also { instance = it }
        }
    }
}
