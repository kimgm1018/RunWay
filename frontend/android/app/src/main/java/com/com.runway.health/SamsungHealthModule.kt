package com.runway.health

import android.content.Intent
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.error.*
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.*
import kotlinx.coroutines.*
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/** Read-only SDK boundary. Never send raw exception messages or records to logs. */
class SamsungHealthModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val store by lazy { HealthDataService.getStore(app) }
  private val types = listOf(DataTypes.SLEEP, DataTypes.HEART_RATE, DataTypes.STEPS, DataTypes.EXERCISE)
  private val permissions get() = types.map { Permission.of(it, AccessType.READ) }.toSet()
  override fun getName() = "SamsungHealth"
  override fun invalidate() { scope.cancel(); super.invalidate() }

  private fun run(promise: Promise, block: suspend () -> Any?) {
    scope.launch {
      try { promise.resolve(block()) }
      catch (e: CancellationException) { promise.reject("SAMSUNG_QUERY", "건강 데이터 조회가 취소되었습니다.") }
      catch (e: Exception) {
        val code = when ((e as? HealthDataException)?.errorCode) {
          ErrorCode.ERR_NO_USER_PERMISSION -> "SAMSUNG_PERMISSION"
          ErrorCode.ERR_INVALID_CALLER, ErrorCode.ERR_ACCESS_CONTROL, ErrorCode.ERR_CHILD_ACCOUNT_ACCESS,
          ErrorCode.ERR_PLATFORM_NOT_INITIALIZED -> "SAMSUNG_POLICY"
          ErrorCode.ERR_PLATFORM_NOT_INSTALLED, ErrorCode.ERR_PLATFORM_DISABLED,
          ErrorCode.ERR_OLD_VERSION_PLATFORM, ErrorCode.ERR_UNSUPPORTED_OPERATION -> "SAMSUNG_UNAVAILABLE"
          else -> if (e is AuthorizationException) "SAMSUNG_POLICY" else "SAMSUNG_QUERY"
        }
        promise.reject(code, "삼성 헬스 접근 상태를 확인해 주세요.")
      }
    }
  }
  @ReactMethod fun availability(promise: Promise) {
    val available = try { app.packageManager.getApplicationInfo("com.sec.android.app.shealth", 0).enabled } catch (_: Exception) { false }
    promise.resolve(if (available) "available" else "unavailable")
  }
  @ReactMethod fun requestReadAccess(promise: Promise) = run(promise) {
    val activity = app.currentActivity ?: throw IllegalStateException()
    store.requestPermissions(permissions, activity)
    null
  }
  @ReactMethod fun openSettings(promise: Promise) {
    try {
      val intent = app.packageManager.getLaunchIntentForPackage("com.sec.android.app.shealth") ?: throw IllegalStateException()
      app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(null)
    } catch (_: Exception) { promise.reject("SAMSUNG_UNAVAILABLE", "삼성 헬스를 열지 못했습니다.") }
  }
  private fun record(id: String, metric: String, start: Instant, end: Instant, origin: String): WritableMap = Arguments.createMap().apply {
    putString("id", id); putString("metric", metric)
    putString("startTime", start.toString()); putString("endTime", end.toString())
    putMap("source", Arguments.createMap().apply { putString("id", origin); putString("name", if (origin == "com.sec.android.app.shealth") "삼성 헬스" else origin) })
  }
  @ReactMethod fun readMetric(metric: String, start: String, end: String, promise: Promise) = run(promise) {
    val type = when (metric) {
      "sleep" -> DataTypes.SLEEP
      "heartRate" -> DataTypes.HEART_RATE
      "steps" -> DataTypes.STEPS
      "exercise", "distance" -> DataTypes.EXERCISE
      else -> throw IllegalArgumentException()
    }
    val permission = Permission.of(type, AccessType.READ)
    if (!store.getGrantedPermissions(setOf(permission)).contains(permission)) {
      throw AuthorizationException(ErrorCode.ERR_NO_USER_PERMISSION, "Read permission required")
    }
    val from = Instant.parse(start); val to = Instant.parse(end)
    val output = Arguments.createArray()
    var token: String? = null
    val seen = mutableSetOf<String>()
    if (metric == "steps") {
      do {
        val builder = DataType.StepsType.TOTAL.requestBuilder
          .setLocalTimeFilter(LocalTimeFilter.of(LocalDateTime.ofInstant(from, ZoneId.systemDefault()), LocalDateTime.ofInstant(to, ZoneId.systemDefault()), true, false))
          .setPageSize(1000)
        token?.let { builder.setPageToken(it) }
        val response = store.aggregateData(builder.build())
        response.dataList.forEachIndexed { index, item ->
          item.value?.let { value ->
            output.pushMap(record("steps-${token ?: "first"}-$index", metric, item.startTime, item.endTime, "com.sec.android.app.shealth").apply {
              putDouble("value", value.toDouble()); putString("unit", "걸음"); putString("aggregation", "period")
            })
          }
        }
        token = response.pageToken?.takeIf { it.isNotEmpty() }
        if (token != null && !seen.add(token!!)) throw IllegalStateException()
      } while (token != null)
    } else {
      // Include sessions beginning before midnight, then filter overlap in the reader.
      val queryStart = if (metric == "sleep") from.minusSeconds(36 * 3600L) else from
      do {
        val builder = when (metric) {
          "sleep" -> DataTypes.SLEEP.readDataRequestBuilder
          "heartRate" -> DataTypes.HEART_RATE.readDataRequestBuilder
          else -> DataTypes.EXERCISE.readDataRequestBuilder
        }.setInstantTimeFilter(InstantTimeFilter.of(queryStart, to, true, false)).setPageSize(1000).setOrdering(Ordering.DESC)
        token?.let { builder.setPageToken(it) }
        val response = store.readData(builder.build())
        response.dataList.forEach { point -> append(output, metric, point) }
        token = response.pageToken?.takeIf { it.isNotEmpty() }
        if (token != null && !seen.add(token!!)) throw IllegalStateException()
      } while (token != null)
    }
    output
  }
  private fun append(output: WritableArray, metric: String, point: HealthDataPoint) {
    val origin = point.dataSource?.appId ?: "unknown"
    fun base(id: String = point.uid, start: Instant = point.startTime, end: Instant = point.endTime ?: point.startTime) = record(id, metric, start, end, origin)
    when (metric) {
      "heartRate" -> {
        val series = point.getValue(DataType.HeartRateType.SERIES_DATA).orEmpty()
        if (series.isNotEmpty()) series.forEachIndexed { index, sample ->
          output.pushMap(base("${point.uid}-$index", sample.startTime, sample.endTime).apply { putDouble("value", sample.heartRate.toDouble()); putString("unit", "bpm") })
        } else point.getValue(DataType.HeartRateType.HEART_RATE)?.let { value ->
          output.pushMap(base().apply { putDouble("value", value.toDouble()); putString("unit", "bpm") })
        }
      }
      "sleep" -> {
        val stages = Arguments.createArray()
        point.getValue(DataType.SleepType.SESSIONS).orEmpty().forEach { session ->
          session.stages.orEmpty().forEach { stage -> stages.pushMap(Arguments.createMap().apply {
            putString("startTime", stage.startTime.toString()); putString("endTime", stage.endTime.toString())
            putString("stage", when (stage.stage) { DataType.SleepType.StageType.AWAKE -> "awake"; DataType.SleepType.StageType.LIGHT -> "light"; DataType.SleepType.StageType.DEEP -> "deep"; DataType.SleepType.StageType.REM -> "rem"; else -> "unknown" })
          }) }
        }
        output.pushMap(base().apply {
          putArray("stages", stages)
          point.getValue(DataType.SleepType.DURATION)?.let { putDouble("reportedSleepMs", it.toMillis().toDouble()) }
          point.getValue(DataType.SleepType.SLEEP_SCORE)?.let { putInt("sleepScore", it) }
        })
      }
      "exercise" -> output.pushMap(base().apply { putString("details", point.getValue(DataType.ExerciseType.CUSTOM_TITLE) ?: point.getValue(DataType.ExerciseType.EXERCISE_TYPE)?.name ?: "운동 기록") })
      "distance" -> point.getValue(DataType.ExerciseType.SESSIONS).orEmpty().forEachIndexed { index, session ->
        session.distance?.let { value -> output.pushMap(base("${point.uid}-$index", session.startTime, session.endTime).apply { putDouble("value", value.toDouble()); putString("unit", "m"); putString("distanceKind", "workout") }) }
      }
    }
  }
}
class SamsungHealthPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(SamsungHealthModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
