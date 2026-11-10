package com.runway.health

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.util.Locale

/**
 * 러닝 중 코칭 음성 안내(S15P31E105-579). The phone's own TextToSpeech reads a coaching sentence in Korean; no library or
 * server. While it speaks, music (Melon·Spotify) is ducked through a transient audio focus and comes back afterwards.
 * A new sentence cuts the one being read. When the phone has no engine or no Korean voice, speak resolves false and the
 * run goes on silently. Sentences are never logged.
 */
class CoachingVoiceModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
  override fun getName() = "CoachingVoice"

  private val lock = Any()
  private val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    .setAudioAttributes(attributes)
    .build()

  private var tts: TextToSpeech? = null
  private var state = State.IDLE
  // Asked for before the engine finished starting; only the newest sentence is kept.
  private var waiting: String? = null
  private var current: String? = null
  private var sequence = 0L

  private enum class State { IDLE, STARTING, READY, UNAVAILABLE }

  /** Resolves true when the sentence is being read (or will be once the engine is up), false when it cannot be. */
  @ReactMethod fun speak(text: String, promise: Promise) {
    val sentence = text.trim()
    if (sentence.isEmpty()) {
      promise.resolve(false)
      return
    }
    synchronized(lock) {
      when (state) {
        State.UNAVAILABLE -> promise.resolve(false)
        State.READY -> promise.resolve(read(sentence))
        State.STARTING -> {
          waiting = sentence
          promise.resolve(true)
        }
        State.IDLE -> {
          waiting = sentence
          start()
          promise.resolve(state != State.UNAVAILABLE)
        }
      }
    }
  }

  /** Stops reading at once, e.g. when the run is paused or ends. */
  @ReactMethod fun stop() {
    synchronized(lock) {
      waiting = null
      current = null
      tts?.stop()
      audio.abandonAudioFocusRequest(focus)
    }
  }

  override fun invalidate() {
    synchronized(lock) {
      waiting = null
      current = null
      tts?.stop()
      tts?.shutdown()
      tts = null
      state = State.IDLE
      audio.abandonAudioFocusRequest(focus)
    }
    super.invalidate()
  }

  // Called with the lock held.
  private fun start() {
    state = State.STARTING
    tts = try {
      TextToSpeech(app) { status -> onReady(status) }
    } catch (_: Exception) {
      null
    }
    if (tts == null) {
      state = State.UNAVAILABLE
      waiting = null
    }
  }

  private fun onReady(status: Int) {
    synchronized(lock) {
      val engine = tts
      if (engine == null || state != State.STARTING) {
        return
      }
      val language = if (status == TextToSpeech.SUCCESS) engine.setLanguage(Locale.KOREAN) else TextToSpeech.LANG_NOT_SUPPORTED
      if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
        state = State.UNAVAILABLE
        waiting = null
        engine.shutdown()
        tts = null
        return
      }
      engine.setAudioAttributes(attributes)
      engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) = Unit
        override fun onDone(utteranceId: String?) = finished(utteranceId)
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) = finished(utteranceId)
        override fun onError(utteranceId: String?, errorCode: Int) = finished(utteranceId)
        override fun onStop(utteranceId: String?, interrupted: Boolean) = finished(utteranceId)
      })
      state = State.READY
      waiting?.let(::read)
      waiting = null
    }
  }

  // Called with the lock held. QUEUE_FLUSH cuts the sentence being read.
  private fun read(sentence: String): Boolean {
    val engine = tts ?: return false
    sequence += 1
    val id = "coaching-$sequence"
    current = id
    // Music lowers while the sentence plays; if focus is refused the sentence is still read.
    audio.requestAudioFocus(focus)
    val queued = engine.speak(sentence, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.SUCCESS
    if (!queued) {
      current = null
      audio.abandonAudioFocusRequest(focus)
    }
    return queued
  }

  // Music comes back only when the newest sentence is over, not when a cut one stops.
  private fun finished(utteranceId: String?) {
    synchronized(lock) {
      if (utteranceId != null && utteranceId == current) {
        current = null
        audio.abandonAudioFocusRequest(focus)
      }
    }
  }
}

class CoachingVoicePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(CoachingVoiceModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
