package com.runway.health.watch

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

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
    val event = JSONObject()
      .put("latitude", location.latitude)
      .put("longitude", location.longitude)
      .put("accuracyM", if (location.hasAccuracy()) location.accuracy.toDouble() else JSONObject.NULL)
      .put("altitudeM", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
      .put("time", location.time)
    app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(RUN_LOCATION_EVENT, event.toString())
  }

  private companion object {
    const val INTERVAL_MS = 1000L
  }
}
