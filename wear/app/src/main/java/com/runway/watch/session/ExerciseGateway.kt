package com.runway.watch.session

/**
 * The real measurement the watch starts and stops for an approved command. Returning normally means the call took
 * effect. [ExerciseRejected] means it certainly did not (reported REJECTED); any other failure leaves it unknown.
 */
interface ExerciseGateway {
    suspend fun start()
    suspend fun pause()
    suspend fun resume()
    suspend fun end()

    /**
     * After the app process restarted mid-run (S15P31E105-445): listens again to this app's exercise that Health Services
     * kept running. False when none is left (ended by the OS, an update or another app); nothing is started then.
     */
    suspend fun reattach(): Boolean

    /**
     * Delivers the readings the platform is holding back right away (S15P31E105-420). With the screen off Health
     * Services batches distance for about a minute, which made group ranks jump; a group run asks for them sooner.
     */
    suspend fun flush() = Unit

    /**
     * Whether the last [start] that returned normally turned watch GPS on (S15P31E105-864); null when unknown. The phone
     * shows that speed and AI coaching are limited when a remote start ran without GPS.
     */
    val startedWithGps: Boolean? get() = null
}

/**
 * What a run needs from this watch before it starts (S15P31E105-864). Heart rate and activity recognition are required:
 * Android refuses the health-type run service without them and the app crashed on START. [remoteGps] tells whether a
 * run started from the phone, with this app off screen, can use GPS (background location "항상 허용").
 */
interface RunCapability {
    fun sensorsGranted(): Boolean
    fun remoteGps(): Boolean
}

object FullCapability : RunCapability {
    override fun sensorsGranted() = true
    override fun remoteGps() = true
}

/** A definite refusal with a reason code, e.g. PERMISSION_DENIED or EXERCISE_IN_USE (another app's exercise). */
class ExerciseRejected(val reasonCode: String) : Exception(reasonCode)

/** Sends one message to the phone; true when at least one connected node accepted it. */
fun interface SessionSender {
    suspend fun send(path: String, bytes: ByteArray): Boolean
}
