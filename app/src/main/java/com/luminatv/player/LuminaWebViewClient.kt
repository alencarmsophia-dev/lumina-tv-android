package com.luminatv.player

import android.graphics.Bitmap
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLException

class LuminaWebViewClient(
    private val assetLoader: WebViewAssetLoader,
    private val defaultUserAgent: String,
    private val onAppReady: () -> Unit
) : WebViewClient() {

    data class StreamHeaderOverride(val userAgent: String, val referer: String)

    companion object {
        private const val TAG = "LuminaProxy"
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val PAIRING_HOST = "surubim-player-pairing.vercel.app"

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

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val req = request ?: return null
        val uri = req.url ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "http" && scheme != "https") return null

        val host = uri.host?.lowercase(Locale.ROOT) ?: return null

        if (host == ASSET_HOST) {
            return assetLoader.shouldInterceptRequest(uri)
        }

        if (host == PAIRING_HOST || uri.encodedPath?.startsWith("/api/pair/") == true) {
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
        val pathLower = (uri.encodedPath ?: "").lowercase(Locale.ROOT)
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

            val client = NativePlayerController.buildHttpClient(20L, 120L, true)
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
                "Last-Modified"
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
        "Access-Control-Expose-Headers" to "*, X-Lumina-Proxy-Error",
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

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        view?.evaluateJavascript(
            "if(window.__luminaFitViewport){window.__luminaFitViewport();}",
            null
        )
        onAppReady()
    }
}
