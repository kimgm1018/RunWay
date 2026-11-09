package com.runway.health.watch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class DailyHrRecordsTest {
  private fun record(revision: Int, uploaded: Int? = null) = DailyHrRecord(
    metricDate = "2026-10-29",
    revision = revision,
    estimatedRestingHrBpm = 58.4,
    method = "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2",
    validSampleCount = 120,
    computedAt = "2026-10-30T00:05:00Z",
    uploadedRevision = uploaded,
  )

  // Mirrors the watch's DailyHrMessages.encodeSummary output.
  private fun summaryJson(
    type: String = "DAILY_HR_SUMMARY",
    payload: JSONObject = JSONObject()
      .put("metricDate", "2026-10-29")
      .put("revision", 2)
      .put("estimatedRestingHrBpm", 58.4)
      .put("method", "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2")
      .put("validSampleCount", 120)
      .put("computedAt", "2026-10-30T00:05:00Z"),
  ): JSONObject = JSONObject()
    .put("protocolVersion", 1)
    .put("type", type)
    .put("messageId", "watch:7")
    .put("replyTo", JSONObject.NULL)
    .put("senderDeviceId", JSONObject.NULL)
    .put("sessionId", JSONObject.NULL)
    .put("payload", payload)

  private fun bytes(json: JSONObject) = json.toString().toByteArray(Charsets.UTF_8)

  @Test fun mergeStoresFirstRevision() {
    val incoming = record(1)
    assertEquals(incoming, merge(null, incoming))
  }

  @Test fun mergeKeepsHigherExistingRevision() {
    val existing = record(2)
    assertSame(existing, merge(existing, record(1)))
    assertSame(existing, merge(existing, record(2)))
  }

  @Test fun mergeReplacesWithNewerRevisionAndKeepsUploadedRevision() {
    val merged = merge(record(1, uploaded = 1), record(2))
    assertEquals(2, merged.revision)
    assertEquals(1, merged.uploadedRevision)
  }

  @Test fun consentedMergeStoresOnlyWithAgreeConsent() {
    assertNull(consentedMerge(null, null, record(1)))
    assertNull(consentedMerge("DISAGREE", record(1), record(2)))
    assertEquals(record(1), consentedMerge("AGREE", null, record(1)))
    val existing = record(2, uploaded = 2)
    assertSame(existing, consentedMerge("AGREE", existing, record(1)))
    assertEquals(2, consentedMerge("AGREE", record(1, uploaded = 1), record(2))!!.revision)
  }

  @Test fun consentPublishesOnlyWhenChangedOrUndelivered() {
    assertTrue(needsConsentPublish(null, false, "AGREE"))
    assertTrue(needsConsentPublish("DISAGREE", true, "AGREE"))
    assertTrue(needsConsentPublish("AGREE", false, "AGREE"))
    assertFalse(needsConsentPublish("AGREE", true, "AGREE"))
  }

  /** S15P31E105-314: a consent saved before the update is the old typo 'AGREEE'. */
  @Test fun legacyStoredAgreeIsNotConsentButIsRepublishedAsAgree() {
    // Not stored and not acked, so the watch keeps the summary and resends it after the republish.
    assertNull(consentedMerge("AGREEE", null, record(1)))
    // Even if the earlier publish was delivered, the server consent (AGREE) differs and is published again.
    assertTrue(needsConsentPublish("AGREEE", true, "AGREE"))
  }

  @Test fun retainRecordKeepsUnuploadedUpToSevenDays() {
    val today = LocalDate.parse("2026-10-30")
    fun pending(date: String) = record(2, uploaded = 1).copy(metricDate = date)
    assertTrue(retainRecord(pending("2026-10-23"), today))
    assertFalse(retainRecord(pending("2026-10-22"), today))
    assertFalse(retainRecord(pending("2026-10-22").copy(uploadedRevision = null), today))
  }

  @Test fun retainRecordKeepsUploadedOnlyForTodayAndYesterday() {
    val today = LocalDate.parse("2026-10-30")
    fun uploaded(date: String) = record(2, uploaded = 2).copy(metricDate = date)
    assertTrue(retainRecord(uploaded("2026-10-30"), today))
    assertTrue(retainRecord(uploaded("2026-10-29"), today))
    assertFalse(retainRecord(uploaded("2026-10-28"), today))
    // A newer revision that is not uploaded yet stays until the cap.
    assertTrue(retainRecord(record(3, uploaded = 2).copy(metricDate = "2026-10-28"), today))
  }

  @Test fun mergeSendsNewerRevisionOfRejectedRecordAgain() {
    val merged = merge(record(1).copy(rejectedRevision = 1), record(2))
    assertEquals(2, merged.revision)
    assertNull(merged.rejectedRevision)
  }

  @Test fun retainRecordTreatsRejectedLikeUploaded() {
    val today = LocalDate.parse("2026-10-30")
    fun rejected(date: String) = record(2).copy(metricDate = date, rejectedRevision = 2)
    assertTrue(retainRecord(rejected("2026-10-29"), today))
    assertFalse(retainRecord(rejected("2026-10-28"), today))
  }

  @Test fun retainRecordKeepsUnparseableDate() {
    assertTrue(retainRecord(record(2, uploaded = 2).copy(metricDate = "not-a-date"), LocalDate.parse("2026-10-30")))
  }

  @Test fun parseSummaryReadsWatchMessage() {
    val parsed = parseSummary(bytes(summaryJson()))!!
    assertEquals("watch:7", parsed.messageId)
    assertEquals(record(2), parsed.record)
  }

  @Test fun parseSummaryRejectsWrongType() {
    assertNull(parseSummary(bytes(summaryJson(type = "DAILY_HR_RECEIVED"))))
  }

  @Test fun parseSummaryRejectsOversizedMessage() {
    val json = summaryJson().put("padding", "x".repeat(32 * 1024))
    assertNull(parseSummary(bytes(json)))
  }

  @Test fun parseSummaryRejectsInvalidPayload() {
    fun payload() = summaryJson().getJSONObject("payload")
    assertNull(parseSummary(bytes(summaryJson(payload = payload().put("metricDate", "2026-13-01")))))
    assertNull(parseSummary(bytes(summaryJson(payload = payload().put("revision", 0)))))
    assertNull(parseSummary(bytes(summaryJson(payload = payload().put("validSampleCount", 0)))))
    assertNull(parseSummary(bytes(summaryJson(payload = payload().put("estimatedRestingHrBpm", "NaN")))))
    assertNull(parseSummary(bytes(summaryJson(payload = payload().apply { remove("method") }))))
    assertNull(parseSummary(bytes(summaryJson().put("protocolVersion", 2))))
    assertNull(parseSummary("not json".toByteArray()))
  }

  @Test fun receivedReplyHasFieldsTheWatchRequires() {
    val json = JSONObject(String(receivedReply("phone:3", "watch:7", "2026-10-29", 2), Charsets.UTF_8))
    // Watch decodeReceived requires protocolVersion 1, type DAILY_HR_RECEIVED, payload.metricDate/revision.
    assertEquals(1, json.getInt("protocolVersion"))
    assertEquals("DAILY_HR_RECEIVED", json.getString("type"))
    assertEquals("phone:3", json.getString("messageId"))
    assertEquals("watch:7", json.getString("replyTo"))
    assertTrue(json.isNull("senderDeviceId"))
    assertTrue(json.isNull("sessionId"))
    val payload = json.getJSONObject("payload")
    assertEquals("2026-10-29", payload.getString("metricDate"))
    assertEquals(2, payload.getInt("revision"))
  }
}
