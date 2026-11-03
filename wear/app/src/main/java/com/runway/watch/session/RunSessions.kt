package com.runway.watch.session

import android.content.Context
import android.os.SystemClock
import com.runway.watch.batch.BatchUploader
import com.runway.watch.batch.FileBatchStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * One controller per process, shared by the screens and the Data Layer listener so a command that arrives while the
 * screen is closed still runs once and is remembered (S15P31E105-256).
 */
class RunSessions private constructor(context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val store = PrefsSessionStore(context)
    private val sender = MessageClientSessionSender(context)

    /** Measurement batches of the run (S15P31E105-311); its own loop closes and resends them. */
    val uploader = BatchUploader(
        store = FileBatchStore(context),
        sender = sender,
        nextMessageId = store::nextMessageId,
        clock = SystemClock::elapsedRealtime,
    )
    val controller = WatchSessionController(
        store = store,
        gateway = HealthServicesExerciseGateway(context, onReadings = { readings -> scope.launch { uploader.offer(readings) } }),
        sender = sender,
        uploads = uploader,
        keepAlive = ServiceKeepAlive(context),
    )
    val control = SessionRunControl(controller, scope, uploader.state)

    /**
     * Controller messages run one at a time in arrival order, off the listener thread: an END waits up to 90 s for the
     * batch save ACKs, which arrive on that same listener thread (S15P31E105-311).
     */
    private val inbox = Channel<SessionEnvelope>(Channel.UNLIMITED)

    init {
        scope.launch { uploader.run() }
        scope.launch {
            for (message in inbox) {
                try { controller.onMessage(message) } catch (_: Exception) { /* storage error: the phone resends */ }
            }
        }
    }

    /** Handles a message from the listener service; malformed or foreign messages are ignored. Returns at once. */
    suspend fun receive(bytes: ByteArray) {
        val message = decodeSessionMessage(bytes) ?: return
        when {
            message.type == "BATCH_RECEIVED" && message.payload.optString("status") == "RECEIVED" -> message.batchId()?.let { uploader.onReceived(it) }
            message.type == "BATCH_COMMITTED" && message.payload.optString("status") == "COMMITTED" -> message.batchId()?.let { id ->
                uploader.onCommitted(id, message.payload.optInt("acceptedCount", -1))
            }
            message.type.startsWith("BATCH_") -> Unit
            message.type == "ERROR" && message.payload.optString("failedType") == "BATCH_DATA" ->
                message.replyTo?.let { uploader.onError(it, message.payload.optBoolean("retryable", false)) }
            else -> inbox.send(message)
        }
    }

    companion object {
        @Volatile private var instance: RunSessions? = null

        fun get(context: Context): RunSessions =
            instance ?: synchronized(this) { instance ?: RunSessions(context.applicationContext).also { instance = it } }
    }
}
