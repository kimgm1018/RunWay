package com.runway.health

import android.location.Address
import android.location.Geocoder
import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.util.Locale

/**
 * The name of a point picked on the map (3.1 기준 위치 지도에서 선택, 담당자 요청), from the phone's own Geocoder: no server
 * or key. Resolves a short Korean address such as "중구 세종대로14길 27-2", or null when the phone has no geocoder or finds nothing.
 * Coordinates are never logged.
 */
class PlaceNameModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  override fun getName() = "PlaceName"

  @ReactMethod fun nameOf(latitude: Double, longitude: Double, promise: Promise) {
    if (!Geocoder.isPresent()) {
      promise.resolve(null)
      return
    }
    val geocoder = Geocoder(app, Locale.KOREA)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      geocoder.getFromLocation(latitude, longitude, 1, object : Geocoder.GeocodeListener {
        override fun onGeocode(addresses: MutableList<Address>) {
          promise.resolve(addresses.firstOrNull()?.let(::shortName))
        }

        override fun onError(errorMessage: String?) {
          promise.resolve(null)
        }
      })
    } else {
      // The old call blocks on the network, so it runs off the JS thread.
      Thread {
        val name = try {
          @Suppress("DEPRECATION")
          geocoder.getFromLocation(latitude, longitude, 1)?.firstOrNull()?.let(::shortName)
        } catch (_: Exception) {
          null
        }
        promise.resolve(name)
      }.start()
    }
  }
}

/**
 * The address without the country and the 시·도, e.g. "중구 세종대로14길 27-2" from "대한민국 서울특별시 중구 세종대로14길
 * 27-2"; 구 and 동 when the phone gives no address line.
 */
internal fun shortName(address: Address): String? {
  val words = address.getAddressLine(0)
    ?.split(" ")
    ?.map(String::trim)
    ?.filter { it.isNotEmpty() && it != "대한민국" && it != "South Korea" }
    .orEmpty()
  if (words.isNotEmpty()) {
    val province = address.adminArea?.trim()
    val rest = if (words.size > 2 && (words.first() == province || isProvince(words.first()))) words.drop(1) else words
    return rest.joinToString(" ")
  }
  return listOf(address.subLocality ?: address.locality, address.thoroughfare)
    .mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }
    .distinct()
    .takeIf { it.isNotEmpty() }
    ?.joinToString(" ")
}

private fun isProvince(word: String) =
  word.endsWith("특별시") || word.endsWith("광역시") || word.endsWith("특별자치시") ||
    word.endsWith("특별자치도") || word.endsWith("도")

class PlaceNamePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PlaceNameModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
