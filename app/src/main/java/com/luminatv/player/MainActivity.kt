package com.luminatv.player

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import java.io.File
import kotlin.math.min
import kotlin.math.roundToInt

class MainActivity : Activity() {

    companion object {
        const val APP_ENTRY_URL = "https://appassets.androidplatform.net/assets/app/index.html"
        private const val DESIGN_WIDTH = 1920.0
        private const val DESIGN_HEIGHT = 1080.0
        private const val MIN_CHROMIUM_MAJOR = 50
    }

    private lateinit var rootContainer: FrameLayout
    private lateinit var fullscreenVideoContainer: FrameLayout
    private lateinit var splashImageView: ImageView
    private var webView: WebView? = null
    private var keyBridge: KeyBridge? = null
    private var chromeClient: LuminaChromeClient? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: Any? = null
    private var wasPlayingBeforePause: Boolean = false

    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        val wv = webView ?: return@OnAudioFocusChangeListener
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                wv.post {
                    wv.evaluateJavascript(
                        "(function(){try{if(window.LuminaPlayer&&window.LuminaPlayer.getState()==='PLAYING'){window.LuminaPlayer.togglePlayPause();}}catch(e){}})();",
                        null
                    )
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                wv.post {
                    wv.evaluateJavascript(
                        "(function(){try{var v=document.getElementById('main-video');if(v)v.volume=0.25;}catch(e){}})();",
                        null
                    )
                }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                wv.post {
                    wv.evaluateJavascript(
                        "(function(){try{var v=document.getElementById('main-video');if(v)v.volume=1.0;}catch(e){}})();",
                        null
                    )
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.setBackgroundColor(Color.parseColor("#0B0F17"))
        applyImmersiveFullscreen()

        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        requestAudioFocus()

        rootContainer = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0B0F17"))
        }

        fullscreenVideoContainer = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }

        splashImageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0B0F17"))
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageResource(R.drawable.splash)
        }

        val createdWebView = try {
            WebView(this)
        } catch (t: Throwable) {
            null
        }

        if (createdWebView == null) {
            showOutdatedWebViewScreen("Componente WebView ausente no sistema.")
            setContentView(rootContainer)
            return
        }

        webView = createdWebView
        val ua = createdWebView.settings.userAgentString ?: ""
        val majorVersion = extractChromiumMajor(ua)
        if (majorVersion in 1 until MIN_CHROMIUM_MAJOR) {
            showOutdatedWebViewScreen("Versão detectada: Chromium $majorVersion (mínimo recomendado: $MIN_CHROMIUM_MAJOR).")
            setContentView(rootContainer)
            return
        }

        setupWebView(createdWebView)

        rootContainer.addView(
            createdWebView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        rootContainer.addView(fullscreenVideoContainer)
        rootContainer.addView(splashImageView)

        setContentView(rootContainer)

        rootContainer.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            val w = right - left
            val h = bottom - top
            val oldW = oldRight - oldLeft
            val oldH = oldBottom - oldTop
            if (w > 0 && h > 0 && (w != oldW || h != oldH)) {
                updateWebViewScale(w, h)
            }
        }

        createdWebView.loadUrl(APP_ENTRY_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(wv: WebView) {
        val isDebugBuild = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(isDebugBuild)

        wv.setBackgroundColor(Color.parseColor("#0B0F17"))
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true
        wv.isHorizontalScrollBarEnabled = false
        wv.isVerticalScrollBarEnabled = false
        wv.overScrollMode = View.OVER_SCROLL_NEVER

        val settings = wv.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        @Suppress("DEPRECATION")
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.textZoom = 100

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true)
        }

        val dm = DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(dm)
        updateWebViewScale(dm.widthPixels, dm.heightPixels)

        wv.addJavascriptInterface(LuminaAndroidBridge(), "LuminaAndroidBridge")

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .setHttpAllowed(false)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val defaultUa = settings.userAgentString
        wv.webViewClient = LuminaWebViewClient(
            assetLoader = assetLoader,
            defaultUserAgent = defaultUa,
            onAppReady = { hideNativeSplash() }
        )

        val cc = LuminaChromeClient(
            activity = this,
            webView = wv,
            fullscreenContainer = fullscreenVideoContainer
        )
        chromeClient = cc
        wv.webChromeClient = cc

        keyBridge = KeyBridge(wv)
        wv.requestFocus()
    }

    private fun updateWebViewScale(widthPx: Int, heightPx: Int) {
        val wv = webView ?: return
        if (widthPx <= 0 || heightPx <= 0) return
        val scaleRatio = min(widthPx / DESIGN_WIDTH, heightPx / DESIGN_HEIGHT)
        val initialScalePercent = (scaleRatio * 100.0).roundToInt().coerceAtLeast(1)
        wv.setInitialScale(initialScalePercent)
        wv.evaluateJavascript(
            "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
            null
        )
    }

    private fun hideNativeSplash() {
        runOnUiThread {
            if (splashImageView.visibility == View.VISIBLE) {
                splashImageView.animate()
                    .alpha(0f)
                    .setDuration(280L)
                    .withEndAction {
                        splashImageView.visibility = View.GONE
                    }
                    .start()
            }
        }
    }

    private fun showOutdatedWebViewScreen(detail: String) {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(96, 64, 96, 64)
            setBackgroundColor(Color.parseColor("#0B0F17"))
        }

        val titleView = TextView(this).apply {
            text = getString(R.string.webview_outdated_title)
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 24f
            gravity = Gravity.CENTER
        }

        val messageView = TextView(this).apply {
            text = "${getString(R.string.webview_outdated_message)}\n\n$detail"
            setTextColor(Color.parseColor("#F8FAFC"))
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 0)
        }

        layout.addView(titleView)
        layout.addView(messageView)
        rootContainer.addView(
            layout,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
    }

    private fun extractChromiumMajor(ua: String): Int {
        val regex = Regex("Chrome/(\\d+)\\.")
        val match = regex.find(ua) ?: return -1
        return match.groupValues.getOrNull(1)?.toIntOrNull() ?: -1
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val cc = chromeClient
        if (cc != null && cc.isInCustomView() && event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                cc.exitCustomView()
            }
            return true
        }

        val kb = keyBridge
        if (kb != null && kb.handleKeyEvent(event)) {
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // O botão Voltar já é tratado por KeyBridge.dispatchKeyEvent -> JS keyCode 27
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveFullscreen()
        requestAudioFocus()
        webView?.let { wv ->
            wv.onResume()
            wv.resumeTimers()
            if (wasPlayingBeforePause) {
                wasPlayingBeforePause = false
                wv.evaluateJavascript(
                    "(function(){try{if(window.LuminaPlayer&&window.LuminaPlayer.getState()==='PAUSED'){window.LuminaPlayer.togglePlayPause();}}catch(e){}})();",
                    null
                )
            }
            wv.requestFocus()
        }
    }

    override fun onPause() {
        webView?.let { wv ->
            wv.evaluateJavascript(
                """
                (function(){
                  try {
                    if (window.LuminaPlayer && window.LuminaPlayer.getState() === 'PLAYING') {
                      window.LuminaAndroidBridge.notifyWasPlaying(true);
                      window.LuminaPlayer.togglePlayPause();
                    } else {
                      var v = document.getElementById('main-video');
                      if (v && !v.paused) {
                        window.LuminaAndroidBridge.notifyWasPlaying(true);
                        v.pause();
                      }
                    }
                  } catch (e) {}
                })();
                """.trimIndent(),
                null
            )
            CookieManager.getInstance().flush()
            wv.onPause()
        }
        abandonAudioFocus()
        super.onPause()
    }

    override fun onDestroy() {
        keyBridge?.cleanup()
        abandonAudioFocus()
        webView?.let { wv ->
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.stopLoading()
            wv.loadUrl("about:blank")
            wv.destroy()
        }
        webView = null
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveFullscreen()
            webView?.requestFocus()
        }
    }

    private fun applyImmersiveFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    private fun requestAudioFocus() {
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(audioFocusChangeListener)
                .build()
            audioFocusRequest = req
            am.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
    }

    private fun abandonAudioFocus() {
        val am = audioManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            (audioFocusRequest as? AudioFocusRequest)?.let { am.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(audioFocusChangeListener)
        }
    }

    inner class LuminaAndroidBridge {
        @JavascriptInterface
        fun exitApp() {
            runOnUiThread {
                finish()
            }
        }

        @JavascriptInterface
        fun notifyWasPlaying(playing: Boolean) {
            wasPlayingBeforePause = playing
        }

        @JavascriptInterface
        fun saveBackupToDisk(filename: String, jsonContent: String): Boolean {
            return try {
                val safeName = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                val targetDir = getExternalFilesDir(null) ?: filesDir
                val outFile = File(targetDir, safeName)
                outFile.writeText(jsonContent, Charsets.UTF_8)
                runOnUiThread {
                    Toast.makeText(
                        this@MainActivity,
                        "Backup salvo em: ${outFile.absolutePath}",
                        Toast.LENGTH_SHORT
                    ).show()
                }
                true
            } catch (e: Exception) {
                false
            }
        }

        @JavascriptInterface
        fun readBackupFromDisk(filename: String): String {
            return try {
                val safeName = filename.replace(Regex("[^a-zA-Z0-9._-]"), "_")
                val targetDir = getExternalFilesDir(null) ?: filesDir
                val inFile = File(targetDir, safeName)
                if (inFile.exists()) inFile.readText(Charsets.UTF_8) else ""
            } catch (e: Exception) {
                ""
            }
        }
    }
}
