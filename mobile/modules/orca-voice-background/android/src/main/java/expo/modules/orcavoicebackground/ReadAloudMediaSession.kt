package expo.modules.orcavoicebackground

import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper

/**
 * Orca Voice fork: the headset and steering-wheel buttons while something is read (owner's
 * request, 2026-10-28): play/pause, next message, previous message, all handed to JS through
 * [ReadAloudControls] like the notification's buttons.
 *
 * Android gives those buttons to the session of the app that last started playing audio. The
 * speech itself plays in the TTS engine's own process, so when reading starts a tenth of a second
 * of silence is played here, which makes this session the one that gets them over a music app.
 * The session lives only while there is something to read, and goes 10 minutes into a pause, so
 * afterwards the buttons belong to the music again.
 */
internal object ReadAloudMediaSession {
  private const val RELEASE_PAUSED_AFTER_MS = 10 * 60_000L
  private const val ACTIONS = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
    PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP

  private val handler = Handler(Looper.getMainLooper())
  private var session: MediaSession? = null
  private val releasePaused = Runnable { release() }

  private val callback = object : MediaSession.Callback() {
    override fun onPlay() = ReadAloudControls.send(ReadAloudControls.PLAY)
    override fun onPause() = ReadAloudControls.send(ReadAloudControls.PAUSE)
    override fun onSkipToNext() = ReadAloudControls.send(ReadAloudControls.NEXT)
    override fun onSkipToPrevious() = ReadAloudControls.send(ReadAloudControls.PREVIOUS)
    override fun onStop() = ReadAloudControls.send(ReadAloudControls.STOP_READING)
  }

  /** `state`: "idle", "reading" or "paused"; `title` is what a car's display shows. */
  fun update(context: Context, state: String, title: String?, previous: Boolean, next: Boolean) {
    val app = context.applicationContext
    // Skips offered only when there is somewhere to skip to, so a car greys them out otherwise.
    val actions = ACTIONS or
      (if (previous) PlaybackState.ACTION_SKIP_TO_PREVIOUS else 0L) or
      (if (next) PlaybackState.ACTION_SKIP_TO_NEXT else 0L)
    handler.post { apply(app, state, title, actions) }
  }

  /** Gives the buttons back, e.g. when the app's JS goes away. */
  fun end() {
    handler.post { release() }
  }

  private fun release() {
    handler.removeCallbacks(releasePaused)
    session?.let {
      it.isActive = false
      it.release()
    }
    session = null
  }

  private fun apply(context: Context, state: String, title: String?, actions: Long) {
    handler.removeCallbacks(releasePaused)
    if (state != "reading" && state != "paused") {
      release()
      return
    }
    val existing = session
    val media = existing ?: MediaSession(context, "OrcaVoiceReadAloud").also {
      it.setCallback(callback, handler)
      session = it
    }
    val wasPlaying = existing?.controller?.playbackState?.state == PlaybackState.STATE_PLAYING
    val playing = state == "reading"
    media.setPlaybackState(
      PlaybackState.Builder()
        .setActions(actions)
        .setState(
          if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          PlaybackState.PLAYBACK_POSITION_UNKNOWN,
          1f
        )
        .build()
    )
    media.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, title ?: "Orca Voice")
        .putString(MediaMetadata.METADATA_KEY_ARTIST, "Orca Voice")
        .build()
    )
    if (!media.isActive) media.isActive = true
    if (playing && !wasPlaying) claimButtons()
    if (!playing) handler.postDelayed(releasePaused, RELEASE_PAUSED_AFTER_MS)
  }

  private fun claimButtons() {
    val track = ReadAloudChime.silence(ReadAloudSpeech.attributes) ?: return
    if (runCatching { track.play() }.isFailure) {
      track.release()
      return
    }
    handler.postDelayed({
      runCatching { track.stop() }
      track.release()
    }, 400)
  }
}
