package com.runway.watch.session

import android.Manifest
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseCapabilities
import androidx.health.services.client.data.ExerciseInfo
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseTypeCapabilities
import com.google.common.util.concurrent.Futures
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.lang.reflect.Proxy

/**
 * Health Services auto-ends an exercise whose owner has no update listener ("Client listener has been away for too
 * long", seen on SM-L300 in the S15P31E105-256 device E2E): the next pause then failed with no exercise left.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HealthServicesExerciseGatewayTest {
    private val calls = mutableListOf<String>()
    private val registered = mutableListOf<ExerciseUpdateCallback>()
    // ExerciseTrackedStatus: 2 = this app's exercise in progress, 3 = no exercise.
    private var trackedStatus = 3

    private fun client(): ExerciseClient {
        val capabilities = ExerciseCapabilities(
            mapOf(ExerciseType.RUNNING to ExerciseTypeCapabilities(setOf<DataType<*, *>>(DataType.HEART_RATE_BPM), emptyMap(), emptyMap(), false)),
        )
        return Proxy.newProxyInstance(ExerciseClient::class.java.classLoader, arrayOf(ExerciseClient::class.java)) { _, method, args ->
            calls.add(method.name)
            when (method.name) {
                "getCurrentExerciseInfoAsync" -> Futures.immediateFuture(ExerciseInfo(trackedStatus, ExerciseType.UNKNOWN))
                "getCapabilitiesAsync" -> Futures.immediateFuture(capabilities)
                "setUpdateCallback" -> { registered.add(args!![0] as ExerciseUpdateCallback); null }
                else -> Futures.immediateFuture(null)
            }
        } as ExerciseClient
    }

    private fun gateway(): HealthServicesExerciseGateway {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACTIVITY_RECOGNITION)
        return HealthServicesExerciseGateway(context, client())
    }

    @Test
    fun startRegistersAnUpdateListenerBeforeStartingTheExercise() = runBlocking {
        gateway().start()
        assertEquals(1, registered.size)
        assertTrue(calls.indexOf("setUpdateCallback") < calls.indexOf("startExerciseAsync"))
    }

    @Test
    fun pauseAfterAProcessRestartRegistersTheListenerAgainBeforePausing() = runBlocking {
        gateway().pause()
        assertEquals(1, registered.size)
        assertTrue(calls.indexOf("setUpdateCallback") < calls.indexOf("pauseExerciseAsync"))
    }

    @Test
    fun theListenerIsRegisteredOnlyOncePerGateway() = runBlocking {
        val gateway = gateway()
        gateway.start()
        gateway.pause()
        gateway.resume()
        assertEquals(1, registered.size)
    }

    @Test
    fun endClearsTheListenerAfterEndingTheExercise() = runBlocking {
        val gateway = gateway()
        gateway.start()
        gateway.end()
        assertTrue(calls.indexOf("endExerciseAsync") < calls.lastIndexOf("clearUpdateCallbackAsync"))
        gateway.resume()
        assertEquals(2, registered.size)
    }

    // S15P31E105-445: after a process restart the kept exercise is listened to again; a gone one is not restarted.
    @Test
    fun reattachListensAgainToTheExerciseThisAppStillOwns() = runBlocking {
        trackedStatus = 2
        assertTrue(gateway().reattach())
        assertEquals(1, registered.size)
        assertFalse(calls.contains("startExerciseAsync"))
    }

    @Test
    fun reattachWithoutAnOwnedExerciseStartsNothing() = runBlocking {
        trackedStatus = 3
        assertFalse(gateway().reattach())
        assertTrue(registered.isEmpty())
        assertFalse(calls.contains("startExerciseAsync"))
    }
}
