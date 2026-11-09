(function (global) {
  'use strict';

  var DB_NAME = 'LuminaTV_DB';
  var DB_VER = 3;
  var SCHEMA_VERSION = 3;
  var dbInstance = null;
  var MAX_PERSISTED_RAW_ITEMS = 2000000;
  var CHUNK_SIZE = 2500;
  var genSequence = 0;
  var simulatedFailAtChunk = -1;
  var simulatedQuotaExceeded = false;

  var STORE_NAMES = [
    'meta',
    'groups',
    'pages',
    'orders',
    'searchIndex',
    'episodes',
    'checkpoints',
    'items',
    'seriesDetail'
  ];

  var memoryStoreData = {
    meta: {},
    groups: {},
    pages: {},
    orders: {},
    searchIndex: {},
    episodes: {},
    checkpoints: {},
    items: {},
    seriesDetail: {}
  };

  var nodeDiskFd = null;
  var nodeDiskPath = "";
  var nodeDiskOffset = 0;
  var v8Mod = null;
  var fsMod = null;

  function enableNodeDiskBackend(filePath) {
    if (typeof process === "undefined" || !process.versions || !process.versions.node) return false;
    try {
      fsMod = require("fs");
      v8Mod = require("v8");
      if (nodeDiskFd !== null) {
        try { fsMod.closeSync(nodeDiskFd); } catch (e) {}
      }
      nodeDiskPath = filePath || "/tmp/lumina_idb_v22.bin";
      nodeDiskFd = fsMod.openSync(nodeDiskPath, "w+");
      nodeDiskOffset = 0;
      resetMemoryStoreForTests();
      return true;
    } catch (e) {
      return false;
    }
  }

  function disableNodeDiskBackend() {
    if (nodeDiskFd !== null && fsMod) {
      try { fsMod.closeSync(nodeDiskFd); } catch (e) {}
      try { if (nodeDiskPath) fsMod.unlinkSync(nodeDiskPath); } catch (e) {}
    }
    nodeDiskFd = null;
    nodeDiskPath = "";
    nodeDiskOffset = 0;
  }

  var DISK_LEN_MOD = 8388608; // 8 MB max por registro, suporta ate 1.07 GB por arquivo // 16 MB max por registro individual

  function writeDiskRecord(storeName, pk, record) {
    var buf = v8Mod.serialize(record);
    var pos = nodeDiskOffset;
    var len = buf.length;
    fsMod.writeSync(nodeDiskFd, buf, 0, len, pos);
    nodeDiskOffset += len;
    memoryStoreData[storeName][pk] = pos * DISK_LEN_MOD + len;
  }

  function readDiskRecord(packedNum) {
    if (typeof packedNum !== "number" || nodeDiskFd === null) return packedNum;
    var len = packedNum % DISK_LEN_MOD;
    var pos = Math.floor(packedNum / DISK_LEN_MOD);
    var buf = Buffer.allocUnsafe(len);
    fsMod.readSync(nodeDiskFd, buf, 0, len, pos);
    return v8Mod.deserialize(buf);
  }

  function getLocalStoreObj() {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    return null;
  }

  function getPrimaryKeyForStore(storeName, record) {
    if (!record) return '';
    if (storeName === 'meta') return record.key;
    if (storeName === 'seriesDetail') return record.seriesId;
    if (storeName === 'items') return record.id;
    return record.key || record.id || record.listId || '';
  }

  function computeStringChecksum(str) {
    var s = String(str || '');
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return (h >>> 0).toString(16) + '_' + s.length;
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

  function openDB(cb) {
    if (dbInstance) return cb(null, dbInstance);
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      return cb(null, null);
    }
    try {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('searchIndex')) db.createObjectStore('searchIndex', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('episodes')) db.createObjectStore('episodes', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('checkpoints')) db.createObjectStore('checkpoints', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('seriesDetail')) db.createObjectStore('seriesDetail', { keyPath: 'seriesId' });
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
    if (simulatedQuotaExceeded) {
      var qErr = new Error('QuotaExceededError: espaço insuficiente no armazenamento.');
      qErr.name = 'QuotaExceededError';
      return cb && cb(qErr);
    }
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      if (!db) {
        var pk = getPrimaryKeyForStore(storeName, record);
        if (nodeDiskFd !== null && storeName !== "meta" && storeName !== "groups") {
          writeDiskRecord(storeName, pk, record);
        } else {
          memoryStoreData[storeName][pk] = record;
        }
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

  // Grava múltiplos registros em uma única transação (ex.: até 8 páginas por vez, Parte 6.4)
  function putRecordsBatch(storeName, records, cb) {
    if (!records || !records.length) return cb && cb(null);
    if (simulatedQuotaExceeded) {
      var qErr = new Error('QuotaExceededError: espaço insuficiente no armazenamento.');
      qErr.name = 'QuotaExceededError';
      return cb && cb(qErr);
    }
    openDB(function (err, db) {
      if (err) return cb && cb(err);
      if (!db) {
        var map = memoryStoreData[storeName];
        var useDisk = (nodeDiskFd !== null && storeName !== "meta" && storeName !== "groups");
        for (var i = 0; i < records.length; i++) {
          var rec = records[i];
          var pk = getPrimaryKeyForStore(storeName, rec);
          if (useDisk) writeDiskRecord(storeName, pk, rec);
          else map[pk] = rec;
        }
        return cb && cb(null);
      }
      try {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        for (var j = 0; j < records.length; j++) {
          store.put(records[j]);
        }
        tx.oncomplete = function () { if (cb) cb(null); };
        tx.onerror = function (e) { if (cb) cb(e.target && e.target.error ? e.target.error : new Error('Erro em transação IDB')); };
      } catch (ex) {
        if (cb) cb(ex);
      }
    });
  }

  function getRecord(storeName, key, cb) {
    openDB(function (err, db) {
      if (err) return cb(err, null);
      if (!db) {
        var found = memoryStoreData[storeName] ? memoryStoreData[storeName][key] : null;
        if (typeof found === "number") {
          return cb(null, readDiskRecord(found));
        }
        return cb(null, found || null);
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
        if (memoryStoreData[storeName]) delete memoryStoreData[storeName][key];
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
        return cb(null, Object.keys(memoryStoreData[storeName] || {}));
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

  function deleteRecordsByPrefix(storeName, prefix, keepPrefix, cb) {
    listAllKeys(storeName, function (err, keys) {
      if (err || !keys || !keys.length) return cb && cb(null, 0);
      var toDelete = [];
      for (var i = 0; i < keys.length; i++) {
        var k = String(keys[i]);
        if (k.indexOf(prefix) === 0 && (!keepPrefix || k.indexOf(keepPrefix) !== 0)) {
          toDelete.push(k);
        }
      }
      if (!toDelete.length) return cb && cb(null, 0);

      openDB(function (dbErr, db) {
        if (dbErr || !db) {
          var map = memoryStoreData[storeName] || {};
          for (var m = 0; m < toDelete.length; m++) {
            delete map[toDelete[m]];
          }
          return cb && cb(null, toDelete.length);
        }
        var idx = 0;
        var BATCH = 50;
        function delNextBatch() {
          if (idx >= toDelete.length) return cb && cb(null, toDelete.length);
          var end = Math.min(idx + BATCH, toDelete.length);
          try {
            var tx = db.transaction(storeName, 'readwrite');
            var st = tx.objectStore(storeName);
            for (; idx < end; idx++) st.delete(toDelete[idx]);
            tx.oncomplete = function () { setTimeout(delNextBatch, 0); };
            tx.onerror = function () { setTimeout(delNextBatch, 0); };
          } catch (e) {
            cb && cb(null, idx);
          }
        }
        delNextBatch();
      });
    });
  }

  // Parte 10.2: Apaga blocos antigos g*:chunk:* da v2.1.0 em pequenos lotes sem travar
  function cleanupLegacyV21ChunksInBatches(maxKeysPerBatch, cb) {
    var limit = maxKeysPerBatch || 20;
    listAllKeys('items', function (err, keys) {
      if (err || !keys || !keys.length) return cb && cb(null, 0);
      var batch = keys.slice(0, limit);
      var i = 0;
      function next() {
        if (i >= batch.length) return cb && cb(null, batch.length, keys.length - batch.length);
        deleteRecord('items', batch[i++], next);
      }
      next();
    });
  }

  // Estima o uso de armazenamento em bytes (Parte 6.4)
  function estimateStorageUsage(cb) {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then(function (est) {
        cb(null, {
          usageBytes: Number(est.usage || 0),
          quotaBytes: Number(est.quota || 0)
        });
      }, function () {
        estimateMemoryUsageFallback(cb);
      });
      return;
    }
    estimateMemoryUsageFallback(cb);
  }

  function estimateMemoryUsageFallback(cb) {
    var totalBytes = 0;
    for (var s = 0; s < STORE_NAMES.length; s++) {
      var stName = STORE_NAMES[s];
      var map = memoryStoreData[stName] || {};
      var keys = Object.keys(map);
      for (var i = 0; i < keys.length; i++) {
        var rec = map[keys[i]];
        if (!rec) continue;
        if (typeof rec.payloadStr === 'string') {
          totalBytes += rec.payloadStr.length + keys[i].length + 24;
        } else {
          try { totalBytes += JSON.stringify(rec).length; } catch (e) { totalBytes += 128; }
        }
      }
    }
    cb(null, { usageBytes: totalBytes, quotaBytes: 512 * 1024 * 1024 });
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

  // Compatibilidade legada para testes v1.6.0 (saveCatalogBatch / loadCatalog)
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
    if (!stripMediaMeta) {
      if (it.logo) out.logo = it.logo;
      if (it.epgNow) out.epgNow = it.epgNow;
      if (it.synopsis) out.synopsis = it.synopsis;
    }
    return out;
  }

  function saveCatalogBatchInternal(items, options, stripMedia, cb, onProgress) {
    var opts = options || {};
    var maxItems = opts.maxItems || MAX_PERSISTED_RAW_ITEMS;
    var truncated = items.length > maxItems;
    var slice = truncated ? items.slice(0, maxItems) : items;
    var totalChunks = Math.max(1, Math.ceil(slice.length / CHUNK_SIZE));
    var genId = String(Date.now()) + '_' + (++genSequence);
    var idx = 0;

    function abortGeneration(err) {
      deleteRecordsByPrefix('items', 'g' + genId + ':', null, function () {
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
          classifierVersion: opts.classifierVersion || '2.2.0',
          truncated: truncated,
          originalTotal: items.length,
          strippedMedia: !!stripMedia,
          updatedAt: Date.now()
        };
        saveMeta('catalogGeneration', genMeta, function (metaErr) {
          if (metaErr) return abortGeneration(metaErr);
          deleteRecordsByPrefix('items', 'g', 'g' + genId + ':', function () {
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
        if (err) return abortGeneration(err);
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
            for (var j = 0; j < b.length; j++) out.push(b[j]);
            idx++;
            if (onProgress) onProgress(idx / totalChunks);
            setTimeout(readNextChunk, 0);
          });
        }
        readNextChunk();
        return;
      }
      cb(null, [], { migratedFromV1: false, integrityOk: true });
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
    memoryStoreData = {
      meta: {},
      groups: {},
      pages: {},
      orders: {},
      searchIndex: {},
      episodes: {},
      checkpoints: {},
      items: {},
      seriesDetail: {}
    };
    simulatedFailAtChunk = typeof simulateChunkFailureIndex === 'number' ? simulateChunkFailureIndex : -1;
    if (nodeDiskFd !== null && fsMod) {
      try { fsMod.ftruncateSync(nodeDiskFd, 0); } catch (e) {}
      nodeDiskOffset = 0;
    }
    simulatedQuotaExceeded = false;
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAX_PERSISTED_RAW_ITEMS: MAX_PERSISTED_RAW_ITEMS,
    CHUNK_SIZE: CHUNK_SIZE,
    STORE_NAMES: STORE_NAMES,
    putRecord: putRecord,
    putRecordsBatch: putRecordsBatch,
    getRecord: getRecord,
    deleteRecord: deleteRecord,
    listAllKeys: listAllKeys,
    deleteRecordsByPrefix: deleteRecordsByPrefix,
    cleanupLegacyV21ChunksInBatches: cleanupLegacyV21ChunksInBatches,
    estimateStorageUsage: estimateStorageUsage,
    computeStringChecksum: computeStringChecksum,
    saveMeta: saveMeta,
    loadMeta: loadMeta,
    saveCatalogBatch: saveCatalogBatch,
    loadCatalog: loadCatalog,
    saveSeriesDetail: saveSeriesDetail,
    loadSeriesDetail: loadSeriesDetail,
    computeCatalogStats: computeCatalogStats,
    computeCatalogChecksum: computeCatalogChecksum,
    resetMemoryStoreForTests: resetMemoryStoreForTests,
    enableNodeDiskBackend: enableNodeDiskBackend,
    disableNodeDiskBackend: disableNodeDiskBackend,
    getDiskBytesUsed: function () { return nodeDiskOffset; },
    dumpAllStoresForTests: function () { return memoryStoreData; },
    setSimulatedChunkFailure: function (idx) { simulatedFailAtChunk = idx; },
    setSimulatedQuotaExceeded: function (flag) { simulatedQuotaExceeded = !!flag; },
    getSimulatedFailAtChunk: function () { return simulatedFailAtChunk; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaStorage = api;
})(typeof window !== 'undefined' ? window : global);
