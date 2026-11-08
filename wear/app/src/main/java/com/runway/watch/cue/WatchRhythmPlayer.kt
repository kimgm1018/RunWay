package com.runway.watch.cue

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.sin

private const val TAG = "RhythmCue"

/**
 * Metronome on the watch speaker and vibrator, ported from `demo/cue/WatchCuePlayer` (S15P31E105-53) for D-4.
 * PCM frame positions come from the beat index so the beat does not drift. A BPM change keeps the thread and
 * restarts the beat at the new tempo; the same BPM is ignored so the beat is not reset (pace-coaching.md).
 * Failures (no audio focus, no vibrator) are logged by type only and stop the cue; they never stop the run.
 */
class WatchRhythmPlayer(context: Context) : RhythmPlayer {
    private val audioManager = context.applicationContext.getSystemService(AudioManager::class.java)
    private val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= 31) {
        context.applicationContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.applicationContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

    private class Playback {
        val running = AtomicBoolean(true)
        @Volatile var track: AudioTrack? = null
        var thread: Thread? = null
    }

    @Volatile private var desiredBpm = 0
    private var playback: Playback? = null

    @Synchronized
    override fun play(bpm: Int) {
        val target = bpm.coerceIn(MIN_BPM, MAX_BPM)
        val current = playback
        if (current != null && current.running.get()) {
            // Same tempo: keep the beat. A new tempo is picked up by the running thread.
            desiredBpm = target
            return
        }
        desiredBpm = target
        val run = Playback()
        playback = run
        run.thread = Thread({ loop(run) }, "runway-rhythm").apply { start() }
    }

    @Synchronized
    override fun stop() {
        val run = playback ?: return
        run.running.set(false)
        vibrator?.cancel()
        runCatching { run.track?.pause() }
        if (Thread.currentThread() != run.thread) runCatching { run.thread?.join(1000) }
        playback = null
    }

    private fun loop(run: Playback) {
        var track: AudioTrack? = null
        var focus: AudioFocusRequest? = null
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val audio = AudioTrack.Builder().setAudioAttributes(attributes)
                .setAudioFormat(
                    AudioFormat.Builder().setSampleRate(RATE).setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                )
                .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT), 2400))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            track = audio
            run.track = audio
            check(audio.state == AudioTrack.STATE_INITIALIZED)
            focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener { }
                .build()
            // Without focus the click is still written; the vibration alone keeps the rhythm.
            audioManager?.requestAudioFocus(focus)

            var bpm = 0
            var frame = 0L
            var beat = 0L
            var nextAudioBeat = 0L
            var lastClick = -10_000L
            var origin = 0L
            var vibrationBeat = 0L
            val pcm = ShortArray(240)
            audio.play()
            while (run.running.get()) {
                val wanted = desiredBpm
                if (wanted != bpm) {
                    bpm = wanted
                    audio.pause(); audio.flush(); audio.play()
                    frame = 0; beat = 0; nextAudioBeat = 0; lastClick = -10_000; vibrationBeat = 0
                    origin = SystemClock.elapsedRealtimeNanos()
                }
                val due = origin + beatOffsetNanos(vibrationBeat, bpm)
                if (SystemClock.elapsedRealtimeNanos() >= due) {
                    vibrator?.takeIf { it.hasVibrator() }?.vibrate(VibrationEffect.createOneShot(VIBRATION_MS, VIBRATION_AMPLITUDE))
                    vibrationBeat = ((SystemClock.elapsedRealtimeNanos() - origin) * bpm / 60_000_000_000L) + 1
                }
                for (i in pcm.indices) {
                    if (frame >= nextAudioBeat) {
                        lastClick = frame
                        beat++
                        nextAudioBeat = (beat * (RATE * 60.0 / bpm)).toLong()
                    }
                    val age = frame - lastClick
                    pcm[i] = if (age < CLICK_FRAMES) (sin(2 * PI * 1400 * age / RATE) * (1 - age / CLICK_FRAMES.toDouble()) * 10000).toInt().toShort() else 0
                    frame++
                }
                check(audio.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING) >= 0)
            }
        } catch (e: Exception) {
            Log.w(TAG, "rhythm cue stopped: ${e.javaClass.simpleName}")
        } finally {
            run.running.set(false)
            vibrator?.cancel()
            runCatching { track?.pause(); track?.flush(); track?.release() }
            run.track = null
            focus?.let { f -> runCatching { audioManager?.abandonAudioFocusRequest(f) } }
        }
    }

    private companion object {
        const val RATE = 24_000
        const val CLICK_FRAMES = 240
        const val MIN_BPM = 60
        const val MAX_BPM = 220
        const val VIBRATION_MS = 22L
        // VibrationEffect.createOneShot의 최대 진폭. 실제 출력은 기기 지원에 따른다.
        const val VIBRATION_AMPLITUDE = 255

        fun beatOffsetNanos(index: Long, bpm: Int): Long = (index * (60_000_000_000.0 / bpm.coerceIn(MIN_BPM, MAX_BPM))).toLong()
    }
}
