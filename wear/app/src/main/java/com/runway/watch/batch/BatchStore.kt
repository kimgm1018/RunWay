package com.runway.watch.batch

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * A finished batch waiting for the server save ACK. [body] (W07 body), [id] and [messageId] never change after
 * creation; only the delivery fields do. [failed] marks a batch that hit the retry limit or a final phone error:
 * it is kept, not resent, and counts as unconfirmed.
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
)

/** Watch-side outbox of batches not yet COMMITTED. Survives app restarts. */
interface BatchStore {
    fun all(): List<OutboxBatch>
    /** Adds or replaces all [batches], or none of them. */
    fun put(batches: List<OutboxBatch>)
    fun remove(id: String)
}

class InMemoryBatchStore : BatchStore {
    private val batches = linkedMapOf<String, OutboxBatch>()
    var failNextPut = false

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

    private fun encode(b: OutboxBatch) = JSONObject()
        .put("id", b.id)
        .put("sessionId", b.sessionId)
        .put("messageId", b.messageId)
        .put("body", b.body)
        .put("itemCount", b.itemCount)
        .put("received", b.received)
        .put("attempts", b.attempts)
        .put("failed", b.failed)
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
        )
    } catch (_: Exception) {
        null
    }

    private companion object {
        val LOCK = Any()
    }
}
