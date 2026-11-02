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

  override fun onMessageReceived(event: MessageEvent) {
    if (event.path.startsWith(SESSION_PATH_PREFIX)) {
      onSessionMessage(event)
      return
    }
    if (event.path != SUMMARY_PATH) return
    try {
      val summary = parseSummary(event.data) ?: return
      // Persist before acking; equal or lower revisions keep the stored value but are acked the same way.
      // Without AGREEE consent nothing is stored and nothing is acked.
      prefs.upsertIfConsented(summary.record) ?: return
      val reply = receivedReply(prefs.nextMessageId(), summary.messageId, summary.record.metricDate, summary.record.revision)
      Tasks.await(Wearable.getMessageClient(this).sendMessage(event.sourceNodeId, RECEIVED_PATH, reply), 10, TimeUnit.SECONDS)
    } catch (_: Exception) {
      // The watch retries an unacked summary later.
    }
  }

  /**
   * Run-session message (S15P31E105-256): store first so a stopped JS still gets it, reply COMMAND_RECEIVED(persisted=false)
   * to a COMMAND_RESULT, then hand it to JS if attached. JS reports to the server and sends persisted=true.
   */
  private fun onSessionMessage(event: MessageEvent) {
    try {
      val message = sessionInbox.add(event.data) ?: return
      // JS first: a failed receipt below must not keep the result from reaching the server report.
      WatchSessionModule.emitter?.invoke(toJsEvent(message))
      if (message.type == "COMMAND_RESULT") {
        val receipt = localReceipt(message, sessionInbox.nextMessageId(), null)
        Tasks.await(Wearable.getMessageClient(this).sendMessage(event.sourceNodeId, COMMAND_RECEIVED_PATH, receipt), 10, TimeUnit.SECONDS)
      }
    } catch (_: Exception) {
      // Stored messages stay in the inbox; the watch resends unconfirmed results.
    }
  }
}
