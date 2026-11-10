package com.runway.watch.readiness

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import java.util.UUID
import java.util.concurrent.TimeUnit

const val READINESS_QUERY_PATH = "/runway/v1/state/readiness-query"
const val READINESS_STATE_PATH = "/runway/v1/state/watch-readiness"

/** Read permissions only: this probe never grants permissions, launches UI or starts collection. */
@SuppressLint("VisibleForTests")
fun publishReadiness(context: Context, rawRequest: ByteArray) {
    if (rawRequest.size > 64) return
    val requestId = rawRequest.toString(Charsets.UTF_8)
    if (runCatching { UUID.fromString(requestId).toString() }.getOrNull() != requestId) return
    val granted = runPermissions(Build.VERSION.SDK_INT).filter {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }.toSet()
    val state = sensorPermissions(Build.VERSION.SDK_INT, granted)
    val request = PutDataMapRequest.create(READINESS_STATE_PATH).apply {
        dataMap.putInt("protocolVersion", 1)
        dataMap.putString("requestId", requestId)
        dataMap.putBoolean("heartRate", state.heartRate)
        dataMap.putBoolean("activity", state.activity)
    }.asPutDataRequest().setUrgent()
    Tasks.await(Wearable.getDataClient(context).putDataItem(request), 5, TimeUnit.SECONDS)
}
