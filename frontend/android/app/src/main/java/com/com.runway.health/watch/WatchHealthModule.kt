package com.runway.health.watch

import android.annotation.SuppressLint
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.*
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Watch daily HR store and health-consent DataItem. Never send records or raw exception messages to logs. */
class WatchHealthModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val prefs by lazy { DailyHrPrefs(app) }
  override fun getName() = "WatchHealth"
  override fun invalidate() { scope.cancel(); super.invalidate() }

  private fun run(promise: Promise, code: String, message: String, block: () -> Any?) {
    scope.launch {
      try { promise.resolve(block()) }
      catch (_: Exception) { promise.reject(code, message) }
    }
  }

  /** Withdrawal is published as DISAGREE; the DataItem is never deleted. */
  @ReactMethod fun setHealthConsent(access: String, promise: Promise) {
    if (access != CONSENT_AGREE && access != CONSENT_DISAGREE) {
      promise.reject("WATCH_INVALID", "건강정보 동의 값이 올바르지 않습니다.")
      return
    }
    run(promise, "WATCH_UNAVAILABLE", "워치에 동의 상태를 전달하지 못했습니다.") {
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

  @ReactMethod fun getDailyHr(promise: Promise) = run(promise, "WATCH_STORAGE", "워치 심박 기록을 읽지 못했습니다.") {
    Arguments.createArray().apply {
      prefs.all().forEach { r ->
        pushMap(Arguments.createMap().apply {
          putString("metricDate", r.metricDate)
          putInt("revision", r.revision)
          putDouble("estimatedRestingHrBpm", r.estimatedRestingHrBpm)
          putInt("validSampleCount", r.validSampleCount)
          putString("computedAt", r.computedAt)
          putBoolean("uploaded", r.uploadedRevision == r.revision)
        })
      }
    }
  }

  @ReactMethod fun markUploaded(date: String, revision: Int, promise: Promise) = run(promise, "WATCH_STORAGE", "워치 심박 기록을 저장하지 못했습니다.") {
    prefs.markUploaded(date, revision)
    null
  }

  // play-services-wearable 18.0.0 marks the public DataMap accessors @VisibleForTesting; lint false positive.
  @SuppressLint("VisibleForTests")
  private fun publishConsent(access: String) {
    val request = PutDataMapRequest.create(CONSENT_PATH).apply {
      dataMap.putString("healthDataAccess", access)
      dataMap.putString("updatedAt", Instant.now().toString())
    }.asPutDataRequest().setUrgent()
    Tasks.await(Wearable.getDataClient(app).putDataItem(request), 10, TimeUnit.SECONDS)
  }
}

class WatchHealthPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(WatchHealthModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
