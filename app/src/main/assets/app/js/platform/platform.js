(function (global) {
  'use strict';

  var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  var isWebOS = /Web0S|webOS|LG Browser|NetCast/i.test(ua) || !!(typeof window !== 'undefined' && (window.webOS || window.PalmSystem));
  var isFireTV = /\bAFT[A-Z0-9]+\b|Amazon|Silk/i.test(ua);
  var isAndroid = /Android/i.test(ua) || isFireTV || !!(typeof window !== 'undefined' && window.LuminaAndroidBridge);
  var FALLBACK_APP_VERSION = '2.2.1';
  var probeSeq = 0;
  var pendingProbes = {};

  function getBridge() {
    if (typeof window !== 'undefined' && window.LuminaAndroidBridge) {
      return window.LuminaAndroidBridge;
    }
    return null;
  }

  // Causa A corrigida (Seção A9): NUNCA retorna true só porque é Android ou webOS.
  // Só retorna true se <video>.canPlayType realmente suportar HLS nativamente.
  function detectNativeHls() {
    if (typeof document === 'undefined' || !document.createElement) return false;
    var v = document.createElement('video');
    if (!v || typeof v.canPlayType !== 'function') return false;
    var can = v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('application/x-mpegURL') || '';
    return can === 'probably' || can === 'maybe';
  }

  function hasNativeExoPlayer() {
    var b = getBridge();
    if (b && typeof b.nativeIsAvailable === 'function') {
      try {
        return !!b.nativeIsAvailable();
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function detectMse() {
    return typeof window !== 'undefined' && !!(window.MediaSource || window.WebKitMediaSource);
  }

  function getAppVersion() {
    var b = getBridge();
    if (b && typeof b.getAppVersion === 'function') {
      try { return String(b.getAppVersion() || FALLBACK_APP_VERSION); } catch (e) {}
    }
    return FALLBACK_APP_VERSION;
  }

  function getPlatformLabel() {
    var chromeMatch = ua.match(/Chrome\/(\d+)/);
    var chromeVer = chromeMatch ? ('Chromium ' + chromeMatch[1]) : 'WebView';
    if (isFireTV) return 'Amazon Fire TV (' + chromeVer + ')';
    if (isAndroid) return 'Android TV (' + chromeVer + ')';
    if (isWebOS) return 'LG webOS Smart TV';
    return 'Navegador Web (' + chromeVer + ')';
  }

  function getDeviceInfo() {
    var b = getBridge();
    if (b && typeof b.getDeviceInfo === 'function') {
      try {
        var raw = b.getDeviceInfo();
        if (raw) {
          var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (e) {}
    }
    var chromeMatch = ua.match(/Chrome\/(\d+)/);
    return {
      model: isFireTV ? 'Fire TV' : (isWebOS ? 'LG webOS' : 'Smart TV'),
      manufacturer: isFireTV ? 'Amazon' : (isWebOS ? 'LG' : 'Web'),
      sdkInt: isAndroid ? 30 : 0,
      webviewVersion: chromeMatch ? ('Chromium ' + chromeMatch[1]) : 'N/A',
      isFireTv: isFireTV,
      supportedCodecs: ['H.264', 'AAC']
    };
  }

  function registerStreamHeaders(url, userAgent, referer) {
    var b = getBridge();
    if (b && typeof b.registerStreamHeaders === 'function' && url) {
      try {
        b.registerStreamHeaders(String(url), String(userAgent || ''), String(referer || ''));
        return true;
      } catch (e) {}
    }
    return false;
  }

  function setDefaultUserAgent(uaStr) {
    var b = getBridge();
    if (b && typeof b.setDefaultUserAgent === 'function' && uaStr) {
      try {
        b.setDefaultUserAgent(String(uaStr));
        return true;
      } catch (e) {}
    }
    return false;
  }

  function trustInsecureHost(host) {
    var b = getBridge();
    if (b && typeof b.trustInsecureHost === 'function' && host) {
      try {
        b.trustInsecureHost(String(host));
        return true;
      } catch (e) {}
    }
    return false;
  }

  function getClipboardText() {
    var b = getBridge();
    if (b && typeof b.getClipboardText === 'function') {
      try {
        return String(b.getClipboardText() || '');
      } catch (e) {}
    }
    return '';
  }

  if (typeof window !== 'undefined') {
    window.__luminaOnProbeResult = function (callbackId, jsonStr) {
      var cb = pendingProbes[callbackId];
      if (!cb) return;
      delete pendingProbes[callbackId];
      var res = null;
      try {
        res = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      } catch (e) {
        res = { ok: false, httpStatus: 0, error: 'Resposta inválida de probeStream' };
      }
      cb(null, res);
    };
  }

  function probeStream(url, userAgent, timeoutMs, cb) {
    var b = getBridge();
    var tOut = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 8000;
    var uaToUse = String(userAgent || 'VLC/3.0.20 LibVLC/3.0.20');

    if (b && typeof b.probeStream === 'function') {
      var cid = 'probe_' + Date.now() + '_' + (++probeSeq);
      pendingProbes[cid] = cb;
      setTimeout(function () {
        if (pendingProbes[cid]) {
          var expiredCb = pendingProbes[cid];
          delete pendingProbes[cid];
          expiredCb(null, { ok: false, httpStatus: 0, elapsedMs: tOut, error: 'Tempo esgotado no teste de stream' });
        }
      }, tOut + 2000);
      try {
        b.probeStream(String(url), uaToUse, tOut, cid);
        return;
      } catch (e) {
        delete pendingProbes[cid];
      }
    }

    // Fallback Web/XHR para ambientes sem ponte Android
    if (typeof XMLHttpRequest === 'undefined') {
      if (cb) cb(null, { ok: false, httpStatus: 0, elapsedMs: 0, error: 'XHR indisponível' });
      return;
    }
    var startMs = Date.now();
    var done = false;
    var xhr = new XMLHttpRequest();
    function finish(resObj) {
      if (done) return;
      done = true;
      try { xhr.abort(); } catch (e) {}
      if (cb) cb(null, resObj);
    }
    try {
      xhr.open('GET', url, true);
      xhr.timeout = tOut;
      xhr.setRequestHeader('Range', 'bytes=0-4095');
      xhr.onreadystatechange = function () {
        if (xhr.readyState >= 3 && xhr.status >= 200 && xhr.status < 400) {
          var elapsed = Date.now() - startMs;
          var cType = xhr.getResponseHeader('Content-Type') || '';
          finish({
            ok: true,
            httpStatus: xhr.status,
            elapsedMs: elapsed,
            bytesRead: (xhr.responseText || '').length,
            contentType: cType,
            detectedFormat: /\.m3u8($|\?)/i.test(url) ? 'HLS (.m3u8)' : (/\.ts($|\?)/i.test(url) ? 'MPEG-TS (.ts)' : 'Stream')
          });
        }
      };
      xhr.onload = function () {
        var elapsed = Date.now() - startMs;
        finish({
          ok: xhr.status >= 200 && xhr.status < 400,
          httpStatus: xhr.status,
          elapsedMs: elapsed,
          bytesRead: (xhr.responseText || '').length,
          contentType: xhr.getResponseHeader('Content-Type') || '',
          detectedFormat: /\.m3u8($|\?)/i.test(url) ? 'HLS (.m3u8)' : 'Stream'
        });
      };
      xhr.onerror = function () {
        finish({ ok: false, httpStatus: xhr.status || 0, elapsedMs: Date.now() - startMs, error: 'Falha de rede' });
      };
      xhr.ontimeout = function () {
        finish({ ok: false, httpStatus: 0, elapsedMs: Date.now() - startMs, error: 'Tempo esgotado' });
      };
      xhr.send();
    } catch (ex) {
      finish({ ok: false, httpStatus: 0, elapsedMs: Date.now() - startMs, error: ex.message || 'Erro' });
    }
  }

  function saveBackupToDisk(filename, jsonContent) {
    var b = getBridge();
    if (b && typeof b.saveBackupToDisk === 'function') {
      try { return !!b.saveBackupToDisk(filename, jsonContent); } catch (e) {}
    }
    if (typeof document !== 'undefined') {
      try {
        var blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename || 'lumina-backup.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        return true;
      } catch (e) {}
    }
    return false;
  }

  function readBackupFromDisk(filename) {
    var b = getBridge();
    if (b && typeof b.readBackupFromDisk === 'function') {
      try { return String(b.readBackupFromDisk(filename) || ''); } catch (e) {}
    }
    return '';
  }

  function checkForAppUpdate(cb) {
    var b = getBridge();
    if (!b || typeof b.checkForUpdate !== 'function') {
      return cb && cb(null, {
        supported: false,
        hasUpdate: false,
        currentVersion: getAppVersion(),
        message: 'Atualização automática via APK disponível apenas no app Android / Fire TV.'
      });
    }
    if (typeof window !== 'undefined') {
      window.__luminaOnUpdateCheckResult = function (jsonStr) {
        try {
          var res = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
          if (cb) cb(null, res);
        } catch (err) {
          if (cb) cb(err, null);
        }
      };
    }
    try {
      b.checkForUpdate();
    } catch (e) {
      if (cb) cb(e, null);
    }
  }

  function canInstallUnknownApps() {
    var b = getBridge();
    if (b && typeof b.canInstallUnknownApps === 'function') {
      try { return !!b.canInstallUnknownApps(); } catch (e) {}
    }
    return true;
  }

  function openUnknownAppsSettings() {
    var b = getBridge();
    if (b && typeof b.openUnknownAppsSettings === 'function') {
      try { b.openUnknownAppsSettings(); return true; } catch (e) {}
    }
    return false;
  }

  function downloadAndInstallUpdate(downloadUrl, assetSize, sha256, onProgress, onComplete) {
    var b = getBridge();
    if (!b || typeof b.downloadAndInstallUpdate !== 'function') {
      if (onComplete) onComplete(new Error('Instalação de APK não suportada nesta plataforma.'));
      return;
    }
    if (typeof window !== 'undefined') {
      window.__luminaOnUpdateProgress = function (pct, downloadedMb, totalMb) {
        if (onProgress) onProgress({ percent: Number(pct || 0), downloadedMb: downloadedMb, totalMb: totalMb });
      };
      window.__luminaOnUpdateResult = function (jsonStr) {
        try {
          var res = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
          if (res && res.ok) {
            if (onComplete) onComplete(null, res);
          } else {
            if (onComplete) onComplete(new Error((res && res.error) || 'Falha ao instalar atualização.'));
          }
        } catch (e) {
          if (onComplete) onComplete(e);
        }
      };
    }
    try {
      b.downloadAndInstallUpdate(String(downloadUrl || ''), Number(assetSize || 0), String(sha256 || ''));
    } catch (e) {
      if (onComplete) onComplete(e);
    }
  }

  var api = {
    isWebOS: isWebOS,
    isFireTV: isFireTV,
    isAndroid: isAndroid,
    hasBridge: function () { return !!getBridge(); },
    hasNativeExoPlayer: hasNativeExoPlayer,
    detectNativeHls: detectNativeHls,
    detectMse: detectMse,
    getAppVersion: getAppVersion,
    getPlatformLabel: getPlatformLabel,
    getDeviceInfo: getDeviceInfo,
    registerStreamHeaders: registerStreamHeaders,
    setDefaultUserAgent: setDefaultUserAgent,
    trustInsecureHost: trustInsecureHost,
    getClipboardText: getClipboardText,
    probeStream: probeStream,
    saveBackupToDisk: saveBackupToDisk,
    readBackupFromDisk: readBackupFromDisk,
    checkForAppUpdate: checkForAppUpdate,
    canInstallUnknownApps: canInstallUnknownApps,
    openUnknownAppsSettings: openUnknownAppsSettings,
    downloadAndInstallUpdate: downloadAndInstallUpdate,
    exitApp: function () {
      try {
        var b = getBridge();
        if (b && typeof b.exitApp === 'function') {
          b.exitApp();
          return;
        }
        if (typeof window !== 'undefined' && window.webOS && window.webOS.platformBack) {
          window.webOS.platformBack();
        } else if (typeof window !== 'undefined' && window.PalmSystem && window.PalmSystem.platformBack) {
          window.PalmSystem.platformBack();
        } else if (typeof window !== 'undefined') {
          window.close();
        }
      } catch (e) {}
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaPlatform = api;
})(typeof window !== 'undefined' ? window : global);
