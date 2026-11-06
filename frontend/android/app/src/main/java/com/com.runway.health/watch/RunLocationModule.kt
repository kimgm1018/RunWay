package com.runway.health.watch

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

const val RUN_LOCATION_EVENT = "RunwayRunLocation"

/**
 * Phone GPS while the phone records a run after the watch handed it over (S15P31E105-464, devices-health.md 폰 인계 후
 * 업로드·종료). Fixes go to JS, which makes W07 GPS_POINT batches with the phone's own deviceId. The run foreground
 * service holds the location type meanwhile so fixes keep coming with the screen off. Never log coordinates.
 */
class RunLocationModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private var listener: LocationListener? = null

  override fun getName() = "RunLocation"

  // NativeEventEmitter requires these on Android.
  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit
  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) = Unit

  /** Resolves false without the fine location permission or a GPS provider; the run then keeps time only. */
  @SuppressLint("MissingPermission")
  @ReactMethod fun start(promise: Promise) {
    if (app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      promise.resolve(false)
      return
    }
    try {
      val manager = app.getSystemService(LocationManager::class.java)
      if (manager == null || !manager.allProviders.contains(LocationManager.GPS_PROVIDER)) {
        promise.resolve(false)
        return
      }
      stopUpdates()
      val next = LocationListener { location -> emit(location) }
      manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, INTERVAL_MS, 0f, next, Looper.getMainLooper())
      listener = next
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  /**
   * One fix for 3.1 기준 위치 (S15P31E105-494), with a listener of its own so a run's updates are untouched. A recent
   * last-known fix answers at once; otherwise the first new fix does, or LOCATION_TIMEOUT after [timeoutMs].
   * Rejects LOCATION_PERMISSION_DENIED, LOCATION_DISABLED or LOCATION_UNAVAILABLE without a fix to give.
   */
  @SuppressLint("MissingPermission")
  @ReactMethod fun current(timeoutMs: Double, promise: Promise) {
    if (app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("LOCATION_PERMISSION_DENIED", "Location permission not granted")
      return
    }
    val manager = app.getSystemService(LocationManager::class.java)
    if (manager == null) {
      promise.reject("LOCATION_UNAVAILABLE", "No location manager")
      return
    }
    val providers = try {
      if (!manager.isLocationEnabled) emptyList()
      else listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { manager.isProviderEnabled(it) }
    } catch (_: Exception) {
      emptyList()
    }
    if (providers.isEmpty()) {
      promise.reject("LOCATION_DISABLED", "Location services are off")
      return
    }
    val now = System.currentTimeMillis()
    val recent = providers
      .mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
      .filter { now - it.time in 0..MAX_FIX_AGE_MS }
      .maxByOrNull { it.time }
    if (recent != null) {
      promise.resolve(fixJson(recent).toString())
      return
    }

    val handler = Handler(Looper.getMainLooper())
    val settled = AtomicBoolean(false)
    lateinit var single: LocationListener
    lateinit var timeout: Runnable
    fun settle(location: Location?) {
      if (!settled.compareAndSet(false, true)) return
      handler.removeCallbacks(timeout)
      runCatching { manager.removeUpdates(single) }
      if (location != null) promise.resolve(fixJson(location).toString())
      else promise.reject("LOCATION_TIMEOUT", "No location fix in time")
    }
    single = LocationListener { location -> settle(location) }
    timeout = Runnable { settle(null) }
    try {
      providers.forEach { manager.requestLocationUpdates(it, 0L, 0f, single, Looper.getMainLooper()) }
      handler.postDelayed(timeout, timeoutMs.toLong().coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS))
    } catch (_: Exception) {
      if (settled.compareAndSet(false, true)) {
        runCatching { manager.removeUpdates(single) }
        promise.reject("LOCATION_UNAVAILABLE", "Location updates could not start")
      }
    }
  }

  @ReactMethod fun stop(promise: Promise) {
    stopUpdates()
    promise.resolve(null)
  }

  override fun invalidate() {
    stopUpdates()
    super.invalidate()
  }

  private fun stopUpdates() {
    val current = listener ?: return
    listener = null
    try {
      app.getSystemService(LocationManager::class.java)?.removeUpdates(current)
    } catch (_: Exception) {
      // Nothing left to stop.
    }
  }

  private fun emit(location: Location) {
    if (!app.hasActiveReactInstance()) return
    app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(RUN_LOCATION_EVENT, fixJson(location).toString())
  }

  private fun fixJson(location: Location) = JSONObject()
    .put("latitude", location.latitude)
    .put("longitude", location.longitude)
    .put("accuracyM", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
    .put("altitudeM", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
    .put("time", location.time)

  private companion object {
    const val INTERVAL_MS = 1000L
    // A last-known fix younger than this stands in for a new one.
    const val MAX_FIX_AGE_MS = 120_000L
    const val MIN_TIMEOUT_MS = 1_000L
    const val MAX_TIMEOUT_MS = 60_000L
  }
}
