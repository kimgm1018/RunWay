package com.runway.watch.dailyhr

import android.os.SystemClock
import androidx.health.services.client.PassiveListenerService
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.HeartRateAccuracy
import androidx.health.services.client.data.HeartRateAccuracy.SensorStatus
import androidx.health.services.client.data.UserActivityInfo
import androidx.health.services.client.data.UserActivityState
import java.time.Instant

/** Receives passive HR batches and activity changes; values are stored, never logged. */
class PassiveHrService : PassiveListenerService() {
    private val store by lazy { DailyHrStore.get(this) }

    override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
        if (!consentHolds()) return
        val bootInstant = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
        val valid = mutableListOf<Pair<Long, Double>>()
        val drops = mutableMapOf<DropReason, Int>()
        dataPoints.getData(DataType.HEART_RATE_BPM).forEach { point ->
            val bpm = point.value
            val accuracy = (point.accuracy as? HeartRateAccuracy)?.sensorStatus?.let(::toHrAccuracy)
            when (val reason = validate(bpm, accuracy)) {
                null -> valid += point.getTimeInstant(bootInstant).toEpochMilli() to bpm
                else -> drops[reason] = (drops[reason] ?: 0) + 1
            }
        }
        if (valid.isNotEmpty()) store.addSamples(valid)
        drops.forEach { (reason, count) -> store.addDrops(reason, count) }
        // Below the battery floor: the registrar unregisters and pauses collection.
        val battery = readBattery(this)
        if (decide(true, true, true, battery.pct, battery.charging) == CollectionState.PAUSED_LOW_BATTERY) {
            enqueueRegistration(this)
        }
    }

    override fun onUserActivityInfoReceived(info: UserActivityInfo) {
        if (!consentHolds()) return
        store.addTransition(
            ActivityTransition(
                info.stateChangeTime.toEpochMilli(),
                info.userActivityState == UserActivityState.USER_ACTIVITY_EXERCISE,
            ),
        )
    }

    override fun onPermissionLost() {
        store.saveState(CollectionState.NEEDS_PERMISSION)
        enqueueRegistration(this)
    }

    /** Batches after withdrawal (in flight, or from a registration that failed to clear) are dropped and the stale registration cleared. */
    private fun consentHolds(): Boolean {
        if (canStore(store.consent())) return true
        enqueueRegistration(this)
        return false
    }

    private fun toHrAccuracy(status: SensorStatus): HrAccuracy = when (status) {
        SensorStatus.ACCURACY_HIGH -> HrAccuracy.HIGH
        SensorStatus.ACCURACY_MEDIUM -> HrAccuracy.MEDIUM
        SensorStatus.ACCURACY_LOW -> HrAccuracy.LOW
        SensorStatus.UNRELIABLE -> HrAccuracy.UNRELIABLE
        SensorStatus.NO_CONTACT -> HrAccuracy.NO_CONTACT
        else -> HrAccuracy.UNKNOWN
    }
}
