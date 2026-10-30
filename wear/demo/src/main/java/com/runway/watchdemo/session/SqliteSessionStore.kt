package com.runway.watchdemo.session

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.io.File

class SqliteSessionStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "experiments.db", null, 1), SessionStore {
    private val exportDir = File(context.filesDir, "exports")
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sessions(id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        db.execSQL("CREATE TABLE events(session_id TEXT NOT NULL, kind TEXT NOT NULL, event_key TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session_id,kind,event_key))")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = error("지원하지 않는 기록 형식입니다")
    @Synchronized override fun create(record: SessionRecord) {
        writableDatabase.insertOrThrow("sessions", null, ContentValues().apply {
            put("id", record.id); put("body", SessionJson.encode(record.copy(events = emptyList(), samples = emptyList())))
        })
    }
    private fun metadata(id: String): SessionRecord = readableDatabase.rawQuery("SELECT body FROM sessions WHERE id=?", arrayOf(id)).use {
        check(it.moveToFirst()) { "기록을 찾을 수 없습니다" }; SessionJson.decode(it.getString(0))
    }
    @Synchronized override fun load(id: String): SessionRecord {
        val meta = metadata(id)
        val samples = mutableListOf<MetricSample>(); val events = mutableListOf<BpmEvent>()
        readableDatabase.rawQuery("SELECT kind,body FROM events WHERE session_id=? ORDER BY rowid", arrayOf(id)).use {
            while (it.moveToNext()) {
                if (it.getString(0) == "sample") samples.add(SessionJson.sample(JSONObject(it.getString(1))))
                else events.add(SessionJson.event(JSONObject(it.getString(1))))
            }
        }
        return meta.copy(samples = samples.sortedBy { it.endElapsedMs }, events = events.sortedBy { it.appliedElapsedMs })
    }
    @Synchronized override fun list(): List<SessionRecord> = readableDatabase.rawQuery("SELECT body FROM sessions ORDER BY rowid DESC", null).use {
        buildList { while (it.moveToNext()) add(SessionJson.decode(it.getString(0))) }
    }
    private fun update(record: SessionRecord) {
        check(writableDatabase.update("sessions", ContentValues().apply { put("body", SessionJson.encode(record)) }, "id=?", arrayOf(record.id)) == 1)
    }
    @Synchronized override fun appendSamples(id: String, samples: List<MetricSample>) {
        check(!metadata(id).isFinal)
        val db = writableDatabase; db.beginTransaction()
        try {
            samples.forEach { s -> db.insertWithOnConflict("events", null, ContentValues().apply {
                put("session_id", id); put("kind", "sample"); put("event_key", "${s.kind}:${s.startElapsedMs}:${s.endElapsedMs}:${s.source}")
                put("body", SessionJson.sample(s).toString())
            }, SQLiteDatabase.CONFLICT_IGNORE) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    @Synchronized override fun appendBpmEvent(id: String, event: BpmEvent) {
        check(!metadata(id).isFinal)
        writableDatabase.insertOrThrow("events", null, ContentValues().apply {
            put("session_id", id); put("kind", "bpm"); put("event_key", "${event.appliedElapsedMs}:${event.requestedElapsedMs}")
            put("body", SessionJson.event(event).toString())
        })
    }
    @Synchronized override fun setState(id: String, state: SessionState) = update(metadata(id).copy(state = state))
    @Synchronized override fun setCapabilities(id: String, values: Map<String, String>) = update(metadata(id).copy(capabilities = values))
    @Synchronized override fun finish(id: String, state: SessionState, endedElapsedMs: Long, endReason: String) =
        update(metadata(id).copy(state = state, endedElapsedMs = endedElapsedMs, endReason = endReason))
    @Synchronized override fun setUploadState(id: String, state: UploadState) = update(metadata(id).copy(uploadState = state))
    @Synchronized override fun claimUpload(id: String): SessionRecord? {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val s = metadata(id)
            if (!s.isFinal || s.uploadState !in setOf(UploadState.PENDING, UploadState.FAILED)) return null
            setUploadState(id, UploadState.UPLOADING)
            val payload = load(id)
            // Claim and payload loading succeed together, or the pending state is restored.
            db.setTransactionSuccessful()
            return payload
        } finally { db.endTransaction() }
    }
    @Synchronized override fun recoverInterrupted() {
        list().forEach { s ->
            var next = s
            if (!s.isFinal) {
                val full = load(s.id)
                val last = maxOf(s.startedElapsedMs, full.samples.maxOfOrNull { it.endElapsedMs } ?: s.startedElapsedMs,
                    full.events.maxOfOrNull { it.appliedElapsedMs } ?: s.startedElapsedMs)
                next = next.copy(state = SessionState.INTERRUPTED, endedElapsedMs = last, endReason = "process_interrupted_end_time_is_last_record")
            }
            if (next.uploadState == UploadState.UPLOADING) next = next.copy(uploadState = UploadState.FAILED)
            if (next != s) update(next)
        }
    }
    @Synchronized fun export(id: String): File {
        exportDir.mkdirs()
        val target = File(exportDir, "$id.json")
        val temp = File.createTempFile("export-", ".tmp", exportDir)
        try {
            temp.outputStream().use { stream -> stream.write(SessionJson.encode(load(id)).toByteArray(Charsets.UTF_8)); stream.fd.sync() }
            check(temp.renameTo(target)) { "기록 파일을 저장하지 못했습니다" }
            return target
        } finally { temp.delete() }
    }
}
