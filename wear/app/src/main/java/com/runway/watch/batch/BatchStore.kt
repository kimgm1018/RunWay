package com.runway.watch.batch

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * A finished batch waiting for the server save ACK. [body] (W07 body), [id] and [messageId] never change after
 * creation; only the delivery fields do. [failed] marks a batch that hit the retry limit or a final phone error:
 * it is kept, not resent, and counts as unconfirmed. [rejected] tells the final phone error apart: such a batch is
 * never sent again, not even when the user asks again for the END result (S15P31E105-446).
 */
data class OutboxBatch(
    val id: String,
    val sessionId: String,
    val messageId: String,
    val body: String,
    val itemCount: Int,
    val received: Boolean = false,
    val attempts: Int = 0,
    val failed: Boolean = false,
    val rejected: Boolean = false,
)

/**
 * Per metric ([Reading.metrics]), the latest measuredAt of [sessionId] already put in a batch (S15P31E105-445).
 * After an app restart Health Services may hand over readings again; ones at or before these times are not batched twice.
 */
data class BatchMarks(val sessionId: String, val latest: Map<String, Instant>)

/** Watch-side outbox of batches not yet COMMITTED. Survives app restarts. */
interface BatchStore {
    fun all(): List<OutboxBatch>
    /** Adds or replaces all [batches], or none of them. */
    fun put(batches: List<OutboxBatch>)
    fun remove(id: String)
    /** The marks of the run batched last, or null. Survives app restarts like the batches. */
    fun marks(): BatchMarks?
    fun saveMarks(marks: BatchMarks)
}

class InMemoryBatchStore : BatchStore {
    private val batches = linkedMapOf<String, OutboxBatch>()
    private var marks: BatchMarks? = null
    var failNextPut = false

    @Synchronized override fun marks() = marks
    @Synchronized override fun saveMarks(marks: BatchMarks) { this.marks = marks }

    @Synchronized override fun all() = batches.values.toList()
    @Synchronized override fun put(batches: List<OutboxBatch>) {
        if (failNextPut) {
            failNextPut = false
            throw IllegalStateException("store failed")
        }
        batches.forEach { this.batches[it.id] = it }
    }
    @Synchronized override fun remove(id: String) { batches.remove(id) }
}

/** One file per batch under filesDir, written to a temp file and renamed so a crash never leaves half a batch. */
class FileBatchStore(context: Context) : BatchStore {
    private val dir = File(context.applicationContext.filesDir, "run_batches").apply { mkdirs() }

    override fun all(): List<OutboxBatch> = synchronized(LOCK) {
        dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty().sortedBy { it.lastModified() }.mapNotNull { read(it) }
    }

    override fun put(batches: List<OutboxBatch>) = synchronized(LOCK) {
        val written = mutableListOf<Pair<File, File?>>()
        try {
            for (batch in batches) {
                val target = File(dir, "${batch.id}.json")
                val backup = if (target.exists()) File(dir, "${batch.id}.bak").also { target.copyTo(it, overwrite = true) } else null
                val temp = File(dir, "${batch.id}.tmp")
                temp.writeText(encode(batch), Charsets.UTF_8)
                if (!temp.renameTo(target)) {
                    target.delete()
                    check(temp.renameTo(target)) { "rename failed" }
                }
                written += target to backup
            }
            written.forEach { it.second?.delete() }
        } catch (e: Exception) {
            // Roll back: new files go, replaced files get their previous content back.
            written.forEach { (target, backup) -> if (backup != null) backup.renameTo(target) else target.delete() }
            throw e
        }
    }

    override fun remove(id: String): Unit = synchronized(LOCK) { File(dir, "$id.json").delete() }

    // Not a .json file, so all() never reads it as a batch.
    override fun marks(): BatchMarks? = synchronized(LOCK) {
        try {
            val o = JSONObject(File(dir, MARKS_FILE).readText(Charsets.UTF_8))
            val latest = o.getJSONObject("latest")
            BatchMarks(o.getString("sessionId"), latest.keys().asSequence().associateWith { Instant.parse(latest.getString(it)) })
        } catch (_: Exception) {
            null
        }
    }

    override fun saveMarks(marks: BatchMarks) = synchronized(LOCK) {
        val latest = JSONObject().apply { marks.latest.forEach { (metric, at) -> put(metric, at.toString()) } }
        val temp = File(dir, "$MARKS_FILE.tmp")
        temp.writeText(JSONObject().put("sessionId", marks.sessionId).put("latest", latest).toString(), Charsets.UTF_8)
        val target = File(dir, MARKS_FILE)
        if (!temp.renameTo(target)) {
            target.delete()
            check(temp.renameTo(target)) { "rename failed" }
        }
    }

    private fun encode(b: OutboxBatch) = JSONObject()
        .put("id", b.id)
        .put("sessionId", b.sessionId)
        .put("messageId", b.messageId)
        .put("body", b.body)
        .put("itemCount", b.itemCount)
        .put("received", b.received)
        .put("attempts", b.attempts)
        .put("failed", b.failed)
        .put("rejected", b.rejected)
        .toString()

    // When each batch was last sent is kept in memory by the uploader: after a restart a reloaded batch is due at once.
    private fun read(file: File): OutboxBatch? = try {
        val o = JSONObject(file.readText(Charsets.UTF_8))
        OutboxBatch(
            id = o.getString("id"),
            sessionId = o.getString("sessionId"),
            messageId = o.getString("messageId"),
            body = o.getString("body"),
            itemCount = o.getInt("itemCount"),
            received = o.getBoolean("received"),
            attempts = o.getInt("attempts"),
            failed = o.getBoolean("failed"),
            // 이 필드 이전에 저장된 batch는 최종 오류 여부를 모르므로 재시도 상한 실패로 본다.
            rejected = o.optBoolean("rejected", false),
        )
    } catch (_: Exception) {
        null
    }

    private companion object {
        val LOCK = Any()
        const val MARKS_FILE = "marks.state"
    }
}
