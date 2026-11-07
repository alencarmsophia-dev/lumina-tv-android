(function (global) {
  'use strict';

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
    return global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
  }

  function classifyRange(st, rawItems, from, to) {
    var profile = st.profile;
    for (var i = from; i < to; i++) {
      var raw = rawItems[i];
      var gOrig = raw.groupTitle || raw.groupOriginal || 'Sem Grupo';
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
      st.classified.push(global.LuminaClassifier.classifyEntry(raw, profile));
    }
  }

  function assembleCatalog(st, rawItems) {
    var profile = st.profile;
    var groupMetaMap = st.groupMetaMap;
    var classified = st.classified;

    // Ordena grupos originais conforme groupOrder
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
    var visibleItems = [];
    var itemByIdMap = {};

    for (var j = 0; j < classified.length; j++) {
      var it = classified[j];
      if (it.kind === 'hidden') continue;
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

    global.LuminaStore.set('itemByIdMap', itemByIdMap);
    global.LuminaStore.set('rawItems', rawItems);
    global.LuminaStore.set('items', visibleItems);
    global.LuminaStore.set('originalGroups', originalGroups);
    global.LuminaStore.set('channels', channels);
    global.LuminaStore.set('movies', movies);
    global.LuminaStore.set('seriesList', grouped.seriesList);
    global.LuminaStore.set('novelasList', grouped.novelasList);

    global.LuminaStore.set('categories', buildCategoriesForList(channels, 'Todos os Canais'));
    global.LuminaStore.set('movieCategories', buildCategoriesForList(movies, 'Todos os Filmes'));
    global.LuminaStore.set('seriesCategories', buildCategoriesForList(grouped.seriesList, 'Todas as Séries'));
    global.LuminaStore.set('novelaCategories', buildCategoriesForList(grouped.novelasList, 'Todas as Novelas'));

    if (channels.length && !global.LuminaStore.get('currentChannelId')) {
      global.LuminaStore.set('currentChannelId', channels[0].id);
    }

    global.LuminaEventBus.emit('catalog:updated', {
      total: visibleItems.length,
      liveCount: channels.length,
      movieCount: movies.length,
      seriesCount: grouped.seriesList.length,
      novelasCount: grouped.novelasList.length
    });
  }

  // Versão síncrona (usada em ajustes rápidos de mapeamento).
  function rebuildCatalogFromRaw(rawItems) {
    var st = { profile: defaultProfile(), groupMetaMap: {}, classified: [] };
    classifyRange(st, rawItems, 0, rawItems.length);
    assembleCatalog(st, rawItems);
  }

  // Versão em fatias: a TV continua respondendo e mostra progresso.
  function rebuildCatalogFromRawAsync(rawItems, onProgress, done) {
    var st = { profile: defaultProfile(), groupMetaMap: {}, classified: [] };
    var N = rawItems.length;
    var SLICE = 1500;
    var i = 0;
    function step() {
      var end = Math.min(i + SLICE, N);
      try { classifyRange(st, rawItems, i, end); } catch (e) { return done(e); }
      i = end;
      if (onProgress) onProgress(N ? i / N : 1);
      if (i < N) return setTimeout(step, 0);
      setTimeout(function () {
        try { assembleCatalog(st, rawItems); } catch (e2) { return done(e2); }
        done(null);
      }, 0);
    }
    step();
  }

  function applyMappingAndPersist(nextProfile, cb) {
    global.LuminaStore.set('mappingProfile', nextProfile);
    global.LuminaStorage.saveMeta('mappingProfile', nextProfile, function () {
      var raw = global.LuminaStore.get('rawItems') || [];
      rebuildCatalogFromRaw(raw);
      if (cb) cb();
    });
  }

  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtMb(bytes) { return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB'; }

  // Etapas: baixar 0–35 · ler 35–50 · organizar 50–90 · salvar 90–100
  function report(onProgress, base, span, status, frac) {
    if (!onProgress) return;
    onProgress({ status: status, percent: frac == null ? null : Math.round(base + span * frac) });
  }

  function finishCatalog(rawItems, onProgress, onComplete) {
    rebuildCatalogFromRawAsync(rawItems, function (f) {
      report(onProgress, 50, 40, 'Organizando catálogo... ' + Math.round(f * 100) + '%', f);
    }, function (err) {
      if (err) return onComplete && onComplete(err);
      report(onProgress, 90, 10, 'Salvando no aparelho...', 0);
      global.LuminaStorage.saveCatalogBatch(rawItems, function () {
        report(onProgress, 100, 0, 'Pronto!', 0);
        if (onComplete) onComplete(null, global.LuminaStore.get('items'));
      }, function (f) {
        report(onProgress, 90, 10, 'Salvando no aparelho...', f);
      });
    });
  }

  function ingestM3UText(rawText, sourceId, onProgress, onComplete) {
    global.LuminaM3UParser.parseChunkedAsync(
      rawText,
      sourceId,
      function (raw) { return raw; },
      function (p) {
        report(onProgress, 35, 15, 'Lendo lista... ' + fmtInt(p.itemsCount) + ' itens encontrados', p.percent / 100);
      },
      function (err, rawItems) {
        if (!rawItems || !rawItems.length) {
          if (onComplete) onComplete(new Error('A lista não tem nenhum canal, filme ou série válido (confira o link M3U).'));
          return;
        }
        setTimeout(function () { finishCatalog(rawItems, onProgress, onComplete); }, 0);
      }
    );
  }

  function loadFromUrlOrLocalPath(urlOrPath, sourceId, onProgress, onComplete) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', urlOrPath, true);
    xhr.timeout = 180000;
    report(onProgress, 0, 35, 'Baixando lista...', null);
    xhr.onprogress = function (e) {
      if (e.lengthComputable && e.total) {
        report(onProgress, 0, 35, 'Baixando lista... ' + fmtMb(e.loaded) + ' de ' + fmtMb(e.total), e.loaded / e.total);
      } else {
        report(onProgress, 0, 35, 'Baixando lista... ' + fmtMb(e.loaded || 0), null);
      }
    };
    xhr.onload = function () {
      if ((xhr.status >= 200 && xhr.status < 300) || (xhr.status === 0 && xhr.responseText)) {
        ingestM3UText(xhr.responseText, sourceId, onProgress, onComplete);
      } else {
        if (onComplete) onComplete(new Error('Falha HTTP ' + xhr.status + ' ao carregar a lista.'));
      }
    };
    xhr.onerror = function () {
      if (onComplete) onComplete(new Error('Não foi possível abrir o endereço da lista.'));
    };
    xhr.ontimeout = function () {
      if (onComplete) onComplete(new Error('A lista demorou demais para baixar.'));
    };
    xhr.send();
  }

  function loadFromXtream(creds, onProgress, onComplete) {
    global.LuminaXtream.fetchXtreamCatalog(creds, function (p) {
      report(onProgress, 0, 35, p.status, (p.percent || 0) / 100);
    }, function (err, rawItems) {
      if (err) return onComplete && onComplete(err);
      if (!rawItems || !rawItems.length) return onComplete && onComplete(new Error('O servidor Xtream não devolveu nenhum conteúdo.'));
      setTimeout(function () { finishCatalog(rawItems, onProgress, onComplete); }, 0);
    });
  }

  global.LuminaRepository = {
    loadFromXtream: loadFromXtream,
    rebuildCatalogFromRaw: rebuildCatalogFromRaw,
    rebuildCatalogFromRawAsync: rebuildCatalogFromRawAsync,
    applyMappingAndPersist: applyMappingAndPersist,
    ingestM3UText: ingestM3UText,
    loadFromUrlOrLocalPath: loadFromUrlOrLocalPath
  };
})(typeof window !== 'undefined' ? window : global);
