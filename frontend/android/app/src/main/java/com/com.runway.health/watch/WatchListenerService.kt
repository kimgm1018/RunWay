package com.runway.health.watch

import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.util.concurrent.TimeUnit

/** Stores DAILY_HR_SUMMARY only with consent, then acks it. Never log record values or exception messages. */
class WatchListenerService : WearableListenerService() {
  private val prefs by lazy { DailyHrPrefs(this) }
  private val sessionInbox by lazy { WatchSessionInbox(this) }
  private val batches by lazy { WatchBatchStore(this) }

  override fun onMessageReceived(event: MessageEvent) {
    if (event.path == BATCH_PATH) {
      onBatch(event)
      return
    }
    if (isSessionInboxPath(event.path)) {
      onSessionMessage(event)
      return
    }
    if (event.path != SUMMARY_PATH) return
    try {
      val summary = parseSummary(event.data) ?: return
      // Persist before acking; equal or lower revisions keep the stored value but are acked the same way.
      // Without AGREE consent nothing is stored and nothing is acked.
      prefs.upsertIfConsented(summary.record) ?: return
      val reply = receivedReply(prefs.nextMessageId(), summary.messageId, summary.record.metricDate, summary.record.revision, summary.record.collectionId)
      Tasks.await(Wearable.getMessageClient(this).sendMessage(event.sourceNodeId, RECEIVED_PATH, reply), 10, TimeUnit.SECONDS)
    } catch (_: Exception) {
      // The watch retries an unacked summary later.
    }
  }

  /**
   * Run-session message (S15P31E105-256): store first so a stopped JS still gets it, reply COMMAND_RECEIVED(persisted=false)
   * to a COMMAND_RESULT or COACHING_RESULT (S15P31E105-257), then hand it to JS if attached. JS reports to the server and sends persisted=true.
   */
  private fun onSessionMessage(event: MessageEvent) {
    try {
      val message = sessionInbox.add(event.data) ?: return
      // JS first: a failed receipt below must not keep the result from reaching the server report.
      WatchSessionModule.emitter?.invoke(toJsEvent(message))
      if (needsLocalReceipt(message.type)) {
        val receipt = localReceipt(message, sessionInbox.nextMessageId(), null)
        Tasks.await(Wearable.getMessageClient(this).sendMessage(event.sourceNodeId, COMMAND_RECEIVED_PATH, receipt), 10, TimeUnit.SECONDS)
      }
    } catch (_: Exception) {
      // Stored messages stay in the inbox; the watch resends unconfirmed results.
    }
  }

  /**
   * BATCH_DATA (S15P31E105-311): store the body unchanged, answer BATCH_RECEIVED, then hand it to JS for W07.
   * A resend of a saved batch gets BATCH_COMMITTED again, of a refused one the same ERROR; nothing is uploaded twice
   * from here once it is COMMITTED.
   */
  private fun onBatch(event: MessageEvent) {
    try {
      val incoming = decodeBatchMessage(event.data) ?: return
      val batch = when (val arrival = batches.arrive(incoming)) {
        is BatchArrival.Stored -> arrival.batch
        is BatchArrival.Known -> arrival.batch
        // 같은 ID에 다른 내용이면 저장하지 않고, 64개 상한이면 받지 않는다. 워치는 ACK가 없으므로 저장 미확인으로 남긴다.
        // 폰 인계 중·인계 후(S15P31E105-464)에는 새 batch를 받지도 수신 확인하지도 않는다.
        BatchArrival.Conflict, BatchArrival.Full, BatchArrival.Blocked -> return
      }
      val messages = Wearable.getMessageClient(this)
      when (batch.status) {
        BatchStatus.RECEIVED -> {
          // JS first: a failed receipt must not keep the batch from its upload.
          WatchSessionModule.emitter?.invoke(batchJsEvent(batch))
          Tasks.await(messages.sendMessage(event.sourceNodeId, BATCH_RECEIVED_PATH, batchReceived(sessionInbox.nextMessageId(), batch)), 10, TimeUnit.SECONDS)
        }
        BatchStatus.COMMITTED -> {
          Tasks.await(messages.sendMessage(event.sourceNodeId, BATCH_RECEIVED_PATH, batchReceived(sessionInbox.nextMessageId(), batch)), 10, TimeUnit.SECONDS)
          Tasks.await(messages.sendMessage(event.sourceNodeId, BATCH_COMMITTED_PATH, batchCommitted(sessionInbox.nextMessageId(), batch)), 10, TimeUnit.SECONDS)
        }
        BatchStatus.FAILED ->
          Tasks.await(messages.sendMessage(event.sourceNodeId, ERROR_PATH, batchError(sessionInbox.nextMessageId(), batch)), 10, TimeUnit.SECONDS)
      }
    } catch (_: Exception) {
      // A stored batch is uploaded when JS drains it; the watch resends one it got no receipt for.
    }
  }
}
