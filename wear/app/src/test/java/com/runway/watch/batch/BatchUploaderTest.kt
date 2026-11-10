package com.runway.watch.batch

import com.runway.watch.session.SessionSender
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Batch creation, stage ACKs, retries and the 64-batch cap (watch-mobile-server-integration.md 6장·9.5, MC-10~12). */
class BatchUploaderTest {
    private class FakeSender : SessionSender {
        val sent = mutableListOf<JSONObject>()
        var accept = true
        override suspend fun send(path: String, bytes: ByteArray): Boolean {
            assertEquals(BATCH_PATH, path)
            sent += JSONObject(String(bytes, Charsets.UTF_8))
            return accept
        }
    }

    private var nowMs = 0L
    private var ids = 0
    private var msgs = 0
    private val store = InMemoryBatchStore()
    private val sender = FakeSender()
    private val at = Instant.parse("2026-10-28T01:00:00Z")

    private fun uploader(maxPending: Int = 64, finishTimeoutMs: Long = 30_000) = BatchUploader(
        store = store,
        sender = sender,
        nextMessageId = { "watch:${++msgs}" },
        clock = { nowMs },
        newId = { "00000000-0000-4000-8000-%012d".format(++ids) },
        sleep = { nowMs += it },
        jitter = { 0 },
        maxPending = maxPending,
        finishTimeoutMs = finishTimeoutMs,
    )

    private fun hr(sec: Long) = Reading(at.plusSeconds(sec), sec, heartRateBpm = 140.0)

    @Test
    fun `readings wait up to 5 seconds and go into exactly one batch`() = runBlocking {
        val u = uploader()
        u.begin("201", "101")
        u.offer(listOf(hr(1), hr(2)))
        u.tick()
        assertTrue(sender.sent.isEmpty())

        nowMs = 5_000
        u.tick()
        assertEquals(1, sender.sent.size)
        val payload = sender.sent[0].getJSONObject("payload")
        assertEquals(2, payload.getJSONArray("items").length())
        assertEquals(101L, payload.getLong("deviceId"))

        // 다음 구간은 새 batch ID, 이미 보낸 측정값은 다시 들어가지 않는다.
        u.offer(listOf(hr(6)))
        nowMs = 10_000
        u.tick()
        val ids = store.all().map { it.id }.toSet()
        assertEquals(2, ids.size)
        assertEquals(3, store.all().sumOf { it.itemCount })
        // 새 원본이 없으면 batch를 만들지 않는다.
        nowMs = 15_000
        u.tick()
        assertEquals(2, store.all().size)
    }

    @Test
    fun `a phone receipt alone keeps the batch, the save ACK releases it once`() = runBlocking {
        val u = uploader()
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        nowMs = 5_000
        u.tick()
        val id = store.all().single().id

        u.onReceived(id)
        assertEquals(1, u.pendingCount("201"))
        u.onCommitted(id, 99)
        assertEquals(1, u.pendingCount("201"))
        u.onCommitted(id, 1)
        assertEquals(0, u.pendingCount("201"))
        u.onCommitted(id, 1)
        assertEquals(0, u.state.value.pending)
        assertFalse(u.state.value.unconfirmed)
    }

    @Test
    fun `a lost ACK is resent with the same id and body, at most three times, then unconfirmed`() = runBlocking {
        val u = uploader()
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        nowMs = 5_000
        u.tick()
        nowMs += 10_000
        u.tick()
        assertEquals(1, sender.sent.size)
        nowMs += 1_000
        u.tick()
        assertEquals(2, sender.sent.size)
        nowMs += 12_000
        u.tick()
        assertEquals(3, sender.sent.size)
        assertEquals(1, sender.sent.map { it.getJSONObject("payload").toString() }.toSet().size)
        assertEquals(1, sender.sent.map { it.getString("messageId") }.toSet().size)

        nowMs += 12_000
        u.tick()
        assertEquals(3, sender.sent.size)
        assertTrue(u.state.value.unconfirmed)
        assertEquals(1, u.pendingCount("201"))
        // 저장 미확인 뒤에는 새 측정값을 모으지 않는다.
        u.offer(listOf(hr(40)))
        nowMs += 10_000
        u.tick()
        assertEquals(1, store.all().size)
    }

    // S15P31E105-446: 종료 뒤 '다시 확인'(같은 END 재수신)에서 저장 미확인 batch를 같은 ID·본문으로 한 번 더 보낸다.
    @Test
    fun `retrying the unsaved batches of an ended run resends them for another three tries`() = runBlocking {
        val u = uploader(finishTimeoutMs = 0)
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        u.finish("201")
        repeat(4) {
            nowMs += 15_000
            u.tick()
        }
        assertEquals(3, sender.sent.size)
        assertTrue(u.state.value.unconfirmed)
        val body = sender.sent[0].getJSONObject("payload").toString()

        u.retryFailed("201")
        assertFalse(u.state.value.unconfirmed)
        assertEquals(1, u.pendingCount("201"))
        u.tick()
        assertEquals(4, sender.sent.size)
        assertEquals(body, sender.sent.last().getJSONObject("payload").toString())
        assertEquals(sender.sent[0].getString("messageId"), sender.sent.last().getString("messageId"))

        // 다시 시도도 최초 포함 3회까지만 보낸다.
        repeat(4) {
            nowMs += 15_000
            u.tick()
        }
        assertEquals(6, sender.sent.size)
        assertTrue(u.state.value.unconfirmed)

        u.retryFailed("201")
        u.tick()
        u.onCommitted(store.all().single().id, 1)
        assertEquals(0, u.pendingCount("201"))
        assertFalse(u.state.value.unconfirmed)
    }

    @Test
    fun `retrying does not clear a collection stopped by the batch cap`() = runBlocking {
        val u = uploader(maxPending = 1)
        u.begin("201", "101")
        repeat(2) { i ->
            u.offer(listOf(hr(i.toLong())))
            nowMs += 5_000
            u.tick()
        }
        assertTrue(u.state.value.unconfirmed)
        u.retryFailed("201")
        assertTrue(u.state.value.unconfirmed)
    }

    @Test
    fun `a final phone error stops the retries for that batch`() = runBlocking {
        val u = uploader()
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        nowMs = 5_000
        u.tick()
        u.onError(sender.sent[0].getString("messageId"), retryable = false)
        nowMs += 60_000
        u.tick()
        assertEquals(1, sender.sent.size)
        assertTrue(u.state.value.unconfirmed)
    }

    // S15P31E105-446: 폰의 최종 오류(권한·내용 오류)로 멈춘 batch는 '다시 확인'에서도 다시 보내지 않는다.
    @Test
    fun `retrying the unsaved batches skips a batch stopped by a final phone error`() = runBlocking {
        val u = uploader(finishTimeoutMs = 0)
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        nowMs = 5_000
        u.tick()
        u.onError(sender.sent[0].getString("messageId"), retryable = false)
        u.finish("201")

        u.retryFailed("201")
        nowMs += 60_000
        u.tick()
        assertEquals(1, sender.sent.size)
        assertTrue(u.state.value.unconfirmed)
        assertEquals(1, u.pendingCount("201"))
    }

    @Test
    fun `the 64 unconfirmed batch cap stops collection without dropping batches`() = runBlocking {
        val u = uploader(maxPending = 2)
        u.begin("201", "101")
        repeat(3) { i ->
            u.offer(listOf(hr(i.toLong())))
            nowMs += 5_000
            u.tick()
        }
        assertEquals(2, store.all().size)
        assertTrue(u.state.value.unconfirmed)
    }

    @Test
    fun `finish sends what is left at once and waits for the save ACKs`() = runBlocking {
        lateinit var u: BatchUploader
        // 폰이 1초 뒤 저장 확인을 돌려주는 상황.
        u = BatchUploader(
            store, sender, { "watch:${++msgs}" }, { nowMs }, { "00000000-0000-4000-8000-%012d".format(++ids) },
            sleep = { ms ->
                nowMs += ms
                sender.sent.forEach { u.onCommitted(it.getJSONObject("payload").getString("id"), 1) }
            },
            jitter = { 0 },
        )
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        // 5초가 되기 전 종료해도 남은 원본을 바로 마지막 batch로 보낸다.
        assertEquals(0, u.finish("201"))
        assertEquals(1, sender.sent.size)
        assertTrue(store.all().isEmpty())
        // 종료 뒤 측정값은 새 batch가 되지 않는다.
        u.offer(listOf(hr(9)))
        nowMs += 10_000
        u.tick()
        assertEquals(1, sender.sent.size)
    }

    @Test
    fun `finish reports the batches still unsaved after the timeout`() = runBlocking {
        val u = uploader(finishTimeoutMs = 20_000)
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        assertEquals(1, u.finish("201"))
        assertEquals(1, u.pendingCount("201"))
    }

    @Test
    fun `a storage failure keeps the readings for the next batch`() = runBlocking {
        val u = uploader()
        u.begin("201", "101")
        u.offer(listOf(hr(1)))
        nowMs = 5_000
        store.failNextPut = true
        try { u.tick() } catch (_: IllegalStateException) { }
        assertTrue(store.all().isEmpty())
        u.tick()
        assertEquals(1, store.all().single().itemCount)
    }

    @Test
    fun `a new run clears batches left by an earlier run`() = runBlocking {
        val u = uploader()
        u.begin("200", "101")
        u.offer(listOf(hr(1)))
        nowMs = 5_000
        u.tick()
        u.begin("201", "101")
        assertEquals(0, store.all().size)
        assertFalse(u.state.value.unconfirmed)
    }

    // S15P31E105-445: Health Services may hand over readings again after the app process restarted mid-run.
    @Test
    fun `after a restart readings already in a batch are not batched again, newer ones are`() = runBlocking {
        val before = uploader()
        before.begin("201", "101")
        before.offer(listOf(hr(1), hr(2), Reading(at.plusSeconds(2), 2, totalDistanceM = 10.0)))
        nowMs = 5_000
        before.tick()
        assertEquals(1, store.all().size)
        // 버퍼에만 있던 원본은 재시작으로 사라졌으므로 다시 받으면 넣는다.
        before.offer(listOf(hr(3)))

        val after = uploader()
        after.begin("201", "101")
        after.offer(listOf(hr(1), hr(2), hr(3), hr(4), Reading(at.plusSeconds(2), 2, totalDistanceM = 10.0)))
        nowMs = 10_000
        after.tick()
        assertEquals(2, store.all().size)
        val second = store.all()[1]
        val items = JSONObject(second.body).getJSONArray("items")
        assertEquals(listOf(at.plusSeconds(3).toString(), at.plusSeconds(4).toString()), (0 until items.length()).map { items.getJSONObject(it).getString("measuredAt") })
    }

    @Test
    fun `marks of another run do not hold back a new run`() = runBlocking {
        val first = uploader()
        first.begin("201", "101")
        first.offer(listOf(hr(5)))
        nowMs = 5_000
        first.tick()

        val next = uploader()
        next.begin("202", "101")
        next.offer(listOf(hr(1)))
        nowMs = 10_000
        next.tick()
        assertEquals(1, store.all().count { it.sessionId == "202" })
    }

    // S15P31E105-549: locations are marked like the metrics, so a restart does not batch a location twice.
    @Test
    fun `after a restart locations already in a batch are not batched again`() = runBlocking {
        fun fix(sec: Long) = Reading(at.plusSeconds(sec), sec, location = GeoFix(37.5, 127.0 + sec / 10_000.0, 3.0, null))
        val before = uploader()
        before.begin("201", "101")
        before.offer(listOf(fix(1), fix(2)))
        nowMs = 5_000
        before.tick()

        val after = uploader()
        after.begin("201", "101")
        after.offer(listOf(fix(1), fix(2), fix(3)))
        nowMs = 10_000
        after.tick()
        val items = JSONObject(store.all()[1].body).getJSONArray("items")
        assertEquals(1, items.length())
        assertEquals("GPS_POINT", items.getJSONObject(0).getString("type"))
        assertEquals(at.plusSeconds(3).toString(), items.getJSONObject(0).getString("measuredAt"))
    }
}
