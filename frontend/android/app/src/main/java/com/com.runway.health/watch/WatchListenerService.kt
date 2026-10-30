package com.runway.health.watch

import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.util.concurrent.TimeUnit

/** Stores DAILY_HR_SUMMARY only with consent, then acks it. Never log record values or exception messages. */
class WatchListenerService : WearableListenerService() {
  private val prefs by lazy { DailyHrPrefs(this) }

  override fun onMessageReceived(event: MessageEvent) {
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
}
