package com.luminatv.player

import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.net.Uri
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLException

class LuminaWebViewClient(
    private val context: Context,
    private val assetLoader: WebViewAssetLoader,
    private val defaultUserAgent: String,
    private val onAppReady: () -> Unit,
    private val onWebViewCrash: () -> Unit,
    private val onMainFrameLoadError: (String) -> Unit = {}
) : WebViewClient() {

    data class StreamHeaderOverride(val userAgent: String, val referer: String)

    companion object {
        private const val TAG = "LuminaProxy"
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val PAIRING_HOST = "surubim-player-pairing.vercel.app"
        const val LOCAL_LISTS_PREFIX = "/__lists__/"

        @Volatile
        var customIptvUserAgent: String = "VLC/3.0.20 LibVLC/3.0.20"

        private val DIRECT_VIDEO_EXTENSIONS = listOf(
            ".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".mp3", ".aac"
        )

        fun maskUrlCredentials(url: String): String {
            return url
                .replace(Regex("([?&](?:password|pass|token)=)([^&\\s]+)", RegexOption.IGNORE_CASE), "$1***")
                .replace(Regex("(/(?:live|movie|series)/[^/\\s]+/)([^/\\s]+)(/)", RegexOption.IGNORE_CASE), "$1***$3")
        }
    }

    private val streamHeadersMap = ConcurrentHashMap<String, StreamHeaderOverride>()

    fun registerStreamHeaders(url: String, userAgent: String, referer: String) {
        if (url.isBlank()) return
        val baseKey = url.substringBefore("?")
        streamHeadersMap[url] = StreamHeaderOverride(userAgent, referer)
        streamHeadersMap[baseKey] = StreamHeaderOverride(userAgent, referer)
    }

    private fun findHeaderOverride(url: String): StreamHeaderOverride? {
        return streamHeadersMap[url] ?: streamHeadersMap[url.substringBefore("?")]
    }

    private fun isAllowedNavigation(urlStr: String?): Boolean {
        if (urlStr.isNullOrBlank()) return false
        val clean = urlStr.trim()
        if (clean == "about:blank") return true
        val uri = try { Uri.parse(clean) } catch (_: Exception) { return false }
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return false
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        return (scheme == "https" && host == ASSET_HOST)
    }

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString()
        if (isAllowedNavigation(url)) {
            return false
        }
        Log.w(TAG, "Navegação externa bloqueada (API 24+): ${maskUrlCredentials(url ?: "")}")
        return true
    }

    @Suppress("DEPRECATION", "DeprecatedCallableAddReplaceWith")
    override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
        if (isAllowedNavigation(url)) {
            return false
        }
        Log.w(TAG, "Navegação externa bloqueada (API legada): ${maskUrlCredentials(url ?: "")}")
        return true
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val req = request ?: return null
        val uri = req.url ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "http" && scheme != "https") return null

        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        val encodedPath = uri.encodedPath ?: ""

        if (host == ASSET_HOST) {
            if (encodedPath.startsWith(LOCAL_LISTS_PREFIX)) {
                return serveLocalListFileWithRange(req, encodedPath.removePrefix(LOCAL_LISTS_PREFIX))
            }
            return assetLoader.shouldInterceptRequest(uri)
        }

        if (host == PAIRING_HOST || encodedPath.startsWith("/api/pair/")) {
            return null
        }

        val method = req.method?.uppercase(Locale.ROOT) ?: "GET"

        if (method == "OPTIONS") {
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                204,
                "No Content",
                corsHeaders(),
                ByteArrayInputStream(ByteArray(0))
            )
        }

        if (method != "GET" && method != "HEAD") {
            return null
        }

        val urlStr = uri.toString()
        val hasCustomStreamHeaders = findHeaderOverride(urlStr) != null
        val pathLower = encodedPath.lowercase(Locale.ROOT)
        val headers = req.requestHeaders ?: emptyMap()
        val secFetchDest = headers["Sec-Fetch-Dest"]?.lowercase(Locale.ROOT) ?: ""
        val secFetchMode = headers["Sec-Fetch-Mode"]?.lowercase(Locale.ROOT) ?: ""
        val hasRange = headers.keys.any { it.equals("Range", ignoreCase = true) }

        if (!hasCustomStreamHeaders) {
            if (secFetchDest == "video" || secFetchDest == "audio" || secFetchDest == "image") {
                return null
            }
            if (DIRECT_VIDEO_EXTENSIONS.any { pathLower.endsWith(it) } && secFetchMode != "cors") {
                return null
            }
            if ((pathLower.endsWith(".ts") || pathLower.endsWith(".m3u8")) &&
                hasRange && secFetchMode == "no-cors"
            ) {
                return null
            }
        }

        return executeCorsProxyRequest(req)
    }

    // Parte 3.3: Serve arquivos locais de cacheDir/lists/<filename> com suporte a Range (206 Partial Content)
    private fun serveLocalListFileWithRange(req: WebResourceRequest, rawName: String): WebResourceResponse {
        val safeName = rawName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val file = File(File(context.cacheDir, "lists"), safeName)
        if (!file.exists() || !file.isFile) {
            return WebResourceResponse(
                "application/json",
                "UTF-8",
                404,
                "Not Found",
                corsHeaders(),
                ByteArrayInputStream("{\"error\":\"not_found\"}".toByteArray(Charsets.UTF_8))
            )
        }

        val totalLen = file.length()
        val headers = req.requestHeaders ?: emptyMap()
        val rangeKey = headers.keys.firstOrNull { it.equals("Range", ignoreCase = true) }
        val rangeVal = if (rangeKey != null) headers[rangeKey] ?: "" else ""

        var start = 0L
        var end = (totalLen - 1L).coerceAtLeast(0L)
        var isPartial = false

        if (rangeVal.startsWith("bytes=", ignoreCase = true) && totalLen > 0L) {
            val spec = rangeVal.substringAfter("=").trim()
            val parts = spec.split("-")
            val s = parts.getOrNull(0)?.trim()?.toLongOrNull()
            val e = parts.getOrNull(1)?.trim()?.toLongOrNull()
            if (s != null && s in 0 until totalLen) {
                start = s
                end = if (e != null && e in start until totalLen) e else (totalLen - 1L)
                isPartial = true
            }
        }

        val contentLen = if (totalLen == 0L) 0L else (end - start + 1L)
        val outHeaders = corsHeaders().toMutableMap().apply {
            put("Accept-Ranges", "bytes")
            put("Content-Length", contentLen.toString())
            if (isPartial) {
                put("Content-Range", "bytes $start-$end/$totalLen")
            }
        }

        val raf = RandomAccessFile(file, "r")
        raf.seek(start)
        val stream = object : InputStream() {
            private var remaining = contentLen
            override fun read(): Int {
                if (remaining <= 0L) return -1
                val b = raf.read()
                if (b != -1) remaining--
                return b
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (remaining <= 0L) return -1
                val maxRead = minOf(len.toLong(), remaining).toInt()
                val r = raf.read(b, off, maxRead)
                if (r > 0) remaining -= r
                return r
            }

            override fun close() {
                try { raf.close() } catch (_: Exception) {}
            }
        }

        val mime = if (safeName.endsWith(".json")) "application/json" else "text/plain"
        return WebResourceResponse(
            mime,
            "UTF-8",
            if (isPartial) 206 else 200,
            if (isPartial) "Partial Content" else "OK",
            outHeaders,
            stream
        )
    }

    private fun executeCorsProxyRequest(webReq: WebResourceRequest): WebResourceResponse {
        val urlStr = webReq.url.toString()
        return try {
            val method = webReq.method?.uppercase(Locale.ROOT) ?: "GET"
            val reqBuilder = Request.Builder().url(urlStr)

            if (method == "HEAD") {
                reqBuilder.head()
            } else {
                reqBuilder.get()
            }

            val incomingHeaders = webReq.requestHeaders ?: emptyMap()
            val forwardedHeaders = listOf(
                "Accept",
                "Accept-Language",
                "Range",
                "If-Range",
                "If-None-Match",
                "If-Modified-Since",
                "Cache-Control"
            )
            for (hName in forwardedHeaders) {
                val matchKey = incomingHeaders.keys.firstOrNull { it.equals(hName, ignoreCase = true) }
                if (matchKey != null) {
                    val v = incomingHeaders[matchKey]
                    if (!v.isNullOrBlank()) {
                        reqBuilder.header(hName, v)
                    }
                }
            }

            val overrideHeaders = findHeaderOverride(urlStr)
            val uaToUse = when {
                overrideHeaders != null && overrideHeaders.userAgent.isNotBlank() -> overrideHeaders.userAgent
                customIptvUserAgent.isNotBlank() -> customIptvUserAgent
                else -> incomingHeaders["User-Agent"]?.takeIf { it.isNotBlank() } ?: defaultUserAgent
            }
            if (uaToUse.isNotBlank()) {
                reqBuilder.header("User-Agent", uaToUse)
            }
            if (overrideHeaders != null && overrideHeaders.referer.isNotBlank()) {
                reqBuilder.header("Referer", overrideHeaders.referer)
            }

            // Timeout de leitura ampliado para 180s para suportar respostas grandes transmitidas em fluxo (Parte 3.6)
            val client = NativePlayerController.buildHttpClient(20L, 180L, true)
            val response = client.newCall(reqBuilder.build()).execute()
            val contentTypeHeader = response.header("Content-Type") ?: guessMimeType(urlStr)
            val mimeType = contentTypeHeader.substringBefore(";").trim().ifEmpty { "application/octet-stream" }
            val charset = if (contentTypeHeader.contains("charset=", ignoreCase = true)) {
                contentTypeHeader.substringAfter("charset=", "UTF-8").substringBefore(";").trim()
            } else {
                "UTF-8"
            }

            val outHeaders = corsHeaders().toMutableMap()
            val passThroughRespHeaders = listOf(
                "Content-Length",
                "Content-Range",
                "Accept-Ranges",
                "Content-Type",
                "Cache-Control",
                "ETag",
                "Last-Modified",
                "Retry-After"
            )
            for (h in passThroughRespHeaders) {
                response.header(h)?.let { outHeaders[h] = it }
            }

            val statusCode = response.code.coerceIn(100, 599)
            val reasonPhrase = response.message.ifBlank {
                if (statusCode in 200..299) "OK" else "HTTP $statusCode"
            }
            val bodyStream = response.body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))

            WebResourceResponse(
                mimeType,
                charset,
                statusCode,
                reasonPhrase,
                outHeaders,
                bodyStream
            )
        } catch (e: Exception) {
            val proxyErrType = when (e) {
                is UnknownHostException -> "DNS"
                is SocketTimeoutException -> "TIMEOUT"
                is SSLException -> "SSL"
                is java.net.ConnectException -> "CONNECT"
                else -> "OTHER"
            }
            val safeMsg = e.message ?: e.javaClass.simpleName
            Log.w(TAG, "Falha de proxy [$proxyErrType] em ${maskUrlCredentials(urlStr)}: $safeMsg")

            val errJson = JSONObject().apply {
                put("proxyError", proxyErrType)
                put("message", safeMsg)
            }.toString()

            val errHeaders = corsHeaders().toMutableMap().apply {
                put("X-Lumina-Proxy-Error", proxyErrType)
                put("Content-Type", "application/json; charset=UTF-8")
            }

            WebResourceResponse(
                "application/json",
                "UTF-8",
                502,
                "Bad Gateway",
                errHeaders,
                ByteArrayInputStream(errJson.toByteArray(Charsets.UTF_8))
            )
        }
    }

    private fun corsHeaders(): Map<String, String> = mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Headers" to "*",
        "Access-Control-Allow-Methods" to "GET, POST, OPTIONS, HEAD",
        "Access-Control-Expose-Headers" to "*, X-Lumina-Proxy-Error, Content-Range, Content-Length, Accept-Ranges, ETag, Last-Modified, Retry-After",
        "Access-Control-Max-Age" to "86400"
    )

    private fun guessMimeType(url: String): String {
        val clean = url.substringBefore("?").lowercase(Locale.ROOT)
        return when {
            clean.endsWith(".m3u") || clean.endsWith(".m3u8") -> "application/vnd.apple.mpegurl; charset=UTF-8"
            clean.endsWith(".json") || clean.contains("player_api.php") -> "application/json; charset=UTF-8"
            clean.endsWith(".ts") -> "video/mp2t"
            clean.endsWith(".mp4") -> "video/mp4"
            clean.endsWith(".mkv") -> "video/x-matroska"
            else -> "text/plain; charset=UTF-8"
        }
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        view?.evaluateJavascript(
            "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
            null
        )
    }

    override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
        super.onReceivedError(view, request, error)
        if (request?.isForMainFrame == true) {
            val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                "${error?.description} (código ${error?.errorCode})"
            } else {
                "Erro de carregamento"
            }
            Log.e(TAG, "Falha ao carregar página principal: $desc em ${request.url}")
            onMainFrameLoadError("Falha ao carregar página principal:\nURL: ${request.url}\nErro: $desc")
        }
    }

    @Suppress("DEPRECATION")
    override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
        super.onReceivedError(view, errorCode, description, failingUrl)
        if (failingUrl == null || failingUrl == MainActivity.APP_ENTRY_URL || failingUrl.startsWith("https://$ASSET_HOST")) {
            Log.e(TAG, "Falha ao carregar página principal (legado): $description (código $errorCode)")
            onMainFrameLoadError("Falha ao carregar página principal (legado):\nURL: $failingUrl\nErro: $description (código $errorCode)")
        }
    }

    override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
        super.onReceivedHttpError(view, request, errorResponse)
        if (request?.isForMainFrame == true) {
            val status = errorResponse?.statusCode ?: 0
            Log.e(TAG, "Erro HTTP na página principal: $status em ${request.url}")
            onMainFrameLoadError("Erro HTTP ao carregar página principal:\nURL: ${request.url}\nStatus: $status")
        }
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        view?.evaluateJavascript(
            "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
            null
        )
        onAppReady()
    }

    // Parte 9.2: Se o processo de renderização do WebView morrer (OOM ou falha interna),
    // registra no boot guard e recria o WebView em Modo Seguro sem fechar nem entrar em loop!
    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
        Log.e(TAG, "WebView onRenderProcessGone detectado! Ativando Modo Seguro e recriando WebView.")
        onWebViewCrash()
        return true
    }
}
