package com.runway.health.watch

import android.content.Context
import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.*
import org.json.JSONArray
import java.util.concurrent.TimeUnit
import kotlin.random.Random

const val WATCH_SESSION_EVENT = "RunwayWatchSession"

/**
 * Run-session messages from the watch kept on the phone until JS handles them (S15P31E105-256).
 * The listener service writes here even when JS is not running; JS drains and acks on start.
 */
class WatchSessionInbox(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("watch_session_inbox", Context.MODE_PRIVATE)

  fun add(raw: ByteArray): SessionEnvelope? = synchronized(LOCK) {
    val incoming = decodeSessionMessage(raw) ?: return null
    val merged = mergeInbox(read(), incoming)
    write(merged.map { it to encodeRaw(it) })
    incoming
  }

  fun all(): List<SessionEnvelope> = synchronized(LOCK) { read() }

  fun ack(messageIds: Set<String>) = synchronized(LOCK) {
    write(read().filter { it.messageId !in messageIds }.map { it to encodeRaw(it) })
  }

  /** The session the run service is kept up for; read at app start to reattach (S15P31E105-256). */
  fun activeSessionId(): String? = synchronized(LOCK) { prefs.getString(KEY_ACTIVE, null) }

  fun setActiveSessionId(sessionId: String?) = synchronized(LOCK) {
    check(prefs.edit().apply { if (sessionId == null) remove(KEY_ACTIVE) else putString(KEY_ACTIVE, sessionId) }.commit())
  }

  fun nextMessageId(): String = synchronized(LOCK) {
    val next = prefs.getLong(KEY_SEQ, 0L) + 1
    check(prefs.edit().putLong(KEY_SEQ, next).commit())
    "phone:$next"
  }

  private fun read(): List<SessionEnvelope> {
    val array = try { JSONArray(prefs.getString(KEY_INBOX, "[]")) } catch (_: Exception) { JSONArray() }
    return (0 until array.length()).mapNotNull { decodeSessionMessage(array.optString(it).toByteArray(Charsets.UTF_8)) }
  }

  private fun write(entries: List<Pair<SessionEnvelope, String>>) {
    val array = JSONArray()
    entries.forEach { array.put(it.second) }
    check(prefs.edit().putString(KEY_INBOX, array.toString()).commit())
  }

  private fun encodeRaw(message: SessionEnvelope): String =
    String(
      encodeSessionMessage(message.type, message.messageId, message.replyTo, message.senderDeviceId, message.sessionId, message.payload.toString()),
      Charsets.UTF_8,
    )

  private companion object {
    val LOCK = Any()
    const val KEY_INBOX = "inbox"
    const val KEY_SEQ = "seq"
    const val KEY_ACTIVE = "active_session"
  }
}

/** RN bridge: send to the watch, drain/ack the inbox, and keep the run service up. */
class WatchSessionModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val inbox by lazy { WatchSessionInbox(app) }
  private val batches by lazy { WatchBatchStore(app) }

  override fun getName() = "WatchSession"

  override fun initialize() {
    super.initialize()
    emitter = { event ->
      if (app.hasActiveReactInstance()) {
        app.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(WATCH_SESSION_EVENT, event)
      }
    }
  }

  override fun invalidate() {
    emitter = null
    scope.cancel()
    super.invalidate()
  }

  // NativeEventEmitter requires these on Android.
  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) = Unit
  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) = Unit

  /**
   * Sends to every connected watch node with the same messageId, at most 3 tries (9.5). Resolves with the messageId once
   * MessageClient accepted it; that is only a transport ack, never the watch's execution result.
   */
  @ReactMethod fun send(path: String, type: String, sessionId: String, payloadJson: String, promise: Promise) {
    if (!isSendablePath(path)) {
      promise.reject("WATCH_INVALID", "지원하지 않는 워치 메시지입니다.")
      return
    }
    scope.launch {
      val messageId = inbox.nextMessageId()
      val bytes = try {
        encodeSessionMessage(type, messageId, null, null, sessionId, payloadJson)
      } catch (_: Exception) {
        promise.reject("WATCH_INVALID", "워치 메시지를 만들지 못했습니다.")
        return@launch
      }
      for (delayMs in retryDelaysMs { Random.nextLong(0, 501) }) {
        if (delayMs > 0) delay(delayMs)
        try {
          val nodes = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 10, TimeUnit.SECONDS)
          if (nodes.isNotEmpty()) {
            nodes.forEach { node ->
              Tasks.await(Wearable.getMessageClient(app).sendMessage(node.id, path, bytes), 10, TimeUnit.SECONDS)
            }
            promise.resolve(messageId)
            return@launch
          }
        } catch (_: Exception) {
          // Retried below; the watch side deduplicates by messageId and commandId.
        }
      }
      promise.reject("WATCH_UNAVAILABLE", "워치에 메시지를 보내지 못했습니다.")
    }
  }

  /** JSON array of BATCH_DATA events still waiting for W07 (S15P31E105-311), oldest first. */
  @ReactMethod fun pendingBatches(promise: Promise) {
    scope.launch {
      try {
        val array = JSONArray()
        batches.open().forEach { array.put(org.json.JSONObject(batchJsEvent(it))) }
        promise.resolve(array.toString())
      } catch (_: Exception) {
        promise.reject("WATCH_STORAGE", "워치 기록을 읽지 못했습니다.")
      }
    }
  }

  /**
   * Phone takeover (S15P31E105-464): closes new watch batch intake for the session and resolves with the batches already
   * stored and still waiting for W07 (same JSON shape as [pendingBatches]). Those are the ones to confirm before S08.
   */
  @ReactMethod fun blockBatches(sessionId: String, promise: Promise) {
    scope.launch {
      try {
        val array = JSONArray()
        batches.block(sessionId).forEach { array.put(org.json.JSONObject(batchJsEvent(it))) }
        promise.resolve(array.toString())
      } catch (_: Exception) {
        promise.reject("WATCH_STORAGE", "워치 기록을 잠그지 못했습니다.")
      }
    }
  }

  /** Opens intake again: the takeover was not sent, was refused with WATCH kept, or the run is over. */
  @ReactMethod fun unblockBatches(sessionId: String, promise: Promise) {
    scope.launch {
      try {
        batches.unblock(sessionId)
        promise.resolve(null)
      } catch (_: Exception) {
        promise.reject("WATCH_STORAGE", "워치 기록 수신을 다시 열지 못했습니다.")
      }
    }
  }

  /** Whether a watch node is reachable now (MessageClient transport only, not the watch app's own state). */
  @ReactMethod fun isWatchConnected(promise: Promise) {
    scope.launch {
      try {
        val nodes = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 10, TimeUnit.SECONDS)
        promise.resolve(nodes.isNotEmpty())
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }
  }

  /** W07 answered COMMITTED: store the ACK, then send BATCH_COMMITTED to the watch. Rejects an ACK that does not match. */
  @ReactMethod fun commitBatch(batchId: String, acceptedCount: Double, promise: Promise) {
    scope.launch {
      val batch = try { batches.commit(batchId, acceptedCount.toInt()) } catch (_: Exception) { null }
      if (batch == null) {
        promise.reject("WATCH_BATCH", "저장 확인이 기록과 맞지 않습니다.")
        return@launch
      }
      promise.resolve(sendToWatch(BATCH_COMMITTED_PATH, batchCommitted(inbox.nextMessageId(), batch)))
    }
  }

  /** W07 refused the batch for good: keep it as FAILED and tell the watch to stop resending it. */
  @ReactMethod fun failBatch(batchId: String, code: String, promise: Promise) {
    scope.launch {
      val batch = try { batches.fail(batchId, code) } catch (_: Exception) { null }
      if (batch == null) {
        promise.resolve(false)
        return@launch
      }
      promise.resolve(sendToWatch(ERROR_PATH, batchError(inbox.nextMessageId(), batch)))
    }
  }

  private suspend fun sendToWatch(path: String, bytes: ByteArray): Boolean {
    for (delayMs in retryDelaysMs { Random.nextLong(0, 501) }) {
      if (delayMs > 0) delay(delayMs)
      try {
        val nodes = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 10, TimeUnit.SECONDS)
        if (nodes.isNotEmpty()) {
          nodes.forEach { Tasks.await(Wearable.getMessageClient(app).sendMessage(it.id, path, bytes), 10, TimeUnit.SECONDS) }
          return true
        }
      } catch (_: Exception) {
        // Retried; the watch resends the batch and gets the stored answer anyway.
      }
    }
    return false
  }

  /** JSON array of events (ids as strings) left in the inbox. */
  @ReactMethod fun drainInbox(promise: Promise) {
    scope.launch {
      try {
        val array = JSONArray()
        inbox.all().forEach { array.put(org.json.JSONObject(toJsEvent(it))) }
        promise.resolve(array.toString())
      } catch (_: Exception) {
        promise.reject("WATCH_STORAGE", "워치 메시지를 읽지 못했습니다.")
      }
    }
  }

  @ReactMethod fun ackInbox(messageIds: ReadableArray, promise: Promise) {
    scope.launch {
      try {
        inbox.ack((0 until messageIds.size()).mapNotNull { messageIds.getString(it) }.toSet())
        promise.resolve(null)
      } catch (_: Exception) {
        promise.reject("WATCH_STORAGE", "워치 메시지를 정리하지 못했습니다.")
      }
    }
  }

  /**
   * Starts or stops the run foreground service (D-11). Started only from the foreground app. [location] adds the
   * location type while the phone records the run itself after a takeover (S15P31E105-464).
   */
  @ReactMethod fun setRunActive(active: Boolean, sessionId: String?, location: Boolean, promise: Promise) {
    try {
      inbox.setActiveSessionId(if (active) sessionId ?: inbox.activeSessionId() else null)
      val intent = Intent(app, RunForegroundService::class.java).putExtra(RunForegroundService.EXTRA_LOCATION, location)
      if (active) {
        app.startForegroundService(intent)
      } else {
        app.stopService(intent)
      }
      promise.resolve(null)
    } catch (_: Exception) {
      promise.reject("RUN_SERVICE", "러닝 알림을 시작하지 못했습니다.")
    }
  }

  @ReactMethod fun getActiveSessionId(promise: Promise) {
    scope.launch {
      try { promise.resolve(inbox.activeSessionId()) }
      catch (_: Exception) { promise.resolve(null) }
    }
  }

  companion object {
    /** Set while JS is attached; the listener service calls it after storing a message. */
    @Volatile var emitter: ((String) -> Unit)? = null
  }
}

class WatchSessionPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(WatchSessionModule(reactContext), RunLocationModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
