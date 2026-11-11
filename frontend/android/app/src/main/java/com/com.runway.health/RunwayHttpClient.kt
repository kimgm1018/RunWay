package com.runway.health

import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.EventListener
import okhttp3.OkHttpClient

/**
 * React Native's default OkHttp client never times out (connect/read/write 0) and keeps idle connections for 5 minutes.
 * The app's own request timeout is a JS timer, which runs late while the phone screen is off, so a request written to a
 * connection that the network dropped during screen-off could hang until TCP gave up (~90 s, S15P31E105-533 device test).
 *
 * - Idle connections are dropped after [IDLE_KEEP_ALIVE_S]: during a run the app talks to the server every few seconds
 *   and keeps its connection, but after a quiet spell the next request opens a fresh one instead of reusing a dead one.
 * - Native limits are a backstop only. The read limit stays above the longest server wait (S01 waits for the AI plan up
 *   to 40 s; the app waits 50 s), so no request that the server is still answering is cut off.
 * - Slow (>= [SLOW_MS]) or failed calls log method, path, whether the connection was reused and durations. No query,
 *   headers, token or body is logged.
 */
object RunwayHttpClient {
  private const val TAG = "RunWayHttp"
  private const val IDLE_KEEP_ALIVE_S = 10L
  private const val CONNECT_TIMEOUT_S = 10L
  private const val READ_TIMEOUT_S = 60L
  private const val WRITE_TIMEOUT_S = 30L
  private const val SLOW_MS = 2_000L
  private val ID_PART = Regex("[0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}")

  @Volatile private var shared: OkHttpClient? = null

  // One client for every caller (networking, images, WebSocket): a new client per call would open another OkHttp
  // cache on the same http-cache directory, which OkHttp does not support.
  fun install(context: Context) {
    val appContext = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory {
      shared ?: synchronized(this) { shared ?: create(appContext).also { shared = it } }
    }
  }

  fun create(context: Context): OkHttpClient =
      OkHttpClientProvider.createClientBuilder(context)
          .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
          .readTimeout(READ_TIMEOUT_S, TimeUnit.SECONDS)
          .writeTimeout(WRITE_TIMEOUT_S, TimeUnit.SECONDS)
          .connectionPool(ConnectionPool(5, IDLE_KEEP_ALIVE_S, TimeUnit.SECONDS))
          .eventListenerFactory { TimingListener() }
          .build()

  private class TimingListener : EventListener() {
    private var startNs = 0L
    private var newConnection = false
    private var responseNs = 0L

    override fun callStart(call: Call) {
      startNs = System.nanoTime()
    }

    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
      newConnection = true
    }

    override fun responseHeadersStart(call: Call) {
      responseNs = System.nanoTime()
    }

    override fun callEnd(call: Call) = report(call, null)

    override fun callFailed(call: Call, ioe: IOException) = report(call, ioe)

    // 경로의 숫자·UUID 구간(세션·이미지 ID 등)은 남기지 않는다.
    private fun maskIds(path: String) =
        path.split('/').joinToString("/") { part -> if (ID_PART.matches(part)) "{id}" else part }

    private fun ms(from: Long, to: Long) = if (from == 0L || to == 0L) -1 else (to - from) / 1_000_000

    private fun report(call: Call, error: IOException?) {
      val end = System.nanoTime()
      val total = ms(startNs, end)
      // 디버그 빌드는 모든 호출을 남겨 화면 꺼짐 중 요청 간격을 확인한다. 릴리스는 느리거나 실패한 호출만 남긴다.
      if (error == null && total < SLOW_MS && !BuildConfig.DEBUG) return
      val request = call.request()
      Log.i(
          TAG,
          "${request.method} ${maskIds(request.url.encodedPath)} total=${total}ms " +
              "connection=${if (newConnection) "new" else "reused"} " +
              "firstByte=${ms(startNs, responseNs)}ms" +
              (if (error != null) " failed=${error.javaClass.simpleName}" else ""),
      )
    }
  }
}
