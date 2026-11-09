(function (global) {
  'use strict';

  var M3U_DOWNLOAD_TIMEOUT_MS = 180000; // 180s para listas M3U grandes (Seção C5)
  var M3U_RETRY_DELAYS_MS = [1500, 3000];
  var activeCancelToken = null;

  function createCancelToken() {
    if (activeCancelToken) {
      activeCancelToken.cancelled = true;
      if (activeCancelToken.activeXhr) {
        try { activeCancelToken.activeXhr.abort(); } catch (e) {}
      }
    }
    activeCancelToken = { cancelled: false, activeXhr: null };
    return activeCancelToken;
  }

  function cancelActiveLoad() {
    if (activeCancelToken) {
      activeCancelToken.cancelled = true;
      if (activeCancelToken.activeXhr) {
        try { activeCancelToken.activeXhr.abort(); } catch (e) {}
      }
      activeCancelToken = null;
      return true;
    }
    return false;
  }

  function buildCategoryCounts(items, allLabel) {
    var counts = {};
    var order = [];
    for (var i = 0; i < items.length; i++) {
      var g = items[i].groupDisplay || items[i].groupOriginal || 'Geral';
      if (!counts[g]) {
        counts[g] = 0;
        order.push(g);
      }
      counts[g]++;
    }
    var out = [{ name: allLabel, count: items.length }];
    for (var j = 0; j < order.length; j++) {
      out.push({ name: order[j], count: counts[order[j]] });
    }
    return out;
  }

  function computeCatalogDiff(prevRaw, nextRaw) {
    var prevIds = {};
    var prevCounts = { live: 0, movie: 0, series: 0 };
    var nextCounts = { live: 0, movie: 0, series: 0 };
    var newIds = {};
    var newCount = 0;

    for (var i = 0; i < (prevRaw || []).length; i++) {
      var p = prevRaw[i];
      if (!p) continue;
      prevIds[p.id] = true;
      if (p.kind === 'live') prevCounts.live++;
      else if (p.kind === 'movie') prevCounts.movie++;
      else prevCounts.series++;
    }

    var hasPrev = (prevRaw && prevRaw.length > 0);
    for (var j = 0; j < (nextRaw || []).length; j++) {
      var n = nextRaw[j];
      if (!n) continue;
      if (n.kind === 'live') nextCounts.live++;
      else if (n.kind === 'movie') nextCounts.movie++;
      else nextCounts.series++;

      if (hasPrev && !prevIds[n.id]) {
        newIds[n.id] = Date.now();
        newCount++;
      }
    }

    return {
      hasPrev: hasPrev,
      liveDelta: nextCounts.live - prevCounts.live,
      movieDelta: nextCounts.movie - prevCounts.movie,
      seriesDelta: nextCounts.series - prevCounts.series,
      newAddedCount: newCount,
      recentAddedIds: newIds
    };
  }

  function rebuildCatalogFromRawAsync(rawItems, onProgress, onDone, alreadyClassified) {
    var profile = (global.LuminaStore && global.LuminaStore.get('mappingProfile')) || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
    var list = rawItems || [];
    var total = list.length;
    var processed = [];
    var idx = 0;
    var BATCH_SIZE = 3000;

    function processSlice() {
      var end = Math.min(idx + BATCH_SIZE, total);
      for (; idx < end; idx++) {
        var it = list[idx];
        if (!it) continue;
        if (!alreadyClassified || !it.cleanTitle || !it.kind) {
          it = global.LuminaClassifier.classifyEntry(it);
        }
        processed.push(global.LuminaClassifier.applyProfileMapping(it, profile));
      }

      if (onProgress && total > 0) {
        onProgress({ stage: 'Organizando catálogo...', percent: Math.round((idx / total) * 70) });
      }

      if (idx < total) {
        setTimeout(processSlice, 0);
      } else {
        finalizeGrouping();
      }
    }

    function finalizeGrouping() {
      var grouped = global.LuminaGrouper.groupCatalog(processed);
      var channels = [];
      var movies = [];
      var unclassified = [];
      var itemByIdMap = {};
      var groupMap = {};

      for (var i = 0; i < processed.length; i++) {
        var item = processed[i];
        itemByIdMap[item.id] = item;
        var origG = item.groupOriginal || 'Sem Grupo';
        if (!groupMap[origG]) {
          groupMap[origG] = {
            originalName: origG,
            displayName: (profile.renamedGroups && profile.renamedGroups[origG]) || item.groupDisplay || origG,
            count: 0,
            suggested: item.kind === 'episode' ? (item.isNovela ? 'novela' : 'series') : item.kind
          };
        }
        groupMap[origG].count++;
      }

      for (var j = 0; j < grouped.standaloneItems.length; j++) {
        var st = grouped.standaloneItems[j];
        if (st.kind === 'hidden') continue;
        if (st.kind === 'live') {
          st.channelNumber = channels.length + 1;
          channels.push(st);
        } else if (st.kind === 'movie') {
          movies.push(st);
        } else {
          unclassified.push(st);
        }
      }

      for (var s = 0; s < grouped.seriesList.length; s++) {
        itemByIdMap[grouped.seriesList[s].id] = grouped.seriesList[s];
      }
      for (var n = 0; n < grouped.novelasList.length; n++) {
        itemByIdMap[grouped.novelasList[n].id] = grouped.novelasList[n];
      }

      var origGroupsArr = Object.keys(groupMap).map(function (k) { return groupMap[k]; });
      origGroupsArr.sort(function (a, b) { return b.count - a.count; });

      if (global.LuminaStore) {
        global.LuminaStore.set('rawItems', processed);
        global.LuminaStore.set('items', processed);
        global.LuminaStore.set('channels', channels);
        global.LuminaStore.set('movies', movies);
        global.LuminaStore.set('seriesList', grouped.seriesList);
        global.LuminaStore.set('novelasList', grouped.novelasList);
        global.LuminaStore.set('unclassifiedList', unclassified);
        global.LuminaStore.set('itemByIdMap', itemByIdMap);
        global.LuminaStore.set('originalGroups', origGroupsArr);
        global.LuminaStore.set('categories', buildCategoryCounts(channels, 'Todos os Canais'));
        global.LuminaStore.set('movieCategories', buildCategoryCounts(movies, 'Todos os Filmes'));
        global.LuminaStore.set('seriesCategories', buildCategoryCounts(grouped.seriesList, 'Todas as Séries'));
        global.LuminaStore.set('novelaCategories', buildCategoryCounts(grouped.novelasList, 'Todas as Novelas'));
      }

      if (onDone) onDone(null, processed);
    }

    processSlice();
  }

  function applyMappingAndPersist(newProfile, cb) {
    var curProfile = global.LuminaStore.get('mappingProfile');
    if (curProfile) {
      var undoStack = (global.LuminaStore.get('organizerUndoStack') || []).slice(-9);
      undoStack.push(JSON.parse(JSON.stringify(curProfile)));
      global.LuminaStore.set('organizerUndoStack', undoStack);
    }
    global.LuminaStore.set('mappingProfile', newProfile);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('mappingProfile', newProfile);
    var raw = global.LuminaStore.get('rawItems') || [];
    rebuildCatalogFromRawAsync(raw, null, function () {
      if (cb) cb();
    }, true);
  }

  function undoLastMappingChange(cb) {
    var stack = (global.LuminaStore.get('organizerUndoStack') || []).slice();
    if (!stack.length) return cb && cb(false);
    var prev = stack.pop();
    global.LuminaStore.set('organizerUndoStack', stack);
    global.LuminaStore.set('mappingProfile', prev);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('mappingProfile', prev);
    var raw = global.LuminaStore.get('rawItems') || [];
    rebuildCatalogFromRawAsync(raw, null, function () {
      if (cb) cb(true);
    }, true);
  }

  function commitIncomingCatalog(newRawItems, onProgress, callback) {
    var prevRaw = (global.LuminaStore && global.LuminaStore.get('rawItems')) || [];
    var diff = computeCatalogDiff(prevRaw, newRawItems);

    if (onProgress) onProgress({ stage: '4/4 \u00B7 Salvando catálogo na TV\u2026', percent: 92 });
    global.LuminaStorage.saveCatalogBatch(
      newRawItems,
      function (saveErr, genMeta) {
        if (saveErr) {
          return callback(saveErr, null);
        }
        rebuildCatalogFromRawAsync(newRawItems, onProgress, function () {
          var updateRecord = {
            updatedAt: Date.now(),
            generation: genMeta ? genMeta.generation : '',
            stats: genMeta ? genMeta.stats : null,
            diff: diff
          };
          if (global.LuminaStore) {
            global.LuminaStore.set('recentAddedIds', diff.recentAddedIds);
            global.LuminaStore.set('lastUpdateInfo', updateRecord);
          }
          if (global.LuminaStorage) {
            global.LuminaStorage.saveMeta('lastUpdateInfo', updateRecord);
          }
          callback(null, newRawItems, updateRecord);
        }, true);
      },
      function (ratio) {
        if (onProgress) {
          onProgress({ stage: '4/4 \u00B7 Salvando catálogo na TV\u2026', percent: 90 + Math.round(ratio * 10) });
        }
      },
      { classifierVersion: global.LuminaClassifier.CLASSIFIER_VERSION }
    );
  }

  function downloadM3uTextWithRetry(url, onProgress, cancelToken, cb) {
    var maxRetries = M3U_RETRY_DELAYS_MS.length;
    var attempt = 0;

    function runAttempt() {
      if (cancelToken && cancelToken.cancelled) {
        return cb(new Error('Importação cancelada pelo usuário.'));
      }
      var xhr = new XMLHttpRequest();
      cancelToken.activeXhr = xhr;
      var startMs = Date.now();

      try {
        xhr.open('GET', url, true);
        xhr.timeout = M3U_DOWNLOAD_TIMEOUT_MS;
      } catch (e) {
        return cb(new Error('URL M3U inválida: ' + e.message));
      }

      xhr.onprogress = function (e) {
        if (!onProgress) return;
        if (e.lengthComputable && e.total > 0) {
          var pct = Math.min(48, Math.round((e.loaded / e.total) * 48));
          var mb = (e.loaded / 1048576).toFixed(1);
          onProgress({ stage: '2/4 \u00B7 Baixando arquivo M3U (' + mb + ' MB)\u2026', percent: pct });
        } else if (e.loaded > 0) {
          var mb2 = (e.loaded / 1048576).toFixed(1);
          onProgress({ stage: '2/4 \u00B7 Baixando arquivo M3U (' + mb2 + ' MB)\u2026', percent: 28 });
        }
      };

      function retryOrFail(errObj) {
        var status = errObj.httpStatus || 0;
        var proxyErr = errObj.proxyError || '';
        var canRetry = !(cancelToken && cancelToken.cancelled) &&
          attempt < maxRetries &&
          status !== 401 && status !== 403 && status !== 404 &&
          proxyErr !== 'SSL' && proxyErr !== 'DNS';

        if (canRetry) {
          var wait = M3U_RETRY_DELAYS_MS[attempt++];
          setTimeout(runAttempt, wait);
          return;
        }
        if (global.LuminaDiagLog) {
          global.LuminaDiagLog.record('list-load', {
            engine: 'M3ULoader',
            url: url,
            httpStatus: status,
            code: errObj.code || 'M3U_ERR',
            elapsedMs: Date.now() - startMs,
            message: errObj.message
          });
        }
        cb(errObj);
      }

      xhr.onload = function () {
        if (cancelToken && cancelToken.cancelled) {
          return cb(new Error('Importação cancelada pelo usuário.'));
        }
        var proxyHeader = '';
        try { proxyHeader = xhr.getResponseHeader('X-Lumina-Proxy-Error') || ''; } catch (e) {}

        if (xhr.status === 502 && proxyHeader) {
          var pJson = null;
          try { pJson = JSON.parse(xhr.responseText); } catch (e) {}
          var pMsg = (pJson && pJson.message) || '';
          var sslErr = new Error(
            proxyHeader === 'SSL'
              ? 'O certificado de segurança (HTTPS) deste servidor é inválido ou autoassinado.'
              : (proxyHeader === 'DNS'
                ? 'Não foi possível encontrar este servidor (erro de DNS). Confira o endereço digitado.'
                : ('Falha de conexão com o servidor (' + (pMsg || proxyHeader) + ').'))
          );
          sslErr.httpStatus = 502;
          sslErr.proxyError = proxyHeader;
          sslErr.isSslError = (proxyHeader === 'SSL');
          return retryOrFail(sslErr);
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          var httpErr = new Error(
            (xhr.status === 401 || xhr.status === 403)
              ? 'Acesso negado ao baixar a lista M3U (HTTP ' + xhr.status + '). Confira o link ou sua assinatura.'
              : ('Falha ao baixar lista M3U (HTTP ' + xhr.status + ').')
          );
          httpErr.httpStatus = xhr.status;
          return retryOrFail(httpErr);
        }

        var text = String(xhr.responseText || '');
        var trimmed = text.trim();
        if (!trimmed) {
          return cb(new Error('A lista foi baixada, mas está vazia.'));
        }
        if (/^<!DOCTYPE\s+html|^<html/i.test(trimmed)) {
          return cb(new Error('O servidor pediu login ou retornou uma página web em vez da lista M3U.'));
        }
        if (trimmed.indexOf('#EXTM3U') === -1 && trimmed.indexOf('#EXTINF') === -1) {
          return cb(new Error('O arquivo baixado não é uma lista M3U válida (cabeçalho #EXTM3U ausente).'));
        }

        cb(null, text);
      };

      xhr.onerror = function () {
        var netErr = new Error('Erro de rede ao baixar lista M3U. Verifique a conexão e a URL.');
        netErr.httpStatus = 0;
        retryOrFail(netErr);
      };

      xhr.ontimeout = function () {
        var tErr = new Error('O servidor demorou demais para enviar a lista M3U.');
        tErr.httpStatus = 0;
        tErr.proxyError = 'TIMEOUT';
        retryOrFail(tErr);
      };

      xhr.send();
    }

    runAttempt();
  }

  function loadFromUrlOrLocalPath(url, sourceId, onProgress, callback) {
    var token = createCancelToken();
    if (onProgress) onProgress({ stage: '2/4 \u00B7 Conectando ao servidor M3U\u2026', percent: 10 });

    downloadM3uTextWithRetry(url, onProgress, token, function (dlErr, text) {
      if (dlErr) return callback(dlErr, null);

      global.LuminaM3UParser.parseChunkedAsync(
        text,
        sourceId || 'm3u',
        global.LuminaClassifier.classifyEntry,
        function (p) {
          if (onProgress) {
            onProgress({
              stage: '3/4 \u00B7 Lendo canais e filmes (' + p.itemsCount + ' itens)\u2026',
              percent: 50 + Math.round((p.percent || 0) * 0.4)
            });
          }
        },
        function (parseErr, items) {
          if (parseErr) return callback(parseErr, null);
          if (!items || !items.length) {
            return callback(new Error('A lista foi baixada, mas não contém canais ou filmes válidos.'), null);
          }
          commitIncomingCatalog(items, onProgress, callback);
        },
        token
      );
    });
  }

  function loadFromXtream(creds, onProgress, callback) {
    var token = createCancelToken();
    global.LuminaXtream.fetchCompleteCatalog(creds, onProgress, function (err, items) {
      if (err) return callback(err, null);
      commitIncomingCatalog(items, onProgress, callback);
    }, token);
  }

  // Troca entre listas salvas preservando favoritos e progresso por lista (Seção B6)
  function activateSavedList(listId, onProgress, callback) {
    var store = global.LuminaStore;
    if (!store) return callback && callback(new Error('Store indisponível'));
    var savedLists = store.get('savedLists') || [];
    var target = null;
    for (var i = 0; i < savedLists.length; i++) {
      if (savedLists[i].id === listId) {
        target = savedLists[i];
        break;
      }
    }
    if (!target) {
      return callback && callback(new Error('Lista salva não encontrada.'));
    }

    var oldListId = store.get('activeListId');
    if (oldListId && global.LuminaStorage) {
      global.LuminaStorage.saveMeta('favorites_' + oldListId, store.get('favorites') || {});
      global.LuminaStorage.saveMeta('watchProgress_' + oldListId, store.get('watchProgress') || {});
    }

    function restorePerListStateAndLoad() {
      if (target.type === 'xtream' && target.creds) {
        loadFromXtream(target.creds, onProgress, function (err, items, updRec) {
          if (!err) {
            var srcObj = { id: target.id, type: 'xtream', name: target.name, creds: target.creds };
            store.set('xtreamCreds', target.creds);
            store.set('source', srcObj);
            if (global.LuminaStorage) global.LuminaStorage.saveMeta('source', srcObj);
            store.upsertSavedList(srcObj);
          }
          if (callback) callback(err, items, updRec);
        });
      } else if (target.type === 'm3u' && target.url) {
        loadFromUrlOrLocalPath(target.url, target.id, onProgress, function (err, items, updRec) {
          if (!err) {
            var srcObj2 = { id: target.id, type: 'm3u', name: target.name, url: target.url };
            store.set('source', srcObj2);
            if (global.LuminaStorage) global.LuminaStorage.saveMeta('source', srcObj2);
            store.upsertSavedList(srcObj2);
          }
          if (callback) callback(err, items, updRec);
        });
      } else {
        if (callback) callback(new Error('Dados da lista salva estão incompletos.'));
      }
    }

    if (global.LuminaStorage) {
      global.LuminaStorage.loadMeta('favorites_' + target.id, {}, function (favs) {
        store.set('favorites', favs || {});
        global.LuminaStorage.saveMeta('favorites', favs || {});
        global.LuminaStorage.loadMeta('watchProgress_' + target.id, {}, function (prog) {
          store.set('watchProgress', prog || {});
          global.LuminaStorage.saveMeta('watchProgress', prog || {});
          restorePerListStateAndLoad();
        });
      });
    } else {
      restorePerListStateAndLoad();
    }
  }

  // Testador de stream sem abrir vídeo para "Testar minha lista" (Seção C3)
  function testMyListStreams(callback, onProgress) {
    var store = global.LuminaStore;
    if (!store) return callback && callback(new Error('Store indisponível'));

    var channels = store.get('channels') || [];
    var movies = store.get('movies') || [];
    var seriesList = store.get('seriesList') || [];
    var samples = [];

    if (channels.length) {
      samples.push({ label: 'Canal ao vivo', title: channels[0].cleanTitle, url: channels[0].url, item: channels[0] });
    }
    if (movies.length) {
      samples.push({ label: 'Filme', title: movies[0].cleanTitle, url: movies[0].url, item: movies[0] });
    }
    if (seriesList.length) {
      var epUrl = '';
      var s0 = seriesList[0];
      if (s0.seasons && s0.seasons[0] && s0.seasons[0].episodes && s0.seasons[0].episodes[0]) {
        epUrl = s0.seasons[0].episodes[0].url;
      }
      if (epUrl) {
        samples.push({ label: 'Episódio de série', title: s0.cleanTitle, url: epUrl, item: s0 });
      }
    }
    while (samples.length < 3 && channels.length > samples.length) {
      var chNext = channels[samples.length];
      samples.push({ label: 'Canal #' + (samples.length + 1), title: chNext.cleanTitle, url: chNext.url, item: chNext });
    }

    if (!samples.length) {
      return callback(new Error('Sua lista ainda não tem itens carregados para testar.'), null);
    }

    var results = [];
    var idx = 0;

    function testNext() {
      if (idx >= samples.length) {
        var allOk = true;
        var any403 = false;
        var anyTimeout = false;
        for (var i = 0; i < results.length; i++) {
          if (!results[i].ok) allOk = false;
          if (results[i].httpStatus === 401 || results[i].httpStatus === 403) any403 = true;
          if (/timeout|tempo/i.test(String(results[i].error || ''))) anyTimeout = true;
        }
        var recommendation = 'Tudo pronto! Os streams da sua lista estão respondendo normalmente.';
        if (!allOk) {
          if (any403) {
            recommendation = 'O servidor recusou a conexão (HTTP 401/403). Experimente mudar o User-Agent em Ajustes > Player ou verifique se outra TV está usando sua conta.';
          } else if (anyTimeout) {
            recommendation = 'O servidor demorou para responder. Experimente trocar o Formato preferido ao vivo para MPEG-TS (.ts) ou aumentar o Buffer.';
          } else {
            recommendation = 'Alguns itens falharam no teste. Verifique sua conexão ou atualize a lista.';
          }
        }
        var summary = { testedAt: Date.now(), results: results, allOk: allOk, recommendation: recommendation };
        store.set('streamTestResults', summary);
        store.set('streamTestRunning', false);
        return callback(null, summary);
      }

      var sample = samples[idx++];
      var ua = (global.LuminaPlayer && global.LuminaPlayer.resolveUserAgentForItem)
        ? global.LuminaPlayer.resolveUserAgentForItem(sample.item, sample.url)
        : 'VLC/3.0.20 LibVLC/3.0.20';

      if (onProgress) onProgress({ index: idx, total: samples.length, title: sample.title });

      global.LuminaPlatform.probeStream(sample.url, ua, 8000, function (_, probeRes) {
        var r = probeRes || { ok: false, httpStatus: 0, elapsedMs: 0, error: 'Sem resposta' };
        var row = {
          label: sample.label,
          title: sample.title,
          ok: !!r.ok,
          httpStatus: Number(r.httpStatus || 0),
          elapsedMs: Number(r.elapsedMs || 0),
          detectedFormat: r.detectedFormat || '-',
          error: r.error || ''
        };
        results.push(row);

        if (global.LuminaDiagLog) {
          global.LuminaDiagLog.record('probe', {
            engine: 'StreamProbe',
            url: sample.url,
            format: row.detectedFormat,
            userAgent: ua,
            httpStatus: row.httpStatus,
            code: row.ok ? 'PROBE_OK' : 'PROBE_FAIL',
            elapsedMs: row.elapsedMs,
            message: sample.label + ' (' + sample.title + '): ' + (row.ok ? 'OK' : (row.error || ('HTTP ' + row.httpStatus)))
          });
        }
        setTimeout(testNext, 100);
      });
    }

    store.set('streamTestRunning', true);
    testNext();
  }

  var api = {
    M3U_DOWNLOAD_TIMEOUT_MS: M3U_DOWNLOAD_TIMEOUT_MS,
    loadFromUrlOrLocalPath: loadFromUrlOrLocalPath,
    loadFromXtream: loadFromXtream,
    rebuildCatalogFromRawAsync: rebuildCatalogFromRawAsync,
    applyMappingAndPersist: applyMappingAndPersist,
    undoLastMappingChange: undoLastMappingChange,
    computeCatalogDiff: computeCatalogDiff,
    cancelActiveLoad: cancelActiveLoad,
    activateSavedList: activateSavedList,
    testMyListStreams: testMyListStreams
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaRepository = api;
})(typeof window !== 'undefined' ? window : global);
