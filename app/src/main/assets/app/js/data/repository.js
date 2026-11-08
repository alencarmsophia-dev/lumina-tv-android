(function (global) {
  'use strict';

  var activeLoadCancelToken = null;

  function buildCategoriesForList(list, allLabel) {
    var map = {};
    map[allLabel] = list.length;
    for (var i = 0; i < list.length; i++) {
      var g = list[i].groupDisplay || list[i].groupOriginal || 'Geral';
      map[g] = (map[g] || 0) + 1;
    }
    var arr = [];
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        arr.push({ name: k, count: map[k] });
      }
    }
    return arr;
  }

  function defaultProfile() {
    return (global.LuminaStore && global.LuminaStore.get('mappingProfile')) || {
      mode: 'auto',
      customGroupRules: {},
      renamedGroups: {},
      groupOrder: []
    };
  }

  // Reassocia favoritos e progresso de reprodução caso os IDs tenham vindo da v1.5.1 ou de outro servidor/credencial (B2)
  function migrateFavoritesAndProgressIfNeeded(allClassified, seriesList, novelasList, itemByIdMap) {
    if (!global.LuminaStore) return;
    var favs = global.LuminaStore.get('favorites') || {};
    var prog = global.LuminaStore.get('watchProgress') || {};
    var favKeys = Object.keys(favs);
    var progKeys = Object.keys(prog);
    if (!favKeys.length && !progKeys.length) return;

    var legacyToNew = {};
    var i;
    for (i = 0; i < allClassified.length; i++) {
      var it = allClassified[i];
      if (it.legacyId && it.legacyId !== it.id) {
        legacyToNew[it.legacyId] = it.id;
      }
    }
    for (i = 0; i < seriesList.length; i++) {
      var sh = seriesList[i];
      var oldShHash = global.LuminaClassifier.stableHash('ser|' + String(sh.cleanTitle || '').toLowerCase());
      legacyToNew[oldShHash] = sh.id;
    }
    for (i = 0; i < novelasList.length; i++) {
      var nv = novelasList[i];
      var oldNvHash = global.LuminaClassifier.stableHash('nov|' + String(nv.cleanTitle || '').toLowerCase());
      legacyToNew[oldNvHash] = nv.id;
    }

    var favChanged = false;
    for (i = 0; i < favKeys.length; i++) {
      var fk = favKeys[i];
      if (!itemByIdMap[fk] && legacyToNew[fk]) {
        favs[legacyToNew[fk]] = favs[fk];
        delete favs[fk];
        favChanged = true;
      }
    }
    if (favChanged) {
      global.LuminaStore.set('favorites', favs);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('favorites', favs);
    }

    var progChanged = false;
    for (i = 0; i < progKeys.length; i++) {
      var pk = progKeys[i];
      if (!itemByIdMap[pk] && legacyToNew[pk]) {
        prog[legacyToNew[pk]] = prog[pk];
        delete prog[pk];
        progChanged = true;
      }
    }
    if (progChanged) {
      global.LuminaStore.set('watchProgress', prog);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', prog);
    }
  }

  function classifyRange(st, entries, from, to, alreadyClassified) {
    var profile = st.profile;
    var hasCustomRules = profile.mode === 'all_live' ||
      (profile.customGroupRules && Object.keys(profile.customGroupRules).length > 0) ||
      (profile.renamedGroups && Object.keys(profile.renamedGroups).length > 0);

    for (var i = from; i < to; i++) {
      var raw = entries[i];
      if (!raw) continue;
      var gOrig = raw.groupOriginal || raw.groupTitle || 'Sem Grupo';
      if (!st.groupMetaMap[gOrig]) {
        st.groupMetaMap[gOrig] = {
          originalName: gOrig,
          displayName: (profile.renamedGroups && profile.renamedGroups[gOrig]) || gOrig,
          count: 0,
          suggested: global.LuminaClassifier.suggestGroupTarget(gOrig),
          activeTarget: (profile.customGroupRules && profile.customGroupRules[gOrig]) || 'auto'
        };
      }
      st.groupMetaMap[gOrig].count++;

      var item;
      if (alreadyClassified && raw.id && raw.kind && !hasCustomRules) {
        item = raw;
      } else {
        item = global.LuminaClassifier.classifyEntry(raw, profile);
      }
      st.classified.push(item);
    }
  }

  function assembleCatalog(st) {
    var profile = st.profile;
    var groupMetaMap = st.groupMetaMap;
    var classified = st.classified;

    var groupKeys = Object.keys(groupMetaMap);
    var order = profile.groupOrder || [];
    groupKeys.sort(function (a, b) {
      var ia = order.indexOf(a);
      var ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    var originalGroups = [];
    for (var gIdx = 0; gIdx < groupKeys.length; gIdx++) {
      originalGroups.push(groupMetaMap[groupKeys[gIdx]]);
    }

    var channels = [];
    var movies = [];
    var unclassifiedList = [];
    var visibleItems = [];
    var itemByIdMap = {};

    for (var j = 0; j < classified.length; j++) {
      var it = classified[j];
      if (it.kind === 'hidden') continue;
      if (it.kind === 'unclassified') {
        unclassifiedList.push(it);
        itemByIdMap[it.id] = it;
        continue;
      }
      visibleItems.push(it);
      itemByIdMap[it.id] = it;
      if (it.kind === 'live') {
        it.channelNumber = channels.length + 1;
        channels.push(it);
      } else if (it.kind === 'movie') {
        movies.push(it);
      }
    }

    var grouped = global.LuminaGrouper.groupSeriesAndNovelas(visibleItems);
    for (var sIdx = 0; sIdx < grouped.seriesList.length; sIdx++) {
      itemByIdMap[grouped.seriesList[sIdx].id] = grouped.seriesList[sIdx];
    }
    for (var nIdx = 0; nIdx < grouped.novelasList.length; nIdx++) {
      itemByIdMap[grouped.novelasList[nIdx].id] = grouped.novelasList[nIdx];
    }

    migrateFavoritesAndProgressIfNeeded(classified, grouped.seriesList, grouped.novelasList, itemByIdMap);

    if (global.LuminaXtream && global.LuminaXtream.clearSearchCache) {
      global.LuminaXtream.clearSearchCache();
    }

    global.LuminaStore.set('itemByIdMap', itemByIdMap);
    // Guardamos os itens já classificados e liberamos duplicatas brutas para economizar RAM (Seção 4.6)
    global.LuminaStore.set('rawItems', classified);
    global.LuminaStore.set('items', visibleItems);
    global.LuminaStore.set('originalGroups', originalGroups);
    global.LuminaStore.set('channels', channels);
    global.LuminaStore.set('movies', movies);
    global.LuminaStore.set('seriesList', grouped.seriesList);
    global.LuminaStore.set('novelasList', grouped.novelasList);
    global.LuminaStore.set('unclassifiedList', unclassifiedList);

    global.LuminaStore.set('categories', buildCategoriesForList(channels, 'Todos os Canais'));
    global.LuminaStore.set('movieCategories', buildCategoriesForList(movies, 'Todos os Filmes'));
    global.LuminaStore.set('seriesCategories', buildCategoriesForList(grouped.seriesList, 'Todas as Séries'));
    global.LuminaStore.set('novelaCategories', buildCategoriesForList(grouped.novelasList, 'Todas as Novelas'));

    if (channels.length && !global.LuminaStore.get('currentChannelId')) {
      global.LuminaStore.set('currentChannelId', channels[0].id);
    }

    var statsSummary = {
      total: visibleItems.length,
      liveCount: channels.length,
      movieCount: movies.length,
      seriesCount: grouped.seriesList.length,
      novelasCount: grouped.novelasList.length,
      unclassifiedCount: unclassifiedList.length
    };
    global.LuminaEventBus.emit('catalog:updated', statsSummary);
    return statsSummary;
  }

  function rebuildCatalogFromRaw(entries, alreadyClassified) {
    var st = { profile: defaultProfile(), groupMetaMap: {}, classified: [] };
    classifyRange(st, entries || [], 0, (entries || []).length, !!alreadyClassified);
    return assembleCatalog(st);
  }

  function rebuildCatalogFromRawAsync(entries, onProgress, done, alreadyClassified) {
    var list = entries || [];
    var st = { profile: defaultProfile(), groupMetaMap: {}, classified: [] };
    var N = list.length;
    var SLICE = 2000;
    var i = 0;

    function step() {
      var end = Math.min(i + SLICE, N);
      try {
        classifyRange(st, list, i, end, !!alreadyClassified);
      } catch (e) {
        return done && done(e);
      }
      i = end;
      if (onProgress) onProgress(N ? i / N : 1);
      if (i < N) return setTimeout(step, 0);
      setTimeout(function () {
        try {
          var stats = assembleCatalog(st);
          if (done) done(null, stats, st.classified);
        } catch (e2) {
          if (done) done(e2);
        }
      }, 0);
    }
    step();
  }

  function applyMappingAndPersist(nextProfile, cb) {
    var prevProfile = JSON.parse(JSON.stringify(defaultProfile()));
    var undoStack = (global.LuminaStore.get('organizerUndoStack') || []).slice(-9);
    undoStack.push(prevProfile);
    global.LuminaStore.set('organizerUndoStack', undoStack);

    global.LuminaStore.set('mappingProfile', nextProfile);
    global.LuminaStorage.saveMeta('mappingProfile', nextProfile, function () {
      var raw = global.LuminaStore.get('rawItems') || [];
      rebuildCatalogFromRaw(raw, false);
      if (cb) cb();
    });
  }

  function undoLastMappingChange(cb) {
    var undoStack = (global.LuminaStore.get('organizerUndoStack') || []).slice();
    if (!undoStack.length) return cb && cb(false);
    var prev = undoStack.pop();
    global.LuminaStore.set('organizerUndoStack', undoStack);
    global.LuminaStore.set('mappingProfile', prev);
    global.LuminaStorage.saveMeta('mappingProfile', prev, function () {
      var raw = global.LuminaStore.get('rawItems') || [];
      rebuildCatalogFromRaw(raw, false);
      if (cb) cb(true);
    });
  }

  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtMb(bytes) { return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB'; }

  function report(onProgress, base, span, status, frac) {
    if (!onProgress) return;
    onProgress({ status: status, percent: frac == null ? null : Math.round(base + span * frac) });
  }

  function computeCatalogDiff(prevIdsMap, prevCounts, newClassified, newStats) {
    var addedIds = {};
    var addedCount = 0;
    var hasPrev = prevCounts && prevCounts.total > 0;
    if (hasPrev) {
      for (var i = 0; i < newClassified.length; i++) {
        var id = newClassified[i].id;
        if (!prevIdsMap[id]) {
          addedIds[id] = true;
          addedCount++;
        }
      }
    }
    return {
      hasPrev: hasPrev,
      addedTotal: addedCount,
      liveDelta: hasPrev ? (newStats.liveCount - (prevCounts.liveCount || 0)) : newStats.liveCount,
      movieDelta: hasPrev ? (newStats.movieCount - (prevCounts.movieCount || 0)) : newStats.movieCount,
      seriesDelta: hasPrev ? (newStats.seriesCount - (prevCounts.seriesCount || 0)) : newStats.seriesCount,
      novelasDelta: hasPrev ? (newStats.novelasCount - (prevCounts.novelasCount || 0)) : newStats.novelasCount,
      addedIds: addedIds
    };
  }

  function finishCatalog(rawItems, onProgress, onComplete, extraMeta) {
    var prevById = global.LuminaStore.get('itemByIdMap') || {};
    var prevIdsMap = {};
    var prevKeys = Object.keys(prevById);
    for (var pk = 0; pk < prevKeys.length; pk++) prevIdsMap[prevKeys[pk]] = true;
    var prevLastUpdate = global.LuminaStore.get('lastUpdateInfo');
    var prevCounts = prevLastUpdate && prevLastUpdate.stats ? prevLastUpdate.stats : null;

    rebuildCatalogFromRawAsync(rawItems, function (f) {
      report(onProgress, 50, 35, 'Classificando e organizando catálogo... ' + Math.round(f * 100) + '%', f);
    }, function (err, statsSummary, classifiedItems) {
      if (err) return onComplete && onComplete(err);

      var diff = computeCatalogDiff(prevIdsMap, prevCounts, classifiedItems, statsSummary);
      global.LuminaStore.set('recentAddedIds', diff.addedIds || {});

      report(onProgress, 85, 15, 'Salvando catálogo de forma atômica no aparelho...', 0);
      global.LuminaStorage.saveCatalogBatch(
        classifiedItems,
        function (saveErr, genMeta) {
          var updateRecord = {
            updatedAt: Date.now(),
            generation: genMeta ? genMeta.generation : 'mem-only',
            truncated: !!(genMeta && genMeta.truncated),
            strippedMedia: !!(genMeta && genMeta.strippedMedia),
            saveError: saveErr ? String(saveErr.message || saveErr) : null,
            stats: statsSummary,
            diff: {
              hasPrev: diff.hasPrev,
              addedTotal: diff.addedTotal,
              liveDelta: diff.liveDelta,
              movieDelta: diff.movieDelta,
              seriesDelta: diff.seriesDelta,
              novelasDelta: diff.novelasDelta
            },
            stepReport: (extraMeta && extraMeta.stepReport) || []
          };

          global.LuminaStore.set('lastUpdateInfo', updateRecord);
          global.LuminaStorage.saveMeta('lastUpdateInfo', updateRecord);

          var diag = global.LuminaStore.get('diagnostics') || {};
          diag.catalogGeneration = updateRecord.generation;
          global.LuminaStore.set('diagnostics', diag);

          if (saveErr) {
            if (global.LuminaUI && global.LuminaUI.toast) {
              global.LuminaUI.toast('⚠ Catálogo carregado na memória, mas não pôde ser salvo no aparelho: ' + (saveErr.message || saveErr));
            }
          } else if (genMeta && genMeta.truncated) {
            if (global.LuminaUI && global.LuminaUI.toast) {
              global.LuminaUI.toast('⚠ Lista excedeu o limite máximo (' + fmtInt(global.LuminaStorage.MAX_PERSISTED_RAW_ITEMS) + ' itens).');
            }
          }

          report(onProgress, 100, 0, 'Pronto!', 1);
          if (onComplete) onComplete(null, global.LuminaStore.get('items'), updateRecord);
        },
        function (f) {
          report(onProgress, 85, 15, 'Salvando catálogo no aparelho... ' + Math.round(f * 100) + '%', f);
        },
        { classifierVersion: global.LuminaClassifier.CLASSIFIER_VERSION }
      );
    }, false);
  }

  function ingestM3UText(rawText, sourceId, onProgress, onComplete, cancelToken) {
    global.LuminaM3UParser.parseChunkedAsync(
      rawText,
      sourceId,
      function (raw) { return raw; },
      function (p) {
        report(onProgress, 35, 15, 'Lendo lista... ' + fmtInt(p.itemsCount) + ' itens encontrados', p.percent / 100);
      },
      function (err, rawItems) {
        if (err) return onComplete && onComplete(err);
        if (!rawItems || !rawItems.length) {
          if (onComplete) onComplete(new Error('A lista não tem nenhum canal, filme ou série válido (confira o link M3U).'));
          return;
        }
        setTimeout(function () { finishCatalog(rawItems, onProgress, onComplete); }, 0);
      },
      cancelToken
    );
  }

  function loadFromUrlOrLocalPath(urlOrPath, sourceId, onProgress, onComplete) {
    cancelActiveLoad();
    var cancelToken = { cancelled: false, xhr: null };
    activeLoadCancelToken = cancelToken;

    var curSrc = global.LuminaStore ? global.LuminaStore.get('source') : null;
    var xhr = new XMLHttpRequest();
    cancelToken.xhr = xhr;
    xhr.open('GET', urlOrPath, true);
    xhr.timeout = 180000;

    // Atualização incremental condicional via ETag / If-Modified-Since quando disponível (B6.1)
    if (curSrc && curSrc.url === urlOrPath && (global.LuminaStore.get('items') || []).length > 0) {
      if (curSrc.etag) {
        try { xhr.setRequestHeader('If-None-Match', curSrc.etag); } catch (e) {}
      }
      if (curSrc.lastModified) {
        try { xhr.setRequestHeader('If-Modified-Since', curSrc.lastModified); } catch (e2) {}
      }
    }

    report(onProgress, 0, 35, 'Baixando lista...', null);
    xhr.onprogress = function (e) {
      if (e.lengthComputable && e.total) {
        report(onProgress, 0, 35, 'Baixando lista... ' + fmtMb(e.loaded) + ' de ' + fmtMb(e.total), e.loaded / e.total);
      } else {
        report(onProgress, 0, 35, 'Baixando lista... ' + fmtMb(e.loaded || 0), null);
      }
    };
    xhr.onload = function () {
      if (cancelToken.cancelled) return;
      if (xhr.status === 304) {
        report(onProgress, 100, 0, 'Lista já está atualizada (sem alterações no servidor).', 1);
        if (onComplete) onComplete(null, global.LuminaStore.get('items'), { unchanged: true });
        return;
      }
      if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) {
        var newEtag = '';
        var newLastMod = '';
        try {
          newEtag = xhr.getResponseHeader('ETag') || '';
          newLastMod = xhr.getResponseHeader('Last-Modified') || '';
        } catch (e) {}
        if (curSrc && curSrc.url === urlOrPath) {
          curSrc.etag = newEtag;
          curSrc.lastModified = newLastMod;
          global.LuminaStore.set('source', curSrc);
          if (global.LuminaStorage) global.LuminaStorage.saveMeta('source', curSrc);
        }
        ingestM3UText(xhr.responseText, sourceId, onProgress, onComplete, cancelToken);
      } else {
        if (onComplete) onComplete(new Error('Falha HTTP ' + xhr.status + ' ao carregar a lista.'));
      }
    };
    xhr.onerror = function () {
      if (!cancelToken.cancelled && onComplete) onComplete(new Error('Não foi possível abrir o endereço da lista.'));
    };
    xhr.ontimeout = function () {
      if (!cancelToken.cancelled && onComplete) onComplete(new Error('A lista demorou demais para baixar (timeout).'));
    };
    xhr.send();
  }

  function loadFromXtream(creds, onProgress, onComplete) {
    cancelActiveLoad();
    var cancelToken = { cancelled: false };
    activeLoadCancelToken = cancelToken;

    global.LuminaXtream.fetchXtreamCatalog(
      creds,
      function (p) {
        report(onProgress, 0, 45, p.status, (p.percent || 0) / 100);
      },
      function (err, rawItems, metaInfo) {
        if (err) return onComplete && onComplete(err);
        if (!rawItems || !rawItems.length) {
          return onComplete && onComplete(new Error('O servidor Xtream não devolveu nenhum conteúdo.'));
        }
        setTimeout(function () {
          finishCatalog(rawItems, onProgress, onComplete, metaInfo);
        }, 0);
      },
      cancelToken
    );
  }

  function cancelActiveLoad() {
    if (activeLoadCancelToken) {
      activeLoadCancelToken.cancelled = true;
      if (activeLoadCancelToken.xhr) {
        try { activeLoadCancelToken.xhr.abort(); } catch (e) {}
      }
      activeLoadCancelToken = null;
      return true;
    }
    return false;
  }

  var api = {
    loadFromXtream: loadFromXtream,
    rebuildCatalogFromRaw: rebuildCatalogFromRaw,
    rebuildCatalogFromRawAsync: rebuildCatalogFromRawAsync,
    applyMappingAndPersist: applyMappingAndPersist,
    undoLastMappingChange: undoLastMappingChange,
    ingestM3UText: ingestM3UText,
    loadFromUrlOrLocalPath: loadFromUrlOrLocalPath,
    cancelActiveLoad: cancelActiveLoad
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaRepository = api;
})(typeof window !== 'undefined' ? window : global);
