package com.luminatv.player

import android.app.Activity
import android.graphics.Color
import android.media.MediaCodecList
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

@OptIn(UnstableApi::class)
class NativePlayerController(
    private val activity: Activity,
    private val playerView: PlayerView,
    private val emitToJs: (String, JSONObject) -> Unit
) {

    companion object {
        private const val TAG = "LuminaExo"
        const val DEFAULT_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20"
        private const val POSITION_POLL_INTERVAL_MS = 500L
        private val HLS_PATH_REGEX = Regex("\\.m3u8($|\\?)", RegexOption.IGNORE_CASE)

        val trustedInsecureHosts: MutableSet<String> = ConcurrentHashMap.newKeySet()

        fun addTrustedHost(host: String) {
            val clean = host.trim().lowercase(Locale.ROOT)
            if (clean.isNotEmpty()) {
                trustedInsecureHosts.add(clean)
            }
        }

        fun buildHttpClient(connectTimeoutSec: Long, readTimeoutSec: Long, allowInsecureForTrusted: Boolean = true): OkHttpClient {
            val builder = OkHttpClient.Builder()
                .connectTimeout(connectTimeoutSec, TimeUnit.SECONDS)
                .readTimeout(readTimeoutSec, TimeUnit.SECONDS)
                .writeTimeout(20, TimeUnit.SECONDS)
                .followRedirects(true)
                .followSslRedirects(true)
                .retryOnConnectionFailure(true)

            if (allowInsecureForTrusted && trustedInsecureHosts.isNotEmpty()) {
                try {
                    val trustAll = object : X509TrustManager {
                        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                    }
                    val sslContext = SSLContext.getInstance("TLS")
                    sslContext.init(null, arrayOf<TrustManager>(trustAll), SecureRandom())
                    builder.sslSocketFactory(sslContext.socketFactory, trustAll)
                    builder.hostnameVerifier { hostname, session ->
                        val h = hostname.lowercase(Locale.ROOT)
                        if (trustedInsecureHosts.contains(h)) true
                        else javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(hostname, session)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Falha ao configurar SSL customizado: ${e.message}")
                }
            }
            return builder.build()
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val probeExecutor = Executors.newCachedThreadPool()
    private var exoPlayer: ExoPlayer? = null
    private var trackSelector: DefaultTrackSelector? = null
    private var currentIsLive: Boolean = false
    private var currentResizeMode: String = "auto"
    private var wasPlayingBeforeActivityPause: Boolean = false
    private var hasAppliedInitialSubtitleRule: Boolean = false

    private val positionTicker = object : Runnable {
        override fun run() {
            val player = exoPlayer ?: return
            if (player.isPlaying) {
                val payload = JSONObject().apply {
                    put("positionMs", player.currentPosition.coerceAtLeast(0L))
                    val dur = player.duration
                    put("durationMs", if (dur != C.TIME_UNSET && dur > 0L) dur else 0L)
                    put("bufferedMs", player.bufferedPosition.coerceAtLeast(0L))
                    put("isLive", currentIsLive || player.isCurrentMediaItemLive)
                }
                emitToJs("position", payload)
                mainHandler.postDelayed(this, POSITION_POLL_INTERVAL_MS)
            }
        }
    }

    init {
        mainHandler.post {
            configurePlayerViewAppearance()
        }
    }

    private fun configurePlayerViewAppearance() {
        playerView.useController = false
        playerView.setShutterBackgroundColor(Color.BLACK)
        playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        playerView.isFocusable = false
        playerView.isFocusableInTouchMode = false
        playerView.visibility = View.INVISIBLE

        playerView.subtitleView?.apply {
            val style = CaptionStyleCompat(
                Color.WHITE,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                Color.BLACK,
                null
            )
            setStyle(style)
            setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
        }
    }

    fun open(configJson: String) {
        mainHandler.post {
            try {
                val cfg = JSONObject(configJson)
                val url = cfg.optString("url", "").trim()
                if (url.isEmpty()) {
                    emitError("PARSING_CONTAINER_MALFORMED", 0, "URL de stream vazia.", true)
                    return@post
                }

                val isLive = cfg.optBoolean("isLive", false)
                val startPositionMs = cfg.optLong("startPositionMs", 0L)
                val userAgent = cfg.optString("userAgent", "").trim().ifEmpty { DEFAULT_USER_AGENT }
                val referer = cfg.optString("referer", "").trim()
                val bufferProfile = cfg.optString("bufferProfile", "normal").lowercase(Locale.ROOT)
                val preferredAudioLang = cfg.optString("preferredAudioLang", "pt").lowercase(Locale.ROOT)

                val extraHeaders = mutableMapOf<String, String>()
                if (referer.isNotEmpty()) {
                    extraHeaders["Referer"] = referer
                }
                val headersObj = cfg.optJSONObject("headers")
                if (headersObj != null) {
                    val keys = headersObj.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        val v = headersObj.optString(k, "")
                        if (k.isNotBlank() && v.isNotBlank()) {
                            extraHeaders[k] = v
                        }
                    }
                }

                // Sempre para e libera qualquer instância anterior antes de abrir outra (evita estourar max_connections)
                stopInternal(hideView = false)

                currentIsLive = isLive
                hasAppliedInitialSubtitleRule = false

                val loadControl = buildLoadControl(isLive, bufferProfile)
                val renderersFactory = DefaultRenderersFactory(activity)
                    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
                    .setEnableDecoderFallback(true)

                val selector = DefaultTrackSelector(activity).apply {
                    setParameters(
                        buildUponParameters()
                            .setPreferredAudioLanguages(preferredAudioLang, "pt", "por", "pt-BR")
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .build()
                    )
                }
                trackSelector = selector

                val audioAttrs = AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build()

                val player = ExoPlayer.Builder(activity, renderersFactory)
                    .setTrackSelector(selector)
                    .setLoadControl(loadControl)
                    .setAudioAttributes(audioAttrs, false)
                    .build()

                exoPlayer = player
                playerView.player = player
                playerView.visibility = View.VISIBLE
                applyResizeModeInternal(currentResizeMode)

                player.addListener(playerListener)

                val mediaSource = buildMediaSource(url, userAgent, extraHeaders, isLive)
                player.setMediaSource(mediaSource)
                if (!isLive && startPositionMs > 0L) {
                    player.seekTo(startPositionMs)
                }
                player.prepare()
                player.playWhenReady = true
            } catch (e: Exception) {
                Log.e(TAG, "Erro em nativeOpen: ${e.message}", e)
                emitError("ERROR_CODE_UNSPECIFIED", 0, e.message ?: "Erro ao iniciar player nativo", true)
            }
        }
    }

    private fun buildLoadControl(isLive: Boolean, bufferProfile: String): DefaultLoadControl {
        val (minBufferMs, maxBufferMs) = when (bufferProfile) {
            "small" -> if (isLive) (8_000 to 20_000) else (20_000 to 45_000)
            "large" -> if (isLive) (30_000 to 45_000) else (60_000 to 90_000)
            else -> if (isLive) (15_000 to 30_000) else (30_000 to 60_000)
        }
        return DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                minBufferMs,
                maxBufferMs,
                1_500,
                3_000
            )
            .setTargetBufferBytes(40 * 1024 * 1024)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
    }

    private fun buildMediaSource(
        url: String,
        userAgent: String,
        extraHeaders: Map<String, String>,
        isLive: Boolean
    ): MediaSource {
        val client = buildHttpClient(15L, 30L, true)
        val dataSourceFactory = OkHttpDataSource.Factory(client)
            .setUserAgent(userAgent)
            .setDefaultRequestProperties(extraHeaders)

        val errorPolicy = object : DefaultLoadErrorHandlingPolicy(if (isLive) 3 else 2) {
            override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
                val ex = loadErrorInfo.exception
                if (ex is HttpDataSource.InvalidResponseCodeException) {
                    val code = ex.responseCode
                    // Nunca faz retry interno em 401, 403, 404, 458, 884 ou qualquer outro 4xx (exceto 429)
                    if (code == 401 || code == 403 || code == 404 || code == 458 || code == 884 || (code in 400..499 && code != 429)) {
                        return C.TIME_UNSET
                    }
                    if (code == 429 || code in 500..599) {
                        return if (loadErrorInfo.errorCount <= 1) 1500L else C.TIME_UNSET
                    }
                }
                val count = loadErrorInfo.errorCount
                if (isLive) {
                    return when (count) {
                        1 -> 1000L
                        2 -> 2000L
                        3 -> 4000L
                        else -> C.TIME_UNSET
                    }
                } else {
                    return when (count) {
                        1 -> 1000L
                        2 -> 2000L
                        else -> C.TIME_UNSET
                    }
                }
            }

            override fun getMinimumLoadableRetryCount(dataType: Int): Int {
                return if (isLive) 3 else 2
            }
        }

        val mediaItem = MediaItem.fromUri(url)
        val isHls = HLS_PATH_REGEX.containsMatchIn(url)

        return if (isHls) {
            HlsMediaSource.Factory(dataSourceFactory)
                .setAllowChunklessPreparation(true)
                .setLoadErrorHandlingPolicy(errorPolicy)
                .createMediaSource(mediaItem)
        } else {
            val extractorsFactory = DefaultExtractorsFactory()
                .setTsExtractorFlags(
                    DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS or
                        DefaultTsPayloadReaderFactory.FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS
                )
                .setConstantBitrateSeekingEnabled(true)

            ProgressiveMediaSource.Factory(dataSourceFactory, extractorsFactory)
                .setLoadErrorHandlingPolicy(errorPolicy)
                .createMediaSource(mediaItem)
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            val player = exoPlayer ?: return
            when (playbackState) {
                Player.STATE_BUFFERING -> {
                    emitToJs("buffering", JSONObject())
                }
                Player.STATE_READY -> {
                    val dur = player.duration
                    emitToJs(
                        "ready",
                        JSONObject().apply {
                            put("durationMs", if (dur != C.TIME_UNSET && dur > 0L) dur else 0L)
                            put("isLive", currentIsLive || player.isCurrentMediaItemLive)
                        }
                    )
                }
                Player.STATE_ENDED -> {
                    mainHandler.removeCallbacks(positionTicker)
                    emitToJs("ended", JSONObject())
                }
                Player.STATE_IDLE -> {
                    mainHandler.removeCallbacks(positionTicker)
                }
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            mainHandler.removeCallbacks(positionTicker)
            if (isPlaying) {
                emitToJs("playing", JSONObject())
                mainHandler.post(positionTicker)
            } else {
                val player = exoPlayer
                if (player != null && player.playbackState == Player.STATE_READY && !player.playWhenReady) {
                    emitToJs("paused", JSONObject())
                }
            }
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width > 0 && videoSize.height > 0) {
                emitToJs(
                    "videoSize",
                    JSONObject().apply {
                        put("width", videoSize.width)
                        put("height", videoSize.height)
                    }
                )
            }
        }

        override fun onTracksChanged(tracks: Tracks) {
            val audioArr = JSONArray()
            val textArr = JSONArray()
            var selectedAudioLang = ""
            var ptSubtitleTrackId = ""

            val groups = tracks.groups
            for (gIdx in 0 until groups.size) {
                val group = groups[gIdx]
                val trackType = group.type
                if (trackType != C.TRACK_TYPE_AUDIO && trackType != C.TRACK_TYPE_TEXT) continue

                for (tIdx in 0 until group.length) {
                    if (!group.isTrackSupported(tIdx)) continue
                    val fmt = group.getTrackFormat(tIdx)
                    val id = "$gIdx:$tIdx"
                    val lang = (fmt.language ?: "und").lowercase(Locale.ROOT)
                    val label = buildTrackLabel(fmt, lang, tIdx)
                    val isSelected = group.isTrackSelected(tIdx)

                    if (trackType == C.TRACK_TYPE_AUDIO) {
                        if (isSelected) selectedAudioLang = lang
                        audioArr.put(
                            JSONObject().apply {
                                put("id", id)
                                put("language", lang)
                                put("label", label)
                                put("codec", fmt.sampleMimeType ?: "")
                                put("channels", if (fmt.channelCount != Format.NO_VALUE) fmt.channelCount else 2)
                                put("selected", isSelected)
                            }
                        )
                    } else if (trackType == C.TRACK_TYPE_TEXT) {
                        if (ptSubtitleTrackId.isEmpty() && (lang.startsWith("pt") || lang.startsWith("por"))) {
                            ptSubtitleTrackId = id
                        }
                        textArr.put(
                            JSONObject().apply {
                                put("id", id)
                                put("language", lang)
                                put("label", label)
                                put("selected", isSelected)
                            }
                        )
                    }
                }
            }

            // Se o áudio selecionado não for português e houver legenda em português, ativa automaticamente na primeira vez
            if (!hasAppliedInitialSubtitleRule && audioArr.length() > 0) {
                hasAppliedInitialSubtitleRule = true
                val isAudioPt = selectedAudioLang.startsWith("pt") || selectedAudioLang.startsWith("por")
                if (!isAudioPt && ptSubtitleTrackId.isNotEmpty()) {
                    setTextTrack(ptSubtitleTrackId)
                }
            }

            emitToJs(
                "tracks",
                JSONObject().apply {
                    put("audio", audioArr)
                    put("text", textArr)
                }
            )
        }

        override fun onPlayerError(error: PlaybackException) {
            val player = exoPlayer
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
                // Recupera automaticamente da janela ao vivo sem incomodar o usuário
                player.seekToDefaultPosition()
                player.prepare()
                player.play()
                return
            }

            mainHandler.removeCallbacks(positionTicker)
            var httpStatus = 0
            var cause: Throwable? = error.cause
            while (cause != null) {
                if (cause is HttpDataSource.InvalidResponseCodeException) {
                    httpStatus = cause.responseCode
                    break
                }
                cause = cause.cause
            }

            val symbolicCode = mapPlaybackExceptionCode(error.errorCode)
            val msg = error.cause?.message ?: error.message ?: "Erro de reprodução"
            emitError(symbolicCode, httpStatus, msg, true)
        }
    }

    private fun buildTrackLabel(fmt: Format, lang: String, index: Int): String {
        val rawLabel = fmt.label?.trim().orEmpty()
        if (rawLabel.isNotEmpty()) return rawLabel
        return when {
            lang.startsWith("pt") || lang.startsWith("por") -> "Português"
            lang.startsWith("en") || lang.startsWith("eng") -> "Inglês"
            lang.startsWith("es") || lang.startsWith("spa") -> "Espanhol"
            lang == "und" || lang.isEmpty() -> "Faixa ${index + 1}"
            else -> lang.uppercase(Locale.ROOT)
        }
    }

    private fun mapPlaybackExceptionCode(code: Int): String {
        return when (code) {
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> "IO_BAD_HTTP_STATUS"
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "IO_NETWORK_CONNECTION_FAILED"
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "IO_NETWORK_CONNECTION_TIMEOUT"
            PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE -> "IO_INVALID_HTTP_CONTENT_TYPE"
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "IO_FILE_NOT_FOUND"
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED -> "PARSING_CONTAINER_MALFORMED"
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED -> "PARSING_MANIFEST_MALFORMED"
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "PARSING_CONTAINER_UNSUPPORTED"
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED -> "PARSING_MANIFEST_UNSUPPORTED"
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED -> "DECODER_INIT_FAILED"
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED -> "DECODER_QUERY_FAILED"
            PlaybackException.ERROR_CODE_DECODING_FAILED -> "DECODING_FAILED"
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "DECODING_FORMAT_EXCEEDS_CAPABILITIES"
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED -> "DECODING_FORMAT_UNSUPPORTED"
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED -> "AUDIO_TRACK_INIT_FAILED"
            PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED -> "AUDIO_TRACK_WRITE_FAILED"
            PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> "BEHIND_LIVE_WINDOW"
            PlaybackException.ERROR_CODE_TIMEOUT -> "TIMEOUT"
            else -> "ERROR_CODE_UNSPECIFIED"
        }
    }

    private fun emitError(code: String, httpStatus: Int, message: String, fatal: Boolean) {
        emitToJs(
            "error",
            JSONObject().apply {
                put("code", code)
                put("httpStatus", httpStatus)
                put("message", message)
                put("fatal", fatal)
            }
        )
    }

    fun play() {
        mainHandler.post {
            exoPlayer?.let {
                it.playWhenReady = true
                it.play()
            }
        }
    }

    fun pause() {
        mainHandler.post {
            exoPlayer?.pause()
        }
    }

    fun setVolume(volume: Float) {
        mainHandler.post {
            exoPlayer?.volume = volume.coerceIn(0f, 1f)
        }
    }

    fun seekTo(positionMs: Long) {
        mainHandler.post {
            exoPlayer?.seekTo(positionMs.coerceAtLeast(0L))
        }
    }

    fun seekBy(deltaMs: Long) {
        mainHandler.post {
            val p = exoPlayer ?: return@post
            val dur = p.duration
            val target = (p.currentPosition + deltaMs).coerceAtLeast(0L)
            val clamped = if (dur != C.TIME_UNSET && dur > 0L) target.coerceAtMost(dur) else target
            p.seekTo(clamped)
        }
    }

    fun setAudioTrack(trackId: String) {
        mainHandler.post {
            val player = exoPlayer ?: return@post
            val parts = trackId.split(":")
            if (parts.size != 2) return@post
            val gIdx = parts[0].toIntOrNull() ?: return@post
            val tIdx = parts[1].toIntOrNull() ?: return@post
            val groups = player.currentTracks.groups
            if (gIdx !in 0 until groups.size) return@post
            val mediaGroup = groups[gIdx].mediaTrackGroup
            player.trackSelectionParameters = player.trackSelectionParameters
                .buildUpon()
                .setOverrideForType(TrackSelectionOverride(mediaGroup, listOf(tIdx)))
                .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
                .build()
        }
    }

    fun setTextTrack(trackId: String) {
        mainHandler.post {
            val player = exoPlayer ?: return@post
            val clean = trackId.trim()
            if (clean.isEmpty() || clean.equals("off", ignoreCase = true) || clean == "-1") {
                player.trackSelectionParameters = player.trackSelectionParameters
                    .buildUpon()
                    .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                    .build()
                return@post
            }
            val parts = clean.split(":")
            if (parts.size != 2) return@post
            val gIdx = parts[0].toIntOrNull() ?: return@post
            val tIdx = parts[1].toIntOrNull() ?: return@post
            val groups = player.currentTracks.groups
            if (gIdx !in 0 until groups.size) return@post
            val mediaGroup = groups[gIdx].mediaTrackGroup
            player.trackSelectionParameters = player.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(mediaGroup, listOf(tIdx)))
                .build()
        }
    }

    fun setResizeMode(mode: String) {
        mainHandler.post {
            currentResizeMode = mode.lowercase(Locale.ROOT)
            applyResizeModeInternal(currentResizeMode)
        }
    }

    private fun applyResizeModeInternal(mode: String) {
        val dm = activity.resources.displayMetrics
        val screenW = dm.widthPixels.coerceAtLeast(1)
        val screenH = dm.heightPixels.coerceAtLeast(1)
        val lp = (playerView.layoutParams as? FrameLayout.LayoutParams)
            ?: FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        when (mode) {
            "16:9", "16-9" -> {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                lp.gravity = Gravity.CENTER
                playerView.layoutParams = lp
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
            }
            "4:3", "4-3" -> {
                lp.width = (screenW * 0.75f).toInt()
                lp.height = screenH
                lp.gravity = Gravity.CENTER
                playerView.layoutParams = lp
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
            }
            "fill", "zoom" -> {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                lp.gravity = Gravity.CENTER
                playerView.layoutParams = lp
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            }
            else -> {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                lp.gravity = Gravity.CENTER
                playerView.layoutParams = lp
                playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            }
        }
    }

    fun stop() {
        mainHandler.post {
            stopInternal(hideView = true)
        }
    }

    fun release() {
        mainHandler.post {
            stopInternal(hideView = true)
        }
    }

    private fun stopInternal(hideView: Boolean) {
        mainHandler.removeCallbacks(positionTicker)
        exoPlayer?.let { p ->
            try {
                p.removeListener(playerListener)
                p.stop()
                p.clearMediaItems()
                p.release()
            } catch (e: Exception) {
                Log.w(TAG, "Erro ao liberar ExoPlayer: ${e.message}")
            }
        }
        exoPlayer = null
        trackSelector = null
        playerView.player = null
        if (hideView) {
            playerView.visibility = View.INVISIBLE
        }
    }

    fun onActivityPause() {
        mainHandler.post {
            val p = exoPlayer ?: return@post
            wasPlayingBeforeActivityPause = p.isPlaying || p.playWhenReady
            if (wasPlayingBeforeActivityPause) {
                p.pause()
            }
        }
    }

    fun onActivityResume() {
        mainHandler.post {
            val p = exoPlayer ?: return@post
            if (wasPlayingBeforeActivityPause) {
                wasPlayingBeforeActivityPause = false
                p.play()
            }
        }
    }

    fun getDeviceInfoJson(webviewVersion: String): String {
        val codecsArr = JSONArray()
        val targetMimes = mapOf(
            "video/avc" to "H.264",
            "video/hevc" to "HEVC",
            "audio/mp4a-latm" to "AAC",
            "audio/ac3" to "AC-3",
            "audio/eac3" to "E-AC-3"
        )
        val found = mutableSetOf<String>()
        try {
            val list = MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
            for (info in list) {
                if (info.isEncoder) continue
                for (type in info.supportedTypes) {
                    val low = type.lowercase(Locale.ROOT)
                    targetMimes[low]?.let { found.add(it) }
                }
            }
        } catch (e: Exception) {
            found.addAll(listOf("H.264", "AAC"))
        }
        for (c in listOf("H.264", "HEVC", "AAC", "AC-3", "E-AC-3")) {
            if (found.contains(c)) codecsArr.put(c)
        }

        val model = Build.MODEL ?: "Android"
        val manufacturer = Build.MANUFACTURER ?: "Android"
        val isFireTv = manufacturer.contains("Amazon", ignoreCase = true) || model.startsWith("AFT", ignoreCase = true)

        return JSONObject().apply {
            put("model", model)
            put("manufacturer", manufacturer)
            put("sdkInt", Build.VERSION.SDK_INT)
            put("webviewVersion", webviewVersion)
            put("isFireTv", isFireTv)
            put("supportedCodecs", codecsArr)
        }.toString()
    }

    fun probeStream(url: String, userAgent: String, timeoutMs: Int, callback: (JSONObject) -> Unit) {
        probeExecutor.execute {
            val startMs = System.currentTimeMillis()
            val res = JSONObject()
            val timeoutSec = ((timeoutMs.coerceIn(3000, 30000)) / 1000L).coerceAtLeast(5L)
            val client = buildHttpClient(timeoutSec, timeoutSec, true)
            val ua = userAgent.trim().ifEmpty { DEFAULT_USER_AGENT }

            try {
                val req = Request.Builder()
                    .url(url)
                    .header("User-Agent", ua)
                    .header("Range", "bytes=0-65535")
                    .get()
                    .build()

                client.newCall(req).execute().use { resp ->
                    val status = resp.code
                    val cType = resp.header("Content-Type") ?: ""
                    val buf = ByteArray(4096)
                    val input = resp.body?.byteStream()
                    var totalRead = 0
                    if (input != null) {
                        while (totalRead < buf.size) {
                            val r = input.read(buf, totalRead, buf.size - totalRead)
                            if (r <= 0) break
                            totalRead += r
                            if (totalRead >= 512) break
                        }
                    }
                    val elapsedMs = System.currentTimeMillis() - startMs
                    val headAscii = if (totalRead > 0) {
                        String(buf, 0, minOf(totalRead, 128), Charsets.ISO_8859_1)
                    } else ""

                    val isM3u8 = headAscii.trimStart().startsWith("#EXTM3U") || cType.contains("mpegurl", ignoreCase = true)
                    val isTs = totalRead > 0 && (buf[0].toInt() and 0xFF) == 0x47
                    val isMp4 = headAscii.contains("ftyp") || cType.contains("mp4", ignoreCase = true)
                    val isMkv = totalRead >= 4 &&
                        (buf[0].toInt() and 0xFF) == 0x1A &&
                        (buf[1].toInt() and 0xFF) == 0x45 &&
                        (buf[2].toInt() and 0xFF) == 0xDF &&
                        (buf[3].toInt() and 0xFF) == 0xA3

                    val ok = resp.isSuccessful && (totalRead > 0)
                    res.put("ok", ok)
                    res.put("httpStatus", status)
                    res.put("elapsedMs", elapsedMs)
                    res.put("bytesRead", totalRead)
                    res.put("contentType", cType)
                    res.put(
                        "detectedFormat",
                        when {
                            isM3u8 -> "HLS (.m3u8)"
                            isTs -> "MPEG-TS (.ts)"
                            isMp4 -> "MP4"
                            isMkv -> "MKV"
                            else -> cType.substringBefore(";").ifEmpty { "Stream" }
                        }
                    )
                }
            } catch (e: Exception) {
                val elapsedMs = System.currentTimeMillis() - startMs
                res.put("ok", false)
                res.put("httpStatus", 0)
                res.put("elapsedMs", elapsedMs)
                res.put("error", e.message ?: e.javaClass.simpleName)
            }
            callback(res)
        }
    }
}
