package com.runway.watchdemo.exercise

import android.Manifest
import androidx.health.services.client.ExerciseClient
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.data.*
import com.google.common.util.concurrent.Futures
import com.runway.watchdemo.session.*
import java.lang.reflect.Proxy
import java.time.Duration
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExerciseMetadataTest {
    private fun update(points: List<DataPoint<*>>): ExerciseUpdate {
        // The SDK's primary constructor is internal to its Kotlin module.
        val constructor = ExerciseUpdate::class.java.declaredConstructors.first {
            it.parameterCount == 10 && it.parameterTypes[0] == DataPointContainer::class.java
        }
        constructor.isAccessible = true
        return constructor.newInstance(DataPointContainer(points), emptySet<Any>(), emptySet<Any>(),
            ExerciseStateInfo(ExerciseState.ACTIVE, 0), null, null, null, null, Duration.ZERO, emptySet<Any>()) as ExerciseUpdate
    }
    private fun exercise(block: (ExerciseUpdateCallback, MutableList<MetricSample>, MutableList<ExerciseSignal>) -> Unit) {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACTIVITY_RECOGNITION)
        val supported = setOf<DataType<*, *>>(DataType.STEPS, DataType.DISTANCE)
        val capabilities = ExerciseCapabilities(mapOf(ExerciseType.RUNNING to
            ExerciseTypeCapabilities(supported, emptyMap(), emptyMap(), false)))
        var listener: ExerciseUpdateCallback? = null
        val client = Proxy.newProxyInstance(ExerciseClient::class.java.classLoader, arrayOf(ExerciseClient::class.java)) { _, method, args ->
            when (method.name) {
                "getCurrentExerciseInfoAsync" -> Futures.immediateFuture(ExerciseInfo(3, ExerciseType.RUNNING))
                "getCapabilitiesAsync" -> Futures.immediateFuture(capabilities)
                "setUpdateCallback" -> { listener = args!![0] as ExerciseUpdateCallback; null }
                "startExerciseAsync", "endExerciseAsync", "clearUpdateCallbackAsync" -> Futures.immediateFuture(null)
                else -> null
            }
        } as ExerciseClient
        val source = HealthExerciseSource(context, client)
        val samples = mutableListOf<MetricSample>(); val signals = mutableListOf<ExerciseSignal>()
        source.start({ samples.addAll(it) }, { signals.add(it) })
        try { block(requireNotNull(listener), samples, signals) } finally { source.stop(); source.close() }
    }
    @Test fun intervalAndTotalSupportRemainDistinctAfterAvailabilityUpdates() = exercise { listener, _, signals ->
        listener.onExerciseUpdateReceived(update(emptyList()))
        val support = (signals.last() as ExerciseSignal.Active).support
        assertEquals("supported", support["STEPS.support"])
        assertEquals("unsupported", support["STEPS_TOTAL.support"])
        assertEquals("supported", support["DISTANCE.support"])
        assertEquals("unsupported", support["DISTANCE_TOTAL.support"])
        assertEquals("unsupported", support["VO2_MAX.support"])
        listener.onAvailabilityChanged(DataType.DISTANCE, DataTypeAvailability.AVAILABLE)
        val availability = (signals.last() as ExerciseSignal.Availability).values
        assertEquals("AVAILABLE", availability["DISTANCE.availability"])
        assertFalse(availability.containsKey("DISTANCE.support"))
    }
    @Test fun vo2MaxSupportAndSampleAreRecordedWhenCapabilityAllows() {
        val context = RuntimeEnvironment.getApplication()
        shadowOf(context).grantPermissions(Manifest.permission.ACTIVITY_RECOGNITION)
        val supported = setOf<DataType<*, *>>(DataType.STEPS, DataType.VO2_MAX)
        val capabilities = ExerciseCapabilities(mapOf(ExerciseType.RUNNING to
            ExerciseTypeCapabilities(supported, emptyMap(), emptyMap(), false)))
        var listener: ExerciseUpdateCallback? = null
        val client = Proxy.newProxyInstance(ExerciseClient::class.java.classLoader, arrayOf(ExerciseClient::class.java)) { _, method, args ->
            when (method.name) {
                "getCurrentExerciseInfoAsync" -> Futures.immediateFuture(ExerciseInfo(3, ExerciseType.RUNNING))
                "getCapabilitiesAsync" -> Futures.immediateFuture(capabilities)
                "setUpdateCallback" -> { listener = args!![0] as ExerciseUpdateCallback; null }
                "startExerciseAsync", "endExerciseAsync", "clearUpdateCallbackAsync" -> Futures.immediateFuture(null)
                else -> null
            }
        } as ExerciseClient
        val source = HealthExerciseSource(context, client)
        val samples = mutableListOf<MetricSample>(); val signals = mutableListOf<ExerciseSignal>()
        source.start({ samples.addAll(it) }, { signals.add(it) })
        try {
            requireNotNull(listener).onExerciseUpdateReceived(update(emptyList()))
            val support = (signals.last() as ExerciseSignal.Active).support
            assertEquals("supported", support["VO2_MAX.support"])
            requireNotNull(listener).onExerciseUpdateReceived(update(listOf(
                SampleDataPoint(DataType.VO2_MAX, 48.5, Duration.ofMillis(1500)))))
            val vo2 = samples.single { it.kind == MetricKind.VO2_MAX }
            assertEquals(48.5, vo2.value)
            assertEquals("mL/kg/min", vo2.unit)
        } finally {
            source.stop(); source.close()
        }
    }

    @Test fun intervalAccuracySurvivesAdapterAndJsonExport() = exercise { listener, samples, _ ->
        val accuracy = LocationAccuracy(5.0, 8.0)
        listener.onExerciseUpdateReceived(update(listOf(IntervalDataPoint(DataType.DISTANCE, 4.0,
            Duration.ofMillis(1000), Duration.ofMillis(2000), accuracy = accuracy))))
        val sample = samples.single()
        assertEquals(accuracy.toString(), sample.quality)
        val record = SessionRecord("accuracy", "runner01", 1700000000000, 1000, samples = samples)
        assertEquals(accuracy.toString(), SessionJson.decode(SessionJson.encode(record)).samples.single().quality)
    }
}
