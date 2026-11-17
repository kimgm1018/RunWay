package com.runway.health

import android.content.Context
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import com.naver.maps.map.NaverMapSdk

/**
 * S15P31E105-898: the NAVER Map SDK's authorization failures, told to the app.
 *
 * Every NaverMap (one per map view) asks the SDK to authorize the key when it is made. A refused key (401) or a
 * used-up quota (429) reaches the SDK's one OnAuthFailedListener; with none set the SDK only shows a toast and that
 * map stays blank. The listener is set here when the app starts, before any map is made, so the first failure is
 * not lost. A network error is not an auth failure for the SDK (it logs "Authorization pending" and waits for the
 * connection to come back), so it never reaches this listener; the map screens watch for a map that never loads.
 *
 * A new map view authorizes again, so the app retries by making its maps again (MapLoadGuard).
 */
object NaverMapAuthWatch {
  const val TAG = "RunwayNaverMapAuth"
  const val EVENT = "RunwayNaverMapAuthFailed"

  @Volatile private var lastFailure: Failure? = null
  @Volatile private var emitter: ((Failure) -> Unit)? = null

  data class Failure(val code: String, val message: String, val at: Long) {
    fun toMap(): WritableMap =
      Arguments.createMap().apply {
        putString("code", code)
        putString("message", message)
        putDouble("at", at.toDouble())
      }
  }

  fun install(context: Context) {
    try {
      NaverMapSdk.getInstance(context).onAuthFailedListener =
        NaverMapSdk.OnAuthFailedListener { error ->
          val failure =
            Failure(
              code = error.errorCode ?: "unknown",
              message = error.message ?: "",
              at = System.currentTimeMillis(),
            )
          Log.w(TAG, "NAVER Map auth failed code=${failure.code} message=${failure.message}")
          lastFailure = failure
          emitter?.invoke(failure)
        }
    } catch (error: RuntimeException) {
      // The map must never stop the app from starting.
      Log.w(TAG, "NAVER Map auth listener not set", error)
    }
  }

  fun lastFailure(): Failure? = lastFailure

  fun clear() {
    lastFailure = null
  }

  fun setEmitter(next: ((Failure) -> Unit)?) {
    emitter = next
  }
}

class NaverMapAuthModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  override fun getName() = "RunwayNaverMapAuth"

  override fun initialize() {
    super.initialize()
    NaverMapAuthWatch.setEmitter { failure ->
      if (app.hasActiveReactInstance()) {
        app
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(NaverMapAuthWatch.EVENT, failure.toMap())
      }
    }
  }

  override fun invalidate() {
    NaverMapAuthWatch.setEmitter(null)
    super.invalidate()
  }

  /** The failure seen before the app's JS was listening (the first maps can fail before it subscribes). */
  @ReactMethod
  fun lastFailure(promise: Promise) {
    promise.resolve(NaverMapAuthWatch.lastFailure()?.toMap())
  }

  /** A map loaded again: the failure is over. */
  @ReactMethod
  fun clear() {
    NaverMapAuthWatch.clear()
  }

  /** The map screens' own reports (made, ready, drawn, timeouts, retries), in the same logcat tag as the SDK's failures. */
  @ReactMethod
  fun log(level: String, message: String) {
    if (level == "warn") Log.w(NaverMapAuthWatch.TAG, message) else Log.i(NaverMapAuthWatch.TAG, message)
  }

  // NativeEventEmitter on Android asks for these.
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Double) = Unit
}

class NaverMapAuthPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(NaverMapAuthModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
