(function (global) {
  'use strict';

  var DB_NAME = 'LuminaTV_DB';
  var DB_VER = 2;
  var SCHEMA_VERSION = 2;
  var dbInstance = null;
  var MAX_PERSISTED_RAW_ITEMS = 400000;
  var CHUNK_SIZE = 2500;
  var genSequence = 0;
  var simulatedFailAtChunk = -1; // usado apenas em testes automatizados de atomicidade

  // Mock de IndexedDB em memória para execução em Node.js (testes automatizados) ou ambientes sem IDB
  var memoryStoreData = {
    meta: {},
    items: {},
    seriesDetail: {}
  };

  function getLocalStoreObj() {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    return null;
  }

  function computeCatalogChecksum(items) {
    var h = 2166136261;
    var len = items ? items.length : 0;
    for (var i = 0; i < len; i++) {
      var it = items[i];
      var s = (it.id || '') + ':' + (it.kind || '') + ':' + (it.isNovela ? '1' : '0');
      for (var c = 0; c < s.length; c++) {
        h ^= s.charCodeAt(c);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
      }
    }
    return ((h >>> 0).toString(16)) + '_' + len;
  }

  function computeCatalogStats(items) {
    var stats = {
      total: 0,
      live: 0,
      movie: 0,
      series: 0,
      novela: 0,
      episode: 0,
      unclassified: 0,
      hidden: 0
    };
    if (!items || !items.length) return stats;
    stats.total = items.length;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var k = it.kind || 'unclassified';
      if (k === 'live') stats.live++;
      else if (k === 'movie') stats.movie++;
      else if (k === 'series-show') stats.series++;
      else if (k === 'novela-show') stats.novela++;
      else if (k === 'episode' || k === 'series') {
        if (it.isNovela) stats.novela++;
        else stats.episode++;
      } else if (k === 'hidden') stats.hidden++;
      else stats.unclassified++;
    }
    return stats;
  }

  function compactItemForStorage(it, stripMediaMeta) {
    if (!it) return null;
    var out = {
      id: it.id,
      kind: it.kind,
      isNovela: !!it.isNovela,
      title: it.title,
      cleanTitle: it.cleanTitle,
      seriesTitle: it.seriesTitle || '',
      year: it.year || 2024,
      rating: it.rating || 0,
      groupOriginal: it.groupOriginal || 'Sem Grupo',
      groupDisplay: it.groupDisplay || it.groupOriginal || 'Sem Grupo',
      groupMapped: it.groupMapped || '',
      url: it.url || '',
      tvgId: it.tvgId || '',
      season: it.season || null,
      episode: it.episode || null,
      seriesKey: it.seriesKey || null,
      addedAt: it.addedAt || 0,
      quality: it.quality || 'HD',
      lang: it.lang || 'DUB',
      adult: !!it.adult,
      sourceId: it.sourceId || 'default',
      kindSource: it.kindSource || '',
      kindConfidence: it.kindConfidence || 'medium'
    };
    if (it.xtreamSeriesId) out.xtreamSeriesId = it.xtreamSeriesId;
    if (it.needsSeriesInfo) out.needsSeriesInfo = true;
    if (it.totalEpisodes) out.totalEpisodes = it.totalEpisodes;
    if (it.httpUserAgent) out.httpUserAgent = it.httpUserAgent;
    if (it.httpReferrer) out.httpReferrer = it.httpReferrer;
    if (!stripMediaMeta) {
      if (it.logo) out.logo = it.logo;
      if (it.epgNow) out.epgNow = it.epgNow;
      if (it.epgNext) out.epgNext = it.epgNext;
      if (it.synopsis) out.synopsis = it.synopsis;
    }
    return out;
  }

  function openDB(cb) {
    if (dbInstance) return cb(null, dbInstance);
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      return cb(null, null); // fallback para memoryStoreData + localStorage
    }
    try {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('items')) {
          db.createObjectStore('items', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('seriesDetail')) {
          db.createObjectStore('seriesDetail', { keyPath: 'seriesId' });
        }
      };
      req.onsuccess = function (e) {
        dbInstance = e.target.result;
        cb(null, dbInstance);
      };
      req.onerror = function (e) {
        cb(e.target.error || new Error('Erro ao abrir IndexedDB'));
      };
    } catch (err) {
      cb(err);
    }
  }

  function putRecord(storeName, record, cb) {
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      if (!db) {
        var pk = storeName === 'meta' ? record.key : (storeName === 'seriesDetail' ? record.seriesId : record.id);
        memoryStoreData[storeName][pk] = JSON.parse(JSON.stringify(record));
        return cb && cb(null);
      }
      try {
        var tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = function () { if (cb) cb(null); };
        tx.onerror = function (e) { if (cb) cb(e.target && e.target.error ? e.target.error : new Error('Erro de escrita IDB')); };
      } catch (ex) {
        if (cb) cb(ex);
      }
    });
  }

  function getRecord(storeName, key, cb) {
    openDB(function (err, db) {
      if (err) return cb(err, null);
      if (!db) {
        var found = memoryStoreData[storeName][key];
        return cb(null, found ? JSON.parse(JSON.stringify(found)) : null);
      }
      try {
        var tx = db.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).get(key);
        req.onsuccess = function () { cb(null, req.result || null); };
        req.onerror = function (e) { cb(e.target && e.target.error ? e.target.error : new Error('Erro de leitura IDB'), null); };
      } catch (ex) {
        cb(ex, null);
      }
    });
  }

  function deleteRecord(storeName, key, cb) {
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      if (!db) {
        delete memoryStoreData[storeName][key];
        return cb && cb(null);
      }
      try {
        var tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = function () { if (cb) cb(null); };
        tx.onerror = function () { if (cb) cb(null); };
      } catch (ex) {
        if (cb) cb(null);
      }
    });
  }

  function listAllKeys(storeName, cb) {
    openDB(function (err, db) {
      if (err) return cb(err, []);
      if (!db) {
        return cb(null, Object.keys(memoryStoreData[storeName]));
      }
      try {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        if (typeof store.getAllKeys === 'function') {
          var req = store.getAllKeys();
          req.onsuccess = function () { cb(null, req.result || []); };
          req.onerror = function () { cb(null, []); };
        } else {
          var keys = [];
          var curReq = store.openCursor();
          curReq.onsuccess = function (e) {
            var cursor = e.target.result;
            if (cursor) {
              keys.push(cursor.key);
              cursor.continue();
            } else {
              cb(null, keys);
            }
          };
          curReq.onerror = function () { cb(null, keys); };
        }
      } catch (ex) {
        cb(null, []);
      }
    });
  }

  function saveMeta(key, value, cb) {
    var ls = getLocalStoreObj();
    if (ls && key !== 'tmdbCache') {
      try { ls.setItem('lumina_' + key, JSON.stringify(value)); } catch (e) {}
    }
    putRecord('meta', { key: key, value: value, updatedAt: Date.now() }, function (err) {
      if (cb) cb(err || null);
    });
  }

  function loadMeta(key, defaultVal, cb) {
    getRecord('meta', key, function (err, rec) {
      if (!err && rec && typeof rec.value !== 'undefined') {
        return cb(rec.value);
      }
      var ls = getLocalStoreObj();
      if (ls) {
        try {
          var raw = ls.getItem('lumina_' + key);
          if (raw) return cb(JSON.parse(raw));
        } catch (e) {}
      }
      cb(defaultVal);
    });
  }

  function cleanupOldGenerations(keepGenId, cb) {
    listAllKeys('items', function (err, keys) {
      if (err || !keys || !keys.length) return cb && cb(null);
      var prefixKeep = 'g' + keepGenId + ':';
      var toDelete = [];
      for (var i = 0; i < keys.length; i++) {
        var k = String(keys[i]);
        if (k.indexOf(prefixKeep) !== 0) {
          toDelete.push(k);
        }
      }
      var idx = 0;
      function delNext() {
        if (idx >= toDelete.length) return cb && cb(null);
        var key = toDelete[idx++];
        deleteRecord('items', key, function () {
          setTimeout(delNext, 0);
        });
      }
      delNext();
    });
  }

  // Gravação atômica por geração (B1):
  // 1. Grava todos os blocos g<genId>:chunk:<idx>
  // 2. Só atualiza meta.catalogGeneration quando 100% dos blocos foram confirmados
  // 3. Se falhar no meio, a geração anterior continua intacta!
  function saveCatalogBatchInternal(items, options, stripMedia, cb, onProgress) {
    var opts = options || {};
    var maxItems = opts.maxItems || MAX_PERSISTED_RAW_ITEMS;
    var truncated = items.length > maxItems;
    var slice = truncated ? items.slice(0, maxItems) : items;
    var totalChunks = Math.max(1, Math.ceil(slice.length / CHUNK_SIZE));
    var genId = String(Date.now()) + '_' + (++genSequence);
    var idx = 0;

    function abortGeneration(err) {
      // Remove os blocos parciais da geração que falhou sem tocar na geração ativa anterior
      listAllKeys('items', function (_, keys) {
        var badPrefix = 'g' + genId + ':';
        for (var k = 0; k < (keys || []).length; k++) {
          if (String(keys[k]).indexOf(badPrefix) === 0) {
            deleteRecord('items', keys[k]);
          }
        }
        if (cb) cb(err || new Error('Falha ao gravar catálogo no armazenamento.'));
      });
    }

    function writeNextChunk() {
      if (idx >= totalChunks) {
        var stats = computeCatalogStats(slice);
        var checksum = computeCatalogChecksum(slice);
        var genMeta = {
          schemaVersion: SCHEMA_VERSION,
          generation: genId,
          totalChunks: totalChunks,
          chunkSize: CHUNK_SIZE,
          stats: stats,
          checksum: checksum,
          classifierVersion: opts.classifierVersion || '2.0.0',
          truncated: truncated,
          originalTotal: items.length,
          strippedMedia: !!stripMedia,
          updatedAt: Date.now()
        };
        saveMeta('catalogGeneration', genMeta, function (metaErr) {
          if (metaErr) return abortGeneration(metaErr);
          cleanupOldGenerations(genId, function () {
            if (cb) cb(null, genMeta);
          });
        });
        return;
      }

      if (simulatedFailAtChunk >= 0 && idx === simulatedFailAtChunk) {
        return abortGeneration(new Error('Falha simulada na gravação do bloco ' + idx));
      }

      var from = idx * CHUNK_SIZE;
      var to = Math.min(from + CHUNK_SIZE, slice.length);
      var batch = [];
      for (var i = from; i < to; i++) {
        batch.push(compactItemForStorage(slice[i], stripMedia));
      }

      var chunkKey = 'g' + genId + ':chunk:' + idx;
      putRecord('items', { id: chunkKey, generation: genId, chunkIndex: idx, batch: batch }, function (err) {
        if (err) {
          var isQuota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message || err)));
          if (isQuota && !stripMedia) {
            // Fallback automático: tenta salvar sem URLs de logos/EPG para caber em aparelhos com pouco espaço
            return saveCatalogBatchInternal(items, options, true, cb, onProgress);
          }
          return abortGeneration(err);
        }
        idx++;
        if (onProgress) onProgress(idx / totalChunks);
        setTimeout(writeNextChunk, 0);
      });
    }

    writeNextChunk();
  }

  function saveCatalogBatch(items, cb, onProgress, options) {
    saveCatalogBatchInternal(items || [], options || {}, false, cb, onProgress);
  }

  // Carrega a geração ativa verificando integridade (contagens + checksum) sem usar .concat em loop
  function loadCatalog(cb, onProgress) {
    loadMeta('catalogGeneration', null, function (genMeta) {
      if (genMeta && genMeta.generation && typeof genMeta.totalChunks === 'number') {
        var totalChunks = genMeta.totalChunks;
        var genId = genMeta.generation;
        var out = [];
        var idx = 0;

        if (totalChunks === 0 || (genMeta.stats && genMeta.stats.total === 0)) {
          return cb(null, [], { generation: genId, stats: genMeta.stats, migratedFromV1: false, integrityOk: true });
        }

        function readNextChunk() {
          if (idx >= totalChunks) {
            var loadedStats = computeCatalogStats(out);
            var loadedChecksum = computeCatalogChecksum(out);
            var expectedTotal = genMeta.stats ? genMeta.stats.total : out.length;
            var integrityOk = (out.length === expectedTotal) && (!genMeta.checksum || loadedChecksum === genMeta.checksum);
            return cb(null, out, {
              generation: genId,
              stats: loadedStats,
              expectedStats: genMeta.stats,
              classifierVersion: genMeta.classifierVersion,
              migratedFromV1: false,
              truncated: !!genMeta.truncated,
              integrityOk: integrityOk,
              updatedAt: genMeta.updatedAt
            });
          }

          var chunkKey = 'g' + genId + ':chunk:' + idx;
          getRecord('items', chunkKey, function (err, rec) {
            if (err || !rec || !Array.isArray(rec.batch)) {
              return cb(new Error('Bloco de catálogo ausente ou corrompido (' + chunkKey + ')'), out, {
                generation: genId,
                integrityOk: false,
                migratedFromV1: false
              });
            }
            var b = rec.batch;
            for (var j = 0; j < b.length; j++) {
              out.push(b[j]);
            }
            idx++;
            if (onProgress) onProgress(idx / totalChunks);
            setTimeout(readNextChunk, 0);
          });
        }

        readNextChunk();
        return;
      }

      // Migração v1 -> v2: procura blocos antigos 'chunk_0', 'chunk_1'...
      listAllKeys('items', function (err, keys) {
        if (err || !keys || !keys.length) {
          return cb(null, [], { migratedFromV1: false, integrityOk: true });
        }
        var v1Keys = [];
        for (var i = 0; i < keys.length; i++) {
          if (String(keys[i]).indexOf('chunk_') === 0) v1Keys.push(String(keys[i]));
        }
        v1Keys.sort(function (a, b) {
          return parseInt(a.replace('chunk_', ''), 10) - parseInt(b.replace('chunk_', ''), 10);
        });
        if (!v1Keys.length) {
          return cb(null, [], { migratedFromV1: false, integrityOk: true });
        }

        var outV1 = [];
        var kIdx = 0;
        function readV1Next() {
          if (kIdx >= v1Keys.length) {
            return cb(null, outV1, {
              migratedFromV1: true,
              wasTruncatedAt25k: outV1.length >= 25000,
              integrityOk: true
            });
          }
          getRecord('items', v1Keys[kIdx++], function (_, rec) {
            if (rec && Array.isArray(rec.batch)) {
              for (var m = 0; m < rec.batch.length; m++) outV1.push(rec.batch[m]);
            }
            setTimeout(readV1Next, 0);
          });
        }
        readV1Next();
      });
    });
  }

  function saveSeriesDetail(seriesId, detailData, cb) {
    if (!seriesId) return cb && cb(null);
    putRecord('seriesDetail', {
      seriesId: String(seriesId),
      data: detailData,
      updatedAt: Date.now()
    }, cb);
  }

  function loadSeriesDetail(seriesId, cb) {
    if (!seriesId) return cb(null, null);
    getRecord('seriesDetail', String(seriesId), function (err, rec) {
      if (err || !rec) return cb(null, null);
      cb(null, rec);
    });
  }

  function resetMemoryStoreForTests(simulateChunkFailureIndex) {
    dbInstance = null;
    memoryStoreData = { meta: {}, items: {}, seriesDetail: {} };
    simulatedFailAtChunk = typeof simulateChunkFailureIndex === 'number' ? simulateChunkFailureIndex : -1;
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_PERSISTED_RAW_ITEMS: MAX_PERSISTED_RAW_ITEMS,
    CHUNK_SIZE: CHUNK_SIZE,
    saveMeta: saveMeta,
    loadMeta: loadMeta,
    saveCatalogBatch: saveCatalogBatch,
    loadCatalog: loadCatalog,
    saveSeriesDetail: saveSeriesDetail,
    loadSeriesDetail: loadSeriesDetail,
    computeCatalogStats: computeCatalogStats,
    computeCatalogChecksum: computeCatalogChecksum,
    resetMemoryStoreForTests: resetMemoryStoreForTests,
    setSimulatedChunkFailure: function (idx) { simulatedFailAtChunk = idx; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaStorage = api;
})(typeof window !== 'undefined' ? window : global);
