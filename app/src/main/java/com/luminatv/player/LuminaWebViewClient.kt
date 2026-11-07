package com.luminatv.player

import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.util.Locale
import java.util.concurrent.TimeUnit

class LuminaWebViewClient(
    private val assetLoader: WebViewAssetLoader,
    private val defaultUserAgent: String,
    private val onAppReady: () -> Unit
) : WebViewClient() {

    companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val PAIRING_HOST = "surubim-player-pairing.vercel.app"

        /**
         * User-Agent configurável: por padrão usa o User-Agent nativo do WebView.
         * Caso algum provedor IPTV exija um UA específico (ex.: "IPTVSmartersPlayer"),
         * basta preencher CUSTOM_IPTV_USER_AGENT abaixo.
         */
        const val CUSTOM_IPTV_USER_AGENT: String = ""

        private val DIRECT_VIDEO_EXTENSIONS = listOf(
            ".mp4", ".mkv", ".avi", ".mov", ".flv", ".webm", ".mp3", ".aac"
        )
    }

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .build()

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val req = request ?: return null
        val uri = req.url ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "http" && scheme != "https") return null

        val host = uri.host?.lowercase(Locale.ROOT) ?: return null

        // 1. Arquivos estáticos embutidos do app (https://appassets.androidplatform.net/assets/app/...)
        if (host == ASSET_HOST) {
            return assetLoader.shouldInterceptRequest(uri)
        }

        // 2. Servidor de pareamento Vercel (já envia Access-Control-Allow-Origin: * e usa POST com body)
        if (host == PAIRING_HOST || uri.encodedPath?.startsWith("/api/pair/") == true) {
            return null
        }

        val method = req.method?.uppercase(Locale.ROOT) ?: "GET"

        // 3. Responde preflight CORS OPTIONS imediatamente com 204
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

        // 4. Não intercepta POST/PUT externos para não perder o corpo da requisição
        if (method != "GET" && method != "HEAD") {
            return null
        }

        val pathLower = (uri.encodedPath ?: "").lowercase(Locale.ROOT)
        val headers = req.requestHeaders ?: emptyMap()
        val secFetchDest = headers["Sec-Fetch-Dest"]?.lowercase(Locale.ROOT) ?: ""
        val secFetchMode = headers["Sec-Fetch-Mode"]?.lowercase(Locale.ROOT) ?: ""
        val hasRange = headers.keys.any { it.equals("Range", ignoreCase = true) }

        // 5. Deixa a tag <video> nativa e imagens carregarem direto pelo pipeline C++ do Chromium
        // sem passar pelo proxy de CORS quando não for uma requisição XHR/fetch (Sec-Fetch-Mode != cors).
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

        // 6. Proxy CORS via OkHttp com streaming direto de InputStream (sem carregar tudo na RAM)
        return executeCorsProxyRequest(req)
    }

    private fun executeCorsProxyRequest(webReq: WebResourceRequest): WebResourceResponse? {
        return try {
            val urlStr = webReq.url.toString()
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

            val uaToUse = if (CUSTOM_IPTV_USER_AGENT.isNotBlank()) {
                CUSTOM_IPTV_USER_AGENT
            } else {
                incomingHeaders["User-Agent"]?.takeIf { it.isNotBlank() } ?: defaultUserAgent
            }
            if (uaToUse.isNotBlank()) {
                reqBuilder.header("User-Agent", uaToUse)
            }

            val response = okHttpClient.newCall(reqBuilder.build()).execute()
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
            // Se falhar na rede, devolve null para que o próprio WebView reporte o erro ao XHR
            null
        }
    }

    private fun corsHeaders(): Map<String, String> = mapOf(
        "Access-Control-Allow-Origin" to "*",
        "Access-Control-Allow-Headers" to "*",
        "Access-Control-Allow-Methods" to "GET, POST, OPTIONS, HEAD",
        "Access-Control-Expose-Headers" to "*",
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
        view?.let { injectViewportAndPlatformShim(it) }
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        view?.let {
            injectViewportAndPlatformShim(it)
            onAppReady()
        }
    }

    /**
     * Injetado por fora do app/ sem alterar nenhum arquivo em assets/app/:
     * 1. Ajusta a escala 1920x1080 exatamente para qualquer resolução/densidade (720p, 1080p, 4K, mobile).
     * 2. Conecta o evento 'app:confirm-exit' e os botões 'modal-cancel' / 'modal-exit' do modal já existente
     *    no index.html para fechar o app no Android quando o usuário confirmar a saída.
     * 3. Espelha o Backup JSON também em arquivo físico na pasta do app quando o usuário exporta.
     */
    private fun injectViewportAndPlatformShim(webView: WebView) {
        val js = """
        (function() {
          if (window.__luminaAndroidShimInstalled) {
            if (window.__luminaFitViewport) window.__luminaFitViewport();
            return;
          }
          window.__luminaAndroidShimInstalled = true;

          window.__luminaFitViewport = function() {
            try {
              var meta = document.querySelector('meta[name="viewport"]');
              if (meta) {
                meta.setAttribute('content', 'width=1920, height=1080, user-scalable=no');
              }
              var root = document.getElementById('app-root');
              if (!root) return;
              var vw = window.innerWidth || document.documentElement.clientWidth || 1920;
              var vh = window.innerHeight || document.documentElement.clientHeight || 1080;
              if (Math.abs(vw - 1920) <= 2 && Math.abs(vh - 1080) <= 2) {
                root.style.transform = '';
                root.style.transformOrigin = '';
                root.style.left = '0px';
                root.style.top = '0px';
                return;
              }
              var scale = Math.min(vw / 1920, vh / 1080);
              var offsetX = Math.max(0, Math.round((vw - 1920 * scale) / 2));
              var offsetY = Math.max(0, Math.round((vh - 1080 * scale) / 2));
              document.documentElement.style.width = vw + 'px';
              document.documentElement.style.height = vh + 'px';
              document.body.style.width = vw + 'px';
              document.body.style.height = vh + 'px';
              root.style.transformOrigin = '0 0';
              root.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
            } catch (e) {}
          };

          window.addEventListener('resize', window.__luminaFitViewport);
          window.__luminaFitViewport();
          setTimeout(window.__luminaFitViewport, 150);
          setTimeout(window.__luminaFitViewport, 600);

          function wireExitModalAndBackup() {
            if (!window.LuminaEventBus || !window.LuminaFocus) {
              setTimeout(wireExitModalAndBackup, 100);
              return;
            }
            if (window.__luminaExitModalWired) return;
            window.__luminaExitModalWired = true;

            function closeExitModal() {
              var modal = document.getElementById('modal-backdrop');
              if (modal) modal.classList.add('hidden');
              window.LuminaFocus.setTrap(null);
              var route = (window.LuminaRouter && window.LuminaRouter.getCurrent) ? window.LuminaRouter.getCurrent() : 'home';
              window.LuminaFocus.restoreOrDefault(route);
            }

            window.LuminaEventBus.on('app:confirm-exit', function() {
              var modal = document.getElementById('modal-backdrop');
              if (!modal) return;
              modal.classList.remove('hidden');
              window.LuminaFocus.setTrap(modal);
              var cancelBtn = document.getElementById('btn-modal-cancel');
              if (cancelBtn) window.LuminaFocus.setFocus(cancelBtn, 'modal');
            });

            window.LuminaEventBus.on('modal:close', function() {
              closeExitModal();
            });

            window.LuminaEventBus.on('focus:select', function(el) {
              if (!el) return;
              var action = el.getAttribute('data-action');
              if (action === 'modal-cancel') {
                closeExitModal();
              } else if (action === 'modal-exit') {
                closeExitModal();
                if (window.LuminaAndroidBridge && window.LuminaAndroidBridge.exitApp) {
                  window.LuminaAndroidBridge.exitApp();
                }
              } else if (action === 'backup-export') {
                try {
                  if (window.LuminaStore && window.LuminaAndroidBridge && window.LuminaAndroidBridge.saveBackupToDisk) {
                    var bkp = window.LuminaStore.exportFullBackupJson();
                    window.LuminaAndroidBridge.saveBackupToDisk('lumina-backup.json', bkp);
                  }
                } catch (e) {}
              }
            });
          }

          wireExitModalAndBackup();
        })();
        """.trimIndent()

        webView.evaluateJavascript(js, null)
    }
}
