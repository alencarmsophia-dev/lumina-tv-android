(function (global) {
  'use strict';
  var DB_NAME = 'LuminaTV_DB';
  var DB_VER = 1;
  var dbInstance = null;
  var MAX_PERSISTED_RAW_ITEMS = 25000; // Protege a cota de armazenamento flash da TV LG
  var CHUNK_SIZE = 2500;

  function openDB(cb) {
    if (dbInstance) return cb(null, dbInstance);
    if (typeof indexedDB === 'undefined') return cb(new Error('IndexedDB indisponível'));
    try {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      };
      req.onsuccess = function (e) { dbInstance = e.target.result; cb(null, dbInstance); };
      req.onerror = function (e) { cb(e.target.error || new Error('Erro IndexedDB')); };
    } catch (err) { cb(err); }
  }

  global.LuminaStorage = {
    saveMeta: function (key, value, cb) {
      try { localStorage.setItem('lumina_' + key, JSON.stringify(value)); } catch (e) {}
      openDB(function (err, db) {
        if (err || !db) return cb && cb(null);
        try {
          var tx = db.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ key: key, value: value });
          tx.oncomplete = function () { if (cb) cb(null); };
          tx.onerror = function () { if (cb) cb(null); };
        } catch (ex) { if (cb) cb(null); }
      });
    },
    loadMeta: function (key, defaultVal, cb) {
      openDB(function (err, db) {
        if (!err && db) {
          try {
            var tx = db.transaction('meta', 'readonly');
            var req = tx.objectStore('meta').get(key);
            req.onsuccess = function () {
              if (req.result && typeof req.result.value !== 'undefined') return cb(req.result.value);
              fallbackLocal();
            };
            req.onerror = fallbackLocal;
            return;
          } catch (ex) {}
        }
        fallbackLocal();
      });
      function fallbackLocal() {
        try {
          var raw = localStorage.getItem('lumina_' + key);
          if (raw) return cb(JSON.parse(raw));
        } catch (e) {}
        cb(defaultVal);
      }
    },
    // Grava em blocos compactos de 2.500 itens (100x mais rápido que 200.000 .put() individuais na TV LG)
    saveCatalogBatch: function (items, cb, onProgress) {
      openDB(function (err, db) {
        if (err || !db) return cb && cb(err);
        var slice = items.length > MAX_PERSISTED_RAW_ITEMS ? items.slice(0, MAX_PERSISTED_RAW_ITEMS) : items;
        var total = Math.max(1, Math.ceil(slice.length / CHUNK_SIZE));
        var idx = 0;
        function fail(e) { if (cb) cb(e || new Error('Falha ao salvar')); }
        function putNext() {
          if (idx >= total) return cb && cb(null);
          try {
            // Uma transação por bloco + pausa entre eles: a TV continua respondendo ao controle
            var tx = db.transaction('items', 'readwrite');
            tx.objectStore('items').put({ id: 'chunk_' + idx, batch: slice.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE) });
            tx.oncomplete = function () {
              idx++;
              if (onProgress) onProgress(idx / total);
              setTimeout(putNext, 0);
            };
            tx.onerror = function (e) { fail(e.target && e.target.error); };
          } catch (ex) { fail(ex); }
        }
        try {
          var clearTx = db.transaction('items', 'readwrite');
          clearTx.objectStore('items').clear();
          clearTx.oncomplete = putNext;
          clearTx.onerror = function (e) { fail(e.target && e.target.error); };
        } catch (ex) { fail(ex); }
      });
    },
    loadCatalog: function (cb) {
      openDB(function (err, db) {
        if (err || !db) return cb(null, []);
        try {
          var tx = db.transaction('items', 'readonly');
          var req = tx.objectStore('items').getAll();
          req.onsuccess = function () {
            var records = req.result || [];
            var flat = [];
            for (var i = 0; i < records.length; i++) {
              if (records[i] && Array.isArray(records[i].batch)) {
                flat = flat.concat(records[i].batch);
              } else if (records[i]) {
                flat.push(records[i]);
              }
            }
            cb(null, flat);
          };
          req.onerror = function () { cb(null, []); };
        } catch (ex) { cb(null, []); }
      });
    }
  };
})(typeof window !== 'undefined' ? window : global);
