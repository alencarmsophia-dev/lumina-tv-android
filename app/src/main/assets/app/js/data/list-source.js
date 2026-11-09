(function (global) {
  'use strict';

  var MIN_UNKNOWN_FREE_BYTES = 300 * 1024 * 1024; // 300 MB
  var EXTRA_SAFETY_FREE_BYTES = 50 * 1024 * 1024; // +50 MB
  var MAX_ALLOWED_LIST_BYTES = 600 * 1024 * 1024;  // 600 MB
  var MAX_XHR_FALLBACK_BYTES = 150 * 1024 * 1024; // 150 MB no fallback XHR único (Parte 3.1)
  var BACKOFF_DELAYS_SEC = [2, 4, 8, 15, 30, 60];
  var DEFAULT_STALL_TIMEOUT_MS = 30000;
  var ALT_USER_AGENTS = [
    'VLC/3.0.20 LibVLC/3.0.20',
    'Lumina TV/2.2.0 (Android)',
    'okhttp/4.12.0',
    'Mozilla/5.0 (Linux; Android 11; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36'
  ];

  var hostUaMemory = {};
  var androidListeners = {};
  var simulatedFreeSpaceBytes = null;
  var memoryFilesByListId = {}; // Armazenamento de arquivo virtual para testes/WebStreamSource

  if (typeof window !== 'undefined') {
    window.__luminaListDownload = {
      emit: function (jsonStr) {
        var data = jsonStr;
        if (typeof jsonStr === 'string') {
          try { data = JSON.parse(jsonStr); } catch (e) { return; }
        }
        if (!data || !data.listId) return;
        var listener = androidListeners[data.listId];
        if (listener) listener(data);
      }
    };
  }

  function extractHost(url) {
    var m = String(url || '').match(/^https?:\/\/([^\/:?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  function computeBytesFnvChecksum(uint8Arr) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < uint8Arr.length; i++) {
      h ^= (uint8Arr[i] & 0xFF);
      h = Math.imul ? (Math.imul(h, 16777619) >>> 0) : ((h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0);
    }
    return (h >>> 0).toString(16) + '_' + uint8Arr.length;
  }

  // Função pura de verificação de espaço livre (Parte 3.2 e 13.6)
  function checkDiskSpaceRequirement(freeBytes, contentLengthBytes) {
    var free = typeof freeBytes === 'number' ? freeBytes : MIN_UNKNOWN_FREE_BYTES;
    var knownLen = typeof contentLengthBytes === 'number' && contentLengthBytes > 0 ? contentLengthBytes : -1;

    if (knownLen > MAX_ALLOWED_LIST_BYTES) {
      return {
        ok: false,
        code: 'LIST_TOO_LARGE',
        humanMessage: 'Esta lista tem ' + Math.round(knownLen / 1048576) + ' MB e ultrapassa o limite máximo seguro de 600 MB.'
      };
    }

    var required = knownLen > 0 ? (knownLen + EXTRA_SAFETY_FREE_BYTES) : MIN_UNKNOWN_FREE_BYTES;
    if (free < required) {
      var reqMb = Math.ceil(required / 1048576);
      return {
        ok: false,
        code: 'NO_SPACE',
        requiredBytes: required,
        humanMessage: 'Sem espaço para a lista. Libere pelo menos ' + reqMb + ' MB na TV e tente de novo.'
      };
    }

    return { ok: true, requiredBytes: required };
  }

  function getAvailableFreeSpace() {
    if (typeof simulatedFreeSpaceBytes === 'number') return simulatedFreeSpaceBytes;
    if (typeof window !== 'undefined' && window.LuminaAndroidBridge && typeof window.LuminaAndroidBridge.getFreeSpaceBytes === 'function') {
      try { return Number(window.LuminaAndroidBridge.getFreeSpaceBytes()); } catch (e) {}
    }
    return 1024 * 1024 * 1024; // 1 GB padrão quando navegador não informa
  }

  function createAndroidFileSource(options) {
    var opts = options || {};
    var listId = String(opts.listId || 'default_list');
    var url = String(opts.url || '');
    var ext = String(opts.ext || 'm3u');
    var userAgent = String(opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20');
    var bridge = (typeof window !== 'undefined' && window.LuminaAndroidBridge) ? window.LuminaAndroidBridge : null;

    var progressCb = opts.onProgress || null;
    var doneCb = opts.onDone || null;
    var errorCb = opts.onError || null;

    androidListeners[listId] = function (ev) {
      if (ev.event === 'progress' && progressCb) {
        progressCb({
          bytesDone: Number(ev.bytesDone || 0),
          bytesTotal: typeof ev.bytesTotal === 'number' ? ev.bytesTotal : null,
          speedBps: Number(ev.speedBps || 0),
          etaSec: typeof ev.etaSec === 'number' && ev.etaSec >= 0 ? ev.etaSec : null,
          attempt: Number(ev.attempt || 1),
          retrying: !!ev.retrying,
          message: ev.message || ''
        });
      } else if (ev.event === 'done' && doneCb) {
        delete androidListeners[listId];
        doneCb({
          sizeBytes: Number(ev.sizeBytes || 0),
          checksum: String(ev.checksum || ''),
          path: ev.path || ('https://appassets.androidplatform.net/__lists__/' + listId + '.' + ext)
        });
      } else if (ev.event === 'error' && errorCb) {
        delete androidListeners[listId];
        errorCb({
          code: String(ev.code || 'DOWNLOAD_ERROR'),
          humanMessage: String(ev.humanMessage || 'Falha ao baixar a lista.')
        });
      }
    };

    return {
      kind: 'android',
      start: function () {
        if (!bridge || typeof bridge.listDownloadStart !== 'function') {
          if (errorCb) errorCb({ code: 'NO_BRIDGE', humanMessage: 'Ponte de download Android indisponível.' });
          return;
        }
        bridge.listDownloadStart(JSON.stringify({
          listId: listId,
          url: url,
          ext: ext,
          userAgent: userAgent
        }));
      },
      pause: function () {
        if (bridge && bridge.listDownloadPause) bridge.listDownloadPause(listId);
      },
      resume: function () {
        if (bridge && bridge.listDownloadResume) bridge.listDownloadResume(listId);
      },
      cancel: function () {
        delete androidListeners[listId];
        if (bridge && bridge.listDownloadCancel) bridge.listDownloadCancel(listId);
      },
      readSlice: function (offset, length, cb) {
        var localUrl = 'https://appassets.androidplatform.net/__lists__/' + listId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.' + ext;
        if (typeof XMLHttpRequest !== 'undefined') {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', localUrl, true);
          xhr.responseType = 'arraybuffer';
          xhr.setRequestHeader('Range', 'bytes=' + offset + '-' + (offset + length - 1));
          xhr.onload = function () {
            if (xhr.status === 206 || xhr.status === 200) {
              return cb(null, new Uint8Array(xhr.response));
            }
            fallbackBridgeReadSlice();
          };
          xhr.onerror = fallbackBridgeReadSlice;
          xhr.send();
          return;
        }
        fallbackBridgeReadSlice();

        function fallbackBridgeReadSlice() {
          if (bridge && typeof bridge.listReadSlice === 'function') {
            try {
              var b64 = bridge.listReadSlice(listId, offset, length);
              if (!b64) return cb(null, new Uint8Array(0));
              var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
              var out = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
              return cb(null, out);
            } catch (e) {
              return cb(e, null);
            }
          }
          cb(new Error('Leitura de fatia indisponível'), null);
        }
      }
    };
  }

  // Implementação Web / Node.js testável para servidores HTTP com Range, gzip, redirecionamento, stall 30s, 403 UA e 6 tentativas
  function createWebStreamSource(options) {
    var opts = options || {};
    var listId = String(opts.listId || 'default_list');
    var initialUrl = String(opts.url || '');
    var userAgent = String(opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20');
    var stallTimeoutMs = typeof opts.stallTimeoutMs === 'number' ? opts.stallTimeoutMs : DEFAULT_STALL_TIMEOUT_MS;
    var backoffScale = typeof opts.backoffScaleMs === 'number' ? opts.backoffScaleMs : 1000; // Permite acelerar nos testes automatizados

    var progressCb = opts.onProgress || null;
    var doneCb = opts.onDone || null;
    var errorCb = opts.onError || null;

    var paused = false;
    var cancelled = false;
    var activeAbortFn = null;
    var retryPending = false;
    var partChunks = [];
    var bytesDone = 0;
    var bytesTotal = null;
    var etagOrLastMod = '';
    var attempt = 0;
    var uaFallbackIdx = 0;
    var startTimeMs = 0;
    var restartedWithoutRangeWarning = false;

    var host = extractHost(initialUrl);
    if (host && hostUaMemory[host]) {
      userAgent = hostUaMemory[host];
    }

    function concatChunks(chunks, totalLen) {
      var out = new Uint8Array(totalLen);
      var pos = 0;
      for (var i = 0; i < chunks.length; i++) {
        out.set(chunks[i], pos);
        pos += chunks[i].length;
      }
      return out;
    }

    function cleanupPart() {
      partChunks = [];
      bytesDone = 0;
      delete memoryFilesByListId[listId + '.part'];
    }

    function runAttempt(currentUrl, redirectDepth) {
      retryPending = false;
      if (cancelled || paused) return;
      if ((redirectDepth || 0) > 5) {
        if (errorCb) errorCb({ code: 'TOO_MANY_REDIRECTS', humanMessage: 'O servidor redirecionou vezes demais.' });
        return;
      }

      var spaceCheck = checkDiskSpaceRequirement(getAvailableFreeSpace(), bytesTotal || -1);
      if (!spaceCheck.ok) {
        cleanupPart();
        if (errorCb) errorCb(spaceCheck);
        return;
      }

      // Em Node.js (testes de servidor HTTP falso ou ambiente Node), usa http/https nativo com suporte a gzip e Range
      if (typeof process !== 'undefined' && process.versions && process.versions.node && /^https?:\/\//i.test(currentUrl)) {
        runNodeHttpAttempt(currentUrl, redirectDepth || 0);
        return;
      }

      // No navegador / WebView sem ponte Android
      runXhrRangeAttempt(currentUrl);
    }

    function scheduleRetry(reasonMsg, customWaitMs) {
      if (cancelled || paused || retryPending) return;
      retryPending = true;
      if (attempt >= BACKOFF_DELAYS_SEC.length) {
        if (errorCb) {
          errorCb({
            code: 'DOWNLOAD_INTERRUPTED',
            attempt: attempt,
            bytesDone: bytesDone,
            humanMessage: 'Download interrompido após 6 tentativas. Vou retomar de onde parou quando você tocar em Retomar.'
          });
        }
        return;
      }
      var waitMs = typeof customWaitMs === 'number'
        ? customWaitMs
        : (BACKOFF_DELAYS_SEC[attempt] * backoffScale);
      attempt++;
      if (progressCb) {
        progressCb({
          bytesDone: bytesDone,
          bytesTotal: bytesTotal,
          speedBps: 0,
          etaSec: null,
          attempt: attempt,
          retrying: true,
          message: reasonMsg || ('Download interrompido. Vou retomar de onde parou (tentativa ' + attempt + '/6)…')
        });
      }
      setTimeout(function () {
        if (!cancelled && !paused) runAttempt(initialUrl, 0);
      }, waitMs);
    }

    function runNodeHttpAttempt(targetUrl, redirectDepth) {
      var httpMod = /^https:/i.test(targetUrl) ? require('https') : require('http');
      var zlibMod = require('zlib');
      var urlMod = require('url');
      var parsed = urlMod.parse(targetUrl);

      var headers = {
        'User-Agent': userAgent
      };
      if (bytesDone > 0) {
        headers['Range'] = 'bytes=' + bytesDone + '-';
        headers['Accept-Encoding'] = 'identity';
        if (etagOrLastMod) headers['If-Range'] = etagOrLastMod;
      } else {
        headers['Accept-Encoding'] = 'gzip';
      }

      var stallTimer = null;
      var req = httpMod.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.path,
        method: 'GET',
        headers: headers
      });

      function resetStallTimer() {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(function () {
          try { req.destroy(new Error('STALL_TIMEOUT')); } catch (e) {}
        }, stallTimeoutMs);
      }

      activeAbortFn = function () {
        if (stallTimer) clearTimeout(stallTimer);
        try { req.destroy(); } catch (e) {}
      };

      resetStallTimer();

      req.on('response', function (res) {
        resetStallTimer();
        var status = res.statusCode || 0;

        if (status === 301 || status === 302 || status === 307 || status === 308) {
          if (stallTimer) clearTimeout(stallTimer);
          var loc = res.headers['location'];
          if (!loc) {
            if (errorCb) errorCb({ code: 'REDIRECT_ERROR', humanMessage: 'Redirecionamento sem destino.' });
            return;
          }
          var resolvedLoc = urlMod.resolve(targetUrl, loc);
          res.resume();
          runAttempt(resolvedLoc, redirectDepth + 1);
          return;
        }

        if (status === 401 || status === 403) {
          if (stallTimer) clearTimeout(stallTimer);
          res.resume();
          if (status === 403 && uaFallbackIdx < ALT_USER_AGENTS.length) {
            userAgent = ALT_USER_AGENTS[uaFallbackIdx++];
            if (userAgent === opts.userAgent && uaFallbackIdx < ALT_USER_AGENTS.length) {
              userAgent = ALT_USER_AGENTS[uaFallbackIdx++];
            }
            runAttempt(targetUrl, redirectDepth);
            return;
          }
          if (errorCb) {
            errorCb({
              code: 'AUTH_' + status,
              httpStatus: status,
              humanMessage: 'Acesso recusado pelo servidor (código ' + status + ').'
            });
          }
          return;
        }

        if (status === 404) {
          if (stallTimer) clearTimeout(stallTimer);
          res.resume();
          if (errorCb) errorCb({ code: 'NOT_FOUND_404', httpStatus: 404, humanMessage: 'Lista não encontrada no servidor (erro 404).' });
          return;
        }

        if (status === 429 || status === 458) {
          if (stallTimer) clearTimeout(stallTimer);
          res.resume();
          var retryAfter = parseInt(res.headers['retry-after'] || '0', 10);
          var waitMs = retryAfter > 0 ? (retryAfter * backoffScale) : undefined;
          scheduleRetry('Servidor ocupou limite de requisições (429). Aguardando para retomar…', waitMs);
          return;
        }

        if (status >= 500) {
          if (stallTimer) clearTimeout(stallTimer);
          res.resume();
          scheduleRetry('Servidor instável (HTTP ' + status + '). Vou retomar de onde parou…');
          return;
        }

        if (status !== 200 && status !== 206) {
          if (stallTimer) clearTimeout(stallTimer);
          res.resume();
          scheduleRetry('Resposta inesperada (HTTP ' + status + ').');
          return;
        }

        if (host) hostUaMemory[host] = userAgent;

        var etag = res.headers['etag'] || res.headers['last-modified'] || '';
        if (etag) etagOrLastMod = String(etag);

        // Se tentamos retomar (bytesDone > 0), mas o servidor respondeu 200 OK em vez de 206 Partial Content:
        if (bytesDone > 0 && status === 200) {
          partChunks = [];
          bytesDone = 0;
          restartedWithoutRangeWarning = true;
        }

        var cLen = parseInt(res.headers['content-length'] || '-1', 10);
        if (!isNaN(cLen) && cLen > 0) {
          bytesTotal = bytesDone + cLen;
          var spCheck = checkDiskSpaceRequirement(getAvailableFreeSpace(), bytesTotal);
          if (!spCheck.ok) {
            if (stallTimer) clearTimeout(stallTimer);
            res.destroy();
            cleanupPart();
            if (errorCb) errorCb(spCheck);
            return;
          }
        }

        var stream = res;
        var enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') {
          stream = res.pipe(zlibMod.createGunzip());
        }

        var completedCleanly = false;

        stream.on('data', function (chunk) {
          if (cancelled || paused) return;
          resetStallTimer();
          var u8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          var copy = new Uint8Array(u8.length);
          copy.set(u8);
          partChunks.push(copy);
          bytesDone += copy.length;
          memoryFilesByListId[listId + '.part'] = bytesDone;

          if (bytesDone > MAX_ALLOWED_LIST_BYTES) {
            if (stallTimer) clearTimeout(stallTimer);
            req.destroy();
            cleanupPart();
            if (errorCb) {
              errorCb({
                code: 'LIST_TOO_LARGE',
                humanMessage: 'A lista ultrapassou o limite máximo de 600 MB.'
              });
            }
            return;
          }

          if (progressCb) {
            var elapsedSec = Math.max(0.1, (Date.now() - startTimeMs) / 1000);
            var speedBps = Math.round(bytesDone / elapsedSec);
            var etaSec = (bytesTotal && bytesTotal > bytesDone && speedBps > 0)
              ? Math.round((bytesTotal - bytesDone) / speedBps)
              : null;
            progressCb({
              bytesDone: bytesDone,
              bytesTotal: bytesTotal,
              speedBps: speedBps,
              etaSec: etaSec,
              attempt: attempt + 1,
              restartedWithoutRange: restartedWithoutRangeWarning
            });
          }
        });

        stream.on('end', function () {
          if (stallTimer) clearTimeout(stallTimer);
          if (cancelled || paused) return;

          // Verifica se a conexão caiu antes de entregar todos os bytes anunciados em Content-Length (quando não é gzip)
          if (enc !== 'gzip' && bytesTotal !== null && bytesDone < bytesTotal) {
            scheduleRetry('Conexão encerrada no meio (' + bytesDone + '/' + bytesTotal + ' bytes). Retomando…');
            return;
          }

          completedCleanly = true;
          var finalBytes = concatChunks(partChunks, bytesDone);
          delete memoryFilesByListId[listId + '.part'];
          memoryFilesByListId[listId] = finalBytes;
          partChunks = [];

          if (finalBytes.length === 0) {
            if (errorCb) errorCb({ code: 'EMPTY_LIST', humanMessage: 'A lista baixada está vazia.' });
            return;
          }

          var checksum = computeBytesFnvChecksum(finalBytes);
          if (doneCb) {
            doneCb({
              sizeBytes: finalBytes.length,
              checksum: checksum,
              path: 'memory://' + listId,
              restartedWithoutRange: restartedWithoutRangeWarning
            });
          }
        });

        stream.on('error', function (err) {
          if (stallTimer) clearTimeout(stallTimer);
          if (cancelled || paused || completedCleanly) return;
          scheduleRetry('Erro no fluxo de download (' + (err.message || 'queda') + '). Retomando…');
        });

        res.on('close', function () {
          if (stallTimer) clearTimeout(stallTimer);
          if (cancelled || paused || completedCleanly) return;
          if (!res.complete) {
            scheduleRetry('Conexão interrompida antes do fim. Retomando de onde parou…');
          }
        });
      });

      req.on('error', function (err) {
        if (stallTimer) clearTimeout(stallTimer);
        if (cancelled || paused) return;
        var isStall = err && err.message === 'STALL_TIMEOUT';
        scheduleRetry(
          isStall
            ? 'Download travado por 30 s sem receber dados. Reconectando de onde parou…'
            : ('Falha de conexão (' + (err.message || 'rede') + '). Retomando…')
        );
      });

      req.end();
    }

    function runXhrRangeAttempt(targetUrl) {
      if (typeof XMLHttpRequest === 'undefined') {
        if (errorCb) errorCb({ code: 'NO_XHR', humanMessage: 'Rede indisponível neste aparelho.' });
        return;
      }
      var xhr = new XMLHttpRequest();
      activeAbortFn = function () {
        try { xhr.abort(); } catch (e) {}
      };
      xhr.open('GET', targetUrl, true);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = stallTimeoutMs;

      xhr.onprogress = function (ev) {
        if (ev && ev.loaded > MAX_XHR_FALLBACK_BYTES) {
          try { xhr.abort(); } catch (e) {}
          cleanupPart();
          if (errorCb) {
            errorCb({
              code: 'LIST_TOO_LARGE_DEVICE',
              humanMessage: 'Lista muito grande para este aparelho (acima de 150 MB no modo navegador).'
            });
          }
          return;
        }
        if (progressCb && ev) {
          progressCb({
            bytesDone: ev.loaded || 0,
            bytesTotal: ev.lengthComputable ? ev.total : null,
            speedBps: 0,
            etaSec: null,
            attempt: attempt + 1
          });
        }
      };

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          var u8 = new Uint8Array(xhr.response || new ArrayBuffer(0));
          memoryFilesByListId[listId] = u8;
          if (doneCb) {
            doneCb({
              sizeBytes: u8.length,
              checksum: computeBytesFnvChecksum(u8),
              path: 'memory://' + listId
            });
          }
        } else if (xhr.status === 401 || xhr.status === 403) {
          if (errorCb) errorCb({ code: 'AUTH_' + xhr.status, httpStatus: xhr.status, humanMessage: 'Acesso recusado pelo servidor.' });
        } else {
          scheduleRetry('Falha HTTP ' + xhr.status);
        }
      };

      xhr.onerror = function () {
        scheduleRetry('Falha de rede durante download.');
      };
      xhr.ontimeout = function () {
        scheduleRetry('Tempo limite esgotado.');
      };
      xhr.send();
    }

    return {
      kind: 'web',
      start: function () {
        cancelled = false;
        paused = false;
        startTimeMs = Date.now();
        runAttempt(initialUrl, 0);
      },
      pause: function () {
        paused = true;
        if (activeAbortFn) activeAbortFn();
      },
      resume: function () {
        if (!paused || cancelled) return;
        paused = false;
        runAttempt(initialUrl, 0);
      },
      cancel: function () {
        cancelled = true;
        if (activeAbortFn) activeAbortFn();
        cleanupPart();
      },
      readSlice: function (offset, length, cb) {
        var data = memoryFilesByListId[listId];
        if (!data) return cb(new Error('Arquivo em memória não encontrado para ' + listId), null);
        if (offset >= data.length) return cb(null, new Uint8Array(0));
        var end = Math.min(data.length, offset + length);
        cb(null, data.subarray(offset, end));
      }
    };
  }

  function createSource(options) {
    var opts = options || {};
    var hasNativeDownloader = !opts.forceWebSource &&
      typeof window !== 'undefined' &&
      window.LuminaAndroidBridge &&
      typeof window.LuminaAndroidBridge.listDownloadStart === 'function';

    if (hasNativeDownloader) {
      return createAndroidFileSource(opts);
    }
    return createWebStreamSource(opts);
  }

  var api = {
    MIN_UNKNOWN_FREE_BYTES: MIN_UNKNOWN_FREE_BYTES,
    EXTRA_SAFETY_FREE_BYTES: EXTRA_SAFETY_FREE_BYTES,
    MAX_ALLOWED_LIST_BYTES: MAX_ALLOWED_LIST_BYTES,
    BACKOFF_DELAYS_SEC: BACKOFF_DELAYS_SEC,
    checkDiskSpaceRequirement: checkDiskSpaceRequirement,
    computeBytesFnvChecksum: computeBytesFnvChecksum,
    createSource: createSource,
    createAndroidFileSource: createAndroidFileSource,
    createWebStreamSource: createWebStreamSource,
    setSimulatedFreeSpaceForTests: function (bytes) { simulatedFreeSpaceBytes = bytes; },
    getMemoryFileForTests: function (key) { return memoryFilesByListId[key] || null; },
    setMemoryFileForTests: function (key, u8) { memoryFilesByListId[key] = u8; },
    clearMemoryFilesForTests: function () { memoryFilesByListId = {}; hostUaMemory = {}; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaListSource = api;
})(typeof window !== 'undefined' ? window : global);
