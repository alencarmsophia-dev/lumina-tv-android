package com.luminatv.player

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.util.Base64
import android.util.Log
import android.view.WindowManager
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ListDownloader(
    private val activity: Activity,
    private val emitToJs: (JSONObject) -> Unit
) {

    companion object {
        private const val TAG = "LuminaListDL"
        const val MIN_UNKNOWN_FREE_BYTES = 300L * 1024L * 1024L // 300 MB
        const val EXTRA_SAFETY_FREE_BYTES = 50L * 1024L * 1024L // +50 MB
        const val MAX_ALLOWED_LIST_BYTES = 600L * 1024L * 1024L  // 600 MB
        private const val WRITE_BUFFER_BYTES = 256 * 1024        // 256 KB
        private const val PROGRESS_EMIT_INTERVAL_MS = 500L
        private val BACKOFF_SECONDS = longArrayOf(2L, 4L, 8L, 15L, 30L, 60L)
        private val ALT_USER_AGENTS = listOf(
            "VLC/3.0.20 LibVLC/3.0.20",
            "Lumina TV/2.2.0 (Android)",
            "okhttp/4.12.0",
            "Mozilla/5.0 (Linux; Android 11; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36"
        )
    }

    class DownloadTaskState(
        val listId: String,
        val url: String,
        val ext: String,
        var userAgent: String
    ) {
        val paused = AtomicBoolean(false)
        val cancelled = AtomicBoolean(false)
        @Volatile var currentCall: okhttp3.Call? = null
        @Volatile var etagOrLastMod: String = ""
        @Volatile var totalBytesExpected: Long = -1L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newCachedThreadPool()
    private val activeTasks = ConcurrentHashMap<String, DownloadTaskState>()
    private val hostWorkingUa = ConcurrentHashMap<String, String>()

    init {
        cleanupStalePartFilesAsync()
    }

    fun getListsDir(): File {
        val dir = File(activity.cacheDir, "lists")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    fun sanitizeId(listId: String): String {
        return listId.replace(Regex("[^a-zA-Z0-9._-]"), "_").ifBlank { "default_list" }
    }

    fun getFinalFile(listId: String, ext: String = "m3u"): File {
        val safe = sanitizeId(listId)
        val cleanExt = if (ext.startsWith(".")) ext.substring(1) else ext
        val f = File(getListsDir(), "$safe.$cleanExt")
        if (f.exists()) return f
        val alt = File(getListsDir(), if (cleanExt == "m3u") "$safe.json" else "$safe.m3u")
        return if (alt.exists()) alt else f
    }

    fun getPartFile(listId: String): File {
        return File(getListsDir(), "${sanitizeId(listId)}.part")
    }

    fun getFreeSpaceBytes(): Long {
        return try {
            val stat = StatFs(activity.cacheDir.absolutePath)
            stat.availableBytes
        } catch (e: Exception) {
            500L * 1024L * 1024L
        }
    }

    fun getFileSize(listId: String): Long {
        val f = getFinalFile(listId)
        return if (f.exists()) f.length() else 0L
    }

    fun deleteListFiles(listId: String): Boolean {
        cancel(listId)
        val safe = sanitizeId(listId)
        val dir = getListsDir()
        var deleted = false
        for (ext in listOf("part", "m3u", "json")) {
            val f = File(dir, "$safe.$ext")
            if (f.exists() && f.delete()) deleted = true
        }
        return deleted
    }

    fun readSliceBase64(listId: String, offset: Long, length: Int): String {
        val f = getFinalFile(listId)
        if (!f.exists() || offset < 0L || offset >= f.length()) return ""
        val maxLen = length.coerceIn(1, 1024 * 1024)
        return try {
            RandomAccessFile(f, "r").use { raf ->
                raf.seek(offset)
                val toRead = minOf(maxLen.toLong(), f.length() - offset).toInt()
                val buf = ByteArray(toRead)
                var total = 0
                while (total < toRead) {
                    val r = raf.read(buf, total, toRead - total)
                    if (r <= 0) break
                    total += r
                }
                val slice = if (total == toRead) buf else buf.copyOf(total)
                Base64.encodeToString(slice, Base64.NO_WRAP)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Erro em readSliceBase64: ${e.message}")
            ""
        }
    }

    private fun cleanupStalePartFilesAsync() {
        executor.execute {
            try {
                val now = System.currentTimeMillis()
                val cutoff = 24L * 3600L * 1000L
                val files = getListsDir().listFiles() ?: return@execute
                for (f in files) {
                    if (f.name.endsWith(".part") && (now - f.lastModified()) > cutoff) {
                        f.delete()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao limpar .part antigos: ${e.message}")
            }
        }
    }

    private fun setKeepScreenOn(keepOn: Boolean) {
        mainHandler.post {
            try {
                if (keepOn) {
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            } catch (e: Exception) {}
        }
    }

    fun start(configJson: String) {
        val cfg = try { JSONObject(configJson) } catch (e: Exception) { JSONObject() }
        val listId = cfg.optString("listId", "default_list")
        val url = cfg.optString("url", "").trim()
        val ext = cfg.optString("ext", "m3u").trim().ifEmpty { "m3u" }
        val initialUa = cfg.optString("userAgent", "VLC/3.0.20 LibVLC/3.0.20").trim().ifEmpty { "VLC/3.0.20 LibVLC/3.0.20" }

        if (url.isEmpty()) {
            emitError(listId, "INVALID_URL", "Endereço da lista vazio.")
            return
        }

        cancel(listId)
        val task = DownloadTaskState(listId, url, ext, initialUa)
        activeTasks[listId] = task
        executor.execute { runDownloadLoop(task) }
    }

    fun pause(listId: String) {
        activeTasks[listId]?.let {
            it.paused.set(true)
            it.currentCall?.cancel()
        }
    }

    fun resume(listId: String) {
        val task = activeTasks[listId] ?: return
        if (task.paused.compareAndSet(true, false)) {
            executor.execute { runDownloadLoop(task) }
        }
    }

    fun cancel(listId: String) {
        val task = activeTasks.remove(listId)
        if (task != null) {
            task.cancelled.set(true)
            task.currentCall?.cancel()
        }
        try {
            val part = getPartFile(listId)
            if (part.exists()) part.delete()
        } catch (e: Exception) {}
    }

    private fun runDownloadLoop(task: DownloadTaskState) {
        val listId = task.listId
        val partFile = getPartFile(listId)
        val finalFile = File(getListsDir(), "${sanitizeId(listId)}.${task.ext}")

        // 1. Verifica espaço livre inicial antes de começar (Parte 3.2)
        val initialFree = getFreeSpaceBytes()
        if (initialFree < MIN_UNKNOWN_FREE_BYTES) {
            emitError(
                listId,
                "NO_SPACE",
                "Sem espaço para a lista. Libere pelo menos 300 MB na TV e tente de novo."
            )
            return
        }

        setKeepScreenOn(true)
        val client = NativePlayerController.buildHttpClient(15L, 30L, true)
        val host = try { android.net.Uri.parse(task.url).host?.lowercase(Locale.ROOT) ?: "" } catch (e: Exception) { "" }
        if (host.isNotEmpty() && hostWorkingUa.containsKey(host)) {
            task.userAgent = hostWorkingUa[host] ?: task.userAgent
        }

        var attempt = 0
        var uaFallbackIdx = 0
        val startWallMs = System.currentTimeMillis()
        var lastEmitMs = 0L

        while (!task.cancelled.get() && !task.paused.get()) {
            val existingBytes = if (partFile.exists()) partFile.length() else 0L

            try {
                val reqBuilder = Request.Builder()
                    .url(task.url)
                    .header("User-Agent", task.userAgent)

                if (existingBytes > 0L) {
                    reqBuilder.header("Range", "bytes=$existingBytes-")
                    reqBuilder.header("Accept-Encoding", "identity")
                    if (task.etagOrLastMod.isNotEmpty()) {
                        reqBuilder.header("If-Range", task.etagOrLastMod)
                    }
                } else {
                    reqBuilder.header("Accept-Encoding", "gzip")
                }

                val call = client.newCall(reqBuilder.build())
                task.currentCall = call

                call.execute().use { resp ->
                    val code = resp.code

                    // Tratamento de 401 / 403 com tentativa de User-Agents alternativos (Parte 3.2)
                    if (code == 401 || code == 403) {
                        if (code == 403 && uaFallbackIdx < ALT_USER_AGENTS.size) {
                            task.userAgent = ALT_USER_AGENTS[uaFallbackIdx++]
                            continue
                        }
                        emitError(
                            listId,
                            "AUTH_$code",
                            "Acesso recusado pelo servidor (código $code). Confira usuário, senha ou se sua lista expirou."
                        )
                        return
                    }

                    if (code == 404) {
                        emitError(
                            listId,
                            "NOT_FOUND_404",
                            "A lista não foi encontrada neste endereço (erro 404)."
                        )
                        return
                    }

                    if (code == 429 || code == 458) {
                        val retryAfterHeader = resp.header("Retry-After")?.trim()?.toLongOrNull()
                        if (attempt < BACKOFF_SECONDS.size) {
                            val waitSec = retryAfterHeader ?: BACKOFF_SECONDS[attempt]
                            attempt++
                            Thread.sleep(waitSec.coerceIn(2L, 60L) * 1000L)
                            continue
                        }
                        emitError(
                            listId,
                            "RATE_LIMIT_$code",
                            "Limite de conexões ou tentativas atingido no servidor (código $code). Aguarde alguns instantes."
                        )
                        return
                    }

                    if (code in 500..599) {
                        throw Exception("Servidor instável (HTTP $code)")
                    }

                    if (!resp.isSuccessful && code != 206) {
                        throw Exception("Erro HTTP $code ao baixar lista")
                    }

                    if (host.isNotEmpty()) {
                        hostWorkingUa[host] = task.userAgent
                    }

                    val etag = resp.header("ETag") ?: resp.header("Last-Modified") ?: ""
                    if (etag.isNotEmpty()) task.etagOrLastMod = etag

                    val isResumed206 = (existingBytes > 0L && code == 206)
                    val startOffset = if (isResumed206) existingBytes else 0L

                    val contentLen = resp.body?.contentLength() ?: -1L
                    val totalExpected = if (contentLen > 0L) (startOffset + contentLen) else -1L
                    task.totalBytesExpected = totalExpected

                    if (totalExpected > MAX_ALLOWED_LIST_BYTES) {
                        partFile.delete()
                        emitError(
                            listId,
                            "LIST_TOO_LARGE",
                            "Esta lista tem ${totalExpected / (1024 * 1024)} MB e ultrapassa o limite seguro de 600 MB."
                        )
                        return
                    }

                    if (totalExpected > 0L) {
                        val neededBytes = (totalExpected - startOffset) + EXTRA_SAFETY_FREE_BYTES
                        if (getFreeSpaceBytes() < neededBytes) {
                            emitError(
                                listId,
                                "NO_SPACE",
                                "Sem espaço para a lista. Libere pelo menos ${(neededBytes / (1024 * 1024))} MB na TV e tente de novo."
                            )
                            return
                        }
                    }

                    val bodyStream = resp.body?.byteStream() ?: throw Exception("Corpo de resposta vazio")
                    FileOutputStream(partFile, isResumed206).use { out ->
                        val buf = ByteArray(WRITE_BUFFER_BYTES)
                        var bytesDone = startOffset
                        while (!task.cancelled.get() && !task.paused.get()) {
                            val r = bodyStream.read(buf)
                            if (r == -1) break
                            if (r > 0) {
                                out.write(buf, 0, r)
                                bytesDone += r
                                if (bytesDone > MAX_ALLOWED_LIST_BYTES) {
                                    out.close()
                                    partFile.delete()
                                    emitError(
                                        listId,
                                        "LIST_TOO_LARGE",
                                        "A lista ultrapassou o limite máximo de 600 MB durante o download."
                                    )
                                    return
                                }
                                val now = System.currentTimeMillis()
                                if (now - lastEmitMs >= PROGRESS_EMIT_INTERVAL_MS) {
                                    lastEmitMs = now
                                    val elapsedSec = ((now - startWallMs) / 1000.0).coerceAtLeast(0.2)
                                    val speedBps = (bytesDone / elapsedSec).toLong()
                                    val etaSec = if (totalExpected > bytesDone && speedBps > 0) {
                                        ((totalExpected - bytesDone) / speedBps).toInt()
                                    } else -1
                                    emitProgress(listId, bytesDone, totalExpected, speedBps, etaSec, attempt + 1)
                                }
                            }
                        }
                        out.flush()
                    }

                    if (task.cancelled.get() || task.paused.get()) return

                    val finalSize = partFile.length()
                    if (finalSize <= 0L) {
                        partFile.delete()
                        emitError(listId, "EMPTY_LIST", "A lista baixada está vazia (0 bytes).")
                        return
                    }

                    val checksum = computeFileFnvChecksum(partFile)
                    if (finalFile.exists()) finalFile.delete()
                    if (!partFile.renameTo(finalFile)) {
                        partFile.copyTo(finalFile, overwrite = true)
                        partFile.delete()
                    }

                    activeTasks.remove(listId)
                    emitToJs(
                        JSONObject().apply {
                            put("event", "done")
                            put("listId", listId)
                            put("sizeBytes", finalFile.length())
                            put("checksum", checksum)
                            put("path", "https://appassets.androidplatform.net/__lists__/${finalFile.name}")
                        }
                    )
                    return
                }
            } catch (e: Exception) {
                if (task.cancelled.get() || task.paused.get()) return
                if (attempt < BACKOFF_SECONDS.size) {
                    val waitSec = BACKOFF_SECONDS[attempt]
                    attempt++
                    emitProgress(
                        listId,
                        if (partFile.exists()) partFile.length() else 0L,
                        task.totalBytesExpected,
                        0L,
                        -1,
                        attempt,
                        retrying = true,
                        message = if (e is SocketTimeoutException) "Download interrompido (sem dados por 30 s). Retomando de onde parou (tentativa $attempt/6)…"
                        else "Download interrompido. Vou retomar de onde parou (tentativa $attempt/6)…"
                    )
                    try { Thread.sleep(waitSec * 1000L) } catch (_: InterruptedException) { return }
                } else {
                    activeTasks.remove(listId)
                    emitError(
                        listId,
                        "DOWNLOAD_INTERRUPTED",
                        "Download interrompido após 6 tentativas. Verifique sua conexão e toque em Retomar."
                    )
                    return
                }
            }
        }
    }

    private fun computeFileFnvChecksum(file: File): String {
        var h = 2166136261L
        val buf = ByteArray(64 * 1024)
        file.inputStream().use { input ->
            var r: Int
            while (input.read(buf).also { r = it } != -1) {
                for (i in 0 until r) {
                    h = h xor (buf[i].toInt() and 0xFF).toLong()
                    h = (h * 16777619L) and 0xFFFFFFFFL
                }
            }
        }
        return "${java.lang.Long.toHexString(h)}_${file.length()}"
    }

    private fun emitProgress(
        listId: String,
        bytesDone: Long,
        bytesTotal: Long,
        speedBps: Long,
        etaSec: Int,
        attempt: Int,
        retrying: Boolean = false,
        message: String = ""
    ) {
        emitToJs(
            JSONObject().apply {
                put("event", "progress")
                put("listId", listId)
                put("bytesDone", bytesDone)
                if (bytesTotal > 0L) put("bytesTotal", bytesTotal) else put("bytesTotal", JSONObject.NULL)
                put("speedBps", speedBps)
                put("etaSec", etaSec)
                put("attempt", attempt)
                put("retrying", retrying)
                if (message.isNotEmpty()) put("message", message)
            }
        )
    }

    private fun emitError(listId: String, code: String, humanMessage: String) {
        emitToJs(
            JSONObject().apply {
                put("event", "error")
                put("listId", listId)
                put("code", code)
                put("humanMessage", humanMessage)
            }
        )
    }
}
