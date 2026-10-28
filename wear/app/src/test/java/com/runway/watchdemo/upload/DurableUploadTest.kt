package com.runway.watchdemo.upload

import com.runway.watchdemo.session.*
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DurableUploadTest {
    @Test fun failedAcknowledgmentAndRestartRetryTheSameDurableRecord() {
        val context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("experiments.db")
        var store = SqliteSessionStore(context)
        val sample = MetricSample(MetricKind.CADENCE, 1100, 1100, 160.0, "steps/min")
        store.create(SessionRecord("durable", "runner01", 1700000000000, 1000))
        store.appendSamples("durable", listOf(sample))
        store.finish("durable", SessionState.COMPLETED, 2000, "user")
        val keys = mutableListOf<String>()
        var acknowledge = false
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/upload") { exchange ->
            keys.add(exchange.requestHeaders.getFirst("Idempotency-Key"))
            exchange.requestBody.use { it.readBytes() }
            val bytes = """{"sessionId":"durable","accepted":$acknowledge}""".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            val endpoint = "http://127.0.0.1:${server.address.port}/upload"
            val uploader = SessionUploader(allowHttp = true)
            assertFalse(UploadCoordinator(store, uploader).upload("durable", endpoint).accepted)
            assertEquals(UploadState.FAILED, store.load("durable").uploadState)
            store.close()
            store = SqliteSessionStore(context)
            store.recoverInterrupted()
            assertEquals(listOf(sample), store.load("durable").samples)
            acknowledge = true
            assertTrue(UploadCoordinator(store, uploader).upload("durable", endpoint).accepted)
            assertEquals(UploadState.UPLOADED, store.load("durable").uploadState)
            assertEquals(listOf("durable", "durable"), keys)
            assertFalse(UploadCoordinator(store, uploader).upload("durable", endpoint).accepted)
            assertEquals(2, keys.size)
            assertEquals(listOf(sample), store.load("durable").samples)
        } finally { server.stop(0); store.close() }
    }
}
