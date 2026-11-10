(function (global) {
  'use strict';

  var plat = global.LuminaPlatform;
  var isWebOS = !!(plat && plat.isWebOS) ||
    (typeof navigator !== 'undefined' && /Web0S|webOS|LG Browser|NetCast/i.test(navigator.userAgent || '')) ||
    !!(typeof window !== 'undefined' && (window.webOS || window.PalmSystem || window.PalmServiceBridge));

  var LUNA_SERVICE_URI = 'luna://com.luminatv.player.service';
  var lunaFallbackEnabled = true;
  var lunaSeq = 0;
  var memoryClipboard = '';
  var memoryBackupMap = {};
  var cursorHiddenByKeys = false;

  function canCallLunaService() {
    if (!lunaFallbackEnabled) return false;
    if (typeof window === 'undefined') return false;
    if (window.webOS && window.webOS.service && typeof window.webOS.service.request === 'function') {
      return true;
    }
    return typeof window.PalmServiceBridge === 'function';
  }

  function callLunaService(uri, method, params, callbacks) {
    var cb = callbacks || {};
    var fullUri = uri.replace(/\/+$/, '') + '/' + String(method || '').replace(/^\/+/, '');

    if (typeof window !== 'undefined' && window.webOS && window.webOS.service && typeof window.webOS.service.request === 'function') {
      try {
        var req = window.webOS.service.request(uri, {
          method: method,
          parameters: params || {},
          subscribe: !!(params && params.subscribe),
          onSuccess: function (res) { if (cb.onSuccess) cb.onSuccess(res); },
          onFailure: function (err) { if (cb.onFailure) cb.onFailure(err); }
        });
        return {
          cancel: function () {
            try { if (req && typeof req.cancel === 'function') req.cancel(); } catch (e) {}
          }
        };
      } catch (e) {
        if (cb.onFailure) cb.onFailure({ errorText: e.message || 'Erro ao chamar webOS.service.request' });
        return { cancel: function () {} };
      }
    }

    if (typeof window !== 'undefined' && typeof window.PalmServiceBridge === 'function') {
      var bridge = null;
      try {
        bridge = new window.PalmServiceBridge();
        bridge.onservicecallback = function (msgStr) {
          var parsed = null;
          try { parsed = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr; } catch (e) {}
          if (!parsed) return;
          if (parsed.returnValue === false || parsed.errorCode) {
            if (cb.onFailure) cb.onFailure(parsed);
          } else if (cb.onSuccess) {
            cb.onSuccess(parsed);
          }
        };
        bridge.call(fullUri, JSON.stringify(params || {}));
        return {
          cancel: function () {
            try { if (bridge && typeof bridge.cancel === 'function') bridge.cancel(); } catch (e) {}
          }
        };
      } catch (err) {
        if (cb.onFailure) cb.onFailure({ errorText: err.message || 'Erro em PalmServiceBridge' });
        return { cancel: function () {} };
      }
    }

    if (cb.onFailure) cb.onFailure({ errorText: 'Luna Service indisponível' });
    return { cancel: function () {} };
  }

  function setupCursorAndPointerManagement() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    function setCursorHidden(hide) {
      if (!document.body) return;
      if (hide && !cursorHiddenByKeys) {
        cursorHiddenByKeys = true;
        document.body.style.cursor = 'none';
      } else if (!hide && cursorHiddenByKeys) {
        cursorHiddenByKeys = false;
        document.body.style.cursor = '';
      }
    }

    if (typeof document.addEventListener === 'function') document.addEventListener('cursorStateChange', function (e) {
      var vis = !!(e && e.detail && e.detail.visibility);
      setCursorHidden(!vis);
    }, false);

    if (typeof window.addEventListener === 'function') window.addEventListener('mousemove', function () {
      if (cursorHiddenByKeys) setCursorHidden(false);
    }, true);

    if (typeof window.addEventListener === 'function') window.addEventListener('keydown', function (e) {
      var code = e.keyCode || e.which;
      if (code >= 37 && code <= 40) {
        setCursorHidden(true);
      }
    }, true);
  }

  function setupSystemImeGuard() {
    if (typeof document === 'undefined') return;
    if (typeof document.addEventListener === 'function') document.addEventListener('focusin', function (e) {
      var t = e && e.target;
      if (!t || !t.tagName) return;
      var tag = String(t.tagName).toUpperCase();
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && t.id !== 'osk-native-ime-input') {
        try { t.blur(); } catch (err) {}
      }
    }, true);
  }

  function setupWebOSLifecycleAndExit() {
    if (!plat) return;

    var origExitApp = plat.exitApp;
    plat.exitApp = function () {
      try {
        if (global.LuminaPlayer && typeof global.LuminaPlayer.stop === 'function') {
          global.LuminaPlayer.stop();
        }
      } catch (e) {}
      try {
        if (typeof window !== 'undefined' && window.webOS && typeof window.webOS.platformBack === 'function') {
          window.webOS.platformBack();
          return;
        }
        if (typeof window !== 'undefined' && window.PalmSystem && typeof window.PalmSystem.platformBack === 'function') {
          window.PalmSystem.platformBack();
          return;
        }
        if (typeof origExitApp === 'function') {
          origExitApp();
        }
      } catch (e2) {}
    };

    if (typeof document !== 'undefined') {
      if (typeof document.addEventListener === 'function') document.addEventListener('webOSRelaunch', function () {
        try {
          if (typeof window !== 'undefined' && window.PalmSystem && typeof window.PalmSystem.activate === 'function') {
            window.PalmSystem.activate();
          }
        } catch (e) {}
      }, false);
    }
  }

  function setupWebOSPlatformOverrides() {
    if (!plat) return;

    var origGetDeviceInfo = plat.getDeviceInfo;
    plat.getDeviceInfo = function () {
      var base = typeof origGetDeviceInfo === 'function' ? origGetDeviceInfo() : {};
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      var chromeMatch = ua.match(/Chrome\/(\d+)/);
      return {
        model: base.model || 'LG webOS TV',
        manufacturer: 'LG Electronics',
        sdkInt: 23,
        webviewVersion: chromeMatch ? ('Chromium ' + chromeMatch[1]) : (base.webviewVersion || 'Chromium 94'),
        isFireTv: false,
        isWebOS: true,
        supportedCodecs: ['H.264', 'HEVC', 'VP9', 'AV1', 'AAC', 'AC3', 'E-AC3', 'MP3']
      };
    };

    plat.checkForAppUpdate = function (cb) {
      if (cb) {
        cb(null, {
          supported: false,
          hasUpdate: false,
          currentVersion: plat.getAppVersion ? plat.getAppVersion() : '2.2.1',
          message: 'Na TV LG webOS, a atualização é feita instalando um novo pacote IPK pelo Modo Desenvolvedor.'
        });
      }
    };

    plat.downloadAndInstallUpdate = function (_url, _size, _sha, _onProg, onComplete) {
      if (onComplete) {
        onComplete(new Error('Na TV LG webOS, instale a nova versão enviando o arquivo .ipk pelo Modo Desenvolvedor (ares-install).'));
      }
    };

    plat.getClipboardText = function () {
      return memoryClipboard || '';
    };

    plat.saveBackupToDisk = function (filename, content) {
      var fname = String(filename || 'lumina-backup.json');
      var text = String(content == null ? '' : content);
      memoryBackupMap[fname] = text;
      memoryClipboard = text;

      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem('lumina_webos_file_' + fname, text);
        }
      } catch (e) {}

      try {
        if (global.LuminaStorage && typeof global.LuminaStorage.saveMeta === 'function') {
          global.LuminaStorage.saveMeta('webos_file_' + fname, text);
          if (fname === 'lumina-backup.json') {
            global.LuminaStorage.saveMeta('lastBackupMeta', text);
          }
        }
      } catch (e2) {}

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).catch(function () {});
        }
      } catch (e3) {}

      return true;
    };

    plat.readBackupFromDisk = function (filename) {
      var fname = String(filename || 'lumina-backup.json');
      if (memoryBackupMap[fname]) return memoryBackupMap[fname];
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          var saved = localStorage.getItem('lumina_webos_file_' + fname);
          if (saved) return saved;
        }
      } catch (e) {}
      return '';
    };
  }

  function setupWebOSXhrFallback() {
    if (typeof window === 'undefined' || typeof window.XMLHttpRequest !== 'function') return;
    var NativeXHR = window.XMLHttpRequest;
    if (NativeXHR.__luminaWebOSWrapped) return;

    function isExternalHttpUrl(urlStr) {
      return /^https?:\/\//i.test(String(urlStr || '').trim());
    }

    function WrappedXHR() {
      var realXhr = new NativeXHR();
      var self = this;
      var reqMethod = 'GET';
      var reqUrl = '';
      var reqAsync = true;
      var reqHeaders = {};
      var reqBody = null;
      var aborted = false;
      var lunaHandle = null;
      var usedLuna = false;
      var stateOverride = null;

      this._realXhr = realXhr;
      this.timeout = 0;
      this.withCredentials = false;
      this.responseType = '';
      this.onreadystatechange = null;
      this.onload = null;
      this.onerror = null;
      this.ontimeout = null;
      this.onprogress = null;

      Object.defineProperty(this, 'readyState', {
        get: function () { return stateOverride ? stateOverride.readyState : realXhr.readyState; }
      });
      Object.defineProperty(this, 'status', {
        get: function () { return stateOverride ? stateOverride.status : realXhr.status; }
      });
      Object.defineProperty(this, 'statusText', {
        get: function () { return stateOverride ? stateOverride.statusText : realXhr.statusText; }
      });
      Object.defineProperty(this, 'responseText', {
        get: function () { return stateOverride ? stateOverride.responseText : realXhr.responseText; }
      });
      Object.defineProperty(this, 'response', {
        get: function () { return stateOverride ? stateOverride.response : realXhr.response; }
      });
      Object.defineProperty(this, 'responseURL', {
        get: function () { return stateOverride ? stateOverride.responseURL : realXhr.responseURL; }
      });

      this.open = function (method, url, async, user, pass) {
        reqMethod = String(method || 'GET').toUpperCase();
        reqUrl = String(url || '');
        reqAsync = async !== false;
        reqHeaders = {};
        aborted = false;
        usedLuna = false;
        stateOverride = null;
        return realXhr.open(method, url, reqAsync, user, pass);
      };

      this.setRequestHeader = function (name, value) {
        if (name) reqHeaders[String(name)] = String(value == null ? '' : value);
        try { return realXhr.setRequestHeader(name, value); } catch (e) {}
      };

      this.getResponseHeader = function (name) {
        if (stateOverride && stateOverride.headers) {
          var key = String(name || '').toLowerCase();
          return stateOverride.headers[key] || null;
        }
        try { return realXhr.getResponseHeader(name); } catch (e) { return null; }
      };

      this.getAllResponseHeaders = function () {
        if (stateOverride && stateOverride.rawHeaders) return stateOverride.rawHeaders;
        try { return realXhr.getAllResponseHeaders(); } catch (e) { return ''; }
      };

      this.abort = function () {
        aborted = true;
        if (lunaHandle && typeof lunaHandle.cancel === 'function') {
          lunaHandle.cancel();
          lunaHandle = null;
        }
        try { realXhr.abort(); } catch (e) {}
      };

      this.addEventListener = function (type, listener, useCapture) {
        return realXhr.addEventListener(type, listener, useCapture);
      };

      this.removeEventListener = function (type, listener, useCapture) {
        return realXhr.removeEventListener(type, listener, useCapture);
      };

      function triggerLunaFallback() {
        var rType = String(self.responseType || '').toLowerCase();
        if (rType === 'arraybuffer' || rType === 'blob') {
          if (typeof self.onerror === 'function') self.onerror(new Event('error'));
          return;
        }
        if (!canCallLunaService()) {
          if (typeof self.onerror === 'function') self.onerror(new Event('error'));
          return;
        }

        usedLuna = true;
        var requestId = 'webos_xhr_' + Date.now() + '_' + (++lunaSeq);
        var chunks = [];

        lunaHandle = callLunaService(
          LUNA_SERVICE_URI,
          'fetchUrl',
          {
            subscribe: true,
            requestId: requestId,
            url: reqUrl,
            method: reqMethod,
            headers: reqHeaders,
            body: reqBody ? String(reqBody) : null,
            timeoutMs: self.timeout > 0 ? self.timeout : 60000,
            allowInsecureSsl: true
          },
          {
            onSuccess: function (res) {
              if (aborted || !res) return;
              if (res.stage === 'progress') {
                if (typeof self.onprogress === 'function') {
                  self.onprogress({
                    lengthComputable: (res.totalBytes || 0) > 0,
                    loaded: res.loadedBytes || 0,
                    total: res.totalBytes || 0
                  });
                }
                return;
              }
              if (res.stage === 'chunk') {
                chunks[res.chunkIndex || 0] = res.chunk || '';
                return;
              }
              if (res.stage === 'complete') {
                if (lunaHandle && typeof lunaHandle.cancel === 'function') {
                  lunaHandle.cancel();
                  lunaHandle = null;
                }
                var fullText = res.chunked ? chunks.join('') : String(res.data || '');
                chunks = [];
                var cType = String(res.contentType || 'text/plain');
                stateOverride = {
                  readyState: 4,
                  status: Number(res.httpStatus || 200),
                  statusText: 'OK',
                  responseText: fullText,
                  response: fullText,
                  responseURL: reqUrl,
                  headers: { 'content-type': cType },
                  rawHeaders: 'content-type: ' + cType + '\r\n'
                };
                if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
                if (typeof self.onload === 'function') self.onload();
              }
            },
            onFailure: function (err) {
              if (aborted) return;
              if (lunaHandle && typeof lunaHandle.cancel === 'function') {
                lunaHandle.cancel();
                lunaHandle = null;
              }
              var proxyErr = (err && err.proxyError) || '';
              if (proxyErr === 'SSL' || proxyErr === 'DNS') {
                var errBody = JSON.stringify({ message: (err && err.errorMessage) || 'Erro no serviço Luna' });
                stateOverride = {
                  readyState: 4,
                  status: 502,
                  statusText: 'Bad Gateway',
                  responseText: errBody,
                  response: errBody,
                  responseURL: reqUrl,
                  headers: {
                    'x-lumina-proxy-error': proxyErr,
                    'content-type': 'application/json'
                  },
                  rawHeaders: 'x-lumina-proxy-error: ' + proxyErr + '\r\ncontent-type: application/json\r\n'
                };
                if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
                if (typeof self.onload === 'function') self.onload();
                return;
              }
              stateOverride = {
                readyState: 4,
                status: 0,
                statusText: '',
                responseText: '',
                response: '',
                responseURL: reqUrl,
                headers: {},
                rawHeaders: ''
              };
              if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
              if (typeof self.onerror === 'function') self.onerror(err);
            }
          }
        );
      }

      this.send = function (body) {
        reqBody = body;
        realXhr.timeout = self.timeout || 0;
        realXhr.withCredentials = !!self.withCredentials;
        if (self.responseType) {
          try { realXhr.responseType = self.responseType; } catch (e) {}
        }

        realXhr.onprogress = function (ev) {
          if (!usedLuna && typeof self.onprogress === 'function') self.onprogress(ev);
        };
        realXhr.onreadystatechange = function (ev) {
          if (usedLuna || aborted) return;
          if (realXhr.readyState === 4 && realXhr.status === 0 && isExternalHttpUrl(reqUrl) && canCallLunaService()) {
            return;
          }
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange(ev);
        };
        realXhr.onload = function (ev) {
          if (!usedLuna && !aborted && typeof self.onload === 'function') self.onload(ev);
        };
        realXhr.ontimeout = function (ev) {
          if (!usedLuna && !aborted && typeof self.ontimeout === 'function') self.ontimeout(ev);
        };
        realXhr.onerror = function (ev) {
          if (aborted) return;
          if (!usedLuna && realXhr.status === 0 && isExternalHttpUrl(reqUrl) && canCallLunaService()) {
            triggerLunaFallback();
            return;
          }
          if (typeof self.onerror === 'function') self.onerror(ev);
        };

        try {
          return realXhr.send(body);
        } catch (sendEx) {
          if (isExternalHttpUrl(reqUrl) && canCallLunaService()) {
            triggerLunaFallback();
            return;
          }
          throw sendEx;
        }
      };
    }

    WrappedXHR.UNSENT = 0;
    WrappedXHR.OPENED = 1;
    WrappedXHR.HEADERS_RECEIVED = 2;
    WrappedXHR.LOADING = 3;
    WrappedXHR.DONE = 4;
    WrappedXHR.__luminaWebOSWrapped = true;

    window.XMLHttpRequest = WrappedXHR;
  }

  function installWebOSPlayerHooks() {
    if (!global.LuminaPlayer || global.LuminaPlayer.__webosHookInstalled) return;
    var player = global.LuminaPlayer;
    player.__webosHookInstalled = true;

    if (player.USER_AGENT_PRESETS) {
      player.USER_AGENT_PRESETS.lumina = 'Lumina TV/2.2.1 (webOS)';
    }
    if (Array.isArray(player.ALT_USER_AGENTS)) {
      player.ALT_USER_AGENTS[0] = 'Lumina TV/2.2.1 (webOS)';
    }

    var origBuildPlan = player.buildFallbackPlan;
    if (typeof origBuildPlan === 'function') {
      player.buildFallbackPlan = function (item, options) {
        var opts = options || {};
        var url = (item && item.url) ? String(item.url) : '';
        var kind = (item && item.kind) || 'live';
        var isLive = (kind === 'live');

        // Em VOD no webOS TV 23, o <video> nativo decodifica por hardware MP4, MKV (H.264/HEVC/VP9/AV1 + AC3/E-AC3/AAC) e HLS VOD.
        if (!isLive && url) {
          var natClass = global.LuminaNativeEngine || { name: 'NativeEngine', isNative: false };
          var hlsClass = global.LuminaHlsEngine || { name: 'HlsJsEngine', isNative: false };
          var tsClass = global.LuminaMpegtsEngine || { name: 'MpegtsEngine', isNative: false };
          var hlsJsOk = !!(global.LuminaHlsEngine && global.LuminaHlsEngine.isSupported());
          var mpegtsOk = !!(global.LuminaMpegtsEngine && global.LuminaMpegtsEngine.isSupported());
          var vodPlan = [];

          function pushVodStep(engName, stepUrl, tOut, cls) {
            if (!stepUrl || vodPlan.length >= 3) return;
            for (var i = 0; i < vodPlan.length; i++) {
              if (vodPlan[i].engine === engName && vodPlan[i].url === stepUrl) return;
            }
            vodPlan.push({
              engine: engName,
              url: stepUrl,
              timeoutMs: tOut,
              formatLabel: player.detectFormatLabel ? player.detectFormatLabel(stepUrl) : 'VOD',
              classRef: cls
            });
          }

          if (player.isHlsPath && player.isHlsPath(url)) {
            if (hlsJsOk) pushVodStep('HlsJsEngine', url, 18000, hlsClass);
            pushVodStep('NativeEngine', url, 15000, natClass);
          } else if (player.isTsPath && player.isTsPath(url)) {
            if (mpegtsOk) pushVodStep('MpegtsEngine', url, 18000, tsClass);
            pushVodStep('NativeEngine', url, 15000, natClass);
          } else {
            // MP4, MKV, MOV, AVI ou URL direta de filme/episódio -> <video> nativo por hardware primeiro
            pushVodStep('NativeEngine', url, 20000, natClass);
            var qIdx = url.indexOf('?');
            var pathPart = qIdx !== -1 ? url.slice(0, qIdx) : url;
            var queryPart = qIdx !== -1 ? url.slice(qIdx) : '';
            if (/\.mkv$/i.test(pathPart)) {
              var mp4Alt = pathPart.replace(/\.mkv$/i, '.mp4') + queryPart;
              pushVodStep('NativeEngine', mp4Alt, 15000, natClass);
            }
            if (item && item.hlsUrl && hlsJsOk) {
              pushVodStep('HlsJsEngine', item.hlsUrl, 15000, hlsClass);
            }
          }
          if (vodPlan.length) return vodPlan.slice(0, 3);
        }

        // Canais ao vivo: mantém o fluxo original (HlsJsEngine -> MpegtsEngine -> NativeEngine)
        var mergedOpts = {};
        var k = Object.keys(opts);
        for (var j = 0; j < k.length; j++) mergedOpts[k[j]] = opts[k[j]];
        if (typeof mergedOpts.nativeHlsAvailable !== 'boolean') {
          mergedOpts.nativeHlsAvailable = true;
        }
        return origBuildPlan.call(player, item, mergedOpts);
      };
    }

    if (global.LuminaNativeEngine && typeof global.LuminaNativeEngine.play === 'function' && !global.LuminaNativeEngine.__webosWrapped) {
      var origNativePlay = global.LuminaNativeEngine.play;
      global.LuminaNativeEngine.__webosWrapped = true;
      global.LuminaNativeEngine.play = function (videoEl, url, callbacks, options) {
        var v = videoEl || (typeof document !== 'undefined' ? document.getElementById('main-video') : null);
        if (v) {
          try {
            v.muted = false;
            if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
          } catch (e) {}
        }
        return origNativePlay.call(global.LuminaNativeEngine, v, url, callbacks, options);
      };
    }
  }

  function initWebOSAdapter() {
    if (!isWebOS) return;
    setupWebOSPlatformOverrides();
    setupWebOSLifecycleAndExit();
    setupCursorAndPointerManagement();
    setupSystemImeGuard();
    setupWebOSXhrFallback();
    installWebOSPlayerHooks();

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installWebOSPlayerHooks);
      } else {
        setTimeout(installWebOSPlayerHooks, 0);
      }
    }
  }

  initWebOSAdapter();

  var webosApi = {
    isWebOS: isWebOS,
    LUNA_SERVICE_URI: LUNA_SERVICE_URI,
    isLunaFallbackEnabled: function () { return lunaFallbackEnabled; },
    setLunaFallbackEnabled: function (val) { lunaFallbackEnabled = !!val; },
    canCallLunaService: canCallLunaService,
    callLunaService: callLunaService,
    installWebOSPlayerHooks: installWebOSPlayerHooks
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = webosApi;
  global.LuminaWebOS = webosApi;
})(typeof window !== 'undefined' ? window : global);
