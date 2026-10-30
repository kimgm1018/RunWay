package com.runway.watch.dailyhr

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.tasks.Task
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.random.Random
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine

private const val MAX_ATTEMPTS = 3
private const val ACK_TIMEOUT_MS = 10_000L
private const val MAX_JITTER_MS = 500L
private const val ACK_POLL_MS = 500L
private val RETRY_DELAYS_MS = longArrayOf(1_000L, 2_000L)
private const val WINDOW_MS = 24 * 3_600_000L

/**
 * Estimates over the minutes starting in the last 24 hours before [now] that do not touch an exercise interval and
 * saves it under the local date of [now]; a later run on the same date overwrites it (new revision if changed).
 * Returns the saved summary, or null when fewer than [MIN_MINUTES] minutes remain.
 */
fun computeCurrent(store: DailyHrStore, zone: ZoneId, now: Instant): DailyHrSummary? {
    val nowMs = now.toEpochMilli()
    val exercise = exerciseIntervals(store.transitions(), untilMs = nowMs)
    val means = store.minuteMeansBetween(nowMs - WINDOW_MS, nowMs)
        .filterNot { (minuteStart, _) -> overlapsExercise(minuteStart, exercise) }
        .map { it.second }
    return estimateWindow(means)?.let { store.saveEstimate(localDate(nowMs, zone), it, means.size, now) }
}

/** Sends one encoded message; true when at least one connected node accepted it. */
interface SummarySender {
    suspend fun send(bytes: ByteArray): Boolean
}

/** Sends DAILY_HR_SUMMARY to every connected node over MessageClient. */
class MessageClientSender(context: Context) : SummarySender {
    private val context = context.applicationContext

    override suspend fun send(bytes: ByteArray): Boolean = try {
        val nodes = Wearable.getNodeClient(context).connectedNodes.await()
        val messages = Wearable.getMessageClient(context)
        nodes.count { node ->
            try {
                messages.sendMessage(node.id, DailyHrMessages.SUMMARY_PATH, bytes).await()
                true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(DAILY_HR_TAG, "summary send failed: ${e.javaClass.simpleName}")
                false
            }
        } > 0
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(DAILY_HR_TAG, "node lookup failed: ${e.javaClass.simpleName}")
        false
    }
}

/**
 * Sends each pending summary up to [MAX_ATTEMPTS] times with one messageId, waiting for the ack after each send.
 * A summary that is never acknowledged stays pending, and the rest of the run is skipped so an unreachable phone
 * cannot stretch the work past its limit. Stops as soon as consent is withdrawn.
 */
suspend fun deliverPending(
    store: DailyHrStore,
    sender: SummarySender,
    awaitAck: suspend (LocalDate, Int, Long) -> Boolean,
    sleep: suspend (Long) -> Unit = { delay(it) },
    jitter: () -> Long = { Random.nextLong(0, MAX_JITTER_MS + 1) },
) {
    for (summary in store.pending()) {
        if (!canStore(store.consent())) return
        val bytes = DailyHrMessages.encodeSummary(store.nextMessageId(), summary)
        var acked = false
        for (attempt in 0 until MAX_ATTEMPTS) {
            if (attempt > 0) sleep(RETRY_DELAYS_MS[attempt - 1] + jitter())
            if (!canStore(store.consent())) return
            // A send with no reachable node still uses up an attempt; there is nothing to wait for.
            if (sender.send(bytes) && awaitAck(summary.metricDate, summary.revision, ACK_TIMEOUT_MS)) {
                acked = true
                break
            }
        }
        if (!acked) return
    }
}

/** Polls the store, which the listener service updates on DAILY_HR_RECEIVED, until the revision is no longer pending. */
suspend fun awaitAckInStore(store: DailyHrStore, date: LocalDate, revision: Int, timeoutMs: Long): Boolean {
    var waited = 0L
    while (true) {
        if (store.pending().none { it.metricDate == date && it.revision == revision }) return true
        if (waited >= timeoutMs) return false
        delay(ACK_POLL_MS)
        waited += ACK_POLL_MS
    }
}

/**
 * Applies the consent DataItem the phone already published (e.g. before this app was installed).
 * Any failure keeps the stored consent.
 */
@SuppressLint("VisibleForTests") // play-services-wearable 18.0.0 DataMap accessors; lint false positive.
suspend fun refreshConsentFromDataLayer(context: Context, store: DailyHrStore) {
    try {
        val uri = Uri.Builder().scheme("wear").path(DailyHrMessages.CONSENT_PATH).authority("*").build()
        val items = Wearable.getDataClient(context).getDataItems(uri).await()
        try {
            items.forEach { item ->
                val map = DataMapItem.fromDataItem(item).dataMap
                val incoming = HealthConsent.fromDataMap(map.getString("healthDataAccess"), map.getString("updatedAt"))
                    ?: return@forEach
                val current = store.consent()
                val next = newerConsent(current, incoming)
                if (next != current) store.saveConsent(next)
            }
        } finally {
            items.release()
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(DAILY_HR_TAG, "consent read failed: ${e.javaClass.simpleName}")
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnCompleteListener { task ->
        val error = task.exception
        when {
            error != null -> cont.resumeWithException(error)
            task.isCanceled -> cont.cancel()
            else -> cont.resume(task.result)
        }
    }
}
