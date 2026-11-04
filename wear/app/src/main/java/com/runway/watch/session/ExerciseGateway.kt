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
}

/** A definite refusal with a reason code, e.g. PERMISSION_DENIED or EXERCISE_IN_USE (another app's exercise). */
class ExerciseRejected(val reasonCode: String) : Exception(reasonCode)

/** Sends one message to the phone; true when at least one connected node accepted it. */
fun interface SessionSender {
    suspend fun send(path: String, bytes: ByteArray): Boolean
}
