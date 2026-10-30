package com.runway.watch.dailyhr

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.guava.await

internal const val DAILY_HR_TAG = "DailyHr"

internal data class BatteryStatus(val pct: Int, val charging: Boolean)

internal fun readBattery(context: Context): BatteryStatus {
    val manager = context.getSystemService(BatteryManager::class.java)
    val capacity = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    val sticky = if (capacity in 1..100) null else context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = sticky?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = sticky?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    return BatteryStatus(batteryPct(capacity, level, scale), manager.isCharging)
}

internal fun hasCollectionPermissions(context: Context): Boolean = requiredPermissions(Build.VERSION.SDK_INT).all {
    ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
}

/** Brings the Health Services passive registration in line with consent, permission, support and battery. */
class PassiveHrRegistrar(context: Context) {
    private val context = context.applicationContext
    private val store = DailyHrStore.get(this.context)

    /** Never throws for Health Services failures; the previous state is kept and the result is marked failed. */
    suspend fun reconcile(): ReconcileResult {
        val previous = store.state()
        return try {
            val client = HealthServices.getClient(context).passiveMonitoringClient
            val consented = canStore(store.consent())
            val permitted = consented && hasCollectionPermissions(context)
            // Capabilities are only queried once consent and permission allow collection.
            val supported = permitted &&
                DataType.HEART_RATE_BPM in client.getCapabilitiesAsync().await().supportedDataTypesPassiveMonitoring
            val battery = readBattery(context)
            val next = decide(consented, permitted, supported, battery.pct, battery.charging)
            try {
                if (next == CollectionState.COLLECTING) {
                    client.setPassiveListenerServiceAsync(PassiveHrService::class.java, CONFIG).await()
                } else {
                    client.clearPassiveListenerServiceAsync().await()
                }
            } finally {
                // Withdrawn consent deletes local data even when unregistering fails.
                if (next == CollectionState.OFF_NO_CONSENT) store.clearAll()
            }
            store.saveState(next)
            ReconcileResult(next, failed = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(DAILY_HR_TAG, "reconcile failed: ${e.javaClass.simpleName}")
            ReconcileResult(previous, failed = true)
        }
    }

    private companion object {
        val CONFIG: PassiveListenerConfig = PassiveListenerConfig.builder()
            .setDataTypes(setOf(DataType.HEART_RATE_BPM))
            .setShouldUserActivityInfoBeRequested(true)
            .build()
    }
}
