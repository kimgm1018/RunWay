package com.runway.watch.dailyhr

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit

private const val REGISTRATION_WORK = "daily_hr_registration"
private const val BATTERY_CHECK_WORK = "daily_hr_battery_check"
private const val SYNC_WORK = "daily_hr_sync"
private const val SYNC_NOW_WORK = "daily_hr_sync_now"

/**
 * Reconciles the passive registration; runs in WorkManager because the Health Services ack can exceed 10s.
 * A failed reconcile retries with backoff so a withdrawal cannot leave the registration active.
 */
class RegistrationWork(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        refreshConsentFromDataLayer(applicationContext, DailyHrStore.get(applicationContext))
        return if (PassiveHrRegistrar(applicationContext).reconcile().failed) Result.retry() else Result.success()
    }
}

/** Re-checks every 15 minutes whether a low-battery pause can end; a failed reconcile is left to the next period. */
class BatteryCheckWork(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (DailyHrStore.get(applicationContext).state() == CollectionState.PAUSED_LOW_BATTERY) {
            PassiveHrRegistrar(applicationContext).reconcile()
        }
        return Result.success()
    }
}

/**
 * Computes the rolling 24-hour estimate, sends unacknowledged summaries to the phone and prunes old data.
 * Unacknowledged summaries stay pending, so a failed delivery is simply retried by the next run.
 */
class DailyHrSyncWork(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = DailyHrStore.get(applicationContext)
        if (!canStore(store.consent())) return Result.success()
        val zone = ZoneId.systemDefault()
        val now = Instant.now()
        computeCurrent(store, zone, now)
        if (!canStore(store.consent())) {
            // Withdrawn while computing: rows may have been written after clearAll, so reconcile clears again.
            enqueueRegistration(applicationContext)
            return Result.success()
        }
        deliverPending(store, MessageClientSender(applicationContext), { date, revision, timeoutMs ->
            awaitAckInStore(store, date, revision, timeoutMs)
        })
        store.prune(now)
        return Result.success()
    }
}

/** Runs a sync right away, e.g. when consent is turned on. */
fun enqueueSyncNow(context: Context) {
    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
        SYNC_NOW_WORK,
        ExistingWorkPolicy.REPLACE,
        OneTimeWorkRequestBuilder<DailyHrSyncWork>().build(),
    )
}

/** Also ensures the hourly sync, so boot, app update and consent changes all keep it scheduled. */
fun enqueueRegistration(context: Context) {
    val workManager = WorkManager.getInstance(context.applicationContext)
    workManager.enqueueUniqueWork(
        REGISTRATION_WORK,
        ExistingWorkPolicy.REPLACE,
        OneTimeWorkRequestBuilder<RegistrationWork>().build(),
    )
    workManager.enqueueUniquePeriodicWork(
        BATTERY_CHECK_WORK,
        ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<BatteryCheckWork>(15, TimeUnit.MINUTES).build(),
    )
    workManager.enqueueUniquePeriodicWork(
        SYNC_WORK,
        ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<DailyHrSyncWork>(1, TimeUnit.HOURS).build(),
    )
}
