package com.runway.health

import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream

/**
 * 경로 재생 공유 (S15P31E105-704): a picture of exactly what the screen shows for one view. The replay is a Modal
 * (its own window) with a TextureView map; drawing the views into a canvas put the map's last texture over the
 * words and lost the route lines, so this copies the window's pixels instead (PixelCopy) and crops them to the
 * view. Android 14+ only; older phones reject and the caller keeps its own way.
 */
class ScreenCaptureModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  override fun getName() = "RunwayScreenCapture"

  @ReactMethod
  fun captureView(reactTag: Double, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.reject("UNSUPPORTED", "Window capture needs Android 14")
      return
    }
    val tag = reactTag.toInt()
    UiThreadUtil.runOnUiThread {
      val view: View? =
        try {
          UIManagerHelper.getUIManagerForReactTag(app, tag)?.resolveView(tag)
        } catch (error: RuntimeException) {
          null
        }
      if (view == null || !view.isAttachedToWindow || view.width == 0 || view.height == 0) {
        promise.reject("NO_VIEW", "The view to capture is not shown")
        return@runOnUiThread
      }
      val where = IntArray(2)
      view.getLocationInWindow(where)
      val width = view.width
      val height = view.height
      val request =
        try {
          PixelCopy.Request.Builder.ofWindow(view).build()
        } catch (error: RuntimeException) {
          promise.reject("CAPTURE_FAILED", "The window could not be copied", error)
          return@runOnUiThread
        }
      PixelCopy.request(request, { command -> Handler(Looper.getMainLooper()).post(command) }) { result ->
        if (result.status != PixelCopy.SUCCESS) {
          promise.reject("CAPTURE_FAILED", "PixelCopy status ${result.status}")
          return@request
        }
        Thread {
          try {
            promise.resolve(save(crop(result.bitmap, where[0], where[1], width, height)))
          } catch (error: Exception) {
            promise.reject("CAPTURE_FAILED", "The picture could not be saved", error)
          }
        }.start()
      }
    }
  }

  private fun crop(window: Bitmap, left: Int, top: Int, width: Int, height: Int): Bitmap {
    val x = left.coerceIn(0, window.width - 1)
    val y = top.coerceIn(0, window.height - 1)
    val w = width.coerceAtMost(window.width - x)
    val h = height.coerceAtMost(window.height - y)
    if (x == 0 && y == 0 && w == window.width && h == window.height) {
      return window
    }
    return Bitmap.createBitmap(window, x, y, w, h)
  }

  private fun save(bitmap: Bitmap): String {
    val file = File.createTempFile("runway-replay-", ".png", app.cacheDir)
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    return file.absolutePath
  }
}

class ScreenCapturePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ScreenCaptureModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
