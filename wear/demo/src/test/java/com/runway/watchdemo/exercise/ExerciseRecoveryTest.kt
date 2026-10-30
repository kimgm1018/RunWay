package com.runway.watchdemo.exercise

import android.Manifest
import android.app.Application
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.data.*
import com.google.common.util.concurrent.Futures
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExerciseRecoveryTest {
    @Test fun onlyAnExerciseOwnedByThisAppCanBeEndedBeforeFreshStart() {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACTIVITY_RECOGNITION)
        for ((status, shouldEnd) in listOf(2 to true, 1 to false, 0 to false)) {
            val calls = mutableListOf<String>()
            val client = Proxy.newProxyInstance(ExerciseClient::class.java.classLoader, arrayOf(ExerciseClient::class.java)) { _, method, _ ->
                calls.add(method.name)
                when (method.name) {
                    "getCurrentExerciseInfoAsync" -> Futures.immediateFuture(ExerciseInfo(status, ExerciseType.RUNNING))
                    "endExerciseAsync" -> Futures.immediateFuture(null)
                    "getCapabilitiesAsync" -> Futures.immediateFailedFuture<Any>(IllegalStateException("end test after recovery"))
                    else -> null
                }
            } as ExerciseClient
            runCatching { HealthExerciseSource(context, client).start({}, {}) }
            assertEquals("status=$status calls=$calls", shouldEnd, "endExerciseAsync" in calls)
            if (shouldEnd) assertTrue(calls.indexOf("endExerciseAsync") < calls.indexOf("getCapabilitiesAsync"))
        }
    }
}
