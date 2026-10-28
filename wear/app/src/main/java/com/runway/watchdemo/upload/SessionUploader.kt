package com.runway.watchdemo.upload

import com.runway.watchdemo.session.*
import org.json.JSONObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import java.net.URI
import java.io.ByteArrayOutputStream

data class UploadResult(val accepted: Boolean, val message: String)
class SessionUploader(private val allowHttp: Boolean = false, private val timeoutMs: Int = 15000) {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).connectTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS).writeTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS).build()
    fun upload(endpoint: String, session: SessionRecord): UploadResult {
        if (!session.isFinal) return UploadResult(false, "종료된 기록만 전송할 수 있습니다")
        val uri = try { URI(endpoint.trim()) } catch (_: Exception) { return UploadResult(false, "업로드 주소를 확인하세요") }
        if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null ||
            (uri.scheme != "https" && !(allowHttp && uri.scheme == "http")))
            return UploadResult(false, "올바른 HTTPS 주소를 입력하세요")
        return try {
            val request = Request.Builder().url(uri.toString()).header("Idempotency-Key", session.id)
                .post(SessionJson.encode(session).toRequestBody("application/json; charset=utf-8".toMediaType())).build()
            client.newCall(request).execute().use { response ->
            val status = response.code
            if (status !in listOf(200, 201)) UploadResult(false, "서버 응답 HTTP $status · 기록은 보존됩니다")
            else {
                val bytes = requireNotNull(response.body).byteStream().use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(4096)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 65536)
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                require(bytes.size <= 65536)
                val json = JSONObject(String(bytes, Charsets.UTF_8))
                if (json.opt("accepted") == true && json.optString("sessionId") == session.id)
                    UploadResult(true, "전송 완료") else UploadResult(false, "서버 저장 확인이 일치하지 않습니다")
            }
            }
        } catch (_: Exception) { UploadResult(false, "연결 또는 응답 오류 · 기록을 보존했습니다. 다시 전송할 수 있습니다") }
    }
}
class UploadCoordinator(private val store: SessionStore, private val uploader: SessionUploader) {
    fun upload(id: String, endpoint: String): UploadResult {
        val session = store.claimUpload(id) ?: return UploadResult(false, "이미 전송했거나 전송할 수 없는 기록입니다")
        val result = uploader.upload(endpoint, session)
        store.setUploadState(id, if (result.accepted) UploadState.UPLOADED else UploadState.FAILED)
        return result
    }
}
