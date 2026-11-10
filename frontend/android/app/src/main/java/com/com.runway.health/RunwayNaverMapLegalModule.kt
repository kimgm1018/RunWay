package com.runway.health

import android.content.ActivityNotFoundException
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * 8.1c 데이터 라이선스 (S15P31E105-612): opens the NAVER Map SDK's own 법적 공지 and 오픈소스 라이선스 screens, which the
 * SDK's terms ask every app to offer. Both activities are public classes of the SDK (com.naver.maps.map.app) and are
 * declared in its manifest, merged into the app's; the logo's info dialog opens the same ones. The SDK is a dependency
 * of the map library, not of this module, so they are named by class name rather than linked.
 */
class RunwayNaverMapLegalModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  override fun getName() = "RunwayNaverMapLegal"

  @ReactMethod fun showLegalNotice(promise: Promise) = open(LEGAL_NOTICE, promise)

  @ReactMethod fun showOpenSourceLicense(promise: Promise) = open(OPEN_SOURCE_LICENSE, promise)

  private fun open(className: String, promise: Promise) {
    val activity = app.currentActivity
    val context = activity ?: app
    val intent = Intent().setClassName(context, className)
    if (activity == null) {
      // Started from outside an activity, it needs a task of its own.
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    try {
      context.startActivity(intent)
      promise.resolve(null)
    } catch (error: ActivityNotFoundException) {
      promise.reject("NOT_AVAILABLE", "NAVER Map SDK screen not found", error)
    } catch (error: RuntimeException) {
      promise.reject("OPEN_FAILED", "NAVER Map SDK screen could not be opened", error)
    }
  }

  private companion object {
    const val LEGAL_NOTICE = "com.naver.maps.map.app.LegalNoticeActivity"
    const val OPEN_SOURCE_LICENSE = "com.naver.maps.map.app.OpenSourceLicenseActivity"
  }
}

class RunwayNaverMapLegalPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(RunwayNaverMapLegalModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
