package com.runway.watchdemo.session

interface SessionStore {
    fun create(record: SessionRecord)
    fun load(id: String): SessionRecord
    fun list(): List<SessionRecord>
    fun appendSamples(id: String, samples: List<MetricSample>)
    fun appendBpmEvent(id: String, event: BpmEvent)
    fun setState(id: String, state: SessionState)
    fun setCapabilities(id: String, values: Map<String, String>)
    fun finish(id: String, state: SessionState, endedElapsedMs: Long, endReason: String)
    fun setUploadState(id: String, state: UploadState)
    fun claimUpload(id: String): SessionRecord?
    fun recoverInterrupted()
}
