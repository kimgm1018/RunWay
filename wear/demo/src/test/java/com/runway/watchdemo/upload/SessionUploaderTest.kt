package com.runway.watchdemo.upload

import com.runway.watchdemo.session.*
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import org.junit.Assert.*
import org.junit.Test

class SessionUploaderTest {
    @Test fun uploadRequiresDurableAcknowledgmentAndPreservesIdempotencyKey() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var status = 201
        var response = """{"sessionId":"run-1","accepted":true}"""
        var key = ""
        var body = ""
        var contentType = ""
        server.createContext("/upload") {
            key = it.requestHeaders.getFirst("Idempotency-Key")
            contentType = it.requestHeaders.getFirst("Content-Type")
            body = it.requestBody.bufferedReader().readText()
            val bytes = response.toByteArray()
            it.sendResponseHeaders(status, bytes.size.toLong())
            it.responseBody.use { out -> out.write(bytes) }
        }
        server.start()
        try {
            val session = SessionRecord("run-1", "runner01", 1700000000000, 1000,
                state = SessionState.COMPLETED, endedElapsedMs = 2000)
            val uploader = SessionUploader(allowHttp = true)
            val url = "http://127.0.0.1:${server.address.port}/upload"
            assertTrue(uploader.upload(url, session).accepted)
            assertEquals("run-1", key)
            assertEquals("run-1", org.json.JSONObject(body).getString("sessionId"))
            assertTrue(contentType.startsWith("application/json"))
            assertTrue(contentType.contains("charset=utf-8"))
            status = 200
            assertTrue(uploader.upload(url, session).accepted)
            for (code in listOf(202, 302, 401, 500)) {
                status = code
                assertFalse(uploader.upload(url, session).accepted)
            }
            status = 200
            response = """{"sessionId":"wrong","accepted":true}"""
            assertFalse(uploader.upload(url, session).accepted)
            response = "bad-json"
            assertFalse(uploader.upload(url, session).accepted)
            assertFalse(SessionUploader(allowHttp = false).upload(url, session).accepted)
            for (invalid in listOf("", "ftp://example.org/upload", "https:///upload", "https://example.org/upload#token"))
                assertFalse(uploader.upload(invalid, session).accepted)
            assertFalse(uploader.upload("https://user:password@example.org/upload", session).accepted)
            assertFalse(uploader.upload(url, session.copy(state = SessionState.RUNNING)).accepted)
        } finally { server.stop(0) }
    }
}
