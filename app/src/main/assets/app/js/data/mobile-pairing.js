(function (global) {
  'use strict';

  var DEFAULT_PAIRING_BASE_URL = 'https://surubim-player-pairing.vercel.app';

  // ── Gerador de QR Code ISO/IEC 18004 (ES5) ──
  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var MAX_VERSION = 10;

  function bit(n, i) { return ((n >>> i) & 1) !== 0; }

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }

  function dataCodewords(ver) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    var res = [];
    for (var k = 0; k < degree; k++) res.push(0);
    res[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < res.length; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < res.length) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return res;
  }

  function rsRemainder(data, divisor) {
    var res = [];
    for (var k = 0; k < divisor.length; k++) res.push(0);
    for (var d = 0; d < data.length; d++) {
      var b = data[d];
      var factor = b ^ res.shift();
      res.push(0);
      for (var i = 0; i < divisor.length; i++) {
        res[i] ^= gfMul(divisor[i], factor);
      }
    }
    return res;
  }

  function toUtf8Bytes(text) {
    var out = [];
    var str = String(text || '');
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function buildCodewords(bytes, ver) {
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    push(4, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (var b = 0; b < bytes.length; b++) push(bytes[b], 8);

    var capBits = dataCodewords(ver) * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capBits; pad ^= (0xec ^ 0x11)) push(pad, 8);

    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }

    var nb = NUM_BLOCKS[ver];
    var eccLen = ECC_PER_BLOCK[ver];
    var rawCw = Math.floor(rawModules(ver) / 8);
    var shortBlocks = nb - (rawCw % nb);
    var shortLen = Math.floor(rawCw / nb);
    var div = rsDivisor(eccLen);
    var blocks = [];
    var k = 0;
    for (var bi = 0; bi < nb; bi++) {
      var len = shortLen - eccLen + (bi < shortBlocks ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, div);
      if (bi < shortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var col = 0; col < blocks[0].length; col++) {
      for (var blkIdx = 0; blkIdx < blocks.length; blkIdx++) {
        if (col !== shortLen - eccLen || blkIdx >= shortBlocks) {
          result.push(blocks[blkIdx][col]);
        }
      }
    }
    return result;
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (_x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
  ];

  function createGrid(size) {
    var g = [];
    for (var y = 0; y < size; y++) {
      var row = [];
      for (var x = 0; x < size; x++) row.push(false);
      g.push(row);
    }
    return g;
  }

  function drawQr(ver, codewords) {
    var size = ver * 4 + 17;
    var mod = createGrid(size);
    var fn = createGrid(size);
    function setFn(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }

    for (var i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          var x = cx + dx; var y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
        }
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2;
      var step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      var pos = [6];
      for (var p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (var ai = 0; ai < na; ai++) {
        for (var aj = 0; aj < na; aj++) {
          if ((ai === 0 && aj === 0) || (ai === 0 && aj === na - 1) || (ai === na - 1 && aj === 0)) continue;
          for (var ady = -2; ady <= 2; ady++) {
            for (var adx = -2; adx <= 2; adx++) {
              setFn(pos[ai] + adx, pos[aj] + ady, Math.max(Math.abs(adx), Math.abs(ady)) !== 1);
            }
          }
        }
      }
    }

    function formatBits(mask) {
      var d = mask;
      var rem = d;
      for (var fi = 0; fi < 10; fi++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fbits = ((d << 10) | rem) ^ 0x5412;
      for (var a = 0; a <= 5; a++) setFn(8, a, bit(fbits, a));
      setFn(8, 7, bit(fbits, 6)); setFn(8, 8, bit(fbits, 7)); setFn(7, 8, bit(fbits, 8));
      for (var b = 9; b < 15; b++) setFn(14 - b, 8, bit(fbits, b));
      for (var c = 0; c < 8; c++) setFn(size - 1 - c, 8, bit(fbits, c));
      for (var e = 8; e < 15; e++) setFn(8, size - 15 + e, bit(fbits, e));
      setFn(8, size - 8, true);
    }
    formatBits(0);

    var k = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < size; v++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var up = ((right + 1) & 2) === 0;
          var y = up ? size - 1 - v : v;
          if (!fn[y][x] && k < codewords.length * 8) {
            mod[y][x] = bit(codewords[k >>> 3], 7 - (k & 7));
            k++;
          }
        }
      }
    }

    for (var my = 0; my < size; my++) {
      for (var mx = 0; mx < size; mx++) {
        if (!fn[my][mx] && MASKS[0](mx, my)) mod[my][mx] = !mod[my][mx];
      }
    }
    formatBits(0);
    return mod;
  }

  function qrMatrix(text) {
    var bytes = toUtf8Bytes(text);
    var ver = 1;
    for (; ver <= MAX_VERSION; ver++) {
      var lenBits = ver <= 9 ? 8 : 16;
      if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > MAX_VERSION) ver = MAX_VERSION;
    return drawQr(ver, buildCodewords(bytes, ver));
  }

  function renderQrSvg(value, scale) {
    var sc = scale || 6;
    var matrix = qrMatrix(value);
    var quiet = 3;
    var n = matrix.length + quiet * 2;
    var d = '';
    for (var y = 0; y < matrix.length; y++) {
      for (var x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x]) {
          d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
        }
      }
    }
    var px = n * sc;
    return (
      '<svg width="' + px + '" height="' + px + '" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="QR Code">' +
        '<rect width="' + n + '" height="' + n + '" fill="#FFFFFF"/>' +
        '<path d="' + d + '" fill="#000000"/>' +
      '</svg>'
    );
  }

  // ── Protocolo de Pareamento Surubim (ECDH P-256 + AES-GCM, polling em /api/pair/*) ──
  var activePollTimer = null;
  var currentSession = null;
  var START_TIMEOUT_MS = 15000;
  var POLL_INTERVAL_MS = 2500;

  function arrayBufferToBase64(buf) {
    var s = '';
    var a = new Uint8Array(buf);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(a).toString('base64');
  }

  function base64ToArrayBuffer(b64Str) {
    if (typeof atob === 'function') {
      var bin = atob(b64Str);
      var a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      return a.buffer;
    }
    var buf = Buffer.from(b64Str, 'base64');
    return new Uint8Array(buf).buffer;
  }

  function getCrypto() {
    var c = null;
    if (typeof window !== 'undefined' && window.crypto) c = window.crypto;
    else if (typeof globalThis !== 'undefined' && globalThis.crypto) c = globalThis.crypto;
    else if (typeof require === 'function') { try { c = require('node:crypto').webcrypto; } catch (e) { c = null; } }
    return (c && c.subtle) ? c : null;
  }

  function utf8Decode(buf) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(new Uint8Array(buf));
    var a = new Uint8Array(buf); var s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return decodeURIComponent(escape(s));
  }

  function generateKeyPair(cb) {
    var c = getCrypto();
    if (!c) return cb(null);
    c.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
      .then(function (kp) {
        return c.subtle.exportKey('raw', kp.publicKey).then(function (raw) {
          return { privateKey: kp.privateKey, pub: arrayBufferToBase64(raw) };
        });
      })
      .then(function (pair) { cb(pair); }, function () { cb(null); });
  }

  function decryptPayload(privateKey, msg, cb) {
    var c = getCrypto();
    if (!c || !privateKey) return cb(new Error('Esta TV não conseguiu decifrar a lista enviada. Gere um novo código.'));
    c.subtle.importKey('raw', base64ToArrayBuffer(msg.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      .then(function (epk) {
        return c.subtle.deriveKey({ name: 'ECDH', public: epk }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) {
        return c.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(msg.iv)) }, key, base64ToArrayBuffer(msg.ct));
      })
      .then(function (plain) {
        var obj;
        try { obj = JSON.parse(utf8Decode(plain)); } catch (e) { return cb(new Error('Lista recebida está corrompida. Gere um novo código.')); }
        cb(null, obj);
      }, function () { cb(new Error('Não foi possível decifrar a lista. Gere um novo código.')); });
  }

  function stopPolling() {
    if (activePollTimer) {
      clearTimeout(activePollTimer);
      activePollTimer = null;
    }
  }

  function resetSession() {
    stopPolling();
    currentSession = null;
  }

  function startErrorMessage(status, errCode) {
    if (errCode === 'server_not_configured') return 'O servidor de pareamento está sem o banco Redis (Upstash) configurado na Vercel.';
    if (errCode === 'no_crypto') return 'Esta TV não tem criptografia e o servidor não tem PAIR_SECRET configurado.';
    if (errCode === 'rate_limit' || status === 429) return 'Muitas tentativas de pareamento. Aguarde alguns minutos e tente de novo.';
    return 'Servidor de pareamento indisponível (erro ' + status + '). Tente novamente.';
  }

  function startSession(baseUrl, onSessionReady, onPayloadReceived, onError) {
    resetSession();
    var cleanBase = String(baseUrl || DEFAULT_PAIRING_BASE_URL).replace(/\/+$/, '');
    var fail = function (msg) { if (onSessionReady) onSessionReady(new Error(msg)); };

    if (typeof XMLHttpRequest === 'undefined') return fail('Rede indisponível neste dispositivo.');

    generateKeyPair(function (pair) {
      var xhr = new XMLHttpRequest();
      try {
        xhr.open('POST', cleanBase + '/api/pair/start', true);
        xhr.timeout = START_TIMEOUT_MS;
        xhr.setRequestHeader('Content-Type', 'application/json');
      } catch (e) { return fail('Não foi possível contatar o servidor de pareamento.'); }

      xhr.onload = function () {
        var j = null;
        try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
        if (xhr.status >= 200 && xhr.status < 300 && j && j.pairId && j.code && j.pollToken) {
          var ttlSec = j.expiresIn || 600;
          currentSession = {
            pairId: j.pairId,
            code: j.code,
            pollToken: j.pollToken,
            expiresIn: ttlSec,
            expiresAt: Date.now() + ttlSec * 1000,
            baseUrl: cleanBase,
            privateKey: pair ? pair.privateKey : null,
            mode: 'live'
          };
          if (onSessionReady) onSessionReady(null, currentSession);
          schedulePoll(currentSession, onPayloadReceived, onError, POLL_INTERVAL_MS);
          return;
        }
        fail(startErrorMessage(xhr.status, j && j.error));
      };
      xhr.onerror = function () { fail('Sem conexão com o servidor de pareamento. Verifique a internet da TV.'); };
      xhr.ontimeout = function () { fail('O servidor de pareamento demorou demais para responder.'); };
      xhr.send(JSON.stringify({ pub: pair ? pair.pub : null }));
    });
  }

  function schedulePoll(session, onPayloadReceived, onError, delayMs) {
    stopPolling();
    var wait = typeof delayMs === 'number' ? delayMs : POLL_INTERVAL_MS;
    activePollTimer = setTimeout(function () {
      if (!currentSession || currentSession.pairId !== session.pairId) return;
      if (session.expiresAt && Date.now() > session.expiresAt) {
        resetSession();
        if (onError) onError(new Error('O código de pareamento expirou (10 minutos). Gere um novo código.'));
        return;
      }

      var xhr = new XMLHttpRequest();
      var again = function (nextDelay) {
        if (currentSession && currentSession.pairId === session.pairId) {
          schedulePoll(session, onPayloadReceived, onError, nextDelay || POLL_INTERVAL_MS);
        }
      };
      var abort = function (msg) {
        resetSession();
        if (onError) onError(new Error(msg));
      };
      xhr.open('GET', session.baseUrl + '/api/pair/poll?pairId=' + encodeURIComponent(session.pairId), true);
      xhr.setRequestHeader('X-Poll-Token', session.pollToken);
      xhr.timeout = 8000;
      xhr.onload = function () {
        var j = null;
        try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
        if (xhr.status === 404) return abort('O código expirou. Gere um novo código.');
        if (xhr.status === 403) return abort('Sessão de pareamento inválida. Gere um novo código.');
        if (xhr.status === 429) {
          // Limite de consultas atingido: desacelera o polling para 10s
          return again(10000);
        }
        if (xhr.status >= 200 && xhr.status < 300 && j && j.status === 'ready') {
          var keyOwner = session;
          resetSession();
          if (j.mode === 'e2e') {
            decryptPayload(keyOwner.privateKey, j, function (err, payload) {
              if (err) { if (onError) onError(err); return; }
              if (onPayloadReceived) onPayloadReceived(payload);
            });
          } else if (j.payload) {
            if (onPayloadReceived) onPayloadReceived(j.payload);
          } else if (onError) {
            onError(new Error('Resposta de pareamento inválida. Gere um novo código.'));
          }
          return;
        }
        again(POLL_INTERVAL_MS);
      };
      xhr.onerror = function () { again(5000); };
      xhr.ontimeout = function () { again(4000); };
      xhr.send();
    }, wait);
  }

  function isHttpUrl(u) { return /^https?:\/\/\S+$/i.test(String(u || '')); }

  function buildXtreamServer(host, port) {
    var h = String(host || '').trim().replace(/\/+$/, '');
    var p = parseInt(port, 10);
    if (!p || /:\d+$/.test(h)) return h;
    var https = /^https:/i.test(h);
    if ((https && p === 443) || (!https && p === 80)) return h;
    return h + ':' + p;
  }

  function applyMobilePayload(payload, callback, onProgress) {
    function save(source) {
      global.LuminaStore.set('source', source);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('source', source);
      if (global.LuminaStore.upsertSavedList) global.LuminaStore.upsertSavedList(source);
    }
    if (!payload || !payload.type) {
      if (callback) callback(new Error('Dados de pareamento inválidos.'));
      return;
    }
    if (payload.type === 'm3u') {
      if (!isHttpUrl(payload.url)) { if (callback) callback(new Error('Link M3U inválido.')); return; }
      global.LuminaRepository.loadFromUrlOrLocalPath(payload.url, 'mobile-m3u', onProgress, function (err, items, updateRecord) {
        if (!err) save({ type: 'm3u', name: payload.name || '', url: payload.url });
        if (callback) callback(err, items, payload, updateRecord);
      });
    } else if (payload.type === 'xtream') {
      if (!isHttpUrl(payload.host) || !payload.username || !payload.password) {
        if (callback) callback(new Error('Dados Xtream incompletos.'));
        return;
      }
      var creds = {
        server: buildXtreamServer(payload.host, payload.port),
        username: payload.username,
        password: payload.password
      };
      global.LuminaRepository.loadFromXtream(creds, onProgress, function (err, items, updateRecord) {
        if (!err) {
          global.LuminaStore.set('xtreamCreds', creds);
          save({ type: 'xtream', name: payload.name || '', creds: creds });
        }
        if (callback) callback(err, items, payload, updateRecord);
      });
    } else {
      if (callback) callback(new Error('Tipo de lista desconhecido: ' + payload.type));
    }
  }

  global.LuminaPairing = {
    DEFAULT_PAIRING_BASE_URL: DEFAULT_PAIRING_BASE_URL,
    qrMatrix: qrMatrix,
    renderQrSvg: renderQrSvg,
    startSession: startSession,
    stopPolling: stopPolling,
    resetSession: resetSession,
    getCurrentSession: function () { return currentSession; },
    applyMobilePayload: applyMobilePayload,
    generateKeyPair: generateKeyPair,
    decryptPayload: decryptPayload,
    buildXtreamServer: buildXtreamServer,
    arrayBufferToBase64: arrayBufferToBase64,
    base64ToArrayBuffer: base64ToArrayBuffer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LuminaPairing;
  }
})(typeof window !== 'undefined' ? window : global);
