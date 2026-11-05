package com.runway.health.watch

import android.content.SharedPreferences
import org.junit.Assert.*
import org.junit.Test

class DailyHrAccountTest {
  private fun row(epoch: String?) = DailyHrRecord(java.time.LocalDate.now().toString(), 1, 58.0,
    "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2", 240, "2026-11-04T12:00:00Z", null, collectionId = epoch)

  @Test fun sameAccountAfterRestartKeepsPendingRecordsAndEpoch() {
    val disk = MemoryPrefs()
    val store = DailyHrPrefs(disk)
    assertTrue(store.prepareAccount("101"))
    val epoch = store.collectionId()!!
    store.saveConsent(CONSENT_AGREE)
    store.upsertIfConsented(row(epoch))
    val restarted = DailyHrPrefs(disk)
    assertTrue(restarted.prepareAccount("101"))
    assertEquals(epoch, restarted.collectionId())
    assertEquals(1, restarted.allForAccount("101").size)
  }

  @Test fun anotherAccountClearsRecordsAndRejectsDelayedOldSummaryAndAck() {
    val store = DailyHrPrefs(MemoryPrefs())
    store.prepareAccount("101")
    val old = store.collectionId()!!
    store.saveConsent(CONSENT_AGREE)
    store.upsertIfConsented(row(old))
    store.prepareAccount("202")
    assertNotEquals(old, store.collectionId())
    assertTrue(store.allForAccount("202").isEmpty())
    store.saveConsent(CONSENT_AGREE)
    assertNull(store.upsertIfConsented(row(old)))
    assertNull(store.upsertIfConsented(row(null)))
    val fresh = row(store.collectionId())
    store.upsertIfConsented(fresh)
    store.markUploaded(fresh.metricDate, fresh.revision, old)
    assertNull(store.allForAccount("202").single().uploadedRevision)
    assertTrue(store.allForAccount("101").isEmpty())
    store.markUploaded(fresh.metricDate, fresh.revision, fresh.collectionId)
    assertEquals(1, store.allForAccount("202").single().uploadedRevision)
  }

  @Test fun withdrawalRotatesEpochSoOldRecordsCannotReturnAfterAgreement() {
    val store = DailyHrPrefs(MemoryPrefs())
    store.prepareAccount("101")
    val old = store.collectionId()!!
    store.saveConsent(CONSENT_AGREE)
    store.upsertIfConsented(row(old))
    store.saveConsent(CONSENT_DISAGREE)
    val next = store.collectionId()
    assertNotEquals(old, next)
    store.saveConsent(CONSENT_DISAGREE)
    assertEquals(next, store.collectionId())
    store.saveConsent(CONSENT_AGREE)
    assertNull(store.upsertIfConsented(row(old)))
    assertTrue(store.allForAccount("101").isEmpty())
  }

  @Test fun consentPublicationTimeIsStrictlyIncreasingAcrossRestartsAndClockRollback() {
    val disk = MemoryPrefs()
    val store = DailyHrPrefs(disk)
    store.prepareAccount("101")
    val at = java.time.Instant.parse("2100-01-01T00:00:00Z")
    assertEquals(at.toString(), store.nextConsentUpdatedAt(at))
    assertEquals("2100-01-01T00:00:00.001Z", store.nextConsentUpdatedAt(at))
    assertEquals("2100-01-01T00:00:00.002Z", DailyHrPrefs(disk).nextConsentUpdatedAt(at.minusSeconds(1)))
  }

  @Test fun missingOrInvalidOwnerNeverClaimsLegacyRecords() {
    val store = DailyHrPrefs(MemoryPrefs())
    store.saveConsent(CONSENT_AGREE)
    store.upsert(row(null))
    assertFalse(store.prepareAccount(""))
    assertFalse(store.prepareAccount("undefined"))
    assertTrue(store.allForAccount("101").isEmpty())
    assertTrue(store.prepareAccount("101"))
    assertTrue(store.allForAccount("101").isEmpty())
  }
}

private class MemoryPrefs : SharedPreferences {
  private val data = mutableMapOf<String, Any?>()
  override fun getAll(): MutableMap<String, *> = data.toMutableMap()
  override fun getString(key: String?, fallback: String?): String? = data[key] as? String ?: fallback
  override fun getStringSet(key: String?, fallback: MutableSet<String>?): MutableSet<String>? = fallback
  override fun getInt(key: String?, fallback: Int) = data[key] as? Int ?: fallback
  override fun getLong(key: String?, fallback: Long) = data[key] as? Long ?: fallback
  override fun getFloat(key: String?, fallback: Float) = data[key] as? Float ?: fallback
  override fun getBoolean(key: String?, fallback: Boolean) = data[key] as? Boolean ?: fallback
  override fun contains(key: String?) = data.containsKey(key)
  override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
  override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
  override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
    private val pending = mutableMapOf<String, Any?>()
    private var clear = false
    override fun putString(key: String?, value: String?) = apply { pending[key!!] = value }
    override fun putStringSet(key: String?, value: MutableSet<String>?) = apply { pending[key!!] = value }
    override fun putInt(key: String?, value: Int) = apply { pending[key!!] = value }
    override fun putLong(key: String?, value: Long) = apply { pending[key!!] = value }
    override fun putFloat(key: String?, value: Float) = apply { pending[key!!] = value }
    override fun putBoolean(key: String?, value: Boolean) = apply { pending[key!!] = value }
    override fun remove(key: String?) = apply { pending[key!!] = null }
    override fun clear() = apply { clear = true }
    override fun commit(): Boolean {
      if (clear) data.clear()
      pending.forEach { (key, value) -> if (value == null) data.remove(key) else data[key] = value }
      return true
    }
    override fun apply() { commit() }
  }
}
