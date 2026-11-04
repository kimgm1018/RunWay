package com.runway.watch.dailyhr

import com.runway.watch.batch.DATA_PATH_PREFIX
import com.runway.watch.session.RunSessions
import com.runway.watch.session.SessionPaths
import kotlinx.coroutines.runBlocking
import android.annotation.SuppressLint
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import java.time.Instant

/** Receives the phone's DAILY_HR_RECEIVED ack and the health-consent DataItem; malformed input is ignored. */
class WatchDataLayerService : WearableListenerService() {
    private val store by lazy { DailyHrStore.get(this) }

    override fun onMessageReceived(event: MessageEvent) {
        // Run-session messages (S15P31E105-256) go to the shared controller's queue; batch ACKs are applied at once.
        // Batch receipts and save ACKs (S15P31E105-311) go to the same place.
        if (event.path.startsWith(SessionPaths.PREFIX) || event.path.startsWith(DATA_PATH_PREFIX) || event.path == SessionPaths.ERROR) {
            runBlocking { RunSessions.get(this@WatchDataLayerService).receive(event.data) }
            return
        }
        if (event.path != DailyHrMessages.RECEIVED_PATH) return
        val (date, revision) = DailyHrMessages.decodeReceived(event.data) ?: return
        store.markAcked(date, revision)
    }

    // play-services-wearable 18.0.0 marks the public DataEvent/DataMap accessors @VisibleForTesting; lint false positive.
    @SuppressLint("VisibleForTests")
    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.dataItem.uri.path != DailyHrMessages.CONSENT_PATH) continue
            when (event.type) {
                DataEvent.TYPE_CHANGED -> applyConsent(readConsent(event) ?: continue)
                // A missing consent item means DISAGREE; deletion has no updatedAt, so it always applies.
                DataEvent.TYPE_DELETED -> {
                    store.saveConsent(HealthConsent(false, Instant.now()))
                    enqueueRegistration(this)
                }
            }
        }
    }

    @SuppressLint("VisibleForTests")
    private fun readConsent(event: DataEvent): HealthConsent? = try {
        val map = DataMapItem.fromDataItem(event.dataItem).dataMap
        HealthConsent.fromDataMap(map.getString("healthDataAccess"), map.getString("updatedAt"))
    } catch (_: Exception) {
        null
    }

    /** Stale consent (older updatedAt) is never applied; registration is reconciled either way. */
    private fun applyConsent(incoming: HealthConsent) {
        val current = store.consent()
        val next = newerConsent(current, incoming)
        if (next != current) store.saveConsent(next)
        enqueueRegistration(this)
        if (next.agreed) enqueueSyncNow(this)
    }
}
