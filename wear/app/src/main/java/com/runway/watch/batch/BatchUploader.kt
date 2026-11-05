package com.runway.watch.batch

import com.runway.watch.session.SessionSender
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

const val BATCH_PATH = "/runway/v1/data/batch"
const val BATCH_RECEIVED_PATH = "/runway/v1/data/batch-received"
const val BATCH_COMMITTED_PATH = "/runway/v1/data/batch-committed"
const val DATA_PATH_PREFIX = "/runway/v1/data/"

/**
 * [pending]: batches of the current run without the server save ACK (STATE_RESULT.pendingBatchCount).
 * [unconfirmed]: the retry limit, a final phone error or the 64-batch cap was hit; new readings are no longer
 * collected and the run shows 저장 미확인 (6장). Ending the run stays possible.
 */
data class UploadState(val pending: Int = 0, val unconfirmed: Boolean = false)

/** What the session controller needs from the uploader; [NoUploads] keeps the controller usable without one. */
interface RunUploads {
    /** A START was applied: readings from now on belong to [sessionId] and are produced by [deviceId]. */
    suspend fun begin(sessionId: String, deviceId: String)
    /** An END was applied: send what is left at once and wait for the server save ACKs. Returns what stays unconfirmed. */
    suspend fun finish(sessionId: String): Int
    suspend fun pendingCount(sessionId: String): Int
    /**
     * The phone asked again for an ended run's result (S15P31E105-446): batches of [sessionId] that hit the retry limit
     * are sent once more with the same id and body, again at most [BatchUploader] maxAttempts tries. Batches stopped by
     * a final phone error (400/401/403/409 content or permission errors) are not sent again.
     */
    suspend fun retryFailed(sessionId: String)
}

object NoUploads : RunUploads {
    override suspend fun begin(sessionId: String, deviceId: String) = Unit
    override suspend fun finish(sessionId: String) = 0
    override suspend fun pendingCount(sessionId: String) = 0
    override suspend fun retryFailed(sessionId: String) = Unit
}

/**
 * Turns readings into W07 batches and delivers them to the phone (S15P31E105-311, watch-mobile-server-integration.md
 * 6장·9.5). New readings wait at most [flushMs]; a reading leaves the buffer in the same step that writes its batch,
 * so it is in exactly one batch. Each batch is resent with the same id and body until BATCH_COMMITTED: per attempt
 * [ackWaitMs] for BATCH_RECEIVED, then [commitWaitMs] for BATCH_COMMITTED, at most [maxAttempts] tries in all with
 * 1 s / 2 s + jitter between them. BATCH_RECEIVED alone never releases a batch.
 */
class BatchUploader(
    private val store: BatchStore,
    private val sender: SessionSender,
    private val nextMessageId: () -> String,
    private val clock: () -> Long,
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val sleep: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
    private val jitter: () -> Long = { kotlin.random.Random.nextLong(0, 501) },
    private val flushMs: Long = 5_000,
    private val ackWaitMs: Long = 10_000,
    // The phone tries W07 up to 3 times with a 10 s wait each (devices-health.md W07 오류와 재시도).
    private val commitWaitMs: Long = 40_000,
    private val maxAttempts: Int = 3,
    private val maxPending: Int = 64,
    private val finishTimeoutMs: Long = 90_000,
    private val tickMs: Long = 1_000,
) : RunUploads {
    private val mutex = Mutex()
    private val buffer = mutableListOf<Reading>()
    private var bufferSinceMs: Long? = null
    private var sessionId: String? = null
    private var deviceId: String? = null
    private var accepting = false
    private var unconfirmed = false
    /** Collection stopped by the 64-batch cap or an unsplittable reading; a retry of failed batches keeps it unconfirmed. */
    private var capped = false
    private val backoff = mutableMapOf<String, Long>()
    // Last send (or BATCH_RECEIVED) time per batch, on [clock]. Not stored: after a restart every open batch is due.
    private val sentAt = mutableMapOf<String, Long>()
    /**
     * Marks stored before this process took the run over (S15P31E105-445). Fixed for the process: readings of a metric
     * at or before its mark were batched before the restart and are dropped if Health Services hands them over again.
     */
    private var floor: Map<String, java.time.Instant> = emptyMap()

    private val _state = MutableStateFlow(UploadState())
    val state: StateFlow<UploadState> = _state

    /** Readings from the exercise listener. Ignored outside a run or once collection stopped. */
    suspend fun offer(readings: List<Reading>) = mutex.withLock {
        if (!accepting || unconfirmed) return@withLock
        val valid = readings.filter { r -> r.metrics.any { floor[it]?.isBefore(r.measuredAt) ?: true } }
        if (valid.isEmpty()) return@withLock
        if (buffer.isEmpty()) bufferSinceMs = clock()
        buffer += valid
    }

    override suspend fun begin(sessionId: String, deviceId: String) = mutex.withLock {
        if (this.sessionId != sessionId) {
            // 이전 운동은 이미 종료 결과(저장 미확인 포함)를 보고했다. 남은 batch가 새 운동의 64개 상한을 막지 않게 정리한다.
            store.all().filter { it.sessionId != sessionId }.forEach { store.remove(it.id) }
            buffer.clear()
            bufferSinceMs = null
            unconfirmed = store.all().any { it.failed }
            capped = false
            // 같은 운동을 재시작 후 이어 받으면 재시작 전에 batch로 만든 원본을 다시 넣지 않는다(S15P31E105-445).
            floor = store.marks()?.takeIf { it.sessionId == sessionId }?.latest.orEmpty()
        }
        this.sessionId = sessionId
        this.deviceId = deviceId
        accepting = true
        publish()
    }

    override suspend fun finish(sessionId: String): Int {
        mutex.withLock {
            if (this.sessionId != sessionId) return@withLock
            accepting = false
            makeBatches()
        }
        val deadline = clock() + finishTimeoutMs
        while (true) {
            tick()
            val open = mutex.withLock { store.all().filter { it.sessionId == sessionId } }
            if (open.none { !it.failed } || clock() >= deadline) return open.size
            sleep(tickMs)
        }
    }

    override suspend fun pendingCount(sessionId: String): Int = mutex.withLock {
        store.all().count { it.sessionId == sessionId }
    }

    override suspend fun retryFailed(sessionId: String) = mutex.withLock {
        val failed = store.all().filter { it.sessionId == sessionId && it.failed && !it.rejected }
        if (failed.isEmpty()) return@withLock
        store.put(failed.map { it.copy(attempts = 0, received = false, failed = false) })
        failed.forEach { sentAt.remove(it.id); backoff.remove(it.id) }
        unconfirmed = capped || store.all().any { it.failed }
        publish()
    }

    /** Called every second while the process runs: closes a due batch and resends what timed out. */
    suspend fun tick() {
        val due = mutex.withLock {
            val since = bufferSinceMs
            if (since != null && clock() - since >= flushMs) makeBatches()
            val now = clock()
            val result = mutableListOf<OutboxBatch>()
            for (batch in store.all()) {
                if (batch.failed) continue
                val last = sentAt[batch.id]
                val wait = (if (batch.received) commitWaitMs else ackWaitMs) + (backoff[batch.id] ?: 0)
                if (last != null && now - last < wait) continue
                if (batch.attempts >= maxAttempts) {
                    fail(batch)
                    continue
                }
                val next = batch.copy(attempts = batch.attempts + 1, received = false)
                store.put(listOf(next))
                sentAt[batch.id] = now
                backoff[batch.id] = if (next.attempts == 1) 1_000 + jitter() else 2_000 + jitter()
                result += next
            }
            publish()
            result
        }
        // 전송은 잠금 밖에서 한다. 실패해도 다음 시도 시각에 같은 ID·본문으로 다시 보낸다.
        for (batch in due) sender.send(BATCH_PATH, BatchFormat.envelope(batch.messageId, batch.sessionId, batch.body))
    }

    /** Runs [tick] forever; started once per process. */
    suspend fun run() {
        while (true) {
            try { tick() } catch (_: Exception) { /* storage error: the next tick tries again */ }
            sleep(tickMs)
        }
    }

    suspend fun onReceived(batchId: String) = mutex.withLock {
        val batch = store.all().firstOrNull { it.id == batchId && !it.failed } ?: return@withLock
        if (!batch.received) {
            store.put(listOf(batch.copy(received = true)))
            sentAt[batchId] = clock()
        }
    }

    /** The server save ACK. A repeated ACK for a released batch is ignored (MC-11). */
    suspend fun onCommitted(batchId: String, acceptedCount: Int) = mutex.withLock {
        val batch = store.all().firstOrNull { it.id == batchId } ?: return@withLock
        if (acceptedCount != batch.itemCount) return@withLock
        store.remove(batchId)
        backoff.remove(batchId)
        sentAt.remove(batchId)
        publish()
    }

    /** ERROR from the phone about a batch (replyTo = its messageId). Final errors stop the retries for it. */
    suspend fun onError(replyTo: String, retryable: Boolean) = mutex.withLock {
        if (retryable) return@withLock
        store.all().firstOrNull { it.messageId == replyTo && !it.failed }?.let { fail(it, rejected = true) }
        publish()
    }

    private fun fail(batch: OutboxBatch, rejected: Boolean = false) {
        store.put(listOf(batch.copy(failed = true, rejected = rejected)))
        unconfirmed = true
    }

    private fun makeBatches() {
        val sessionId = sessionId ?: return
        val deviceId = deviceId ?: return
        if (buffer.isEmpty()) return
        val items = BatchFormat.items(buffer)
        if (items.isEmpty()) {
            buffer.clear()
            bufferSinceMs = null
            return
        }
        val open = store.all().count { it.sessionId == sessionId }
        val groups = try {
            BatchFormat.split(items) { part -> BatchFormat.envelope("x".repeat(200), sessionId, BatchFormat.body(SAMPLE_ID, deviceId, sessionId, part)).size }
        } catch (_: IllegalStateException) {
            capped = true
            unconfirmed = true
            publish()
            return
        }
        if (open + groups.size > maxPending) {
            // 64개 상한: 미확인 batch를 버리지 않고 새 수집을 멈춘다.
            capped = true
            unconfirmed = true
            publish()
            return
        }
        val batches = groups.map { part ->
            val id = newId()
            OutboxBatch(id, sessionId, nextMessageId(), BatchFormat.body(id, deviceId, sessionId, part), part.size)
        }
        // 기준 시각을 batch보다 먼저 저장한다. 그 사이에 종료되면 원본이 빠질 수는 있어도 두 batch에 들어가지는 않는다.
        store.saveMarks(nextMarks(sessionId))
        store.put(batches)
        buffer.clear()
        bufferSinceMs = null
        publish()
    }

    /** The stored marks of [sessionId] moved up to the readings now in the buffer. */
    private fun nextMarks(sessionId: String): BatchMarks {
        val latest = store.marks()?.takeIf { it.sessionId == sessionId }?.latest.orEmpty().toMutableMap()
        for (reading in buffer) {
            for (metric in reading.metrics) {
                if (latest[metric]?.isBefore(reading.measuredAt) != false) latest[metric] = reading.measuredAt
            }
        }
        return BatchMarks(sessionId, latest)
    }

    private fun publish() {
        val sessionId = sessionId
        _state.value = UploadState(
            pending = if (sessionId == null) 0 else store.all().count { it.sessionId == sessionId },
            unconfirmed = unconfirmed,
        )
    }

    private companion object {
        // Same length as a real UUID, so the size check matches the real envelope.
        const val SAMPLE_ID = "00000000-0000-4000-8000-000000000000"
    }
}
