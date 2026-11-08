package com.runway.health.music

import android.graphics.Bitmap
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.client.CallResult
import com.spotify.protocol.client.Subscription
import com.spotify.protocol.types.Image
import com.spotify.protocol.types.PlayerState
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class SpotifyRemoteModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val main = Handler(Looper.getMainLooper())
  private val images = Executors.newSingleThreadExecutor()
  private var remote: SpotifyAppRemote? = null
  private var subscription: Subscription<PlayerState>? = null
  private var player: PlayerState? = null
  private var canPlayOnDemand = false
  private var generation = 0
  private val pendingConnections = mutableListOf<Promise>()
  private var artworkId: String? = null
  private var artworkPath: String? = null

  override fun getName() = "SpotifyRemote"

  @ReactMethod fun installed(promise: Promise) {
    promise.resolve(SpotifyAppRemote.isSpotifyInstalled(app))
  }

  @ReactMethod fun openApp(promise: Promise) { main.post {
    try {
      val intent = app.packageManager.getLaunchIntentForPackage("com.spotify.music")
        ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.spotify.music"))
      app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(null)
    } catch (_: Exception) { promise.reject("FAILED", "Could not open Spotify") }
  } }

  @ReactMethod fun connect(clientId: String, redirectUri: String, interactive: Boolean, promise: Promise) {
    main.post {
      if (!SpotifyAppRemote.isSpotifyInstalled(app)) { promise.reject("INSTALL_REQUIRED", "Install Spotify to connect"); return@post }
      if (remote?.isConnected == true) { promise.resolve(null); return@post }
      pendingConnections.add(promise)
      if (pendingConnections.size > 1) return@post
      val attempt = ++generation
      val previous = remote; remote = null
      subscription?.cancel(); subscription = null
      previous?.let { SpotifyAppRemote.disconnect(it) }
      player = null; artworkId = null; artworkPath = null; canPlayOnDemand = false
      // Do not enable SDK debug logging: authorization details must never enter logs.
      SpotifyAppRemote.setDebugMode(false)
      val timeout = Runnable {
        if (generation == attempt && pendingConnections.isNotEmpty()) {
          Log.w("RunWaySpotify", "connect timeout")
          generation++
          finishConnection("CONNECTION_LOST")
        }
      }
      main.postDelayed(timeout, SpotifyRemotePolicy.connectionTimeout(interactive))
      val params = ConnectionParams.Builder(clientId).setRedirectUri(redirectUri).showAuthView(interactive).build()
      try {
        SpotifyAppRemote.connect(SpotifyRemoteContext(app, interactive), params, object : Connector.ConnectionListener {
          override fun onConnected(connected: SpotifyAppRemote) {
            main.post {
              main.removeCallbacks(timeout)
              if (generation != attempt) { SpotifyAppRemote.disconnect(connected); return@post }
              Log.i("RunWaySpotify", "connected")
              remote = connected
              connected.userApi.capabilities.setResultCallback { capabilities -> main.post {
                if (remote === connected) { canPlayOnDemand = capabilities.canPlayOnDemand; emit() }
              } }.setErrorCallback { /* Capability failure must not masquerade as a Premium requirement. */ }
              subscription?.cancel()
              subscription = connected.playerApi.subscribeToPlayerState().setEventCallback { state -> main.post {
                if (remote === connected) remember(state, true)
              } }
              subscription?.setErrorCallback { error -> main.post {
                Log.w("RunWaySpotify", "subscription failed: ${code(error)} (${error.javaClass.simpleName})")
                if (remote === connected) close()
              } }
              finishConnection(null)
            }
          }
          override fun onFailure(error: Throwable) { main.post {
            Log.w("RunWaySpotify", "connect failed: ${code(error)} (${error.javaClass.simpleName})")
            main.removeCallbacks(timeout)
            if (generation == attempt) finishConnection(code(error))
          } }
        })
      } catch (error: Exception) {
        main.removeCallbacks(timeout)
        finishConnection(code(error))
      }
    }
  }

  private fun finishConnection(error: String?) {
    val waiting = pendingConnections.toList(); pendingConnections.clear()
    waiting.forEach { if (error == null) it.resolve(null) else it.reject(error, "Spotify connection failed") }
  }

  @ReactMethod fun getState(promise: Promise) { main.post {
    val connected = remote
    if (connected?.isConnected != true) { promise.reject("CONNECTION_LOST", "Reconnect Spotify"); return@post }
    result(connected.playerApi.playerState, promise) { state -> remember(state, false); snapshot().toString() }
  } }

  @ReactMethod fun command(name: String, promise: Promise) { main.post {
    val connected = remote
    if (connected?.isConnected != true) { promise.reject("CONNECTION_LOST", "Reconnect Spotify"); return@post }
    when (name) {
      "play" -> {
        // A local App Remote connection can still have Connect playback on another device.
        // Switching is explicit and must succeed before resume is sent.
        val switched = connected.connectApi.connectSwitchToLocalDevice()
        result(switched, promise, complete = false) {
          result(connected.playerApi.resume(), promise) { null }
          null
        }
      }
      "pause" -> result(connected.playerApi.pause(), promise) { null }
      "next" -> result(connected.playerApi.skipNext(), promise) { null }
      "previous" -> result(connected.playerApi.skipPrevious(), promise) { null }
      else -> promise.reject("FAILED", "Unsupported Spotify command")
    }
  } }

  // 2.7 내 재생 목록 · 최근 들은 곡 (S15P31E105-478): a playlist or a song starts on this phone, switched to it first
  // like 재생, so it never plays on another Connect device. Only playlist and track URIs are taken.
  @ReactMethod fun playUri(uri: String, promise: Promise) { main.post {
    val connected = remote
    if (connected?.isConnected != true) { promise.reject("CONNECTION_LOST", "Reconnect Spotify"); return@post }
    if (!SpotifyRemotePolicy.playableUri(uri)) { promise.reject("FAILED", "Unsupported Spotify URI"); return@post }
    val switched = connected.connectApi.connectSwitchToLocalDevice()
    result(switched, promise, complete = false) {
      result(connected.playerApi.play(uri), promise) { null }
      null
    }
  } }

  private fun <T> result(call: CallResult<T>, promise: Promise, complete: Boolean = true, consume: (T) -> Any?) {
    val attempt = generation
    val settled = AtomicBoolean(false)
    val timeout = Runnable { if (settled.compareAndSet(false, true)) {
      Log.w("RunWaySpotify", "request timeout")
      promise.reject("CONNECTION_LOST", "Spotify did not respond")
    } }
    main.postDelayed(timeout, 10_000)
    call.setResultCallback { value -> main.post {
      if (!settled.compareAndSet(false, true)) return@post
      main.removeCallbacks(timeout)
      if (generation != attempt) { promise.reject("CONNECTION_LOST", "Spotify connection changed"); return@post }
      try { val output = consume(value); if (complete) promise.resolve(output) }
      catch (error: Exception) {
        Log.w("RunWaySpotify", "result failed: ${code(error)} (${error.javaClass.simpleName})")
        promise.reject(code(error), "Spotify request failed")
      }
    } }.setErrorCallback { error -> main.post {
      if (settled.compareAndSet(false, true)) {
        Log.w("RunWaySpotify", "request failed: ${code(error)} (${error.javaClass.simpleName})")
        main.removeCallbacks(timeout); promise.reject(code(error), "Spotify request failed")
      }
    } }
  }

  private fun code(error: Throwable) = SpotifyRemotePolicy.failure(error.javaClass.simpleName, error.message.orEmpty())

  private fun remember(state: PlayerState, notify: Boolean) {
    player = state
    val track = state.track
    val id = track?.uri?.takeIf { it.isNotBlank() }
    if (artworkId != id) {
      artworkId = id; artworkPath = null
      val connected = remote
      val imageUri = track?.imageUri
      if (id != null && imageUri != null && connected != null) {
        val attempt = generation
        connected.imagesApi.getImage(imageUri, Image.Dimension.LARGE).setResultCallback { bitmap ->
          main.post {
            if (generation != attempt || images.isShutdown) return@post
            images.execute {
            try {
              val dir = File(app.cacheDir, "spotify-art").apply { mkdirs() }
              val name = MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).joinToString("") { "%02x".format(it) }
              val file = File(dir, "$name.png")
              file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
              main.post { if (generation == attempt && artworkId == id) { artworkPath = Uri.fromFile(file).toString(); emit() } }
              dir.listFiles()?.filter { it != file }?.sortedByDescending { it.lastModified() }?.drop(10)?.forEach { it.delete() }
            } catch (_: Exception) { /* A missing cover keeps the default card artwork. */ }
          }
          }
        }.setErrorCallback { /* Keep the default artwork. */ }
      }
    }
    if (notify) emit()
  }

  private fun snapshot(): JSONObject {
    val connected = remote?.isConnected == true
    val state = player
    val track = state?.track?.takeIf { connected && !it.uri.isNullOrBlank() }
    return JSONObject().apply {
      put("connected", connected); put("playing", connected && state?.isPaused == false); put("canPlayOnDemand", canPlayOnDemand)
      put("track", if (track == null) JSONObject.NULL else JSONObject().apply {
        put("id", track.uri); put("title", track.name.orEmpty())
        put("artist", track.artists?.joinToString(", ") { it.name.orEmpty() } ?: track.artist?.name.orEmpty())
        put("durationMs", track.duration.coerceAtLeast(0)); put("positionMs", state!!.playbackPosition.coerceAtLeast(0))
        put("artworkUri", artworkPath ?: JSONObject.NULL)
      })
    }
  }

  private fun emit() {
    if (app.hasActiveReactInstance()) app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("SpotifyRemoteState", snapshot().toString())
  }

  private fun close() {
    generation++
    finishConnection("CONNECTION_LOST")
    subscription?.cancel(); subscription = null
    remote?.let { SpotifyAppRemote.disconnect(it) }; remote = null
    player = null; artworkId = null; artworkPath = null; canPlayOnDemand = false
    emit()
  }
  @ReactMethod fun disconnect(promise: Promise) { main.post { close(); promise.resolve(null) } }
  @ReactMethod fun addListener(eventName: String) { /* Required by NativeEventEmitter. */ }
  @ReactMethod fun removeListeners(count: Int) { /* Required by NativeEventEmitter. */ }
  override fun invalidate() { main.post { close(); images.shutdownNow() }; super.invalidate() }
}

class SpotifyRemotePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(SpotifyRemoteModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
