(function (global) {
  'use strict';

  var MAX_EVENTS = 50;
  var STORAGE_META_KEY = 'diagLogEvents_v21';
  var eventsBuffer = [];

  function maskUrlCredentials(input) {
    if (input === null || input === undefined) return '';
    var s = String(input);
    if (!s) return '';

    // 1. Mascara query params: password=, pass=, token=
    s = s.replace(/([?&](?:password|pass|token)=)([^&\s#]+)/gi, '$1***');

    // 2. Mascara caminhos Xtream com prefixo: /live/user/pass/..., /movie/user/pass/..., /series/user/pass/...
    s = s.replace(/(\/(?:live|movie|series)\/[^\/\s]+\/)([^\/\s]+)(\/)/gi, '$1***$3');

    // 3. Mascara caminhos Xtream diretos sem prefixo: http://host:port/user/pass/12345(.ts|.m3u8)
    s = s.replace(/(https?:\/\/[^\/\s]+\/(?!live\/|movie\/|series\/|api\/|assets\/)[^\/\s?#]+\/)([^\/\s?#]+)(\/[^\/\s?#]+(?:\.[a-z0-9]+)?(?:$|\?))/gi, '$1***$3');

    // 4. Mascara basic auth em URL: http://user:pass@host
    s = s.replace(/(https?:\/\/[^\/:\s]+:)([^@\/\s]+)(@)/gi, '$1***$3');

    // 5. Mascara campos JSON eventualmente colados em mensagens
    s = s.replace(/("(?:password|pass|token|apiKey)"\s*:\s*")([^"]*)(")/gi, '$1***$3');

    return s;
  }

  function persistBuffer() {
    if (global.LuminaStorage && typeof global.LuminaStorage.saveMeta === 'function') {
      global.LuminaStorage.saveMeta(STORAGE_META_KEY, eventsBuffer.slice());
    }
  }

  function loadFromStorage(cb) {
    if (!global.LuminaStorage || typeof global.LuminaStorage.loadMeta !== 'function') {
      if (cb) cb(eventsBuffer);
      return;
    }
    global.LuminaStorage.loadMeta(STORAGE_META_KEY, [], function (saved) {
      if (Array.isArray(saved) && saved.length) {
        eventsBuffer = saved.slice(-MAX_EVENTS);
      }
      if (cb) cb(eventsBuffer);
    });
  }

  function record(type, data) {
    var d = data || {};
    var now = Date.now();
    var entry = {
      ts: now,
      isoTime: new Date(now).toISOString(),
      type: String(type || 'info'),
      engine: String(d.engine || '-'),
      urlMasked: maskUrlCredentials(d.url || d.urlMasked || ''),
      format: String(d.format || '-'),
      userAgent: String(d.userAgent || '-'),
      httpStatus: typeof d.httpStatus === 'number' ? d.httpStatus : 0,
      code: String(d.code || '-'),
      elapsedMs: typeof d.elapsedMs === 'number' ? Math.round(d.elapsedMs) : 0,
      message: maskUrlCredentials(d.message || '')
    };

    eventsBuffer.push(entry);
    if (eventsBuffer.length > MAX_EVENTS) {
      eventsBuffer = eventsBuffer.slice(eventsBuffer.length - MAX_EVENTS);
    }
    persistBuffer();

    if (global.LuminaEventBus && typeof global.LuminaEventBus.emit === 'function') {
      global.LuminaEventBus.emit('diag:logged', entry);
    }
    return entry;
  }

  function getEvents() {
    return eventsBuffer.slice();
  }

  function getRecentEvents(limit) {
    var max = (typeof limit === 'number' && limit > 0) ? limit : MAX_EVENTS;
    return eventsBuffer.slice(-max).reverse();
  }

  function clear() {
    eventsBuffer = [];
    persistBuffer();
  }

  function formatReportText(extraContext) {
    var ctx = extraContext || {};
    var dev = ctx.deviceInfo || (global.LuminaPlatform && global.LuminaPlatform.getDeviceInfo ? global.LuminaPlatform.getDeviceInfo() : {});
    var store = global.LuminaStore;
    var src = store ? store.get('source') : null;
    var acc = store ? store.get('accountInfo') : null;
    var diag = store ? (store.get('diagnostics') || {}) : {};

    var lines = [];
    lines.push('=== LUMINA TV v2.1.0 - RELATÓRIO DE DIAGNÓSTICO ===');
    lines.push('Data: ' + new Date().toISOString());
    lines.push('Aparelho: ' + (dev.manufacturer || 'Android') + ' ' + (dev.model || '') + ' (API ' + (dev.sdkInt || '-') + ')');
    lines.push('WebView: ' + (dev.webviewVersion || '-'));
    lines.push('Codecs suportados: ' + (Array.isArray(dev.supportedCodecs) ? dev.supportedCodecs.join(', ') : '-'));
    lines.push('Motor configurado: ' + (store ? (store.get('playerEngine') || 'auto') : 'auto'));
    lines.push('Motor ativo: ' + (diag.engine || '-'));
    lines.push('User-Agent ativo: ' + (diag.userAgent || 'VLC/3.0.20 LibVLC/3.0.20'));
    lines.push('Buffer: ' + (store ? (store.get('bufferProfile') || 'normal') : 'normal'));
    lines.push('Formato ao vivo preferido: ' + (store ? (store.get('preferOutputFormat') || 'auto') : 'auto'));

    if (src) {
      var hostMasked = src.type === 'xtream' && src.creds ? maskUrlCredentials(src.creds.server) : maskUrlCredentials(src.url || '');
      lines.push('Lista ativa: ' + (src.name || 'Minha Lista') + ' (' + src.type + ') -> ' + hostMasked);
    } else {
      lines.push('Lista ativa: Nenhuma');
    }

    if (acc) {
      lines.push('Conta Xtream: status=' + (acc.status || '-') + ', conexões=' + (acc.activeCons || 0) + '/' + (acc.maxConnections || 1) + ', formatos=' + (Array.isArray(acc.allowedOutputFormats) ? acc.allowedOutputFormats.join(',') : '-'));
    }

    lines.push('');
    lines.push('--- ÚLTIMOS EVENTOS (' + eventsBuffer.length + ') ---');
    var recent = getRecentEvents(50);
    for (var i = 0; i < recent.length; i++) {
      var ev = recent[i];
      var timePart = ev.isoTime ? ev.isoTime.slice(11, 19) : '';
      lines.push(
        '[' + timePart + '] ' + ev.type.toUpperCase() +
        ' | motor=' + ev.engine +
        ' | fmt=' + ev.format +
        ' | http=' + (ev.httpStatus || '-') +
        ' | cod=' + ev.code +
        ' | ' + ev.elapsedMs + 'ms' +
        (ev.urlMasked ? (' | url=' + ev.urlMasked) : '') +
        (ev.message ? (' | msg=' + ev.message) : '')
      );
    }
    return lines.join('\n');
  }

  var api = {
    MAX_EVENTS: MAX_EVENTS,
    maskUrlCredentials: maskUrlCredentials,
    record: record,
    getEvents: getEvents,
    getRecentEvents: getRecentEvents,
    clear: clear,
    loadFromStorage: loadFromStorage,
    formatReportText: formatReportText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LuminaDiagLog = api;
})(typeof window !== 'undefined' ? window : global);
