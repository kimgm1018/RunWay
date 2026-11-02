package com.runway.watch.session

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * One controller per process, shared by the screens and the Data Layer listener so a command that arrives while the
 * screen is closed still runs once and is remembered (S15P31E105-256).
 */
class RunSessions private constructor(context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val controller = WatchSessionController(
        store = PrefsSessionStore(context),
        gateway = HealthServicesExerciseGateway(context),
        sender = MessageClientSessionSender(context),
    )
    val control = SessionRunControl(controller, scope)

    /** Handles a message from the listener service; malformed or foreign messages are ignored. */
    suspend fun receive(bytes: ByteArray) {
        decodeSessionMessage(bytes)?.let { controller.onMessage(it) }
    }

    companion object {
        @Volatile private var instance: RunSessions? = null

        fun get(context: Context): RunSessions =
            instance ?: synchronized(this) { instance ?: RunSessions(context.applicationContext).also { instance = it } }
    }
}
