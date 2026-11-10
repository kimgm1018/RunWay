package com.runway.health.watch

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val READINESS_STATE_PATH = "/runway/v1/state/watch-readiness"
private const val READINESS_QUERY_PATH = "/runway/v1/state/readiness-query"

data class SensorReadiness(val heartRate: Boolean, val activity: Boolean)

/** No old, other-node, partial or differently versioned evidence can make a watch ready. */
fun matchingReadiness(
  node: String?, expectedNode: String, request: String?, expectedRequest: String,
  version: Int, heart: Any?, activity: Any?,
): SensorReadiness? =
  if (node == expectedNode && request == expectedRequest && version == 1 && heart is Boolean && activity is Boolean)
    SensorReadiness(heart, activity) else null

class WatchReadinessProbe(private val app: Context) {
  // One snapshot path is owned by each watch. Serialize this phone's requests so they cannot overwrite each other.
  private val mutex = Mutex()

  @SuppressLint("VisibleForTests")
  @Suppress("DEPRECATION")
  suspend fun read(nodeId: String): WritableMap = mutex.withLock {
    val answer = Arguments.createMap()
    answer.putString("appStatus", "noResponse")
    val client = Wearable.getDataClient(app)
    val reply = CompletableDeferred<SensorReadiness>()
    val requestId = UUID.randomUUID().toString()
    val listener = DataClient.OnDataChangedListener { events ->
      for (event in events) {
        if (event.type != DataEvent.TYPE_CHANGED || event.dataItem.uri.path != READINESS_STATE_PATH) continue
        runCatching {
          val map = DataMapItem.fromDataItem(event.dataItem).dataMap
          val bundle = map.toBundle()
          matchingReadiness(
            event.dataItem.uri.host, nodeId, map.getString("requestId"), requestId,
            map.getInt("protocolVersion"), bundle.get("heartRate"), bundle.get("activity"),
          )?.let { reply.complete(it) }
        }
      }
    }
    try {
      if (Tasks.await(Wearable.getNodeClient(app).connectedNodes, 3, TimeUnit.SECONDS).none { it.id == nodeId }) {
        answer.putString("appStatus", "disconnected")
        return@withLock answer
      }
      val capable = runCatching {
        Tasks.await(Wearable.getCapabilityClient(app).getCapability("runway_readiness_v1", CapabilityClient.FILTER_REACHABLE), 3, TimeUnit.SECONDS)
          .nodes.any { it.id == nodeId }
      }.getOrNull()
      // Install/update can only be distinguished from no response when capability discovery succeeded.
      if (capable == false) answer.putString("appStatus", "missingOrOutdated")
      Tasks.await(client.addListener(listener, Uri.Builder().scheme("wear").authority(nodeId).path(READINESS_STATE_PATH).build(), DataClient.FILTER_LITERAL), 3, TimeUnit.SECONDS)
      Tasks.await(Wearable.getMessageClient(app).sendMessage(nodeId, READINESS_QUERY_PATH, requestId.toByteArray(Charsets.UTF_8)), 3, TimeUnit.SECONDS)
      val sensors = withTimeoutOrNull(6_000) { reply.await() }
      // A disconnected watch must not be resurrected by an in-flight DataItem response.
      val connected = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 3, TimeUnit.SECONDS).any { it.id == nodeId }
      if (!connected) answer.putString("appStatus", "disconnected")
      if (sensors != null && connected) {
        answer.putString("appStatus", "responded")
        answer.putBoolean("heartRate", sensors.heartRate)
        answer.putBoolean("activity", sensors.activity)
      }
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      // No credentials, health records, raw exception messages or stale snapshots are returned.
    } finally {
      client.removeListener(listener)
    }
    answer
  }
}
