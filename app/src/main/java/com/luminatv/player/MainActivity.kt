package com.luminatv.player

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {

    companion object {
        const val APP_ENTRY_URL = "https://appassets.androidplatform.net/assets/app/index.html"
        const val UPDATE_REPO = "alencarmsophia-dev/lumina-tv-android"
        const val APP_VERSION_NAME = "2.0.0"
        private const val MIN_CHROMIUM_MAJOR = 50
    }

    private lateinit var rootContainer: FrameLayout
    private lateinit var fullscreenVideoContainer: FrameLayout
    private lateinit var splashImageView: ImageView
    private var webView: WebView? = null
    private var webViewClientInstance: LuminaWebViewClient? = null
    private var keyBridge: KeyBridge? = null
    private var chromeClient: LuminaChromeClient? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: Any? = null
    private var wasPlayingBeforePause: Boolean = false
    private var isOutdatedWebViewScreenShown: Boolean = false
    private val bgExecutor = Executors.newSingleThreadExecutor()

    private val updateHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
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
            showOutdatedWebViewScreen("Componente WebView ausente no sistema. Pressione Voltar para sair.")
            setContentView(rootContainer)
            return
        }

        webView = createdWebView
        val ua = createdWebView.settings.userAgentString ?: ""
        val majorVersion = extractChromiumMajor(ua)
        if (majorVersion in 1 until MIN_CHROMIUM_MAJOR) {
            showOutdatedWebViewScreen("Versão detectada: Chromium $majorVersion (mínimo recomendado: $MIN_CHROMIUM_MAJOR). Pressione Voltar para sair.")
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
                createdWebView.evaluateJavascript(
                    "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
                    null
                )
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
        // T6: Escala 1920x1080 passa a ser feita exclusivamente pelo JS (js/core/viewport-fit.js)
        settings.useWideViewPort = false
        settings.loadWithOverviewMode = false
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.textZoom = 100

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true)
        }

        wv.addJavascriptInterface(LuminaAndroidBridge(), "LuminaAndroidBridge")

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .setHttpAllowed(false)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val defaultUa = settings.userAgentString
        val client = LuminaWebViewClient(
            assetLoader = assetLoader,
            defaultUserAgent = defaultUa,
            onAppReady = {
                wv.evaluateJavascript("if(window.__luminaFitViewport){window.__luminaFitViewport();}", null)
                hideNativeSplash()
            }
        )
        webViewClientInstance = client
        wv.webViewClient = client

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

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyImmersiveFullscreen()
        webView?.evaluateJavascript(
            "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
            null
        )
    }

    private fun hideNativeSplash() {
        runOnUiThread {
            if (splashImageView.visibility == View.VISIBLE) {
                splashImageView.animate()
                    .alpha(0f)
                    .setDuration(120L)
                    .withEndAction {
                        splashImageView.visibility = View.GONE
                    }
                    .start()
            }
        }
    }

    private fun showOutdatedWebViewScreen(detail: String) {
        isOutdatedWebViewScreenShown = true
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
        if (isOutdatedWebViewScreenShown && event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                finish()
            }
            return true
        }

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
        if (isOutdatedWebViewScreenShown) {
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveFullscreen()
        requestAudioFocus()
        webView?.let { wv ->
            wv.onResume()
            wv.resumeTimers()
            wv.evaluateJavascript(
                "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
                null
            )
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
                    var v = document.getElementById('main-video');
                    if (v && !v.paused) {
                      window.LuminaAndroidBridge.notifyWasPlaying(true);
                      v.pause();
                    }
                    if (window.LuminaPlayer && window.LuminaPlayer.getState() === 'PLAYING') {
                      window.LuminaAndroidBridge.notifyWasPlaying(true);
                      window.LuminaPlayer.togglePlayPause();
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
            webView?.let { wv ->
                wv.requestFocus()
                wv.evaluateJavascript(
                    "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
                    null
                )
            }
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

    private fun isNewerSemanticVersion(latestTag: String, currentVer: String): Boolean {
        val cleanLatest = latestTag.trim().removePrefix("v").removePrefix("V")
        val cleanCur = currentVer.trim().removePrefix("v").removePrefix("V")
        val lParts = cleanLatest.split(".").map { it.toIntOrNull() ?: 0 }
        val cParts = cleanCur.split(".").map { it.toIntOrNull() ?: 0 }
        val maxLen = maxOf(lParts.size, cParts.size)
        for (i in 0 until maxLen) {
            val lv = lParts.getOrElse(i) { 0 }
            val cv = cParts.getOrElse(i) { 0 }
            if (lv > cv) return true
            if (lv < cv) return false
        }
        return false
    }

    private fun sendJsCallback(script: String) {
        runOnUiThread {
            webView?.evaluateJavascript(script, null)
        }
    }

    inner class LuminaAndroidBridge {
        @JavascriptInterface
        fun getAppVersion(): String = APP_VERSION_NAME

        @JavascriptInterface
        fun exitApp() {
            runOnUiThread { finish() }
        }

        @JavascriptInterface
        fun notifyWasPlaying(playing: Boolean) {
            wasPlayingBeforePause = playing
        }

        @JavascriptInterface
        fun registerStreamHeaders(url: String, userAgent: String, referer: String) {
            webViewClientInstance?.registerStreamHeaders(url, userAgent, referer)
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
                        "Salvo em: ${outFile.absolutePath}",
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

        @JavascriptInterface
        fun canInstallUnknownApps(): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                packageManager.canRequestPackageInstalls()
            } else {
                true
            }
        }

        @JavascriptInterface
        fun openUnknownAppsSettings() {
            runOnUiThread {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        val intent = Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:$packageName")
                        )
                        startActivity(intent)
                    } else {
                        startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
                    }
                } catch (e: Exception) {
                    Toast.makeText(
                        this@MainActivity,
                        "Ative 'Apps de fontes desconhecidas' nas Configurações da Fire TV.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        @JavascriptInterface
        fun checkForUpdate() {
            bgExecutor.execute {
                val resObj = JSONObject()
                resObj.put("supported", true)
                resObj.put("currentVersion", APP_VERSION_NAME)
                try {
                    val apiUrl = "https://api.github.com/repos/$UPDATE_REPO/releases/latest"
                    val req = Request.Builder()
                        .url(apiUrl)
                        .header("Accept", "application/vnd.github+json")
                        .header("User-Agent", "LuminaTV-Android/$APP_VERSION_NAME")
                        .build()

                    updateHttpClient.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) {
                            resObj.put("hasUpdate", false)
                            resObj.put("message", "Atualização automática indisponível (HTTP ${resp.code}).")
                        } else {
                            val bodyStr = resp.body?.string() ?: "{}"
                            val json = JSONObject(bodyStr)
                            val tagName = json.optString("tag_name", APP_VERSION_NAME)
                            val bodyNotes = json.optString("body", "").take(260)
                            val assets = json.optJSONArray("assets")
                            var apkUrl = ""
                            var apkSize = 0L
                            var sha256Hash = ""

                            if (assets != null) {
                                for (i in 0 until assets.length()) {
                                    val asset = assets.getJSONObject(i)
                                    val name = asset.optString("name", "")
                                    if (name == "lumina-tv.apk" || (apkUrl.isEmpty() && name.endsWith(".apk"))) {
                                        apkUrl = asset.optString("browser_download_url", "")
                                        apkSize = asset.optLong("size", 0L)
                                    }
                                }
                            }
                            val shaMatch = Regex("(?i)sha256[:\\s]+([a-f0-9]{64})").find(bodyNotes)
                            if (shaMatch != null) {
                                sha256Hash = shaMatch.groupValues[1].lowercase()
                            }

                            val hasNew = isNewerSemanticVersion(tagName, APP_VERSION_NAME) && apkUrl.isNotEmpty()
                            resObj.put("hasUpdate", hasNew)
                            resObj.put("latestVersion", tagName)
                            resObj.put("releaseNotes", bodyNotes)
                            resObj.put("downloadUrl", apkUrl)
                            resObj.put("assetSize", apkSize)
                            resObj.put("sha256", sha256Hash)
                        }
                    }
                } catch (e: Exception) {
                    resObj.put("hasUpdate", false)
                    resObj.put("message", "Atualização automática indisponível no momento.")
                }

                val safeJson = JSONObject.quote(resObj.toString())
                sendJsCallback("if(window.__luminaOnUpdateCheckResult){window.__luminaOnUpdateCheckResult($safeJson);}")
            }
        }

        @JavascriptInterface
        fun downloadAndInstallUpdate(downloadUrl: String, expectedSize: Long, expectedSha256: String) {
            bgExecutor.execute {
                try {
                    val updatesDir = File(cacheDir, "updates")
                    if (!updatesDir.exists()) updatesDir.mkdirs()
                    val apkFile = File(updatesDir, "lumina-tv.apk")
                    if (apkFile.exists()) apkFile.delete()

                    val req = Request.Builder()
                        .url(downloadUrl)
                        .header("User-Agent", "LuminaTV-Android/$APP_VERSION_NAME")
                        .build()

                    updateHttpClient.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) {
                            throw Exception("Falha no download do APK (HTTP ${resp.code})")
                        }
                        val body = resp.body ?: throw Exception("Resposta vazia ao baixar APK")
                        val totalBytes = if (body.contentLength() > 0) body.contentLength() else expectedSize
                        val digest = MessageDigest.getInstance("SHA-256")

                        body.byteStream().use { input ->
                            FileOutputStream(apkFile).use { output ->
                                val buffer = ByteArray(16 * 1024)
                                var downloaded = 0L
                                var read: Int
                                var lastReportedPct = -1
                                while (input.read(buffer).also { read = it } != -1) {
                                    output.write(buffer, 0, read)
                                    digest.update(buffer, 0, read)
                                    downloaded += read
                                    if (totalBytes > 0) {
                                        val pct = ((downloaded * 100L) / totalBytes).toInt().coerceIn(0, 100)
                                        if (pct != lastReportedPct) {
                                            lastReportedPct = pct
                                            val dlMb = String.format("%.1f", downloaded / 1048576.0)
                                            val totMb = String.format("%.1f", totalBytes / 1048576.0)
                                            sendJsCallback("if(window.__luminaOnUpdateProgress){window.__luminaOnUpdateProgress($pct,'$dlMb','$totMb');}")
                                        }
                                    }
                                }
                                output.flush()
                            }
                        }

                        if (expectedSize > 0 && apkFile.length() != expectedSize) {
                            throw Exception("Tamanho do APK baixado (${apkFile.length()}) difere do esperado ($expectedSize).")
                        }

                        if (expectedSha256.isNotBlank()) {
                            val actualSha = digest.digest().joinToString("") { "%02x".format(it) }
                            if (!actualSha.equals(expectedSha256.trim(), ignoreCase = true)) {
                                apkFile.delete()
                                throw Exception("Verificação SHA-256 falhou! Arquivo corrompido.")
                            }
                        }
                    }

                    runOnUiThread {
                        val apkUri = FileProvider.getUriForFile(
                            this@MainActivity,
                            "$packageName.fileprovider",
                            apkFile
                        )
                        val installIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(apkUri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(installIntent)
                    }

                    val okJson = JSONObject.quote(JSONObject().put("ok", true).toString())
                    sendJsCallback("if(window.__luminaOnUpdateResult){window.__luminaOnUpdateResult($okJson);}")
                } catch (e: Exception) {
                    val errJson = JSONObject.quote(
                        JSONObject().put("ok", false).put("error", e.message ?: "Erro ao atualizar APK").toString()
                    )
                    sendJsCallback("if(window.__luminaOnUpdateResult){window.__luminaOnUpdateResult($errJson);}")
                }
            }
        }
    }
}
