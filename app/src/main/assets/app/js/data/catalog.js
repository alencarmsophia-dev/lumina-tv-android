(function (global) {
  'use strict';

  var PAGE_SIZE = 200;
  var MAX_LRU_PAGES_PER_SECTION = 12; // Parte 2 e 13.8

  // Cache LRU de páginas por seção: section -> { map: { key: pageObj }, order: [key1, ...] }
  var pageLruBySection = {
    live: { map: {}, order: [] },
    movie: { map: {}, order: [] },
    series: { map: {}, order: [] }
  };

  var groupsCacheByKey = {};
  var subscribersBySection = { live: [], movie: [], series: [], all: [] };

  // Instrumentação para provar nos testes (Parte 13.7) zero leituras de página e zero chamadas de rede na abertura
  var instrumentation = {
    pageReads: 0,
    groupReads: 0,
    searchCalls: 0,
    networkCalls: 0
  };


  function normSec(sec) {
    if (sec === "vod") return "movie";
    return sec || "live";
  }

  var lastKnownListStateById = {};

  function getListStateSync(listId) {
    var id = listId || getActiveListId();
    if (lastKnownListStateById[id]) return lastKnownListStateById[id];
    var empty = createEmptyListState(id);
    empty.counts = { live: 0, vod: 0, movie: 0, series: 0 };
    empty.totalCount = 0;
    return empty;
  }

  function getActiveListId() {
    if (global.LuminaStore && global.LuminaStore.get('activeListId')) {
      return global.LuminaStore.get('activeListId');
    }
    var src = global.LuminaStore ? global.LuminaStore.get('source') : null;
    if (src && src.id) return src.id;
    return 'default_list';
  }

  function getStorage() {
    return global.LuminaStorage;
  }

  function createLruCache(maxEntries) {
    var limit = maxEntries || MAX_LRU_PAGES_PER_SECTION;
    var map = {};
    var order = [];

    return {
      get: function (key) {
        if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
        var idx = order.indexOf(key);
        if (idx !== -1) {
          order.splice(idx, 1);
          order.push(key);
        }
        return map[key];
      },
      put: function (key, val) {
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          var idx = order.indexOf(key);
          if (idx !== -1) order.splice(idx, 1);
        } else if (order.length >= limit) {
          var oldest = order.shift();
          delete map[oldest];
        }
        map[key] = val;
        order.push(key);
      },
      clear: function () {
        map = {};
        order = [];
      },
      size: function () {
        return order.length;
      },
      keys: function () {
        return order.slice();
      }
    };
  }

  var sectionLru = {
    live: createLruCache(MAX_LRU_PAGES_PER_SECTION),
    movie: createLruCache(MAX_LRU_PAGES_PER_SECTION),
    series: createLruCache(MAX_LRU_PAGES_PER_SECTION)
  };

  function clearMemoryCaches(section) {
    if (section && sectionLru[section]) {
      sectionLru[section].clear();
    } else {
      sectionLru.live.clear();
      sectionLru.movie.clear();
      sectionLru.series.clear();
      groupsCacheByKey = {};
    }
  }

  // Parte 6.3: Reconstrói a URL final de reprodução somente na hora de tocar, usando as credenciais atuais da lista
  function resolvePlaybackUrl(itemOrRef, credsOrSource) {
    if (!itemOrRef) return '';
    var ref = typeof itemOrRef === 'string' ? itemOrRef : (itemOrRef.ref || itemOrRef.url || '');
    if (!ref) return '';

    var src = credsOrSource || (global.LuminaStore ? global.LuminaStore.get('source') : null);
    var creds = (src && src.creds) ? src.creds : (src && src.server ? src : (global.LuminaStore ? global.LuminaStore.get('xtreamCreds') : null));
    var server = (creds && creds.server) ? String(creds.server).replace(/\/+$/, '') : '';
    var user = (creds && creds.username) ? encodeURIComponent(creds.username) : '';
    var pass = (creds && creds.password) ? encodeURIComponent(creds.password) : '';

    if (ref.indexOf('xt:') === 0) {
      // Formato: xt:<kind>:<streamId>:<ext>
      var parts = ref.split(':');
      var kind = parts[1] || 'live';
      var streamId = parts[2] || '';
      var ext = parts[3] || (kind === 'live' ? 'm3u8' : 'mp4');
      if (!server) return '';
      var prefix = kind === 'movie' ? '/movie/' : (kind === 'series' || kind === 'episode' ? '/series/' : '/live/');
      return server + prefix + user + '/' + pass + '/' + streamId + '.' + ext;
    }

    if (ref.indexOf('xtpath:') === 0) {
      var tpl = ref.slice(7);
      var pathFilled = tpl.replace('{u}', user || 'user').replace('{p}', pass || 'pass');
      var origin = server || (src && src.origin) || 'http://localhost';
      return origin.replace(/\/+$/, '') + pathFilled;
    }

    if (ref.indexOf('xtshort:') === 0) {
      var tplShort = ref.slice(8);
      var shortFilled = tplShort.replace('{u}', user || 'user').replace('{p}', pass || 'pass');
      var origin2 = server || (src && src.origin) || 'http://localhost';
      return origin2.replace(/\/+$/, '') + shortFilled;
    }

    if (ref.indexOf('url:') === 0) {
      var raw = ref.slice(4);
      if (pass) raw = raw.replace(/\{p\}/g, pass);
      return raw;
    }

    return ref;
  }

  // Parte 6.5: Cria retrato leve do item para salvar junto de Favoritos e Continuar Assistindo
  function createItemPortrait(item) {
    if (!item) return null;
    var ref = item.ref || (global.LuminaImportWorker
      ? global.LuminaImportWorker.buildSafePlaybackRef(item.url || '', item.sourceId || 'm3u', item.xtreamId, item.section || item.kind || 'live')
      : ('url:' + (item.url || '')));
    return {
      id: item.id,
      section: item.section || (item.kind === 'movie' ? 'movie' : (item.kind === 'live' ? 'live' : 'series')),
      kind: item.kind || 'live',
      isNovela: !!item.isNovela,
      title: item.title || item.cleanTitle || 'Sem Título',
      cleanTitle: item.cleanTitle || item.title || 'Sem Título',
      seriesTitle: item.seriesTitle || '',
      logo: item.logo || '',
      ref: ref,
      groupId: item.groupId || 'g_0',
      groupOriginal: item.groupOriginal || 'Geral',
      groupDisplay: item.groupDisplay || item.groupOriginal || 'Geral',
      year: item.year || 2024,
      rating: item.rating || 8.0,
      season: item.season || null,
      episode: item.episode || null,
      channelNumber: item.channelNumber || 0,
      quality: item.quality || 'HD',
      lang: item.lang || 'DUB',
      adult: !!item.adult,
      xtreamSeriesId: item.xtreamSeriesId || '',
      needsSeriesInfo: !!item.needsSeriesInfo
    };
  }

  function hydratePortraitForPlayback(portrait, credsOrSource) {
    if (!portrait) return null;
    var copy = JSON.parse(JSON.stringify(portrait));
    copy.url = resolvePlaybackUrl(copy, credsOrSource);
    return copy;
  }

  function shouldFilterAdult() {
    if (!global.LuminaStore) return false;
    var par = global.LuminaStore.get('parental');
    return !!(par && par.enabled && !par.unlockedSession);
  }

  function getListState(listId, cb) {
    if (typeof listId === "function") {
      cb = listId;
      listId = null;
    }
    var id = listId || getActiveListId();
    function run(done) {
      var st = getStorage();
      if (!st) {
        var emp = createEmptyListState(id);
        emp.counts = { live: 0, vod: 0, movie: 0, series: 0 };
        emp.totalCount = 0;
        return done(null, emp);
      }
      st.loadMeta('catalogState_' + id, null, function (meta) {
        if (meta && meta.sections) {
          if (meta.origin && global.LuminaStore) {
            var curSrc = global.LuminaStore.get('source');
            if (curSrc && !curSrc.origin) curSrc.origin = meta.origin;
          }
          var stStats = meta.stats || {};
          meta.counts = {
            live: Number(stStats.live || (meta.sections.live && meta.sections.live.count) || 0),
            vod: Number(stStats.movie || (meta.sections.movie && meta.sections.movie.count) || 0),
            movie: Number(stStats.movie || (meta.sections.movie && meta.sections.movie.count) || 0),
            series: Number(stStats.series || (meta.sections.series && meta.sections.series.count) || 0)
          };
          meta.totalCount = Number(stStats.totalEntries || (meta.counts.live + meta.counts.movie + meta.counts.series));
          lastKnownListStateById[id] = meta;
          return done(null, meta);
        }
        var emp2 = createEmptyListState(id);
        emp2.counts = { live: 0, vod: 0, movie: 0, series: 0 };
        emp2.totalCount = 0;
        lastKnownListStateById[id] = emp2;
        done(null, emp2);
      });
    }
    if (typeof cb === "function") {
      run(cb);
      return;
    }
    if (typeof Promise !== "undefined") {
      return new Promise(function (resolve, reject) {
        run(function (err, res) {
          if (err) reject(err);
          else resolve(res);
        });
      });
    }
  }

  function createEmptyListState(listId) {
    return {
      listId: listId,
      generationId: '',
      stats: { totalEntries: 0, live: 0, movie: 0, series: 0 },
      sections: {
        live: { status: 'empty', count: 0, groupsCount: 0, updatedAt: 0 },
        movie: { status: 'empty', count: 0, groupsCount: 0, updatedAt: 0 },
        series: { status: 'empty', count: 0, groupsCount: 0, updatedAt: 0 }
      },
      updatedAt: 0
    };
  }

  // Parte 6.2 e 6.7: Lê o índice de grupos aplicando o perfil do Organizador (renomear, ocultar, mover seção) sem reprocessar itens
  function getGroups(section, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    var options = opts || {};
    var listId = options.listId || getActiveListId();
    var sec = normSec(section);
    instrumentation.groupReads++;

    getListState(listId, function (err, state) {
      if (err || !state || !state.generationId) {
        return cb(null, []);
      }
      var genId = state.generationId;
      var recKey = listId + ':' + genId + ':' + sec;
      var st = getStorage();

      st.getRecord('groups', recKey, function (gErr, rec) {
        if (gErr || !rec || !Array.isArray(rec.groups)) {
          return cb(null, []);
        }
        var profile = (global.LuminaStore && global.LuminaStore.get('mappingProfile')) || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
        var renamed = profile.renamedGroups || {};
        var rules = profile.customGroupRules || {};
        var hideAdult = options.respectParental !== false && shouldFilterAdult();

        var outGroups = [];
        var totalVisibleCount = 0;

        for (var i = 0; i < rec.groups.length; i++) {
          var g = rec.groups[i];
          var customTarget = rules[g.originalName];
          if (customTarget === 'hidden') continue;
          if (customTarget && customTarget !== sec && !(sec === 'series' && customTarget === 'novela')) {
            continue;
          }
          if (hideAdult && g.adult) continue;

          var copyG = {
            id: g.id,
            index: g.index,
            originalName: g.originalName,
            displayName: renamed[g.originalName] || g.displayName || g.originalName,
            name: renamed[g.originalName] || g.displayName || g.originalName,
            count: g.count || 0,
            totalPages: g.totalPages || Math.ceil((g.count || 0) / PAGE_SIZE),
            order: g.order || i,
            adult: !!g.adult,
            suggestedSection: customTarget || g.suggestedSection || sec
          };
          totalVisibleCount += copyG.count;
          outGroups.push(copyG);
        }

        // Parte 5.7: Adiciona "Todos" quando a seção está pronta/indexada, ou "Recentes" no topo
        var allLabel = sec === 'live' ? 'Todos os Canais' : (sec === 'movie' ? 'Todos os Filmes' : 'Todas as Séries');
        var secState = state.sections && state.sections[sec];
        var isFullyIndexed = !!(secState && secState.status === 'ready');

        if (options.includeVirtualTop !== false) {
          if (isFullyIndexed) {
            outGroups.unshift({
              id: 'all',
              index: -1,
              originalName: allLabel,
              displayName: allLabel,
              name: allLabel,
              count: totalVisibleCount,
              totalPages: Math.ceil(totalVisibleCount / PAGE_SIZE),
              order: -2,
              adult: false,
              isVirtualAll: true
            });
          } else {
            outGroups.unshift({
              id: 'recent',
              index: -2,
              originalName: 'Recentes',
              displayName: 'Recentes',
              name: 'Recentes',
              count: 0,
              totalPages: 1,
              order: -1,
              adult: false,
              isVirtualRecent: true
            });
          }
        }

        cb(null, outGroups, {
          totalCount: totalVisibleCount,
          updatedAt: rec.updatedAt || state.updatedAt || 0,
          status: (secState && secState.status) || 'ready'
        });
      });
    });
  }

  function unpackPageLines(payloadStr, credsOrSource, filterAdultItems) {
    if (!payloadStr) return [];
    var lines = String(payloadStr).split('\n');
    var items = [];
    var unpackFn = global.LuminaImportWorker ? global.LuminaImportWorker.unpackTupleLine : null;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln) continue;
      var it = unpackFn ? unpackFn(ln) : JSON.parse(ln);
      if (filterAdultItems && it.adult) continue;
      it.url = resolvePlaybackUrl(it, credsOrSource);
      items.push(it);
    }
    return items;
  }

  function readRawGroupPage(listId, genId, section, groupId, pageIndex, cb) {
    var lru = sectionLru[section] || sectionLru.live;
    var cacheKey = listId + ':' + genId + ':' + section + ':' + groupId + ':' + pageIndex;
    var cached = lru.get(cacheKey);
    if (cached) {
      return cb(null, cached, true);
    }

    instrumentation.pageReads++;
    var st = getStorage();
    st.getRecord('pages', cacheKey, function (err, rec) {
      if (err || !rec) {
        return cb(err || new Error('Página não encontrada: ' + cacheKey), null, false);
      }
      // Parte 9.3: Verifica integridade por página usando checksum leve na leitura
      if (rec.checksum && typeof rec.payloadStr === 'string') {
        var actualSum = st.computeStringChecksum(rec.payloadStr);
        if (actualSum !== rec.checksum) {
          var corrErr = new Error('Vou recarregar só esta categoria (cache corrompido).');
          corrErr.code = 'PAGE_CHECKSUM_MISMATCH';
          corrErr.groupId = groupId;
          if (global.LuminaDiagLog) {
            global.LuminaDiagLog.record('error', {
              engine: 'LuminaCatalog',
              code: 'PAGE_CORRUPTED',
              message: 'Checksum inválido na página ' + cacheKey + '; marcada para recarga pontual.'
            });
          }
          return cb(corrErr, null, false);
        }
      }

      var lines = rec.payloadStr ? String(rec.payloadStr).split('\n') : [];
      var pageObj = {
        key: cacheKey,
        groupId: groupId,
        pageIndex: pageIndex,
        lines: lines
      };
      lru.put(cacheKey, pageObj);
      cb(null, pageObj, false);
    });
  }

  // Resolve uma lista de locators Uint32 ((groupIdx << 20) | (pageIdx << 8) | slotIdx) em objetos hidratados
  function hydrateLocatorsSlice(listId, genId, section, locatorsSlice, credsOrSource, filterAdultItems, cb) {
    if (!locatorsSlice || !locatorsSlice.length) return cb(null, []);
    var neededPagesMap = {};
    var neededPageKeys = [];

    for (var i = 0; i < locatorsSlice.length; i++) {
      var loc = locatorsSlice[i];
      var gIdx = (loc >>> 20) & 0xFFF;
      var pIdx = (loc >>> 8) & 0xFFF;
      var gId = 'g_' + section + '_' + gIdx;
      var pk = gId + ':' + pIdx;
      if (!neededPagesMap[pk]) {
        neededPagesMap[pk] = { groupId: gId, pageIndex: pIdx, pageObj: null };
        neededPageKeys.push(pk);
      }
    }

    var idx = 0;
    function fetchNextNeededPage() {
      if (idx >= neededPageKeys.length) {
        var out = [];
        var unpackFn = global.LuminaImportWorker.unpackTupleLine;
        for (var j = 0; j < locatorsSlice.length; j++) {
          var l = locatorsSlice[j];
          var gi = (l >>> 20) & 0xFFF;
          var pi = (l >>> 8) & 0xFFF;
          var si = l & 0xFF;
          var entry = neededPagesMap['g_' + section + '_' + gi + ':' + pi];
          if (entry && entry.pageObj && entry.pageObj.lines[si]) {
            var item = unpackFn(entry.pageObj.lines[si]);
            if (filterAdultItems && item.adult) continue;
            item.url = resolvePlaybackUrl(item, credsOrSource);
            out.push(item);
          }
        }
        return cb(null, out);
      }
      var k = neededPageKeys[idx++];
      var reqInfo = neededPagesMap[k];
      readRawGroupPage(listId, genId, section, reqInfo.groupId, reqInfo.pageIndex, function (err, pObj) {
        if (!err && pObj) reqInfo.pageObj = pObj;
        if ((idx & 31) === 0) setTimeout(fetchNextNeededPage, 0);
        else fetchNextNeededPage();
      });
    }
    fetchNextNeededPage();
  }

  // Parte 6.2: getPage(section, groupId|'all', order, pageIndex, cb) -> até 200 itens
  function getPage(section, groupId, order, pageIndex, cb, opts) {
    var options = opts || {};
    var listId = options.listId || getActiveListId();
    var sec = normSec(section);
    var grpId = groupId || 'all';
    var ord = order || 'default';
    var pIdx = Math.max(0, parseInt(pageIndex || 0, 10));
    var filterAdult = options.respectParental !== false && shouldFilterAdult();
    var credsOrSource = options.source || (global.LuminaStore ? global.LuminaStore.get('source') : null);

    if (grpId === 'recent' || ord === 'recent') {
      return getRecent(sec, PAGE_SIZE, function (rErr, recItems) {
        cb(rErr, {
          items: recItems || [],
          pageIndex: 0,
          totalPages: 1,
          totalItems: (recItems || []).length,
          order: 'recent'
        });
      }, options);
    }

    getListState(listId, function (err, state) {
      if (err || !state || !state.generationId) {
        return cb(null, { items: [], pageIndex: pIdx, totalPages: 0, totalItems: 0, order: ord });
      }
      var genId = state.generationId;
      var st = getStorage();

      // Caso 1: Ordem Alfabética ('az') usando Uint32Array pré-calculado na loja 'orders'
      if (ord === 'az') {
        var ordKey = listId + ':' + genId + ':' + sec + ':' + grpId + ':az';
        st.getRecord('orders', ordKey, function (oErr, ordRec) {
          if (oErr || !ordRec || !ordRec.locators) {
            return cb(null, { items: [], pageIndex: pIdx, totalPages: 0, totalItems: 0, order: 'az' });
          }
          var locs = ordRec.locators;
          var total = locs.length;
          var from = pIdx * PAGE_SIZE;
          var to = Math.min(from + PAGE_SIZE, total);
          var slice = [];
          for (var i = from; i < to; i++) slice.push(locs[i]);

          hydrateLocatorsSlice(listId, genId, sec, slice, credsOrSource, filterAdult, function (hErr, items) {
            cb(hErr, {
              items: items || [],
              pageIndex: pIdx,
              totalPages: Math.ceil(total / PAGE_SIZE),
              totalItems: total,
              letterJump: ordRec.letterJump || {},
              order: 'az'
            });
          });
        });
        return;
      }

      // Caso 2: Ordem padrão do provedor para um grupo específico
      if (grpId !== 'all') {
        readRawGroupPage(listId, genId, sec, grpId, pIdx, function (pErr, pageObj) {
          if (pErr) return cb(pErr, null);
          var items = unpackPageLines((pageObj.lines || []).join('\n'), credsOrSource, filterAdult);
          cb(null, {
            items: items,
            pageIndex: pIdx,
            totalPages: 1,
            totalItems: items.length,
            order: 'default'
          });
        });
        return;
      }

      // Caso 3: Ordem padrão para 'all' (atravessa os grupos visíveis na ordem do provedor)
      getGroups(sec, { listId: listId, includeVirtualTop: false, respectParental: filterAdult }, function (gErr, groups) {
        if (gErr || !groups || !groups.length) {
          return cb(null, { items: [], pageIndex: pIdx, totalPages: 0, totalItems: 0, order: 'default' });
        }
        var targetStart = pIdx * PAGE_SIZE;
        var targetEnd = targetStart + PAGE_SIZE;
        var runningCount = 0;
        var locatorsToFetch = [];

        for (var g = 0; g < groups.length; g++) {
          var grp = groups[g];
          var gStart = runningCount;
          var gEnd = runningCount + grp.count;
          runningCount = gEnd;

          if (gEnd <= targetStart) continue;
          if (gStart >= targetEnd) break;

          var localFrom = Math.max(0, targetStart - gStart);
          var localTo = Math.min(grp.count, targetEnd - gStart);
          for (var pos = localFrom; pos < localTo; pos++) {
            var gpIdx = Math.floor(pos / PAGE_SIZE);
            var gsIdx = pos % PAGE_SIZE;
            var loc = ((grp.index & 0xFFF) << 20) | ((gpIdx & 0xFFF) << 8) | (gsIdx & 0xFF);
            locatorsToFetch.push(loc);
          }
        }

        hydrateLocatorsSlice(listId, genId, sec, locatorsToFetch, credsOrSource, filterAdult, function (hErr, items) {
          cb(hErr, {
            items: items || [],
            pageIndex: pIdx,
            totalPages: Math.ceil(runningCount / PAGE_SIZE),
            totalItems: runningCount,
            order: 'default'
          });
        });
      });
    });
  }

  // Parte 7.6 e 13.3: Salto rápido por letra A..Z ou # em ordem A–Z
  function getLetterJumpIndex(section, groupId, letter, cb, opts) {
    var options = opts || {};
    var listId = options.listId || getActiveListId();
    var sec = normSec(section || 'movie');
    var grpId = groupId || 'all';
    var ch = String(letter || 'A').toUpperCase();

    getListState(listId, function (err, state) {
      if (err || !state || !state.generationId) return cb(null, null);
      var ordKey = listId + ':' + state.generationId + ':' + sec + ':' + grpId + ':az';
      getStorage().getRecord('orders', ordKey, function (oErr, ordRec) {
        if (oErr || !ordRec || !ordRec.letterJump) return cb(null, null);
        var pos = ordRec.letterJump[ch];
        if (typeof pos !== 'number') return cb(null, null);
        cb(null, {
          letter: ch,
          itemIndex: pos,
          pageIndex: Math.floor(pos / PAGE_SIZE),
          slotIndex: pos % PAGE_SIZE
        });
      });
    });
  }

  function getRecent(section, limit, cb, opts) {
    var options = opts || {};
    var listId = options.listId || getActiveListId();
    var maxItems = typeof limit === 'number' && limit > 0 ? limit : 20;
    var filterAdult = options.respectParental !== false && shouldFilterAdult();
    var credsOrSource = options.source || (global.LuminaStore ? global.LuminaStore.get('source') : null);

    getListState(listId, function (err, state) {
      if (err || !state || !state.generationId) return cb(null, []);
      var recKey = listId + ':' + state.generationId + ':' + normSec(section);
      getStorage().getRecord('groups', recKey, function (gErr, rec) {
        if (gErr || !rec || !rec.recentPayloadStr) return cb(null, []);
        var items = unpackPageLines(rec.recentPayloadStr, credsOrSource, filterAdult);
        cb(null, items.slice(0, maxItems));
      });
    });
  }

  function getSeriesDetail(seriesId, cb, opts) {
    var options = opts || {};
    var listId = options.listId || getActiveListId();
    var credsOrSource = options.source || (global.LuminaStore ? global.LuminaStore.get('source') : null);

    getListState(listId, function (err, state) {
      if (err || !state || !state.generationId) return cb(new Error('Catálogo não inicializado.'), null);
      var epKey = listId + ':' + state.generationId + ':series:' + seriesId;
      getStorage().getRecord('episodes', epKey, function (eErr, rec) {
        if (!eErr && rec && rec.payloadStr) {
          var eps = unpackPageLines(rec.payloadStr, credsOrSource, false);
          var seasonsMap = {};
          for (var i = 0; i < eps.length; i++) {
            var ep = eps[i];
            var sNum = ep.season || 1;
            if (!seasonsMap[sNum]) seasonsMap[sNum] = [];
            seasonsMap[sNum].push(ep);
          }
          var sKeys = Object.keys(seasonsMap).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
          var seasons = [];
          for (var j = 0; j < sKeys.length; j++) {
            var sn = sKeys[j];
            var list = seasonsMap[sn];
            list.sort(function (a, b) { return (a.episode || 1) - (b.episode || 1); });
            seasons.push({ seasonNumber: sn, episodes: list });
          }
          return cb(null, { seriesId: seriesId, seasons: seasons, totalEpisodes: eps.length });
        }
        cb(new Error('Episódios não encontrados para esta série.'), null);
      });
    });
  }

  function getItem(id, cb, opts) {
    if (!id) return cb(null, null);
    var options = opts || {};
    var credsOrSource = options.source || (global.LuminaStore ? global.LuminaStore.get('source') : null);

    // 1. Verifica nos retratos de favoritos e watchProgress primeiro (instantâneo, zero leitura de página!)
    if (global.LuminaStore) {
      var favs = global.LuminaStore.get('favorites') || {};
      if (favs[id] && typeof favs[id] === 'object' && favs[id].portrait) {
        return cb(null, hydratePortraitForPlayback(favs[id].portrait, credsOrSource));
      }
      var prog = global.LuminaStore.get('watchProgress') || {};
      if (prog[id] && prog[id].portrait) {
        return cb(null, hydratePortraitForPlayback(prog[id].portrait, credsOrSource));
      }
    }

    // 2. Verifica nos caches LRU de páginas
    var secNames = ['live', 'movie', 'series'];
    var unpackFn = global.LuminaImportWorker ? global.LuminaImportWorker.unpackTupleLine : null;
    for (var s = 0; s < secNames.length; s++) {
      var lru = sectionLru[secNames[s]];
      var keys = lru.keys();
      for (var k = 0; k < keys.length; k++) {
        var pageObj = lru.get(keys[k]);
        if (!pageObj || !pageObj.lines) continue;
        for (var l = 0; l < pageObj.lines.length; l++) {
          var line = pageObj.lines[l];
          if (line.indexOf(id + '\t') === 0 && unpackFn) {
            var item = unpackFn(line);
            item.url = resolvePlaybackUrl(item, credsOrSource);
            return cb(null, item);
          }
        }
      }
    }

    cb(null, null);
  }

  function getItems(ids, cb, opts) {
    var list = Array.isArray(ids) ? ids : [];
    var out = [];
    var i = 0;
    function next() {
      if (i >= list.length) return cb(null, out);
      getItem(list[i++], function (_, it) {
        if (it) out.push(it);
        next();
      }, opts);
    }
    next();
  }

  // Parte 5.8 e 6.2: Zapping e busca de canal por número dentro da categoria ativa
  function getAdjacentChannel(channelId, direction, groupId, cb, opts) {
    var grpId = groupId || 'all';
    getPage('live', grpId, 'default', 0, function (err, pageRes) {
      if (err || !pageRes || !pageRes.items || !pageRes.items.length) return cb(null, null);
      var items = pageRes.items;
      var idx = -1;
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === channelId) { idx = i; break; }
      }
      var delta = direction >= 0 ? 1 : -1;
      var nextIdx = (idx + delta + items.length) % items.length;
      cb(null, items[nextIdx] || null);
    }, opts);
  }

  function getChannelByNumber(channelNumber, groupId, cb, opts) {
    var num = parseInt(channelNumber, 10);
    if (isNaN(num) || num <= 0) return cb(null, null);
    var grpId = groupId || 'all';
    getPage('live', grpId, 'default', 0, function (err, pageRes) {
      if (err || !pageRes || !pageRes.items) return cb(null, null);
      var items = pageRes.items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].channelNumber === num) return cb(null, items[i]);
      }
      if (num - 1 < items.length) return cb(null, items[num - 1]);
      cb(null, null);
    }, opts);
  }

  // Parte 8.4: Pontuação de relevância da busca por aba (começa com > palavra inteira > prefixo de palavra > contém)
  function scoreSearchMatch(normTitle, normQuery, queryWords) {
    if (!normTitle || !normQuery) return 0;
    for (var w = 0; w < queryWords.length; w++) {
      if (normTitle.indexOf(queryWords[w]) === -1) return 0;
    }
    if (normTitle.indexOf(normQuery) === 0) return 400;

    var titleWords = normTitle.split(' ');
    var firstQ = queryWords[0];
    var hasExactWord = false;
    var hasWordPrefix = false;
    for (var i = 0; i < titleWords.length; i++) {
      var tw = titleWords[i];
      if (tw === firstQ) {
        hasExactWord = true;
        break;
      }
      if (tw.indexOf(firstQ) === 0) {
        hasWordPrefix = true;
      }
    }
    if (hasExactWord) return 300;
    if (hasWordPrefix) return 200;
    return 100;
  }

  // Parte 6.2 e 8.4: Busca individual por aba usando os buckets de prefixo de 2 letras em disco
  function search(section, query, opts, onResults) {
    if (typeof opts === 'function') {
      onResults = opts;
      opts = {};
    }
    var options = opts || {};
    var startMs = Date.now();
    instrumentation.searchCalls++;

    var listId = options.listId || getActiveListId();
    var sec = normSec(section || 'movie');
    var scope = options.scope || 'all'; // 'group' | 'all'
    var groupId = options.groupId || 'all';
    var limit = options.limit || 60;
    var cursor = Math.max(0, parseInt(options.cursor || 0, 10));
    var cancelToken = options.cancelToken || null;
    var filterAdult = options.respectParental !== false && shouldFilterAdult();
    var credsOrSource = options.source || (global.LuminaStore ? global.LuminaStore.get('source') : null);

    var normQuery = global.LuminaImportWorker
      ? global.LuminaImportWorker.normalizeSearchKey(query)
      : String(query || '').toLowerCase().trim();

    if (!normQuery) {
      return onResults(null, {
        items: [],
        totalMatched: 0,
        nextCursor: null,
        hasMore: false,
        elapsedMs: 0
      });
    }

    var queryWords = normQuery.split(' ').filter(Boolean);
    var firstWord = queryWords[0] || normQuery;
    var bucketKey = firstWord.length === 1 ? ('^' + firstWord) : firstWord.slice(0, 2);

    var targetGroupIdx = -1;
    if (scope === 'group' && groupId && groupId !== 'all' && groupId.indexOf('g_' + sec + '_') === 0) {
      targetGroupIdx = parseInt(groupId.replace('g_' + sec + '_', ''), 10);
    }

    getListState(listId, function (err, state) {
      if (cancelToken && cancelToken.cancelled) return;
      if (err || !state || !state.generationId) {
        return onResults(null, { items: [], totalMatched: 0, nextCursor: null, hasMore: false, elapsedMs: Date.now() - startMs });
      }

      var genId = state.generationId;
      var secState = (state.sections && state.sections[sec]) || {};
      var runsCount = Number(secState.searchRuns || 1);
      var st = getStorage();
      var candidateLocators = [];
      var runIdx = 0;

      function readNextRunBucket() {
        if (cancelToken && cancelToken.cancelled) return;
        if (runIdx >= runsCount) {
          evaluateCandidateLocators();
          return;
        }
        var rKey = listId + ':' + genId + ':' + sec + ':run:' + (runIdx++) + ':' + bucketKey;
        st.getRecord('searchIndex', rKey, function (_, rec) {
          if (rec && rec.postings) {
            var p = rec.postings;
            for (var i = 0; i < p.length; i++) {
              var loc = p[i];
              if (targetGroupIdx >= 0 && ((loc >>> 20) & 0xFFF) !== targetGroupIdx) {
                continue;
              }
              candidateLocators.push(loc);
            }
          }
          readNextRunBucket();
        });
      }

      function evaluateCandidateLocators() {
        if (!candidateLocators.length) {
          return onResults(null, {
            items: [],
            totalMatched: 0,
            nextCursor: null,
            hasMore: false,
            elapsedMs: Date.now() - startMs
          });
        }

        // Agrupa locators por página para ler cada página do disco apenas 1 vez!
        var pagesNeeded = {};
        var pageKeysOrder = [];
        for (var i = 0; i < candidateLocators.length; i++) {
          var loc = candidateLocators[i];
          var gIdx = (loc >>> 20) & 0xFFF;
          var pIdx = (loc >>> 8) & 0xFFF;
          var sIdx = loc & 0xFF;
          var gId = 'g_' + sec + '_' + gIdx;
          var pk = gId + ':' + pIdx;
          if (!pagesNeeded[pk]) {
            pagesNeeded[pk] = { groupId: gId, pageIndex: pIdx, slots: [] };
            pageKeysOrder.push(pk);
          }
          pagesNeeded[pk].slots.push({ slotIdx: sIdx, locator: loc });
        }

        var matchedEntries = [];
        var pkIdx = 0;
        var unpackFn = global.LuminaImportWorker.unpackTupleLine;
        var normFn = global.LuminaImportWorker.normalizeSearchKey;

        var targetMatchPool = cursor + Math.max(limit * 3, 180);
        function inspectNextPage() {
          if (cancelToken && cancelToken.cancelled) return;
          if (pkIdx >= pageKeysOrder.length || (pkIdx >= 16 && matchedEntries.length >= targetMatchPool)) {
            matchedEntries.sort(function (a, b) {
              if (b.score !== a.score) return b.score - a.score;
              return a.locator - b.locator;
            });

            var total = matchedEntries.length;
            var slice = matchedEntries.slice(cursor, cursor + limit);
            var outItems = [];
            for (var m = 0; m < slice.length; m++) {
              var it = unpackFn(slice[m].rawLine);
              it.url = resolvePlaybackUrl(it, credsOrSource);
              outItems.push(it);
            }
            var hasMore = (cursor + limit) < total;
            return onResults(null, {
              items: outItems,
              totalMatched: total,
              nextCursor: hasMore ? (cursor + limit) : null,
              hasMore: hasMore,
              elapsedMs: Date.now() - startMs
            });
          }

          var pk = pageKeysOrder[pkIdx++];
          var info = pagesNeeded[pk];
          readRawGroupPage(listId, genId, sec, info.groupId, info.pageIndex, function (_, pageObj) {
            if (pageObj && pageObj.lines) {
              var slots = info.slots;
              for (var s = 0; s < slots.length; s++) {
                var sl = slots[s];
                var rawLine = pageObj.lines[sl.slotIdx];
                if (!rawLine) continue;
                var tabParts = rawLine.split('\t');
                var isAdult = tabParts[12] === '1';
                if (filterAdult && isAdult) continue;
                var cleanT = tabParts[3] || tabParts[2] || '';
                var normT = normFn(cleanT);
                // Para consulta de 1 letra, exige que o título comece com ela (Parte 8.4)
                if (normQuery.length === 1) {
                  if (normT.charAt(0) === normQuery) {
                    matchedEntries.push({ score: 400, locator: sl.locator, rawLine: rawLine });
                  }
                } else {
                  var sc = scoreSearchMatch(normT, normQuery, queryWords);
                  if (sc > 0) {
                    matchedEntries.push({ score: sc, locator: sl.locator, rawLine: rawLine });
                  }
                }
              }
            }
            if ((pkIdx & 31) === 0) setTimeout(inspectNextPage, 0);
            else inspectNextPage();
          });
        }

        inspectNextPage();
      }

      readNextRunBucket();
    });
  }

  function subscribe(section, fn) {
    var key = section || 'all';
    if (!subscribersBySection[key]) subscribersBySection[key] = [];
    subscribersBySection[key].push(fn);
    return function unsubscribe() {
      var arr = subscribersBySection[key] || [];
      var idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    };
  }

  function notifySubscribers(section, payload) {
    var arr = (subscribersBySection[section] || []).concat(subscribersBySection.all || []);
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) {}
    }
  }

  function clearList(listId, cb) {
    var id = listId || getActiveListId();
    clearMemoryCaches();
    var st = getStorage();
    if (!st) return cb && cb(null);
    var stores = ['groups', 'pages', 'orders', 'searchIndex', 'episodes'];
    var idx = 0;
    function nextStore() {
      if (idx >= stores.length) {
        st.deleteRecord('checkpoints', id, function () {
          st.saveMeta('catalogState_' + id, createEmptyListState(id), function () {
            if (cb) cb(null);
          });
        });
        return;
      }
      st.deleteRecordsByPrefix(stores[idx++], id + ':', null, nextStore);
    }
    nextStore();
  }

  function clearSection(listId, section, cb) {
    var id = listId || getActiveListId();
    clearMemoryCaches(section);
    getListState(id, function (_, state) {
      if (!state || !state.generationId) return cb && cb(null);
      var prefix = id + ':' + state.generationId + ':' + section;
      var st = getStorage();
      st.deleteRecordsByPrefix('pages', prefix + ':', null, function () {
        st.deleteRecordsByPrefix('orders', prefix + ':', null, function () {
          st.deleteRecordsByPrefix('searchIndex', prefix + ':', null, function () {
            if (cb) cb(null);
          });
        });
      });
    });
  }

  function getStorageUsage(cb) {
    var st = getStorage();
    if (!st || !st.estimateStorageUsage) {
      return cb(null, { usageBytes: 0, quotaBytes: 0, formattedMb: '0,0 MB' });
    }
    st.estimateStorageUsage(function (err, est) {
      var bytes = (est && est.usageBytes) || 0;
      var mb = (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
      cb(err, {
        usageBytes: bytes,
        quotaBytes: (est && est.quotaBytes) || 0,
        formattedMb: mb
      });
    });
  }

  var api = {
    PAGE_SIZE: PAGE_SIZE,
    MAX_LRU_PAGES_PER_SECTION: MAX_LRU_PAGES_PER_SECTION,
    createLruCache: createLruCache,
    clearMemoryCaches: clearMemoryCaches,
    resolvePlaybackUrl: resolvePlaybackUrl,
    createItemPortrait: createItemPortrait,
    hydratePortraitForPlayback: hydratePortraitForPlayback,
    getListState: getListState,
    getListStateSync: getListStateSync,
    getGroups: getGroups,
    getPage: getPage,
    getLetterJumpIndex: getLetterJumpIndex,
    getRecent: getRecent,
    getSeriesDetail: getSeriesDetail,
    getItem: getItem,
    getItems: getItems,
    getAdjacentChannel: getAdjacentChannel,
    getChannelByNumber: getChannelByNumber,
    scoreSearchMatch: scoreSearchMatch,
    search: search,
    subscribe: subscribe,
    notifySubscribers: notifySubscribers,
    clearList: clearList,
    clearSection: clearSection,
    getStorageUsage: getStorageUsage,
    getSectionLruSize: function (sec) { return sectionLru[sec] ? sectionLru[sec].size() : 0; },
    getInstrumentationStats: function () { return JSON.parse(JSON.stringify(instrumentation)); },
    resetInstrumentationStats: function () {
      instrumentation = { pageReads: 0, groupReads: 0, searchCalls: 0, networkCalls: 0 };
    },
    recordNetworkCall: function () { instrumentation.networkCalls++; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaCatalog = api;
})(typeof window !== 'undefined' ? window : global);
