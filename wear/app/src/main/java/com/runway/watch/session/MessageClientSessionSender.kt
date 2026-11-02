package com.runway.watch.session

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Task
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "RunSession"

/** Sends a run-session message to every connected node, like the daily-HR sender. Logs only the error type. */
class MessageClientSessionSender(context: Context) : SessionSender {
    private val context = context.applicationContext

    override suspend fun send(path: String, bytes: ByteArray): Boolean = try {
        val nodes = Wearable.getNodeClient(context).connectedNodes.await()
        val messages = Wearable.getMessageClient(context)
        nodes.count { node ->
            try {
                messages.sendMessage(node.id, path, bytes).await()
                true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "session send failed: ${e.javaClass.simpleName}")
                false
            }
        } > 0
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "node lookup failed: ${e.javaClass.simpleName}")
        false
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnCompleteListener { task ->
        val error = task.exception
        when {
            error != null -> cont.resumeWithException(error)
            task.isCanceled -> cont.cancel()
            else -> cont.resume(task.result)
        }
    }
}
