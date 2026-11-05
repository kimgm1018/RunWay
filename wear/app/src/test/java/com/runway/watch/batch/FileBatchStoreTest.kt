package com.runway.watch.batch

import com.runway.watch.session.SessionSender
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.Instant

/** The file outbox with the real uploader: batches survive a reload and resends keep their wait (device E2E bug). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FileBatchStoreTest {
    private var nowMs = 0L
    private val sent = mutableListOf<String>()
    private val sender = SessionSender { _, bytes -> sent += String(bytes, Charsets.UTF_8); true }

    private fun uploader(store: BatchStore) = BatchUploader(
        store = store,
        sender = sender,
        nextMessageId = { "watch:1" },
        clock = { nowMs },
        newId = { "00000000-0000-4000-8000-000000000001" },
        jitter = { 0 },
    )

    @Test
    fun `a stored batch waits for its ACK between tries and keeps id and body after a reload`() = runBlocking {
        val store = FileBatchStore(RuntimeEnvironment.getApplication())
        val u = uploader(store)
        u.begin("201", "101")
        u.offer(listOf(Reading(Instant.parse("2026-10-28T01:00:00Z"), 1, heartRateBpm = 140.0)))
        nowMs = 5_000
        u.tick()
        assertEquals(1, sent.size)

        // Reading the store every tick must not make the batch due again before the 10 s ACK wait.
        repeat(9) {
            nowMs += 1_000
            u.tick()
        }
        assertEquals(1, sent.size)
        u.onReceived("00000000-0000-4000-8000-000000000001")
        nowMs += 20_000
        u.tick()
        assertEquals(1, sent.size)

        val reloaded = FileBatchStore(RuntimeEnvironment.getApplication()).all().single()
        assertEquals("00000000-0000-4000-8000-000000000001", reloaded.id)
        assertTrue(reloaded.received)
        assertEquals(1, reloaded.attempts)
        // After a restart the batch is due at once, with the same body.
        val restarted = uploader(FileBatchStore(RuntimeEnvironment.getApplication()))
        restarted.tick()
        assertEquals(2, sent.size)
        assertEquals(sent[0], sent[1])
    }

    @Test
    fun `batch marks survive a reload and are not read as a batch`() {
        val marks = BatchMarks("201", mapOf("heartRate" to Instant.parse("2026-10-28T01:00:02Z")))
        FileBatchStore(RuntimeEnvironment.getApplication()).saveMarks(marks)
        val reloaded = FileBatchStore(RuntimeEnvironment.getApplication())
        assertEquals(marks, reloaded.marks())
        assertTrue(reloaded.all().isEmpty())
    }
}
