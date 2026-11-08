package com.runway.health.watch

import android.annotation.SuppressLint
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import java.util.concurrent.Executors
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Watch daily HR store and health-consent DataItem. Never send records or raw exception messages to logs. */
class WatchHealthModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val executor = Executors.newSingleThreadExecutor()
  private val prefs by lazy { DailyHrPrefs(app) }
  override fun getName() = "WatchHealth"
  override fun invalidate() { executor.shutdownNow(); super.invalidate() }

  private fun run(promise: Promise, code: String, message: String, block: () -> Any?) {
    executor.execute {
      try { promise.resolve(block()) }
      catch (_: Exception) { promise.reject(code, message) }
    }
  }

  @ReactMethod fun prepareAccount(account: String, promise: Promise) = run(promise, "WATCH_STORAGE", "기록 계정을 확인하지 못했습니다.") {
    prefs.prepareAccount(account)
  }

  /** Withdrawal is published as DISAGREE; the DataItem is never deleted. */
  @ReactMethod fun setHealthConsent(access: String, account: String?, promise: Promise) {
    if (access != CONSENT_AGREE && access != CONSENT_DISAGREE) {
      promise.reject("WATCH_INVALID", "건강정보 동의 값이 올바르지 않습니다.")
      return
    }
    run(promise, "WATCH_UNAVAILABLE", "워치에 동의 상태를 전달하지 못했습니다.") {
      // A delayed W05/withdrawal from a previous login cannot alter the current account.
      if (account != null && prefs.owner() != account) return@run null
      if (access == CONSENT_AGREE && (account == null || prefs.collectionId() == null)) return@run null
      if (needsConsentPublish(prefs.consent(), prefs.consentDelivered(), access)) {
        prefs.saveConsent(access) // DISAGREE also clears stored records atomically.
        publishConsent(access)
        prefs.markConsentDelivered(access)
      }
      null
    }
  }

  /** App start: re-sends only a saved consent whose last publish failed. */
  @ReactMethod fun republishConsent(promise: Promise) = run(promise, "WATCH_UNAVAILABLE", "워치에 동의 상태를 전달하지 못했습니다.") {
    val access = prefs.consent()
    if (access != null && !prefs.consentDelivered()) {
      publishConsent(access)
      prefs.markConsentDelivered(access)
    }
    null
  }

  @ReactMethod fun getDailyHr(account: String, promise: Promise) = run(promise, "WATCH_STORAGE", "워치 심박 기록을 읽지 못했습니다.") {
    Arguments.createArray().apply {
      prefs.allForAccount(account).forEach { r ->
        pushMap(Arguments.createMap().apply {
          putString("collectionId", r.collectionId)
          putString("metricDate", r.metricDate)
          putInt("revision", r.revision)
          putDouble("estimatedRestingHrBpm", r.estimatedRestingHrBpm)
          putString("method", r.method)
          putInt("validSampleCount", r.validSampleCount)
          putString("computedAt", r.computedAt)
          putBoolean("uploaded", r.uploadedRevision == r.revision)
          putBoolean("rejected", r.rejectedRevision == r.revision)
        })
      }
    }
  }

  @ReactMethod fun markUploaded(date: String, revision: Int, collectionId: String, promise: Promise) = run(promise, "WATCH_STORAGE", "워치 심박 기록을 저장하지 못했습니다.") {
    prefs.markUploaded(date, revision, collectionId)
    null
  }

  @ReactMethod fun markRejected(date: String, revision: Int, collectionId: String, promise: Promise) = run(promise, "WATCH_STORAGE", "워치 심박 기록을 저장하지 못했습니다.") {
    prefs.markRejected(date, revision, collectionId)
    null
  }

  // play-services-wearable 18.0.0 marks the public DataMap accessors @VisibleForTesting; lint false positive.
  @SuppressLint("VisibleForTests")
  private fun publishConsent(access: String) {
    val request = PutDataMapRequest.create(CONSENT_PATH).apply {
      dataMap.putString("healthDataAccess", access)
      prefs.collectionId()?.let { dataMap.putString("collectionId", it) }
      prefs.collectionStartedAt()?.let { dataMap.putString("collectionStartedAt", it) }
      dataMap.putString("updatedAt", prefs.nextConsentUpdatedAt(Instant.now()))
    }.asPutDataRequest().setUrgent()
    Tasks.await(Wearable.getDataClient(app).putDataItem(request), 10, TimeUnit.SECONDS)
  }
}

class WatchHealthPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(WatchHealthModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
