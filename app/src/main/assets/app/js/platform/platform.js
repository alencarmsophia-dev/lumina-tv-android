(function (global) {
  'use strict';

  var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? String(navigator.userAgent) : '';
  var hasBridge = typeof global.LuminaAndroidBridge !== 'undefined' && global.LuminaAndroidBridge !== null;
  var isWebOS = /Web0S|webOS|PalmSystem/i.test(ua) || (typeof global.PalmSystem !== 'undefined');
  var isFireTv = /AFT[A-Z0-9]+|Amazon|Fire OS/i.test(ua);
  var isAndroid = hasBridge || /Android/i.test(ua) || isFireTv;

  var platformName = isAndroid ? 'android' : (isWebOS ? 'webos' : 'browser');
  var chromeMatch = ua.match(/Chrome\/(\d+)\./);
  var webviewMajor = chromeMatch ? parseInt(chromeMatch[1], 10) : 0;

  function detectNativeHls() {
    if (typeof document === 'undefined' || !document.createElement) return isAndroid || isWebOS;
    try {
      var v = document.createElement('video');
      if (!v || !v.canPlayType) return isAndroid || isWebOS;
      var res = v.canPlayType('application/vnd.apple.mpegurl') || v.canPlayType('audio/mpegurl');
      return res === 'probably' || res === 'maybe' || isAndroid || isWebOS;
    } catch (e) {
      return isAndroid || isWebOS;
    }
  }

  function detectMse() {
    return typeof global.MediaSource !== 'undefined' && typeof global.MediaSource.isTypeSupported === 'function';
  }

  function getBridge() {
    return (typeof global.LuminaAndroidBridge !== 'undefined' && global.LuminaAndroidBridge) ? global.LuminaAndroidBridge : null;
  }

  function getAppVersion() {
    var b = getBridge();
    if (b && typeof b.getAppVersion === 'function') {
      try { return String(b.getAppVersion() || '2.0.0'); } catch (e) {}
    }
    return '2.0.0';
  }

  function getPlatformLabel() {
    if (isFireTv) return 'Amazon Fire TV (Android WebView ' + (webviewMajor || '?') + ')';
    if (isAndroid) return 'Android TV / Android (WebView ' + (webviewMajor || '?') + ')';
    if (isWebOS) return 'LG webOS Smart TV';
    return 'Navegador Web';
  }

  function exitApp() {
    var b = getBridge();
    if (b && typeof b.exitApp === 'function') {
      try { b.exitApp(); return true; } catch (e) {}
    }
    if (typeof global.PalmSystem !== 'undefined' && global.PalmSystem.platformBack) {
      try { global.PalmSystem.platformBack(); return true; } catch (e2) {}
    }
    if (typeof global.close === 'function') {
      try { global.close(); return true; } catch (e3) {}
    }
    return false;
  }

  function saveBackupToDisk(filename, jsonStr) {
    var b = getBridge();
    if (b && typeof b.saveBackupToDisk === 'function') {
      try { return !!b.saveBackupToDisk(String(filename || 'lumina-backup.json'), String(jsonStr || '')); } catch (e) {}
    }
    return false;
  }

  function readBackupFromDisk(filename) {
    var b = getBridge();
    if (b && typeof b.readBackupFromDisk === 'function') {
      try { return String(b.readBackupFromDisk(String(filename || 'lumina-backup.json')) || ''); } catch (e) {}
    }
    return '';
  }

  function registerStreamHeaders(url, userAgent, referer) {
    var b = getBridge();
    if (b && typeof b.registerStreamHeaders === 'function' && url && (userAgent || referer)) {
      try {
        b.registerStreamHeaders(String(url), String(userAgent || ''), String(referer || ''));
        return true;
      } catch (e) {}
    }
    return false;
  }

  var pendingUpdateCheckCb = null;
  var pendingUpdateProgressCb = null;
  var pendingUpdateDoneCb = null;

  global.__luminaOnUpdateCheckResult = function (resultJson) {
    var cb = pendingUpdateCheckCb;
    pendingUpdateCheckCb = null;
    if (!cb) return;
    try {
      var parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
      cb(null, parsed);
    } catch (e) {
      cb(new Error('Resposta de atualização inválida.'));
    }
  };

  global.__luminaOnUpdateProgress = function (percent, downloadedMb, totalMb) {
    if (pendingUpdateProgressCb) {
      try { pendingUpdateProgressCb({ percent: percent, downloadedMb: downloadedMb, totalMb: totalMb }); } catch (e) {}
    }
  };

  global.__luminaOnUpdateResult = function (resultJson) {
    var cb = pendingUpdateDoneCb;
    pendingUpdateDoneCb = null;
    pendingUpdateProgressCb = null;
    if (!cb) return;
    try {
      var parsed = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
      if (parsed && parsed.ok) cb(null, parsed);
      else cb(new Error((parsed && parsed.error) || 'Não foi possível instalar a atualização.'));
    } catch (e) {
      cb(new Error('Erro ao processar instalação do APK.'));
    }
  };

  function checkForAppUpdate(cb) {
    var b = getBridge();
    if (!b || typeof b.checkForUpdate !== 'function') {
      if (cb) cb(null, { supported: false, hasUpdate: false, currentVersion: getAppVersion() });
      return;
    }
    pendingUpdateCheckCb = cb;
    try {
      b.checkForUpdate();
    } catch (e) {
      pendingUpdateCheckCb = null;
      if (cb) cb(new Error('Falha ao consultar atualizações no Android.'));
    }
  }

  function downloadAndInstallUpdate(downloadUrl, expectedSize, sha256, onProgress, onDone) {
    var b = getBridge();
    if (!b || typeof b.downloadAndInstallUpdate !== 'function') {
      if (onDone) onDone(new Error('Atualização de APK só está disponível no aplicativo Android / Fire TV.'));
      return;
    }
    pendingUpdateProgressCb = onProgress || null;
    pendingUpdateDoneCb = onDone || null;
    try {
      b.downloadAndInstallUpdate(
        String(downloadUrl || ''),
        Number(expectedSize || 0),
        String(sha256 || '')
      );
    } catch (e) {
      pendingUpdateProgressCb = null;
      pendingUpdateDoneCb = null;
      if (onDone) onDone(new Error('Falha ao iniciar download da atualização.'));
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

  var api = {
    name: platformName,
    isAndroid: isAndroid,
    isFireTv: isFireTv,
    isWebOS: isWebOS,
    webviewMajor: webviewMajor,
    canNativeHls: detectNativeHls(),
    canMsePlayer: detectMse(),
    hasColorKeys: !isFireTv,
    hasBridge: function () { return !!getBridge(); },
    maxMemoryHintMb: (isFireTv || isWebOS) ? 128 : 256,
    getAppVersion: getAppVersion,
    getPlatformLabel: getPlatformLabel,
    exitApp: exitApp,
    saveBackupToDisk: saveBackupToDisk,
    readBackupFromDisk: readBackupFromDisk,
    registerStreamHeaders: registerStreamHeaders,
    checkForAppUpdate: checkForAppUpdate,
    downloadAndInstallUpdate: downloadAndInstallUpdate,
    canInstallUnknownApps: canInstallUnknownApps,
    openUnknownAppsSettings: openUnknownAppsSettings
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaPlatform = api;
})(typeof window !== 'undefined' ? window : global);
