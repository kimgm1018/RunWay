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
import android.location.LocationManager
import androidx.health.services.client.data.ExerciseConfig

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
    private var supported: Set<DataType<*, *>> = setOf(DataType.HEART_RATE_BPM)
    private var started: ExerciseConfig? = null

    private fun client(): ExerciseClient {
        val capabilities = ExerciseCapabilities(
            mapOf(ExerciseType.RUNNING to ExerciseTypeCapabilities(supported, emptyMap(), emptyMap(), false)),
        )
        return Proxy.newProxyInstance(ExerciseClient::class.java.classLoader, arrayOf(ExerciseClient::class.java)) { _, method, args ->
            calls.add(method.name)
            when (method.name) {
                "getCurrentExerciseInfoAsync" -> Futures.immediateFuture(ExerciseInfo(trackedStatus, ExerciseType.UNKNOWN))
                "getCapabilitiesAsync" -> Futures.immediateFuture(capabilities)
                "setUpdateCallback" -> { registered.add(args!![0] as ExerciseUpdateCallback); null }
                "startExerciseAsync" -> { started = args!![0] as ExerciseConfig; Futures.immediateFuture(null) }
                else -> Futures.immediateFuture(null)
            }
        } as ExerciseClient
    }

    private fun gateway(location: Boolean = false, gpsOn: Boolean = true): HealthServicesExerciseGateway {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACTIVITY_RECOGNITION)
        if (location) shadowOf(context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        else shadowOf(context).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        shadowOf(context.getSystemService(LocationManager::class.java)).setProviderEnabled(LocationManager.GPS_PROVIDER, gpsOn)
        // 화면 위(앱이 보이는) 상태로 본다. 백그라운드는 아래 별도 테스트가 gpsAllowed=false로 확인한다.
        return HealthServicesExerciseGateway(context, client(), gpsAllowed = { RunLocationHold.permitted(it) })
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

    // S15P31E105-549: GPS is used only when the permission, the GPS provider and the LOCATION capability are all there.
    @Test
    fun startTurnsOnGpsAndLocationWhenEverythingIsThere() = runBlocking {
        supported = setOf(DataType.HEART_RATE_BPM, DataType.LOCATION)
        gateway(location = true).start()
        val config = started!!
        assertTrue(config.isGpsEnabled)
        assertTrue(DataType.LOCATION in config.dataTypes)
    }

    @Test
    fun startRunsWithoutGpsWhenTheLocationPermissionIsMissing() = runBlocking {
        supported = setOf(DataType.HEART_RATE_BPM, DataType.LOCATION)
        gateway(location = false).start()
        assertFalse(started!!.isGpsEnabled)
        assertFalse(DataType.LOCATION in started!!.dataTypes)
    }

    @Test
    fun startRunsWithoutGpsWhenTheGpsProviderIsOff() = runBlocking {
        supported = setOf(DataType.HEART_RATE_BPM, DataType.LOCATION)
        gateway(location = true, gpsOn = false).start()
        assertFalse(started!!.isGpsEnabled)
    }

    @Test
    fun startRunsWithoutGpsWhenLocationIsNotSupported() = runBlocking {
        gateway(location = true).start()
        assertFalse(started!!.isGpsEnabled)
        assertFalse(DataType.LOCATION in started!!.dataTypes)
    }

    @Test
    fun aLocationSampleKeepsItsTimeAccuracyAndAltitude() {
        val boot = java.time.Instant.parse("2026-11-10T00:00:00Z")
        val point = androidx.health.services.client.data.SampleDataPoint(
            DataType.LOCATION,
            androidx.health.services.client.data.LocationData(37.5, 127.0, 31.0),
            java.time.Duration.ofSeconds(90),
            accuracy = androidx.health.services.client.data.LocationAccuracy(4.0),
        )
        val reading = HealthServicesExerciseGateway.locationReading(point, boot, 60)
        assertEquals(boot.plusSeconds(90), reading.measuredAt)
        assertEquals(60L, reading.elapsedSec)
        assertEquals(com.runway.watch.batch.GeoFix(37.5, 127.0, 4.0, 31.0), reading.location)
    }

    @Test
    fun aLocationSampleWithoutQualityLeavesItUnknown() {
        val point = androidx.health.services.client.data.SampleDataPoint(
            DataType.LOCATION,
            androidx.health.services.client.data.LocationData(37.5, 127.0),
            java.time.Duration.ofSeconds(1),
        )
        val fix = HealthServicesExerciseGateway.locationReading(point, java.time.Instant.EPOCH, 0).location!!
        assertEquals(null, fix.accuracyM)
        assertEquals(null, fix.altitudeM)
    }

    // A-1/B-1: from the background (not on screen, no held type) the run starts without GPS rather than risk a refused
    // location service.
    @Test
    fun startRunsWithoutGpsWhenTheLocationServiceTypeIsNotPossible() = runBlocking {
        supported = setOf(DataType.HEART_RATE_BPM, DataType.LOCATION)
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACTIVITY_RECOGNITION, Manifest.permission.ACCESS_FINE_LOCATION)
        shadowOf(context.getSystemService(LocationManager::class.java)).setProviderEnabled(LocationManager.GPS_PROVIDER, true)
        HealthServicesExerciseGateway(context, client(), gpsAllowed = { false }).start()
        assertFalse(started!!.isGpsEnabled)
    }

    // R-3: a service that already holds the location type keeps GPS allowed in the background; without permission or
    // with GPS off it is never allowed.
    @Test
    fun locationHoldAllowsGpsOnlyWithPermissionGpsOnAndTheTypeHeld() {
        val context = RuntimeEnvironment.getApplication()
        val gps = shadowOf(context.getSystemService(LocationManager::class.java))
        try {
            RunLocationHold.held = true
            shadowOf(context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
            gps.setProviderEnabled(LocationManager.GPS_PROVIDER, true)
            assertTrue(RunLocationHold.allowed(context))
            gps.setProviderEnabled(LocationManager.GPS_PROVIDER, false)
            assertFalse(RunLocationHold.allowed(context))
            gps.setProviderEnabled(LocationManager.GPS_PROVIDER, true)
            shadowOf(context).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
            assertFalse(RunLocationHold.allowed(context))
        } finally {
            RunLocationHold.held = false
        }
    }

    // S15P31E105-549 "항상 허용": off screen, GPS needs background location and waits for the service to hold the type.
    @Test
    fun offScreenGpsNeedsBackgroundLocationAndTheHeldType() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        shadowOf(context.getSystemService(LocationManager::class.java)).setProviderEnabled(LocationManager.GPS_PROVIDER, true)
        val screen = RunLocationHold.onScreen
        try {
            RunLocationHold.onScreen = { false }
            RunLocationHold.held = false
            shadowOf(context).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            assertFalse(RunLocationHold.allowed(context))
            assertFalse(RunLocationHold.gpsReady(context, waitMs = 50, stepMs = 10))

            shadowOf(context).grantPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            // The service may ask for the type now, but GPS stays off until it really holds it.
            assertTrue(RunLocationHold.allowed(context))
            assertFalse(RunLocationHold.gpsReady(context, waitMs = 50, stepMs = 10))
            RunLocationHold.held = true
            assertTrue(RunLocationHold.gpsReady(context, waitMs = 50, stepMs = 10))

            // On screen the type comes at once, background location or not.
            RunLocationHold.held = false
            RunLocationHold.onScreen = { true }
            shadowOf(context).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            assertTrue(RunLocationHold.gpsReady(context, waitMs = 50, stepMs = 10))
        } finally {
            RunLocationHold.held = false
            RunLocationHold.onScreen = screen
        }
    }
}
