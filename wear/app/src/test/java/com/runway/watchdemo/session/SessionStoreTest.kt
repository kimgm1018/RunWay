package com.runway.watchdemo.session

import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SessionStoreTest {
    @Test fun legacyDatabaseRecordRemainsReadableAndExportsTypedDeviceAfterReopen() {
        val context: Context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("experiments.db")
        var store = SqliteSessionStore(context)
        val legacy = """{
            "schemaVersion":1,"sessionId":"legacy-device","participantId":"runner01",
            "startedAtEpochMs":1792378800000,"startedElapsedMs":1000,"endedElapsedMs":5000,
            "state":"COMPLETED","endReason":"user","uploadState":"PENDING",
            "device":{"model":"Watch7","api":"34","appVersion":"1.0","bootCount":"-1","synthetic":"false"},
            "capabilities":{"HEART_RATE.support":"supported"},"bpmEvents":[],"samples":[]
        }"""
        store.writableDatabase.execSQL("INSERT INTO sessions(id,body) VALUES(?,?)", arrayOf("legacy-device", legacy))
        store.close()
        store = SqliteSessionStore(context)
        try {
            assertEquals(DeviceInfo("Watch7", 34, "1.0", null, false), store.load("legacy-device").device)
            val claimed = store.claimUpload("legacy-device")!!
            assertEquals(UploadState.UPLOADING, claimed.uploadState)
            assertEquals(false, claimed.device.synthetic)
            val exported = org.json.JSONObject(store.export("legacy-device").readText())
            assertEquals(2, exported.getInt("schemaVersion"))
            assertEquals("legacy-device", exported.getString("sessionId"))
            assertEquals(34, exported.getJSONObject("device").get("api"))
            assertEquals(false, exported.getJSONObject("device").get("synthetic"))
            assertTrue(exported.getJSONObject("device").isNull("bootCount"))
            assertEquals("supported", store.load("legacy-device").capabilities["HEART_RATE.support"])
        } finally { store.close() }
    }

    @Test fun failedPayloadLoadRollsBackUploadClaim() {
        val context: Context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("experiments.db")
        val store = SqliteSessionStore(context)
        store.create(SessionRecord("broken-payload", "runner01", 1700000000000, 1000))
        store.finish("broken-payload", SessionState.COMPLETED, 2000, "user")
        store.writableDatabase.execSQL("INSERT INTO events(session_id,kind,event_key,body) VALUES(?,?,?,?)",
            arrayOf("broken-payload", "sample", "corrupt", "not-json"))
        assertTrue(runCatching { store.claimUpload("broken-payload") }.isFailure)
        assertEquals("An unreadable payload must not be stuck UPLOADING", UploadState.PENDING, store.list().single().uploadState)
        store.close()
    }
    @Test fun concurrentCallbacksAndUploadClaimsPreserveEveryRawSample() {
        val context: Context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("experiments.db")
        val store = SqliteSessionStore(context)
        store.create(SessionRecord("parallel", "runner01", 1700000000000, 1000))
        val workers = List(4) { worker -> Thread {
            for (index in 0 until 10) {
                val at = 1000L + worker * 10 + index
                store.appendSamples("parallel", listOf(MetricSample(MetricKind.HEART_RATE, at, at, 150.0, "bpm")))
            }
        }.apply { start() } }
        workers.forEach { it.join() }
        store.finish("parallel", SessionState.COMPLETED, 2000, "user")
        val accepted = java.util.concurrent.atomic.AtomicInteger()
        val uploads = List(4) { Thread { if (store.claimUpload("parallel") != null) accepted.incrementAndGet() }.apply { start() } }
        uploads.forEach { it.join() }
        assertEquals(1, accepted.get())
        assertEquals(40, store.load("parallel").samples.size)
        store.setUploadState("parallel", UploadState.FAILED)
        val exported = store.export("parallel")
        assertEquals(40, SessionJson.decode(exported.readText()).samples.size)
        assertNotNull(store.claimUpload("parallel"))
        assertEquals(40, store.load("parallel").samples.size)
        store.close()
    }
    @Test fun reopenPreservesRawEventsAndRecoversInterruptedSessions() {
        val context: Context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("experiments.db")
        var store = SqliteSessionStore(context)
        store.create(SessionRecord("run-1", "runner01", 1700000000000, 1000))
        store.appendBpmEvent("run-1", BpmEvent(1000, 1100, 164))
        val raw = MetricSample(MetricKind.HEART_RATE, 2000, 2000, 150.0, "bpm")
        store.appendSamples("run-1", listOf(raw, raw))
        store.close()
        store = SqliteSessionStore(context)
        store.recoverInterrupted()
        val saved = store.load("run-1")
        assertEquals(SessionState.INTERRUPTED, saved.state)
        assertEquals(listOf(raw), saved.samples)
        assertEquals(1100L, saved.events.single().appliedElapsedMs)
        assertTrue(SessionJson.encode(saved).contains("runner01"))
        store.close()
    }
    @Test fun completedRecordAndUncertainUploadRemainRetryable() {
        val context: Context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("experiments.db")
        val store = SqliteSessionStore(context)
        store.create(SessionRecord("run-2", "runner02", 1700000000000, 1000))
        store.finish("run-2", SessionState.COMPLETED, 2000, "user")
        store.setUploadState("run-2", UploadState.UPLOADING)
        store.recoverInterrupted()
        assertEquals(SessionState.COMPLETED, store.load("run-2").state)
        assertEquals(UploadState.FAILED, store.load("run-2").uploadState)
        store.close()
    }
}
