package com.runway.watchdemo.cue

import android.content.Context
import android.media.*
import android.os.*
import com.runway.watchdemo.session.*
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.PI
import kotlin.math.sin

/** PCM frame positions are calculated from the beat index, avoiding integer-period drift. */
class WatchCuePlayer(context: Context, private val createAudio: (AudioAttributes) -> AudioTrack = { attributes ->
        val rate = 24000
        AudioTrack.Builder().setAudioAttributes(attributes)
                .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT), 2400))
                .setTransferMode(AudioTrack.MODE_STREAM).build()
    }) : CuePlayer {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val vibrator = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java).defaultVibrator
        else @Suppress("DEPRECATION") (context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
    private data class Command(val settings: CueSettings, val requestedMs: Long)
    private class Playback {
        val running = AtomicBoolean(true)
        @Volatile var track: AudioTrack? = null
        var thread: Thread? = null
    }
    @Volatile private var desired = Command(CueSettings(), 0)
    private var playback: Playback? = null
    @Synchronized override fun start(settings: CueSettings, onApplied: (BpmEvent) -> Unit, onError: (String) -> Unit) {
        stop()
        if (playback?.thread?.isAlive == true) { onError("이전 박자 재생 종료를 기다려 주세요"); return }
        desired = Command(settings.copy(bpm = MetricMath.clampBpm(settings.bpm)), SystemClock.elapsedRealtime())
        if (settings.vibrationEnabled && !vibrator.hasVibrator()) { onError("이 기기에서 진동을 사용할 수 없습니다"); return }
        val run = Playback(); playback = run
        run.thread = Thread({
            var resource: AudioTrack? = null
            var focus: AudioFocusRequest? = null
            var hasFocus = false
            try {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
                val rate = 24000
                val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                val audio = createAudio(attributes)
                resource = audio; run.track = audio
                check(audio.state == AudioTrack.STATE_INITIALIZED)
                focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(attributes).setOnAudioFocusChangeListener { change ->
                        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            if (run.running.get()) onError("오디오가 다른 앱으로 전환되어 실험을 중단했습니다")
                        }
                    }.build()
                var applied: Command? = null; var active = settings; var frame = 0L; var beat = 0L
                var nextAudioBeat = 0L; var lastClick = -10000L; var origin = 0L; var vibrationBeat = 0L
                val pcm = ShortArray(240)
                audio.play()
                while (run.running.get()) {
                    val command = desired
                    if (applied !== command) {
                        applied = command; active = command.settings
                        if (active.soundEnabled && !hasFocus) {
                            check(audioManager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
                            hasFocus = true
                        } else if (!active.soundEnabled && hasFocus) {
                            audioManager.abandonAudioFocusRequest(focus); hasFocus = false
                        }
                        if (active.vibrationEnabled && !vibrator.hasVibrator()) error("no_vibrator")
                        audio.pause(); audio.flush(); audio.play()
                        frame = 0; beat = 0; nextAudioBeat = 0; lastClick = -10000; vibrationBeat = 0
                        origin = SystemClock.elapsedRealtimeNanos()
                        onApplied(BpmEvent(command.requestedMs, origin / 1_000_000, active.bpm, active.soundEnabled, active.vibrationEnabled))
                    }
                    val due = origin + MetricMath.beatOffsetNanos(vibrationBeat, active.bpm)
                    if (SystemClock.elapsedRealtimeNanos() >= due) {
                        if (active.vibrationEnabled) vibrator.vibrate(
                            VibrationEffect.createOneShot(BEAT_VIBRATION_DURATION_MS, MAX_VIBRATION_AMPLITUDE)
                        )
                        vibrationBeat = ((SystemClock.elapsedRealtimeNanos() - origin) * active.bpm / 60_000_000_000L) + 1
                    }
                    for (i in pcm.indices) {
                        if (frame >= nextAudioBeat) {
                            lastClick = frame; beat++
                            nextAudioBeat = (beat * (rate * 60.0 / active.bpm)).toLong()
                        }
                        val age = frame - lastClick
                        pcm[i] = if (active.soundEnabled && age < 240)
                            (sin(2 * PI * 1400 * age / rate) * (1 - age / 240.0) * 10000).toInt().toShort() else 0
                        frame++
                    }
                    check(audio.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING) >= 0)
                }
            } catch (_: Exception) {
                if (run.running.getAndSet(false)) onError("소리·진동 재생 실패 · 실험을 중단했습니다")
            } finally {
                run.running.set(false); vibrator.cancel()
                runCatching { resource?.pause(); resource?.flush(); resource?.release() }; run.track = null
                if (hasFocus) focus?.let { audioManager.abandonAudioFocusRequest(it) }
            }
        }, "runway-cue").apply { start() }
    }
    override fun update(settings: CueSettings) {
        desired = Command(settings.copy(bpm = MetricMath.clampBpm(settings.bpm)), SystemClock.elapsedRealtime())
    }
    @Synchronized override fun stop() {
        val run = playback ?: return
        run.running.set(false); vibrator.cancel(); runCatching { run.track?.pause() }
        if (Thread.currentThread() != run.thread) runCatching { run.thread?.join(1000) }
        if (run.thread?.isAlive != true) playback = null
    }
    override fun close() = stop()

    private companion object {
        const val BEAT_VIBRATION_DURATION_MS = 22L
        // VibrationEffect.createOneShot에서 허용하는 최대 진폭. 실제 출력은 기기 지원에 따름.
        const val MAX_VIBRATION_AMPLITUDE = 255
    }
}
