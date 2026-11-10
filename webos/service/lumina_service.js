/* global require, Buffer */
var Service = require('webos-service');
var http = require('http');
var https = require('https');
var urlModule = require('url');

var SERVICE_ID = 'com.luminatv.player.service';
var MAX_REDIRECTS = 5;
var MAX_BODY_BYTES = 60 * 1024 * 1024; // 60 MB teto de segurança para listas M3U/JSON
var CHUNK_CHARS = 262144; // 256 KB por mensagem no barramento Luna

var service = new Service(SERVICE_ID);
var activeRequests = {};

function sanitizeUrlForLog(rawUrl) {
  return String(rawUrl || '')
    .replace(/([?&](?:password|pass|pwd|token|api_key)=)[^&#]*/gi, '$1***')
    .replace(/(\/(?:live|movie|series)\/[^\/]+\/)[^\/]+(\/)/gi, '$1***$2');
}

function performHttpFetch(options, onProgress, onComplete) {
  var reqId = options.requestId || ('req_' + Date.now());
  var targetUrl = String(options.url || '').trim();
  var method = String(options.method || 'GET').toUpperCase();
  var timeoutMs = Number(options.timeoutMs || 30000);
  var headers = options.headers && typeof options.headers === 'object' ? options.headers : {};
  var bodyStr = options.body ? String(options.body) : null;
  var redirectCount = 0;
  var finished = false;
  var currentReq = null;
  var timeoutTimer = null;

  function done(errObj, resultObj) {
    if (finished) return;
    finished = true;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    delete activeRequests[reqId];
    onComplete(errObj, resultObj);
  }

  activeRequests[reqId] = {
    abort: function () {
      if (currentReq) {
        try { currentReq.abort(); } catch (e) {}
      }
      done({ code: 'ABORTED', httpStatus: 0, message: 'Operação cancelada pelo usuário.' }, null);
    }
  };

  function requestStep(stepUrl) {
    if (finished) return;
    var parsed;
    try {
      parsed = urlModule.parse(stepUrl);
    } catch (e) {
      return done({ code: 'INVALID_URL', httpStatus: 0, message: 'URL inválida.' }, null);
    }

    var isHttps = parsed.protocol === 'https:';
    var transport = isHttps ? https : http;
    var reqHeaders = {
      'User-Agent': headers['User-Agent'] || headers['user-agent'] || 'VLC/3.0.20 LibVLC/3.0.20',
      'Accept': headers['Accept'] || headers['accept'] || '*/*'
    };

    var hKeys = Object.keys(headers);
    for (var i = 0; i < hKeys.length; i++) {
      var k = hKeys[i];
      if (headers[k] !== undefined && headers[k] !== null && String(headers[k]).length > 0) {
        reqHeaders[k] = String(headers[k]);
      }
    }

    var reqOpts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path || '/',
      method: method,
      headers: reqHeaders,
      rejectUnauthorized: options.allowInsecureSsl !== false ? false : true
    };

    try {
      currentReq = transport.request(reqOpts, function (res) {
        if (finished) return;
        var status = Number(res.statusCode || 0);
        var loc = res.headers && (res.headers.location || res.headers.Location);

        if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && loc) {
          res.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            return done({ code: 'TOO_MANY_REDIRECTS', httpStatus: status, message: 'Muitos redirecionamentos.' }, null);
          }
          redirectCount++;
          var nextUrl = urlModule.resolve(stepUrl, loc);
          return requestStep(nextUrl);
        }

        var totalBytes = Number((res.headers && res.headers['content-length']) || 0);
        var loadedBytes = 0;
        var buffers = [];
        var lastProgressAt = 0;

        res.on('data', function (chunk) {
          if (finished) return;
          loadedBytes += chunk.length;
          if (loadedBytes > MAX_BODY_BYTES) {
            try { currentReq.abort(); } catch (e) {}
            return done({
              code: 'PAYLOAD_TOO_LARGE',
              httpStatus: status,
              message: 'A lista excede o limite de memória permitido na TV (60 MB).'
            }, null);
          }
          buffers.push(chunk);
          var now = Date.now();
          if (onProgress && (now - lastProgressAt >= 250)) {
            lastProgressAt = now;
            onProgress({ loadedBytes: loadedBytes, totalBytes: totalBytes });
          }
        });

        res.on('end', function () {
          if (finished) return;
          var fullBuf = Buffer.concat(buffers, loadedBytes);
          buffers = null;
          var text = fullBuf.toString('utf8');
          done(null, {
            httpStatus: status,
            contentType: (res.headers && res.headers['content-type']) || '',
            loadedBytes: loadedBytes,
            text: text
          });
        });

        res.on('error', function (err) {
          done({
            code: (err && err.code) || 'READ_ERROR',
            httpStatus: status,
            message: 'Falha ao ler resposta do servidor (' + sanitizeUrlForLog(stepUrl) + ').'
          }, null);
        });
      });
    } catch (reqEx) {
      return done({
        code: 'REQUEST_INIT_ERROR',
        httpStatus: 0,
        message: reqEx && reqEx.message ? reqEx.message : 'Erro ao iniciar requisição.'
      }, null);
    }

    currentReq.on('error', function (err) {
      var errCode = (err && err.code) ? String(err.code) : 'CONNECT';
      var proxyType = 'CONNECT';
      if (/ENOTFOUND|EAI_AGAIN/i.test(errCode)) proxyType = 'DNS';
      else if (/CERT|SSL|TLS/i.test(errCode)) proxyType = 'SSL';
      else if (/ETIMEDOUT|ESOCKETTIMEDOUT/i.test(errCode)) proxyType = 'TIMEOUT';

      done({
        code: errCode,
        proxyError: proxyType,
        httpStatus: 0,
        message: (err && err.message) ? err.message : 'Falha de conexão com o servidor.'
      }, null);
    });

    timeoutTimer = setTimeout(function () {
      if (currentReq) {
        try { currentReq.abort(); } catch (e) {}
      }
      done({
        code: 'TIMEOUT',
        proxyError: 'TIMEOUT',
        httpStatus: 0,
        message: 'Tempo limite esgotado ao aguardar o servidor.'
      }, null);
    }, timeoutMs > 0 ? timeoutMs : 30000);

    if (bodyStr && (method === 'POST' || method === 'PUT')) {
      currentReq.write(bodyStr);
    }
    currentReq.end();
  }

  requestStep(targetUrl);
}

var fetchMethod = service.register('fetchUrl');
fetchMethod.on('request', function (message) {
  var payload = (message && message.payload) || {};
  var reqId = payload.requestId || ('req_' + Date.now());
  var isSub = !!(message && message.isSubscription);

  if (!payload.url || !/^https?:\/\//i.test(String(payload.url))) {
    message.respond({
      returnValue: false,
      stage: 'error',
      httpStatus: 0,
      errorCode: 'INVALID_URL',
      errorMessage: 'URL HTTP/HTTPS inválida.'
    });
    return;
  }

  performHttpFetch(
    {
      requestId: reqId,
      url: payload.url,
      method: payload.method || 'GET',
      headers: payload.headers || {},
      body: payload.body || null,
      timeoutMs: payload.timeoutMs || 60000,
      allowInsecureSsl: payload.allowInsecureSsl !== false
    },
    function (prog) {
      if (isSub) {
        try {
          message.respond({
            returnValue: true,
            stage: 'progress',
            loadedBytes: prog.loadedBytes,
            totalBytes: prog.totalBytes || 0
          });
        } catch (e) {}
      }
    },
    function (err, result) {
      if (err) {
        try {
          message.respond({
            returnValue: false,
            stage: 'error',
            httpStatus: err.httpStatus || 0,
            proxyError: err.proxyError || '',
            errorCode: err.code || 'NETWORK_ERROR',
            errorMessage: err.message || 'Falha de rede no serviço webOS.'
          });
        } catch (e) {}
        return;
      }

      var text = result.text || '';
      if (!isSub || text.length <= CHUNK_CHARS) {
        try {
          message.respond({
            returnValue: true,
            stage: 'complete',
            httpStatus: result.httpStatus,
            contentType: result.contentType,
            totalLength: text.length,
            data: text
          });
        } catch (e) {}
        return;
      }

      var totalChunks = Math.ceil(text.length / CHUNK_CHARS);
      for (var c = 0; c < totalChunks; c++) {
        var slice = text.slice(c * CHUNK_CHARS, (c + 1) * CHUNK_CHARS);
        try {
          message.respond({
            returnValue: true,
            stage: 'chunk',
            chunkIndex: c,
            totalChunks: totalChunks,
            chunk: slice
          });
        } catch (e) {}
      }
      try {
        message.respond({
          returnValue: true,
          stage: 'complete',
          httpStatus: result.httpStatus,
          contentType: result.contentType,
          totalLength: text.length,
          chunked: true,
          totalChunks: totalChunks
        });
      } catch (e) {}
    }
  );
});

fetchMethod.on('cancel', function (message) {
  var payload = (message && message.payload) || {};
  var reqId = payload.requestId;
  if (reqId && activeRequests[reqId]) {
    activeRequests[reqId].abort();
  }
});

service.register('abortFetch', function (message) {
  var payload = (message && message.payload) || {};
  var reqId = payload.requestId;
  if (reqId && activeRequests[reqId]) {
    activeRequests[reqId].abort();
  }
  message.respond({ returnValue: true });
});
