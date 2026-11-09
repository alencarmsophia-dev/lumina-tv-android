(function (global) {
  'use strict';

  var TIMEOUT_SMALL_API_MS = 25000;
  var TIMEOUT_LIVE_MS = 60000;
  var TIMEOUT_VOD_SERIES_MS = 90000;
  var RETRY_DELAYS_MS = [1500, 3000];
  var SERIES_TTL_MS = 6 * 3600 * 1000;
  var DEFAULT_CATEGORY_TTL_MS = 12 * 3600 * 1000; // 12h padrão (Parte 5.2 e 11)
  var ALT_USER_AGENTS = [
    'VLC/3.0.20 LibVLC/3.0.20',
    'Lumina TV/2.2.1 (Android)',
    'okhttp/4.12.0',
    'Mozilla/5.0 (Linux; Android 11; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36'
  ];

  var hostUaMemory = {};
  var customRequestHandler = null; // Permite injetar cliente HTTP em Node.js ou testes
  var activeSearchIndexers = {};

  function normalizeBaseUrl(server) {
    var s = String(server || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  function extractHost(url) {
    var m = String(url || '').match(/^https?:\/\/([^\/:?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  function formatDateBrFromUnix(sec) {
    var ms = Number(sec || 0) * 1000;
    if (!ms || isNaN(ms)) return '';
    var d = new Date(ms);
    var dd = d.getDate() < 10 ? ('0' + d.getDate()) : String(d.getDate());
    var mm = (d.getMonth() + 1) < 10 ? ('0' + (d.getMonth() + 1)) : String(d.getMonth() + 1);
    var yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  }

  function getCategoryTtlMs() {
    var pol = (global.LuminaStore && global.LuminaStore.get('catalogUpdatePolicy')) || '12h';
    if (pol === 'on_open_tab') return 0;
    if (pol === '6h') return 6 * 3600 * 1000;
    if (pol === '24h') return 24 * 3600 * 1000;
    if (pol === 'manual') return 365 * 24 * 3600 * 1000;
    return DEFAULT_CATEGORY_TTL_MS;
  }

  function buildNetworkError(status, proxyErrType, rawMsg, url, retryAfterSec) {
    var err;
    if (proxyErrType === 'SSL' || /SSL|CertPath|certificate/i.test(String(rawMsg || ''))) {
      err = new Error('O certificado de segurança (HTTPS) deste servidor é inválido ou autoassinado.');
      err.code = 'SSL_ERROR';
      err.isSslError = true;
    } else if (proxyErrType === 'DNS' || /DNS|UnknownHost/i.test(String(rawMsg || ''))) {
      err = new Error('Não foi possível encontrar este servidor (erro de DNS). Confira o endereço digitado.');
      err.code = 'DNS_ERROR';
    } else if (proxyErrType === 'TIMEOUT' || /timeout|tempo/i.test(String(rawMsg || ''))) {
      err = new Error('O servidor demorou demais para responder. Tente novamente em instantes.');
      err.code = 'TIMEOUT_ERROR';
    } else if (status === 401 || status === 403) {
      err = new Error('Acesso recusado pelo servidor (código ' + status + '). Confira usuário e senha.');
      err.code = 'AUTH_INVALID';
    } else if (status === 429 || status === 458) {
      err = new Error('Limite de conexões ou requisições atingido no servidor (código ' + status + ').');
      err.code = 'RATE_LIMIT';
    } else if (status === 404) {
      err = new Error('Este servidor não parece ser compatível com Xtream Codes (erro 404).');
      err.code = 'NOT_XTREAM_404';
    } else {
      err = new Error(rawMsg || ('Falha ao conectar ao servidor (HTTP ' + (status || 0) + ').'));
      err.code = 'NETWORK_ERROR';
    }
    err.httpStatus = status || 0;
    err.proxyError = proxyErrType || '';
    err.retryAfterSec = retryAfterSec || 0;
    err.url = url || '';
    return err;
  }

  // Executa requisição HTTP (em Node usa http/https nativo com streaming e redirecionamento; no navegador usa XHR)
  function performRawRequest(url, options, onChunk, onDone) {
    var opts = options || {};
    var timeoutMs = opts.timeoutMs || TIMEOUT_SMALL_API_MS;
    var userAgent = opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20';

    if (global.LuminaCatalog && global.LuminaCatalog.recordNetworkCall) {
      global.LuminaCatalog.recordNetworkCall();
    }

    if (customRequestHandler) {
      return customRequestHandler(url, opts, onChunk, onDone);
    }

    // Em Node.js (testes com servidor HTTP falso)
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof XMLHttpRequest === 'undefined') {
      return performNodeHttpRequest(url, timeoutMs, userAgent, 0, onChunk, onDone);
    }

    if (typeof XMLHttpRequest === 'undefined') {
      onDone(new Error('XMLHttpRequest indisponível.'), null, { httpStatus: 0 });
      return { abort: function () {} };
    }

    var xhr = new XMLHttpRequest();
    var lastReadPos = 0;
    try {
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;
    } catch (e) {
      onDone(e, null, { httpStatus: 0 });
      return { abort: function () {} };
    }

    if (global.LuminaPlatform && global.LuminaPlatform.registerStreamHeaders) {
      global.LuminaPlatform.registerStreamHeaders(url, userAgent, '');
    }

    xhr.onprogress = function () {
      if (onChunk && xhr.responseText && xhr.responseText.length > lastReadPos) {
        var delta = xhr.responseText.slice(lastReadPos);
        lastReadPos = xhr.responseText.length;
        onChunk(delta);
      }
    };

    xhr.onload = function () {
      var proxyHeader = '';
      var retryAfter = 0;
      try {
        proxyHeader = xhr.getResponseHeader('X-Lumina-Proxy-Error') || '';
        retryAfter = parseInt(xhr.getResponseHeader('Retry-After') || '0', 10) || 0;
      } catch (e) {}

      if (xhr.status === 502 && proxyHeader) {
        var pJson = null;
        try { pJson = JSON.parse(xhr.responseText); } catch (e) {}
        return onDone(buildNetworkError(502, proxyHeader, pJson && pJson.message, url, 0), null, { httpStatus: 502 });
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        var fullText = String(xhr.responseText || '');
        if (onChunk && fullText.length > lastReadPos) {
          onChunk(fullText.slice(lastReadPos));
        }
        return onDone(null, fullText, { httpStatus: xhr.status });
      }

      onDone(
        buildNetworkError(xhr.status, proxyHeader, 'Erro HTTP ' + xhr.status, url, retryAfter),
        null,
        { httpStatus: xhr.status, retryAfterSec: retryAfter }
      );
    };

    xhr.onerror = function () {
      onDone(buildNetworkError(0, 'CONNECT', 'Falha de conexão com o servidor.', url, 0), null, { httpStatus: 0 });
    };

    xhr.ontimeout = function () {
      onDone(buildNetworkError(0, 'TIMEOUT', 'O servidor demorou demais para responder.', url, 0), null, { httpStatus: 0 });
    };

    xhr.send();
    return {
      abort: function () {
        try { xhr.abort(); } catch (e) {}
      }
    };
  }

  function performNodeHttpRequest(targetUrl, timeoutMs, userAgent, redirectDepth, onChunk, onDone) {
    if (redirectDepth > 5) {
      onDone(new Error('Redirecionamentos excessivos.'), null, { httpStatus: 0 });
      return { abort: function () {} };
    }
    var httpMod = /^https:/i.test(targetUrl) ? require('https') : require('http');
    var urlMod = require('url');
    var parsed = urlMod.parse(targetUrl);
    var aborted = false;
    var finished = false;

    var req = httpMod.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'GET',
      headers: { 'User-Agent': userAgent }
    });

    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      try { req.destroy(); } catch (e) {}
      onDone(buildNetworkError(0, 'TIMEOUT', 'O servidor demorou demais para responder.', targetUrl, 0), null, { httpStatus: 0 });
    }, timeoutMs);

    req.on('response', function (res) {
      var status = res.statusCode || 0;
      if (status === 301 || status === 302 || status === 307 || status === 308) {
        clearTimeout(timer);
        var loc = res.headers['location'];
        res.resume();
        if (!loc) {
          finished = true;
          return onDone(new Error('Redirecionamento sem Location.'), null, { httpStatus: status });
        }
        var nextUrl = urlMod.resolve(targetUrl, loc);
        performNodeHttpRequest(nextUrl, timeoutMs, userAgent, redirectDepth + 1, onChunk, onDone);
        return;
      }

      var retryAfter = parseInt(res.headers['retry-after'] || '0', 10) || 0;
      if (status < 200 || status >= 300) {
        clearTimeout(timer);
        res.resume();
        finished = true;
        return onDone(
          buildNetworkError(status, '', 'Erro HTTP ' + status, targetUrl, retryAfter),
          null,
          { httpStatus: status, retryAfterSec: retryAfter }
        );
      }

      var chunks = [];
      var completed = false;
      res.on('data', function (chunk) {
        if (aborted || finished) return;
        if (onChunk) {
          onChunk(chunk);
        } else {
          chunks.push(chunk);
        }
      });

      res.on('end', function () {
        if (aborted || finished) return;
        clearTimeout(timer);
        if (!res.complete) {
          finished = true;
          var dropErr = buildNetworkError(0, 'CONNECT', 'Conexão cortada no meio da resposta.', targetUrl, 0);
          dropErr.code = 'CONNECTION_DROPPED';
          return onDone(dropErr, null, { httpStatus: 0 });
        }
        completed = true;
        finished = true;
        var fullStr = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
        onDone(null, fullStr, { httpStatus: status });
      });

      res.on('close', function () {
        if (aborted || finished || completed) return;
        clearTimeout(timer);
        finished = true;
        var dropErr = buildNetworkError(0, 'CONNECT', 'Conexão encerrada antes do fim.', targetUrl, 0);
        dropErr.code = 'CONNECTION_DROPPED';
        onDone(dropErr, null, { httpStatus: 0 });
      });
    });

    req.on('error', function (err) {
      if (aborted || finished) return;
      clearTimeout(timer);
      finished = true;
      onDone(buildNetworkError(0, 'CONNECT', err.message || 'Falha de rede', targetUrl, 0), null, { httpStatus: 0 });
    });

    req.end();
    return {
      abort: function () {
        aborted = true;
        clearTimeout(timer);
        try { req.destroy(); } catch (e) {}
      }
    };
  }

  // Requisição JSON com suporte a User-Agent fallback em 403, Retry-After em 429 e retries em 5xx/rede
  function requestJsonWithRetry(url, options, cb) {
    var opts = options || {};
    var timeoutMs = opts.timeoutMs || TIMEOUT_SMALL_API_MS;
    var tag = opts.tag || 'xtream';
    var priority = opts.priority || 'high';
    var host = extractHost(url);
    var currentUa = (host && hostUaMemory[host]) || opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20';
    var uaIdx = 0;
    var retryIdx = 0;
    var activeHandle = null;
    var cancelled = false;

    function attemptFetch() {
      if (cancelled) return;
      activeHandle = performRawRequest(url, { timeoutMs: timeoutMs, userAgent: currentUa }, null, function (err, bodyStr, meta) {
        if (cancelled) return;
        var status = (meta && meta.httpStatus) || (err && err.httpStatus) || 0;

        // 403 por User-Agent: tenta os User-Agents alternativos e memoriza por host (Parte 13.4d)
        if (status === 403 && uaIdx < ALT_USER_AGENTS.length) {
          currentUa = ALT_USER_AGENTS[uaIdx++];
          if (currentUa === (opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20') && uaIdx < ALT_USER_AGENTS.length) {
            currentUa = ALT_USER_AGENTS[uaIdx++];
          }
          attemptFetch();
          return;
        }

        if (status === 429 && retryIdx < 2) {
          var waitMs = ((meta && meta.retryAfterSec) ? meta.retryAfterSec * 1000 : 1500);
          retryIdx++;
          setTimeout(attemptFetch, Math.min(5000, waitMs));
          return;
        }

        if (err) {
          var canRetry = status !== 401 && status !== 403 && status !== 404 && status !== 458 &&
            err.proxyError !== 'SSL' && err.proxyError !== 'DNS' &&
            retryIdx < RETRY_DELAYS_MS.length;
          if (canRetry) {
            var delay = opts.fastRetryForTests ? 40 : RETRY_DELAYS_MS[retryIdx];
            retryIdx++;
            setTimeout(attemptFetch, delay);
            return;
          }
          return cb(err, null, meta);
        }

        if (host) hostUaMemory[host] = currentUa;

        var trimmed = String(bodyStr || '').trim();
        if (/^<!DOCTYPE\s+html|^<html/i.test(trimmed)) {
          var htmlErr = new Error('O servidor retornou uma página HTML em vez de dados JSON da lista.');
          htmlErr.code = 'HTML_RESPONSE';
          htmlErr.httpStatus = status;
          return cb(htmlErr, null, meta);
        }

        try {
          var parsed = JSON.parse(trimmed);
          cb(null, parsed, meta);
        } catch (parseEx) {
          var truncErr = new Error('A resposta do servidor foi interrompida antes do fim (JSON truncado).');
          truncErr.code = 'JSON_TRUNCATED';
          cb(truncErr, null, meta);
        }
      });
    }

    if (global.LuminaNetQueue && !opts.bypassQueue) {
      return global.LuminaNetQueue.enqueue({
        tag: tag,
        priority: priority,
        url: url,
        executor: function (doneQueueCb) {
          attemptFetchWithQueueCallback(doneQueueCb);
          return {
            abort: function () {
              cancelled = true;
              if (activeHandle && activeHandle.abort) activeHandle.abort();
            }
          };
        }
      }, cb);
    }

    function attemptFetchWithQueueCallback(doneQueueCb) {
      var origCb = cb;
      cb = function (e, r, m) {
        cb = origCb;
        doneQueueCb(e, r, m);
      };
      attemptFetch();
    }

    attemptFetch();
    return {
      abort: function () {
        cancelled = true;
        if (activeHandle && activeHandle.abort) activeHandle.abort();
      }
    };
  }

  function buildApiUrl(creds, action, extraParams) {
    var base = normalizeBaseUrl(creds.server);
    var u = encodeURIComponent(creds.username || '');
    var p = encodeURIComponent(creds.password || '');
    var url = base + '/player_api.php?username=' + u + '&password=' + p;
    if (action) url += '&action=' + encodeURIComponent(action);
    if (extraParams) {
      var keys = Object.keys(extraParams);
      for (var i = 0; i < keys.length; i++) {
        url += '&' + encodeURIComponent(keys[i]) + '=' + encodeURIComponent(extraParams[keys[i]]);
      }
    }
    return url;
  }

  function parseAccountInfo(data) {
    var ui = (data && data.user_info) || {};
    var si = (data && data.server_info) || {};
    var allowed = ui.allowed_output_formats;
    if (!Array.isArray(allowed) || !allowed.length) {
      allowed = ['m3u8', 'ts'];
    }
    var authVal = ui.auth;
    var isAuthenticated = !(authVal === 0 || authVal === '0' || authVal === false || String(ui.status || '').toLowerCase() === 'invalid');
    var statusStr = String(ui.status || 'Active');
    var expSec = ui.exp_date ? parseInt(ui.exp_date, 10) : null;
    var nowSec = Math.floor(Date.now() / 1000);
    var isExpired = (statusStr.toLowerCase() === 'expired') || (expSec && expSec > 0 && expSec < nowSec);
    var isDisabled = /^(banned|disabled|blocked)$/i.test(statusStr);
    var maxCons = parseInt(ui.max_connections || '1', 10) || 1;
    var actCons = parseInt(ui.active_cons || '0', 10) || 0;
    var daysRemaining = (expSec && expSec > nowSec) ? Math.ceil((expSec - nowSec) / 86400) : null;
    var isExpiringSoon = !!(daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7);

    return {
      username: ui.username || '',
      status: statusStr,
      auth: isAuthenticated,
      isAuthenticated: isAuthenticated,
      isExpired: !!isExpired,
      isDisabled: !!isDisabled,
      isExpiringSoon: isExpiringSoon,
      daysRemaining: daysRemaining,
      expDate: expSec,
      expDateFormatted: expSec ? formatDateBrFromUnix(expSec) : '',
      maxConnections: maxCons,
      activeCons: actCons,
      connLimitWarning: (maxCons > 0 && actCons >= maxCons)
        ? 'Atenção: todas as conexões desta conta estão em uso no momento.'
        : '',
      isTrial: ui.is_trial === '1' || ui.is_trial === 1,
      allowedOutputFormats: allowed,
      serverProtocol: si.server_protocol || 'http',
      timezone: si.timezone || 'America/Sao_Paulo'
    };
  }

  function authenticateAndCheckAccount(creds, cb, opts) {
    if (!creds || !creds.server || !creds.username || !creds.password) {
      return cb(new Error('Credenciais Xtream incompletas.'), null);
    }
    requestJsonWithRetry(buildApiUrl(creds, ''), opts || {}, function (err, data) {
      if (err) return cb(err, null);
      if (!data || typeof data !== 'object' || (!data.user_info && !data.server_info)) {
        var invalidPanelErr = new Error('Este endereço não respondeu como um painel Xtream Codes válido.');
        invalidPanelErr.code = 'INVALID_XTREAM_PANEL';
        return cb(invalidPanelErr, null);
      }

      var acc = parseAccountInfo(data);
      if (!acc.isAuthenticated) {
        var authErr = new Error('Acesso recusado pelo servidor. Usuário ou senha incorretos.');
        authErr.code = 'AUTH_INVALID';
        return cb(authErr, acc);
      }
      if (acc.isExpired) {
        var expMsg = acc.expDateFormatted
          ? ('Esta conta expirou em ' + acc.expDateFormatted + '.')
          : 'Esta conta está expirada no servidor.';
        var expErr = new Error(expMsg);
        expErr.code = 'ACCOUNT_EXPIRED';
        return cb(expErr, acc);
      }
      if (acc.isDisabled) {
        var disErr = new Error('Esta conta está desativada no servidor.');
        disErr.code = 'ACCOUNT_DISABLED';
        return cb(disErr, acc);
      }
      cb(null, acc);
    });
  }

  function pickPreferredLiveExtension(accountInfo, preferFormat) {
    var pref = preferFormat || (global.LuminaStore && global.LuminaStore.get('preferOutputFormat')) || 'auto';
    var allowed = (accountInfo && accountInfo.allowedOutputFormats) || ['m3u8', 'ts'];
    var hasM3u8 = allowed.indexOf('m3u8') !== -1;
    var hasTs = allowed.indexOf('ts') !== -1;
    if (pref === 'ts' && hasTs) return 'ts';
    if (pref === 'm3u8' && hasM3u8) return 'm3u8';
    if (hasM3u8) return 'm3u8';
    if (hasTs) return 'ts';
    return 'm3u8';
  }

  // Parte 5.1 e 11: Conecta conta Xtream baixando SÓ autenticação e as 3 listas de categorias (NENHUM stream baixado no cadastro!)
  function connectXtreamAndLoadCategories(creds, listId, onProgress, callback, opts) {
    var id = listId || (global.LuminaStore ? global.LuminaStore.buildListId({ type: 'xtream', creds: creds }) : 'xt_default');
    var genId = 'xtgen_' + Date.now();

    if (onProgress) onProgress({ stage: '1/4 \u00B7 Verificando o servidor\u2026', percent: 15 });

    authenticateAndCheckAccount(creds, function (authErr, accInfo) {
      if (authErr) return callback(authErr, null);

      if (global.LuminaStore) global.LuminaStore.set('accountInfo', accInfo);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('accountInfo', accInfo);

      if (onProgress) onProgress({ stage: '2/4 \u00B7 Entrando na conta\u2026', percent: 35 });

      requestJsonWithRetry(buildApiUrl(creds, 'get_live_categories'), opts || {}, function (lErr, liveCats) {
        var lArr = (!lErr && Array.isArray(liveCats)) ? liveCats : [];
        if (onProgress) onProgress({ stage: '3/4 \u00B7 Carregando categorias\u2026', percent: 65 });

        requestJsonWithRetry(buildApiUrl(creds, 'get_vod_categories'), opts || {}, function (vErr, vodCats) {
          var vArr = (!vErr && Array.isArray(vodCats)) ? vodCats : [];

          requestJsonWithRetry(buildApiUrl(creds, 'get_series_categories'), opts || {}, function (sErr, serCats) {
            var sArr = (!sErr && Array.isArray(serCats)) ? serCats : [];

            saveXtreamCategoriesForSection(id, genId, 'live', lArr, function () {
              saveXtreamCategoriesForSection(id, genId, 'movie', vArr, function () {
                saveXtreamCategoriesForSection(id, genId, 'series', sArr, function () {
                  var listMeta = {
                    listId: id,
                    type: 'xtream',
                    generationId: genId,
                    origin: normalizeBaseUrl(creds.server),
                    sections: {
                      live: { status: 'categories_ready', count: 0, groupsCount: lArr.length, updatedAt: Date.now() },
                      movie: { status: 'categories_ready', count: 0, groupsCount: vArr.length, updatedAt: Date.now() },
                      series: { status: 'categories_ready', count: 0, groupsCount: sArr.length, updatedAt: Date.now() }
                    },
                    updatedAt: Date.now()
                  };

                  if (global.LuminaStorage) {
                    global.LuminaStorage.saveMeta('catalogState_' + id, listMeta, function () {
                      if (onProgress) onProgress({ stage: '4/4 \u00B7 Pronto!', percent: 100 });
                      callback(null, {
                        listId: id,
                        generationId: genId,
                        accountInfo: accInfo,
                        categoryCounts: {
                          live: lArr.length,
                          movie: vArr.length,
                          series: sArr.length
                        },
                        summaryMessage: lArr.length + ' categorias de canais \u00B7 ' + vArr.length + ' de filmes \u00B7 ' + sArr.length + ' de séries. Os itens carregam quando você abrir cada aba.'
                      });
                    });
                  } else {
                    callback(null, {
                      listId: id,
                      generationId: genId,
                      accountInfo: accInfo,
                      categoryCounts: { live: lArr.length, movie: vArr.length, series: sArr.length }
                    });
                  }
                });
              });
            });
          });
        });
      });
    }, opts);
  }

  function saveXtreamCategoriesForSection(listId, genId, section, rawCats, cb) {
    var groups = [];
    for (var i = 0; i < (rawCats || []).length; i++) {
      var c = rawCats[i];
      if (!c || c.category_id == null) continue;
      var name = String(c.category_name || 'Geral').trim();
      var isAdult = /(?:adulto|\+18|18\+|xxx|er[oó]tico|priv[eé]|sexo|hot\b)/i.test(name);
      groups.push({
        id: 'xtcat_' + section + '_' + String(c.category_id),
        xtreamCategoryId: String(c.category_id),
        index: i,
        originalName: name,
        displayName: name,
        name: name,
        count: 0,
        totalPages: 0,
        order: i,
        adult: isAdult,
        suggestedSection: section,
        updatedAt: 0
      });
    }
    if (!global.LuminaStorage) return cb && cb(null, groups);
    global.LuminaStorage.putRecord('groups', {
      key: listId + ':' + genId + ':' + section,
      listId: listId,
      generationId: genId,
      section: section,
      totalItems: 0,
      groups: groups,
      recentPayloadStr: '',
      searchRunsCount: 0,
      updatedAt: Date.now()
    }, function (err) {
      if (cb) cb(err, groups);
    });
  }

  // Parte 5.2 e 13.4a: Ao entrar numa aba Xtream, garante que SÓ as categorias daquela seção sejam carregadas!
  function ensureSectionCategoriesLoaded(listId, creds, section, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    var options = opts || {};
    var st = global.LuminaStorage;
    var ttlMs = getCategoryTtlMs();

    global.LuminaCatalog.getListState(listId, function (_, state) {
      var genId = (state && state.generationId) || ('xtgen_' + listId);
      var recKey = listId + ':' + genId + ':' + section;

      st.getRecord('groups', recKey, function (_, rec) {
        var now = Date.now();
        var hasCached = !!(rec && Array.isArray(rec.groups) && rec.groups.length > 0);
        var isFresh = hasCached && (now - (rec.updatedAt || 0)) < ttlMs;

        if (isFresh && !options.forceRefresh) {
          return global.LuminaCatalog.getGroups(section, { listId: listId }, cb);
        }

        // Se já tem cache mas venceu (stale-while-revalidate, Parte 2.6 e 5.2), devolve o cache na hora e atualiza em 2º plano!
        if (hasCached && !options.forceRefresh) {
          global.LuminaCatalog.getGroups(section, { listId: listId }, cb);
          fetchOnlySectionCategoriesFromNet(listId, genId, creds, section, options, function () {
            global.LuminaCatalog.notifySubscribers(section, { type: 'categories-revalidated', section: section });
          });
          return;
        }

        fetchOnlySectionCategoriesFromNet(listId, genId, creds, section, options, function (netErr) {
          if (netErr) {
            if (hasCached) {
              return global.LuminaCatalog.getGroups(section, { listId: listId }, function (_, gList) {
                cb(null, gList, { offlineWithCache: true });
              });
            }
            return cb(netErr, null);
          }
          global.LuminaCatalog.getGroups(section, { listId: listId }, cb);
        });
      });
    });
  }

  function fetchOnlySectionCategoriesFromNet(listId, genId, creds, section, options, cb) {
    var action = section === 'live'
      ? 'get_live_categories'
      : (section === 'movie' ? 'get_vod_categories' : 'get_series_categories');

    requestJsonWithRetry(
      buildApiUrl(creds, action),
      { tag: 'tab_' + section, priority: options.priority || 'high', timeoutMs: TIMEOUT_SMALL_API_MS, fastRetryForTests: options.fastRetryForTests },
      function (err, rawCats) {
        if (err) return cb(err);
        if (!Array.isArray(rawCats)) {
          return cb(new Error('O servidor retornou uma lista de categorias inválida.'));
        }
        global.LuminaStorage.loadMeta('catalogState_' + listId, null, function (curState) {
          var state = curState || {
            listId: listId,
            type: 'xtream',
            generationId: genId,
            sections: {
              live: { status: 'empty', count: 0, updatedAt: 0 },
              movie: { status: 'empty', count: 0, updatedAt: 0 },
              series: { status: 'empty', count: 0, updatedAt: 0 }
            }
          };
          state.generationId = genId;
          state.sections[section] = state.sections[section] || {};
          state.sections[section].status = 'categories_ready';
          state.sections[section].groupsCount = rawCats.length;
          state.sections[section].updatedAt = Date.now();
          global.LuminaStorage.saveMeta('catalogState_' + listId, state, function () {
            saveXtreamCategoriesForSection(listId, genId, section, rawCats, cb);
          });
        });
      }
    );
  }

  // Parte 5.2, 5.3, 5.4 e 13.4c: Baixa e interpreta em fluxo (StreamJson) APENAS os streams da categoria selecionada!
  // Emite a 1ª página (onFirstPageReady) assim que os primeiros 200 itens chegam, mesmo em categorias de 50.000 itens!
  function ensureCategoryStreamsLoaded(listId, creds, section, groupId, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    var options = opts || {};
    var st = global.LuminaStorage;
    var ttlMs = getCategoryTtlMs();

    global.LuminaCatalog.getListState(listId, function (_, state) {
      var genId = (state && state.generationId) || ('xtgen_' + listId);
      var groupsKey = listId + ':' + genId + ':' + section;

      st.getRecord('groups', groupsKey, function (gErr, groupsRec) {
        if (gErr || !groupsRec || !Array.isArray(groupsRec.groups)) {
          return cb(new Error('Categorias ainda não carregadas para ' + section), null);
        }

        var targetGroup = null;
        for (var i = 0; i < groupsRec.groups.length; i++) {
          if (groupsRec.groups[i].id === groupId || groupsRec.groups[i].xtreamCategoryId === groupId) {
            targetGroup = groupsRec.groups[i];
            break;
          }
        }
        if (!targetGroup) {
          return cb(new Error('Categoria não encontrada: ' + groupId), null);
        }

        var now = Date.now();
        var isCached = (targetGroup.totalPages > 0) && (targetGroup.updatedAt > 0);
        var isFresh = isCached && ((now - targetGroup.updatedAt) < ttlMs);

        if (isFresh && !options.forceRefresh) {
          return global.LuminaCatalog.getPage(section, targetGroup.id, 'default', 0, cb, { listId: listId, source: { type: 'xtream', creds: creds } });
        }

        // Stale-while-revalidate (Parte 2.6 e 5.2): se já tem cache mas venceu, entrega o cache na hora e atualiza em 2º plano!
        if (isCached && !options.forceRefresh) {
          global.LuminaCatalog.getPage(section, targetGroup.id, 'default', 0, cb, { listId: listId, source: { type: 'xtream', creds: creds } });
          streamCategoryFromNetwork(listId, genId, creds, section, groupsRec, targetGroup, { priority: 'low' }, function () {
            global.LuminaCatalog.notifySubscribers(section, { type: 'category-revalidated', section: section, groupId: targetGroup.id });
          });
          return;
        }

        streamCategoryFromNetwork(listId, genId, creds, section, groupsRec, targetGroup, options, cb);
      });
    });
  }

  function streamCategoryFromNetwork(listId, genId, creds, section, groupsRec, targetGroup, options, cb) {
    var action = section === 'live'
      ? 'get_live_streams'
      : (section === 'movie' ? 'get_vod_streams' : 'get_series');
    var catId = targetGroup.xtreamCategoryId || targetGroup.id.replace('xtcat_' + section + '_', '');
    var url = buildApiUrl(creds, action, { category_id: catId });
    var timeoutMs = section === 'live' ? TIMEOUT_LIVE_MS : TIMEOUT_VOD_SERIES_MS;
    var liveExt = pickPreferredLiveExtension(global.LuminaStore ? global.LuminaStore.get('accountInfo') : null);

    var pageLines = [];
    var pageIdx = 0;
    var totalInCat = 0;
    var pendingBatch = [];
    var firstPageEmitted = false;
    var first40Ids = [];
    var packFn = global.LuminaImportWorker.packTupleLine;
    var normFn = global.LuminaImportWorker.normalizeSearchKey;
    var lexFn = global.LuminaImportWorker.computeLexFloat64Key;

    var catSortKeys = [];
    var catSortLocators = [];
    var catSearchBuckets = {};

    var parser = global.LuminaStreamJson.createParser({
      onItem: function (rawObj, idx) {
        var streamId = section === 'series' ? (rawObj.series_id || (idx + 1)) : (rawObj.stream_id || (idx + 1));
        var rawTitle = String(rawObj.name || rawObj.title || ('Item ' + streamId)).trim();
        var cleaned = global.LuminaClassifier.cleanTitleAndYear(rawTitle);
        var ext = section === 'live' ? liveExt : (rawObj.container_extension || 'mp4');
        var itemId = section === 'series'
          ? ('s:xt:series:' + streamId)
          : (section === 'movie' ? ('i:xt:movie:' + streamId) : ('i:xt:live:' + streamId));
        var ref = 'xt:' + section + ':' + streamId + ':' + ext;
        var logo = rawObj.stream_icon || rawObj.cover || '';
        var rating = parseFloat(rawObj.rating || rawObj.rating_5based || '8.0') || 8.0;
        var chNum = section === 'live' ? (parseInt(rawObj.num, 10) || (idx + 1)) : 0;
        var isAdult = targetGroup.adult || /(?:adulto|\+18|18\+|\bxxx\b)/i.test(rawTitle);

        var slotIdx = pageLines.length;
        var curPageIdx = pageIdx;
        var tuple = [
          itemId,
          section,
          rawTitle,
          cleaned.cleanTitle,
          cleaned.year || 2024,
          rating,
          targetGroup.id,
          targetGroup.originalName,
          logo,
          ref,
          global.LuminaClassifier ? 'HD' : 'HD',
          /legendado|\bleg\b/i.test(rawTitle + ' ' + targetGroup.originalName) ? 'LEG' : 'DUB',
          isAdult ? 1 : 0,
          null,
          null,
          chNum,
          0,
          '',
          '',
          section === 'series' ? String(streamId) : ''
        ];

        if (first40Ids.length < 40) first40Ids.push(itemId);

        var line = packFn(tuple);
        pageLines.push(line);
        totalInCat++;

        var loc = ((targetGroup.index & 0xFFF) << 20) | ((curPageIdx & 0xFFF) << 8) | (slotIdx & 0xFF);
        var normT = normFn(cleaned.cleanTitle);
        catSortKeys.push(lexFn(normT));
        catSortLocators.push(loc);

        if (normT) {
          var k1 = '^' + normT.charAt(0);
          if (!catSearchBuckets[k1]) catSearchBuckets[k1] = [];
          catSearchBuckets[k1].push(loc);
          var words = normT.split(' ');
          for (var w = 0; w < words.length && w < 6; w++) {
            if (words[w].length >= 2) {
              var p2 = words[w].slice(0, 2);
              if (!catSearchBuckets[p2]) catSearchBuckets[p2] = [];
              catSearchBuckets[p2].push(loc);
            }
          }
        }

        if (pageLines.length >= 200) {
          var payloadStr = pageLines.join('\n');
          var recKey = listId + ':' + genId + ':' + section + ':' + targetGroup.id + ':' + curPageIdx;
          var pageRec = {
            key: recKey,
            listId: listId,
            generationId: genId,
            section: section,
            groupId: targetGroup.id,
            pageIndex: curPageIdx,
            count: pageLines.length,
            checksum: global.LuminaStorage.computeStringChecksum(payloadStr),
            payloadStr: payloadStr
          };
          pendingBatch.push(pageRec);
          pageLines = [];
          pageIdx++;

          // Parte 5.3 e 13.4c: Emite a 1ª página imediatamente antes mesmo de terminar o download da categoria gigante!
          if (!firstPageEmitted) {
            firstPageEmitted = true;
            global.LuminaStorage.putRecord('pages', pageRec, function () {
              if (options.onFirstPageReady) {
                global.LuminaCatalog.getPage(section, targetGroup.id, 'default', 0, function (_, firstPageObj) {
                  options.onFirstPageReady(firstPageObj);
                }, { listId: listId, source: { type: 'xtream', creds: creds } });
              }
            });
          }
        }
      },
      onError: function (parseErr) {
        parserFailed = parseErr;
      }
    });

    var parserFailed = null;
    var host = extractHost(url);
    var currentUa = (host && hostUaMemory[host]) || 'VLC/3.0.20 LibVLC/3.0.20';

    function runStreamRequest() {
      return performRawRequest(
        url,
        { timeoutMs: timeoutMs, userAgent: currentUa },
        function onChunk(chunk) {
          parser.write(chunk);
        },
        function onDone(netErr, _fullBody, meta) {
          if (netErr) return finishWithError(netErr, meta);
          parser.end();
          if (parserFailed) {
            var pErr = new Error(parserFailed.humanMessage || 'JSON truncado ou inválido.');
            pErr.code = parserFailed.code || 'JSON_TRUNCATED';
            return finishWithError(pErr, meta);
          }

          if (pageLines.length > 0) {
            var payloadStr = pageLines.join('\n');
            pendingBatch.push({
              key: listId + ':' + genId + ':' + section + ':' + targetGroup.id + ':' + pageIdx,
              listId: listId,
              generationId: genId,
              section: section,
              groupId: targetGroup.id,
              pageIndex: pageIdx,
              count: pageLines.length,
              checksum: global.LuminaStorage.computeStringChecksum(payloadStr),
              payloadStr: payloadStr
            });
            pageLines = [];
            pageIdx++;
          }

          global.LuminaCatalog.clearMemoryCaches(section);
          global.LuminaStorage.putRecordsBatch('pages', pendingBatch, function (bErr) {
            if (bErr) return finishWithError(bErr, meta);

            // Salva índice A–Z da categoria
            var indices = new Uint32Array(catSortLocators.length);
            for (var i = 0; i < indices.length; i++) indices[i] = i;
            Array.prototype.sort.call(indices, function (a, b) {
              var ka = catSortKeys[a];
              var kb = catSortKeys[b];
              return ka < kb ? -1 : (ka > kb ? 1 : (catSortLocators[a] - catSortLocators[b]));
            });
            var azLocs = new Uint32Array(indices.length);
            var letterJump = {};
            var BASE9_POW8 = Math.pow(38, 8);
            for (var j = 0; j < indices.length; j++) {
              var oi = indices[j];
              azLocs[j] = catSortLocators[oi];
              var topDigit = Math.floor(catSortKeys[oi] / BASE9_POW8) % 38;
              var letter = (topDigit >= 12 && topDigit <= 37) ? String.fromCharCode(65 + (topDigit - 12)) : '#';
              if (letterJump[letter] === undefined) letterJump[letter] = j;
            }

            global.LuminaStorage.putRecord('orders', {
              key: listId + ':' + genId + ':' + section + ':' + targetGroup.id + ':az',
              listId: listId,
              generationId: genId,
              section: section,
              groupId: targetGroup.id,
              locators: azLocs,
              letterJump: letterJump
            }, function () {
              // Salva buckets de busca da categoria (run por índice do grupo)
              var searchRecs = [];
              var bKeys = Object.keys(catSearchBuckets);
              for (var bk = 0; bk < bKeys.length; bk++) {
                var bName = bKeys[bk];
                searchRecs.push({
                  key: listId + ':' + genId + ':' + section + ':run:' + targetGroup.index + ':' + bName,
                  listId: listId,
                  generationId: genId,
                  section: section,
                  bucket: bName,
                  postings: new Uint32Array(catSearchBuckets[bName])
                });
              }

              global.LuminaStorage.putRecordsBatch('searchIndex', searchRecs, function () {
                targetGroup.count = totalInCat;
                targetGroup.totalPages = pageIdx;
                targetGroup.updatedAt = Date.now();
                targetGroup.first40Ids = first40Ids;

                var secTotal = 0;
                for (var g = 0; g < groupsRec.groups.length; g++) {
                  secTotal += (groupsRec.groups[g].count || 0);
                }
                groupsRec.totalItems = secTotal;
                groupsRec.searchRunsCount = Math.max(groupsRec.searchRunsCount || 0, groupsRec.groups.length);

                global.LuminaStorage.putRecord('groups', groupsRec, function () {
                  global.LuminaCatalog.getPage(section, targetGroup.id, 'default', 0, function (pErr, page0) {
                    if (page0) page0.first40Ids = first40Ids;
                    cb(pErr, page0);
                  }, { listId: listId, source: { type: 'xtream', creds: creds } });
                });
              });
            });
          });
        }
      );
    }

    function finishWithError(err, meta) {
      cb(err, null, meta);
    }

    if (global.LuminaNetQueue && !options.bypassQueue) {
      global.LuminaNetQueue.enqueue({
        tag: options.tag || ('tab_' + section),
        priority: options.priority || 'high',
        url: url,
        executor: function (doneQueueCb) {
          var origCb = cb;
          cb = function (e, r, m) {
            cb = origCb;
            doneQueueCb(e, r, m);
          };
          return runStreamRequest();
        }
      }, cb);
    } else {
      runStreamRequest();
    }
  }

  // Parte 8.5 e 13.4f: Indexação progressiva em segundo plano para busca "Em todos" no Xtream, com resultados parciais e retomada!
  function indexXtreamSectionProgressively(listId, creds, section, query, callbacks) {
    var cbs = callbacks || {};
    var key = listId + ':' + section;
    if (activeSearchIndexers[key]) {
      activeSearchIndexers[key].cancelled = true;
    }
    var state = { cancelled: false };
    activeSearchIndexers[key] = state;

    global.LuminaCatalog.getListState(listId, function (_, listState) {
      var genId = (listState && listState.generationId) || ('xtgen_' + listId);
      var groupsKey = listId + ':' + genId + ':' + section;

      global.LuminaStorage.getRecord('groups', groupsKey, function (gErr, groupsRec) {
        if (gErr || !groupsRec || !Array.isArray(groupsRec.groups)) {
          if (cbs.onDone) cbs.onDone(new Error('Categorias não disponíveis.'));
          return;
        }

        var groups = groupsRec.groups;
        var totalCats = groups.length;
        var idx = 0;

        function nextCategory() {
          if (state.cancelled) return;
          // Pula categorias já indexadas (permite retomar de onde parou! Parte 8.5)
          while (idx < totalCats && groups[idx].updatedAt > 0) {
            idx++;
          }
          if (idx >= totalCats) {
            // Marca a seção como 'ready' (totalmente indexada -> habilita "Todos" na coluna de categorias, Parte 5.7)
            if (listState && listState.sections && listState.sections[section]) {
              listState.sections[section].status = 'ready';
              listState.sections[section].searchRuns = totalCats;
              listState.sections[section].count = groupsRec.totalItems || 0;
              global.LuminaStorage.saveMeta('catalogState_' + listId, listState, function () {
                if (cbs.onDone) cbs.onDone(null, { completed: true, indexedCategories: totalCats, totalCategories: totalCats });
              });
            } else if (cbs.onDone) {
              cbs.onDone(null, { completed: true, indexedCategories: totalCats, totalCategories: totalCats });
            }
            return;
          }

          var grp = groups[idx++];
          ensureCategoryStreamsLoaded(
            listId,
            creds,
            section,
            grp.id,
            { priority: 'low', tag: 'search_index_' + section },
            function () {
              if (state.cancelled) return;
              if (cbs.onProgress) {
                cbs.onProgress({ indexedCategories: idx, totalCategories: totalCats });
              }
              if (query && cbs.onPartialResults) {
                global.LuminaCatalog.search(section, query, { listId: listId, scope: 'all', source: { type: 'xtream', creds: creds } }, function (_, searchRes) {
                  if (searchRes) {
                    searchRes.partial = idx < totalCats;
                    searchRes.indexingProgress = { current: idx, total: totalCats };
                    cbs.onPartialResults(searchRes);
                  }
                  setTimeout(nextCategory, 5);
                });
              } else {
                setTimeout(nextCategory, 5);
              }
            }
          );
        }

        nextCategory();
      });
    });

    return {
      cancel: function () {
        state.cancelled = true;
        if (global.LuminaNetQueue) global.LuminaNetQueue.abortByTag('search_index_' + section);
      }
    };
  }

  // Helpers mantidos para compatibilidade com xtream-search.test.js
  function mapCategoriesToById(list) {
    var map = {};
    if (!Array.isArray(list)) return map;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c && c.category_id != null) {
        map[String(c.category_id)] = String(c.category_name || 'Geral').trim();
      }
    }
    return map;
  }

  function convertXtreamPayloadToRawItems(creds, payload) {
    var p = payload || {};
    var base = normalizeBaseUrl((creds && creds.server) || 'http://localhost');
    var user = encodeURIComponent((creds && creds.username) || 'user');
    var pass = encodeURIComponent((creds && creds.password) || 'pass');
    var liveCatMap = mapCategoriesToById(p.liveCategories || []);
    var vodCatMap = mapCategoriesToById(p.vodCategories || []);
    var seriesCatMap = mapCategoriesToById(p.seriesCategories || []);
    var lives = p.liveStreams || [];
    var vods = p.vodStreams || [];
    var seriesArr = p.seriesStreams || [];
    var out = [];
    var now = Date.now();

    for (var i = 0; i < lives.length; i++) {
      var l = lives[i];
      var sid = l.stream_id || (i + 1);
      out.push({
        id: 'xt_live_' + sid,
        title: l.name || ('Canal ' + sid),
        groupTitle: liveCatMap[String(l.category_id)] || 'Canais',
        tvgLogo: l.stream_icon || '',
        tvgId: l.epg_channel_id || '',
        url: base + '/live/' + user + '/' + pass + '/' + sid + '.m3u8',
        addedAt: now - i,
        sourceId: 'xtream',
        forcedKind: 'live',
        xtreamKind: 'live'
      });
    }

    for (var j = 0; j < vods.length; j++) {
      var v = vods[j];
      var vid = v.stream_id || (j + 1);
      var ext = v.container_extension || 'mp4';
      out.push({
        id: 'xt_vod_' + vid,
        title: v.name || ('Filme ' + vid),
        groupTitle: vodCatMap[String(v.category_id)] || 'Filmes',
        tvgLogo: v.stream_icon || v.cover || '',
        tvgRating: parseFloat(v.rating || '0') || 0,
        url: base + '/movie/' + user + '/' + pass + '/' + vid + '.' + ext,
        addedAt: now - j,
        sourceId: 'xtream',
        forcedKind: 'movie',
        xtreamKind: 'movie'
      });
    }

    for (var k = 0; k < seriesArr.length; k++) {
      var s = seriesArr[k];
      var serId = s.series_id || (k + 1);
      var sCat = seriesCatMap[String(s.category_id)] || 'Séries';
      if (Array.isArray(s.episodes) && s.episodes.length) {
        for (var eIdx = 0; eIdx < s.episodes.length; eIdx++) {
          var ep = s.episodes[eIdx];
          var epId = ep.id || (serId + '_' + (eIdx + 1));
          var epExt = ep.container_extension || 'mp4';
          out.push({
            id: 'xt_ep_' + epId,
            title: ep.title || (s.name + ' S01E0' + (eIdx + 1)),
            groupTitle: sCat,
            tvgLogo: s.cover || '',
            tvgRating: parseFloat(s.rating || '0') || 0,
            url: base + '/series/' + user + '/' + pass + '/' + epId + '.' + epExt,
            addedAt: now - k,
            sourceId: 'xtream',
            forcedKind: 'series',
            xtreamKind: 'episode'
          });
        }
      } else {
        out.push({
          id: 'xt_ser_' + serId,
          title: s.name || ('Série ' + serId),
          groupTitle: sCat,
          tvgLogo: s.cover || '',
          tvgRating: parseFloat(s.rating || '0') || 0,
          url: '',
          addedAt: now - k,
          sourceId: 'xtream',
          forcedKind: 'series',
          xtreamKind: 'series-show',
          xtreamSeriesId: String(serId),
          needsSeriesInfo: true
        });
      }
    }
    return out;
  }

  function hydrateShowFromEpisodesMap(creds, showItem, infoData) {
    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username || '');
    var pass = encodeURIComponent(creds.password || '');
    var episodesBySeason = (infoData && infoData.episodes) || {};
    var infoMeta = (infoData && infoData.info) || {};
    if (infoMeta.plot && !showItem.synopsis) showItem.synopsis = infoMeta.plot;
    if (infoMeta.cover && !showItem.logo) showItem.logo = infoMeta.cover;

    var seasonKeys = Object.keys(episodesBySeason).sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });

    var seasons = [];
    var totalEps = 0;

    for (var i = 0; i < seasonKeys.length; i++) {
      var sKey = seasonKeys[i];
      var sNum = parseInt(sKey, 10) || (i + 1);
      var rawEps = episodesBySeason[sKey] || [];
      var epsOut = [];

      for (var j = 0; j < rawEps.length; j++) {
        var ep = rawEps[j];
        var epId = ep.id || (showItem.xtreamSeriesId + '_' + sNum + '_' + (j + 1));
        var ext = ep.container_extension || 'mp4';
        var epNum = parseInt(ep.episode_num || (j + 1), 10) || (j + 1);
        var epObj = {
          id: 'xt_ep_' + epId,
          kind: 'episode',
          isNovela: !!showItem.isNovela,
          title: ep.title || ('Episódio ' + epNum),
          cleanTitle: ep.title || ('Episódio ' + epNum),
          seriesTitle: showItem.cleanTitle,
          seriesKey: showItem.seriesKey,
          season: sNum,
          episode: epNum,
          logo: (ep.info && ep.info.movie_image) || showItem.logo || '',
          synopsis: (ep.info && ep.info.plot) || showItem.synopsis || '',
          durationSecs: (ep.info && ep.info.duration_secs) ? Number(ep.info.duration_secs) : 2700,
          groupOriginal: showItem.groupOriginal,
          groupDisplay: showItem.groupDisplay,
          quality: 'HD',
          lang: showItem.lang || 'DUB',
          ref: 'xt:series:' + epId + ':' + ext,
          url: base + '/series/' + user + '/' + pass + '/' + epId + '.' + ext
        };
        epsOut.push(epObj);
        totalEps++;
      }

      if (epsOut.length) {
        seasons.push({ seasonNumber: sNum, episodes: epsOut });
      }
    }

    showItem.seasons = seasons;
    showItem.totalEpisodes = totalEps;
    showItem.needsSeriesInfo = false;
    return showItem;
  }

  function convertSeriesInfoResponse(creds, showItem, infoData) {
    return hydrateShowFromEpisodesMap(creds, showItem, infoData);
  }

  function fetchSeriesInfo(creds, showItem, callback) {
    if (!showItem || !showItem.xtreamSeriesId) {
      return callback(new Error('Série sem identificador Xtream.'));
    }
    var serId = String(showItem.xtreamSeriesId);

    global.LuminaStorage.loadSeriesDetail(serId, function (_, cached) {
      var now = Date.now();
      if (cached && cached.data && (now - (cached.updatedAt || 0) < SERIES_TTL_MS)) {
        hydrateShowFromEpisodesMap(creds, showItem, cached.data);
        return callback(null, showItem);
      }

      if (!creds || !creds.server) {
        if (cached && cached.data) {
          hydrateShowFromEpisodesMap(creds || {}, showItem, cached.data);
          return callback(null, showItem);
        }
        return callback(new Error('Credenciais Xtream ausentes para buscar episódios.'));
      }

      var url = buildApiUrl(creds, 'get_series_info', { series_id: serId });
      requestJsonWithRetry(url, { timeoutMs: TIMEOUT_SMALL_API_MS, priority: 'high' }, function (err, data) {
        if (err || !data) {
          if (cached && cached.data) {
            hydrateShowFromEpisodesMap(creds, showItem, cached.data);
            return callback(null, showItem);
          }
          return callback(err || new Error('Não foi possível carregar os episódios desta série.'));
        }
        global.LuminaStorage.saveSeriesDetail(serId, data);
        hydrateShowFromEpisodesMap(creds, showItem, data);
        callback(null, showItem);
      });
    });
  }

  function normalizeSearchTerm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function searchCatalog(query, state) {
    var q = normalizeSearchTerm(query);
    if (!q) return { channels: [], movies: [], series: [], novelas: [], total: 0 };

    function filterArr(arr, max) {
      var res = [];
      if (!arr) return res;
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        var hay = normalizeSearchTerm((it.cleanTitle || '') + ' ' + (it.groupDisplay || ''));
        if (hay.indexOf(q) !== -1) {
          res.push(it);
          if (res.length >= max) break;
        }
      }
      return res;
    }

    var ch = filterArr(state.channels, 20);
    var mv = filterArr(state.movies, 20);
    var sr = filterArr(state.seriesList, 20);
    var nv = filterArr(state['novelas' + 'List'], 20);
    return {
      channels: ch,
      movies: mv,
      series: sr,
      novelas: nv,
      total: ch.length + mv.length + sr.length + nv.length
    };
  }

  var api = {
    TIMEOUT_SMALL_API_MS: TIMEOUT_SMALL_API_MS,
    TIMEOUT_LIVE_MS: TIMEOUT_LIVE_MS,
    TIMEOUT_VOD_SERIES_MS: TIMEOUT_VOD_SERIES_MS,
    SERIES_TTL_MS: SERIES_TTL_MS,
    DEFAULT_CATEGORY_TTL_MS: DEFAULT_CATEGORY_TTL_MS,
    normalizeBaseUrl: normalizeBaseUrl,
    parseAccountInfo: parseAccountInfo,
    authenticateAndCheckAccount: authenticateAndCheckAccount,
    pickPreferredLiveExtension: pickPreferredLiveExtension,
    connectXtreamAndLoadCategories: connectXtreamAndLoadCategories,
    ensureSectionCategoriesLoaded: ensureSectionCategoriesLoaded,
    ensureCategoryStreamsLoaded: ensureCategoryStreamsLoaded,
    indexXtreamSectionProgressively: indexXtreamSectionProgressively,
    convertXtreamPayloadToRawItems: convertXtreamPayloadToRawItems,
    convertSeriesInfoResponse: convertSeriesInfoResponse,
    fetchSeriesInfo: fetchSeriesInfo,
    searchCatalog: searchCatalog,
    requestJsonWithRetry: requestJsonWithRetry,
    setCustomRequestHandlerForTests: function (fn) { customRequestHandler = fn; },
    clearHostUaMemoryForTests: function () { hostUaMemory = {}; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaXtream = api;
})(typeof window !== 'undefined' ? window : global);
