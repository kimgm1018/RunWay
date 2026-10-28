package com.runway.watchdemo.upload

import com.runway.watchdemo.session.*
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class UploadDeadlineTest {
    @Test fun serverThatNeverReadsBodyCannotHoldUploadIndefinitely() {
        val server = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val release = CountDownLatch(1)
        val peer = Thread { server.accept().use { release.await(8, TimeUnit.SECONDS) } }.apply { isDaemon = true; start() }
        val store = MemoryStore()
        val sample = MetricSample(MetricKind.HEART_RATE, 1000, 1000, 150.0, "bpm")
        store.create(SessionRecord("large", "runner01", 1700000000000, 1000,
            state = SessionState.COMPLETED, endedElapsedMs = 2000, samples = List(25000) { sample }))
        val started = System.nanoTime()
        try {
            val result = UploadCoordinator(store, SessionUploader(true, 250)).upload("large", "http://127.0.0.1:${server.localPort}/upload")
            val ms = (System.nanoTime() - started) / 1_000_000
            assertFalse(result.accepted)
            assertTrue("request held the caller for $ms ms", ms < 5000)
            assertEquals(UploadState.FAILED, store.load("large").uploadState)
            assertEquals(25000, store.load("large").samples.size)
        } finally { release.countDown(); server.close(); peer.join(1000) }
    }
}
