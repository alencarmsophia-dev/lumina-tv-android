(function (global) {
  'use strict';

  var TIMEOUT_SMALL_API_MS = 25000;   // 25s para autenticação e categorias (Seção C5)
  var TIMEOUT_LIVE_MS = 60000;        // 60s para get_live_streams
  var TIMEOUT_VOD_SERIES_MS = 90000;  // 90s para get_vod_streams e get_series
  var RETRY_DELAYS_MS = [1500, 3000]; // Até 2 retries automáticos com backoff (1.5s, 3s)
  var SERIES_TTL_MS = 6 * 3600 * 1000; // 6 horas

  function normalizeBaseUrl(server) {
    var s = String(server || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
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

  function buildNetworkError(status, proxyErrType, rawMsg, url) {
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
      err = new Error('Usuário ou senha incorretos. Confira os dados com seu fornecedor.');
      err.code = 'AUTH_INVALID';
    } else if (status === 404) {
      err = new Error('Este servidor não parece ser compatível com Xtream Codes (erro 404 em player_api.php).');
      err.code = 'NOT_XTREAM_404';
    } else {
      err = new Error(rawMsg || ('Falha ao conectar ao servidor (HTTP ' + (status || 0) + ').'));
      err.code = 'NETWORK_ERROR';
    }
    err.httpStatus = status || 0;
    err.proxyError = proxyErrType || '';
    err.url = url || '';
    return err;
  }

  function xhrJsonWithRetry(url, timeoutMs, cb, cancelToken, onProgress) {
    var maxRetries = RETRY_DELAYS_MS.length;
    var attempt = 0;

    function runAttempt() {
      if (cancelToken && cancelToken.cancelled) {
        return cb(new Error('Operação cancelada pelo usuário.'), null);
      }
      if (typeof XMLHttpRequest === 'undefined') {
        return cb(new Error('XMLHttpRequest indisponível neste ambiente.'), null);
      }

      var startMs = Date.now();
      var xhr = new XMLHttpRequest();
      if (cancelToken) cancelToken.activeXhr = xhr;

      try {
        xhr.open('GET', url, true);
        xhr.timeout = timeoutMs || TIMEOUT_SMALL_API_MS;
      } catch (e) {
        return cb(e, null);
      }

      xhr.onprogress = function (ev) {
        if (onProgress && ev && ev.loaded > 0) {
          var mb = (ev.loaded / 1048576).toFixed(1);
          onProgress({ loadedBytes: ev.loaded, loadedMb: mb });
        }
      };

      function shouldRetry(status, proxyErr) {
        if (cancelToken && cancelToken.cancelled) return false;
        if (attempt >= maxRetries) return false;
        if (status === 401 || status === 403 || status === 404) return false;
        if (proxyErr === 'SSL' || proxyErr === 'DNS') return false;
        return true;
      }

      function retryOrFail(errObj) {
        if (shouldRetry(errObj.httpStatus, errObj.proxyError)) {
          var delay = RETRY_DELAYS_MS[attempt];
          attempt++;
          if (onProgress) {
            onProgress({ retrying: true, attempt: attempt, maxRetries: maxRetries });
          }
          setTimeout(runAttempt, delay);
          return;
        }
        if (global.LuminaDiagLog) {
          global.LuminaDiagLog.record('list-load', {
            engine: 'XtreamClient',
            url: url,
            httpStatus: errObj.httpStatus || 0,
            code: errObj.code || 'ERROR',
            elapsedMs: Date.now() - startMs,
            message: errObj.message
          });
        }
        cb(errObj, null);
      }

      xhr.onload = function () {
        if (cancelToken && cancelToken.cancelled) {
          return cb(new Error('Operação cancelada pelo usuário.'), null);
        }
        var proxyHeader = '';
        try { proxyHeader = xhr.getResponseHeader('X-Lumina-Proxy-Error') || ''; } catch (e) {}

        if (xhr.status === 502 && proxyHeader) {
          var pJson = null;
          try { pJson = JSON.parse(xhr.responseText); } catch (e) {}
          var pMsg = (pJson && pJson.message) || '';
          return retryOrFail(buildNetworkError(502, proxyHeader, pMsg, url));
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText);
            return cb(null, data);
          } catch (err) {
            var rawTrim = String(xhr.responseText || '').trim();
            if (/^<!DOCTYPE\s+html|^<html/i.test(rawTrim)) {
              var htmlErr = new Error('O servidor retornou uma página HTML em vez de dados JSON da lista.');
              htmlErr.code = 'HTML_RESPONSE';
              htmlErr.httpStatus = xhr.status;
              return cb(htmlErr, null);
            }
            return cb(new Error('O servidor enviou uma resposta JSON inválida ou incompleta.'), null);
          }
        }
        retryOrFail(buildNetworkError(xhr.status, proxyHeader, 'Erro HTTP ' + xhr.status + ' no painel Xtream.', url));
      };

      xhr.onerror = function () {
        retryOrFail(buildNetworkError(0, 'CONNECT', 'Falha de rede ao conectar ao servidor da lista.', url));
      };

      xhr.ontimeout = function () {
        retryOrFail(buildNetworkError(0, 'TIMEOUT', 'Tempo limite esgotado ao aguardar o servidor da lista.', url));
      };

      xhr.send();
    }

    runAttempt();
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
      isExpiringSoon: isExpiringSoon,
      daysRemaining: daysRemaining,
      isExpired: !!isExpired,
      isDisabled: !!isDisabled,
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

  // Valida autenticação e estado da conta Xtream com mensagens humanas claras (Seção B5)
  function authenticateAndCheckAccount(creds, cb, cancelToken) {
    if (!creds || !creds.server || !creds.username || !creds.password) {
      return cb(new Error('Credenciais Xtream incompletas.'), null);
    }
    xhrJsonWithRetry(buildApiUrl(creds, ''), TIMEOUT_SMALL_API_MS, function (err, data) {
      if (err) return cb(err, null);
      if (!data || typeof data !== 'object' || (!data.user_info && !data.server_info)) {
        var invalidPanelErr = new Error('Este endereço não respondeu como um painel Xtream Codes válido.');
        invalidPanelErr.code = 'INVALID_XTREAM_PANEL';
        return cb(invalidPanelErr, null);
      }

      var acc = parseAccountInfo(data);
      if (!acc.isAuthenticated) {
        var authErr = new Error('Usuário ou senha incorretos. Confira os dados com seu fornecedor.');
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
    }, cancelToken);
  }

  function pickPreferredLiveExtension(accountInfo, preferFormat) {
    var pref = preferFormat || (global.LuminaStore && global.LuminaStore.get('preferOutputFormat')) || 'auto';
    var allowed = (accountInfo && accountInfo.allowedOutputFormats) || ['m3u8', 'ts'];
    var hasM3u8 = allowed.indexOf('m3u8') !== -1;
    var hasTs = allowed.indexOf('ts') !== -1;

    if (pref === 'ts' && hasTs) return 'ts';
    if (pref === 'm3u8' && hasM3u8) return 'm3u8';
    // Em 'auto', prefere m3u8 quando disponível (melhor compatibilidade em ExoPlayer e HLS.js)
    if (hasM3u8) return 'm3u8';
    if (hasTs) return 'ts';
    return 'm3u8';
  }

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

  // Fallback por categoria quando get_vod_streams ou get_series inteiro falha por tamanho/timeout (Seção B5)
  function fetchStreamsByCategoryFallback(creds, actionName, catList, cancelToken, onProgress, doneCb) {
    if (!Array.isArray(catList) || !catList.length) {
      return doneCb([]);
    }
    var maxCats = Math.min(catList.length, 30);
    var combined = [];
    var idx = 0;

    function nextCat() {
      if (cancelToken && cancelToken.cancelled) return doneCb(combined);
      if (idx >= maxCats) return doneCb(combined);
      var cat = catList[idx++];
      var catId = cat && cat.category_id;
      if (catId == null) return nextCat();

      xhrJsonWithRetry(
        buildApiUrl(creds, actionName, { category_id: String(catId) }),
        TIMEOUT_SMALL_API_MS,
        function (_err, arr) {
          if (Array.isArray(arr)) {
            for (var i = 0; i < arr.length; i++) combined.push(arr[i]);
          }
          if (onProgress) {
            onProgress({ catIdx: idx, catTotal: maxCats, count: combined.length });
          }
          setTimeout(nextCat, 0);
        },
        cancelToken
      );
    }
    nextCat();
  }

  function fetchCompleteCatalog(creds, onProgress, callback, cancelToken) {
    if (!creds || !creds.server || !creds.username || !creds.password) {
      return callback(new Error('Credenciais Xtream incompletas.'), null);
    }

    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username);
    var pass = encodeURIComponent(creds.password);

    if (onProgress) onProgress({ stage: '2/4 \u00B7 Conectando ao servidor\u2026', percent: 8 });

    authenticateAndCheckAccount(creds, function (authErr, accountInfo) {
      if (authErr) return callback(authErr, null);

      if (global.LuminaStore) global.LuminaStore.set('accountInfo', accountInfo);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('accountInfo', accountInfo);
      if (accountInfo.connLimitWarning && global.LuminaUI && global.LuminaUI.toast) {
        global.LuminaUI.toast(accountInfo.connLimitWarning);
      }

      var liveExt = pickPreferredLiveExtension(accountInfo);

      if (onProgress) onProgress({ stage: '2/4 \u00B7 Carregando categorias\u2026', percent: 18 });
      xhrJsonWithRetry(buildApiUrl(creds, 'get_live_categories'), TIMEOUT_SMALL_API_MS, function (_, liveCats) {
        var liveCatMap = mapCategoriesToById(liveCats);

        xhrJsonWithRetry(buildApiUrl(creds, 'get_vod_categories'), TIMEOUT_SMALL_API_MS, function (_, vodCats) {
          var vodCatMap = mapCategoriesToById(vodCats);

          xhrJsonWithRetry(buildApiUrl(creds, 'get_series_categories'), TIMEOUT_SMALL_API_MS, function (_, seriesCats) {
            var seriesCatMap = mapCategoriesToById(seriesCats);

            if (onProgress) onProgress({ stage: '3/4 \u00B7 Baixando canais ao vivo\u2026', percent: 32 });
            xhrJsonWithRetry(buildApiUrl(creds, 'get_live_streams'), TIMEOUT_LIVE_MS, function (liveErr, liveStreams) {
              var lives = (!liveErr && Array.isArray(liveStreams)) ? liveStreams : [];

              if (onProgress) {
                onProgress({
                  stage: '3/4 \u00B7 Canais: ' + lives.length + ' \u00B7 Baixando filmes\u2026',
                  percent: 54
                });
              }

              xhrJsonWithRetry(buildApiUrl(creds, 'get_vod_streams'), TIMEOUT_VOD_SERIES_MS, function (vodErr, vodStreams) {
                function afterVods(vods) {
                  if (onProgress) {
                    onProgress({
                      stage: '3/4 \u00B7 Canais: ' + lives.length + ' \u00B7 Filmes: ' + vods.length + ' \u00B7 Baixando séries\u2026',
                      percent: 76
                    });
                  }

                  xhrJsonWithRetry(buildApiUrl(creds, 'get_series'), TIMEOUT_VOD_SERIES_MS, function (serErr, seriesStreams) {
                    function afterSeries(seriesArr) {
                      if (!lives.length && !vods.length && !seriesArr.length) {
                        return callback(new Error('Nenhum canal, filme ou série retornado pelo servidor Xtream.'), null);
                      }

                      if (onProgress) {
                        onProgress({
                          stage: '3/4 \u00B7 Canais: ' + lives.length + ' \u00B7 Filmes: ' + vods.length + ' \u00B7 Séries: ' + seriesArr.length,
                          percent: 90
                        });
                      }

                      var rawItems = [];
                      var now = Date.now();

                      for (var i = 0; i < lives.length; i++) {
                        var l = lives[i];
                        var streamId = l.stream_id || (i + 1);
                        var catName = liveCatMap[String(l.category_id)] || 'Canais Ao Vivo';
                        rawItems.push(global.LuminaClassifier.classifyEntry({
                          id: 'xt_live_' + streamId,
                          title: l.name || ('Canal ' + streamId),
                          groupTitle: catName,
                          tvgLogo: l.stream_icon || '',
                          tvgId: l.epg_channel_id || '',
                          url: base + '/live/' + user + '/' + pass + '/' + streamId + '.' + liveExt,
                          addedAt: l.added ? Number(l.added) * 1000 : (now - i),
                          sourceId: 'xtream',
                          forcedKind: 'live'
                        }));
                      }

                      for (var j = 0; j < vods.length; j++) {
                        var v = vods[j];
                        var vodId = v.stream_id || (j + 1);
                        var ext = v.container_extension || 'mp4';
                        var vCatName = vodCatMap[String(v.category_id)] || 'Filmes';
                        var ratingNum = parseFloat(v.rating || v.rating_5based || '0') || 0;
                        rawItems.push(global.LuminaClassifier.classifyEntry({
                          id: 'xt_vod_' + vodId,
                          title: v.name || ('Filme ' + vodId),
                          groupTitle: vCatName,
                          tvgLogo: v.stream_icon || v.cover || '',
                          tvgRating: ratingNum,
                          url: base + '/movie/' + user + '/' + pass + '/' + vodId + '.' + ext,
                          addedAt: v.added ? Number(v.added) * 1000 : (now - j),
                          sourceId: 'xtream',
                          forcedKind: 'movie'
                        }));
                      }

                      for (var k = 0; k < seriesArr.length; k++) {
                        var s = seriesArr[k];
                        var serId = s.series_id || (k + 1);
                        var sCatName = seriesCatMap[String(s.category_id)] || 'Séries';
                        var sRating = parseFloat(s.rating || s.rating_5based || '0') || 0;
                        var classified = global.LuminaClassifier.classifyEntry({
                          id: 'xt_ser_' + serId,
                          title: s.name || ('Série ' + serId),
                          groupTitle: sCatName,
                          tvgLogo: s.cover || '',
                          tvgRating: sRating,
                          url: '',
                          addedAt: s.last_modified ? Number(s.last_modified) * 1000 : (now - k),
                          sourceId: 'xtream',
                          forcedKind: 'series',
                          xtreamSeriesId: String(serId),
                          needsSeriesInfo: true,
                          synopsis: s.plot || ''
                        });
                        rawItems.push(classified);
                      }

                      if (global.LuminaDiagLog) {
                        global.LuminaDiagLog.record('list-load', {
                          engine: 'XtreamClient',
                          url: base,
                          httpStatus: 200,
                          code: 'OK',
                          elapsedMs: Date.now() - now,
                          message: 'Xtream carregado: ' + lives.length + ' canais, ' + vods.length + ' filmes, ' + seriesArr.length + ' séries'
                        });
                      }

                      callback(null, rawItems, {
                        accountInfo: accountInfo,
                        counts: {
                          channels: lives.length,
                          movies: vods.length,
                          series: seriesArr.length
                        }
                      });
                    }

                    if (!serErr && Array.isArray(seriesStreams)) {
                      afterSeries(seriesStreams);
                    } else if (Array.isArray(seriesCats) && seriesCats.length) {
                      fetchStreamsByCategoryFallback(creds, 'get_series', seriesCats, cancelToken, function (p) {
                        if (onProgress) {
                          onProgress({
                            stage: '3/4 \u00B7 Baixando séries por categoria (' + p.catIdx + '/' + p.catTotal + ')\u2026',
                            percent: 82
                          });
                        }
                      }, afterSeries);
                    } else {
                      afterSeries([]);
                    }
                  }, cancelToken, function (prog) {
                    if (onProgress && prog && prog.loadedMb) {
                      onProgress({ stage: '3/4 \u00B7 Baixando séries (' + prog.loadedMb + ' MB)\u2026', percent: 80 });
                    }
                  });
                }

                if (!vodErr && Array.isArray(vodStreams)) {
                  afterVods(vodStreams);
                } else if (Array.isArray(vodCats) && vodCats.length) {
                  fetchStreamsByCategoryFallback(creds, 'get_vod_streams', vodCats, cancelToken, function (p) {
                    if (onProgress) {
                      onProgress({
                        stage: '3/4 \u00B7 Baixando filmes por categoria (' + p.catIdx + '/' + p.catTotal + ')\u2026',
                        percent: 62
                      });
                    }
                  }, afterVods);
                } else {
                  afterVods([]);
                }
              }, cancelToken, function (prog) {
                if (onProgress && prog && prog.loadedMb) {
                  onProgress({ stage: '3/4 \u00B7 Baixando filmes (' + prog.loadedMb + ' MB)\u2026', percent: 60 });
                }
              });
            }, cancelToken, function (prog) {
              if (onProgress && prog && prog.loadedMb) {
                onProgress({ stage: '3/4 \u00B7 Baixando canais (' + prog.loadedMb + ' MB)\u2026', percent: 40 });
              }
            });
          }, cancelToken);
        }, cancelToken);
      }, cancelToken);
    }, cancelToken);
  }

  function hydrateShowFromEpisodesMap(creds, showItem, infoData) {
    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username);
    var pass = encodeURIComponent(creds.password);
    var episodesBySeason = (infoData && infoData.episodes) || {};
    var infoMeta = (infoData && infoData.info) || {};
    if (infoMeta.plot && !showItem.synopsis) showItem.synopsis = infoMeta.plot;
    if (infoMeta.cover && !showItem.logo) showItem.logo = infoMeta.cover;

    var seasonKeys = Object.keys(episodesBySeason).sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });

    var seasons = [];
    var totalEps = 0;
    var itemByIdMap = (global.LuminaStore && global.LuminaStore.get('itemByIdMap')) || {};

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
          url: base + '/series/' + user + '/' + pass + '/' + epId + '.' + ext
        };
        epsOut.push(epObj);
        itemByIdMap[epObj.id] = epObj;
        totalEps++;
      }

      if (epsOut.length) {
        seasons.push({ seasonNumber: sNum, episodes: epsOut });
      }
    }

    showItem.seasons = seasons;
    showItem.totalEpisodes = totalEps;
    showItem.needsSeriesInfo = false;
    if (global.LuminaStore) global.LuminaStore.set('itemByIdMap', itemByIdMap);
    return showItem;
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
      xhrJsonWithRetry(url, TIMEOUT_SMALL_API_MS, function (err, data) {
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
    var nv = filterArr(state.novelasList, 20);
    return {
      channels: ch,
      movies: mv,
      series: sr,
      novelas: nv,
      total: ch.length + mv.length + sr.length + nv.length
    };
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

  function convertSeriesInfoResponse(creds, showItem, infoData) {
    return hydrateShowFromEpisodesMap(creds, showItem, infoData);
  }

  var api = {
    TIMEOUT_SMALL_API_MS: TIMEOUT_SMALL_API_MS,
    convertXtreamPayloadToRawItems: convertXtreamPayloadToRawItems,
    convertSeriesInfoResponse: convertSeriesInfoResponse,
    TIMEOUT_LIVE_MS: TIMEOUT_LIVE_MS,
    TIMEOUT_VOD_SERIES_MS: TIMEOUT_VOD_SERIES_MS,
    SERIES_TTL_MS: SERIES_TTL_MS,
    normalizeBaseUrl: normalizeBaseUrl,
    parseAccountInfo: parseAccountInfo,
    authenticateAndCheckAccount: authenticateAndCheckAccount,
    pickPreferredLiveExtension: pickPreferredLiveExtension,
    fetchCompleteCatalog: fetchCompleteCatalog,
    fetchSeriesInfo: fetchSeriesInfo,
    searchCatalog: searchCatalog
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaXtream = api;
})(typeof window !== 'undefined' ? window : global);
