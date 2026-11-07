(function (global) {
  'use strict';

  var memoryCache = {};
  var MAX_PER_RUN = 80;

  function normalizeLookupKey(title) {
    return String(title || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Aplica um resultado REAL do TMDB ({ overview, vote_average, release_date | first_air_date }) ao item.
  function applyTmdbResult(item, hit) {
    if (!item || !hit) return item;
    if (hit.overview) item.synopsis = hit.overview;
    if (hit.vote_average) item.rating = String(Math.round(hit.vote_average * 10) / 10);
    var date = hit.release_date || hit.first_air_date || '';
    if (date && !item.year) item.year = parseInt(date.slice(0, 4), 10) || item.year;
    item.tmdbEnriched = true;
    return item;
  }

  // Reaplica o que já foi baixado antes (cache), sem rede.
  function enrichItem(item) {
    if (!item) return item;
    var hit = memoryCache[normalizeLookupKey(item.cleanTitle)];
    return hit ? applyTmdbResult(item, hit) : item;
  }

  function searchTmdb(cfg, item, cb) {
    var type = item.kind === 'movie' ? 'movie' : 'tv';
    var url = 'https://api.themoviedb.org/3/search/' + type +
      '?api_key=' + encodeURIComponent(cfg.apiKey) +
      '&language=' + encodeURIComponent(cfg.language || 'pt-BR') +
      '&query=' + encodeURIComponent(item.cleanTitle || '');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 8000;
    xhr.onload = function () {
      if (xhr.status === 401) return cb(new Error('Chave TMDB inválida.'));
      try { cb(null, (JSON.parse(xhr.responseText).results || [])[0] || null); } catch (e) { cb(null, null); }
    };
    xhr.onerror = function () { cb(null, null); };
    xhr.ontimeout = function () { cb(null, null); };
    xhr.send();
  }

  function enrichCatalogBatch(cfg, callback) {
    if (!cfg || !cfg.apiKey) {
      return callback(new Error('Informe sua chave TMDB em app-config.json (tmdb.apiKey) para enriquecer o catálogo.'), 0);
    }
    var store = global.LuminaStore;
    var all = (store.get('movies') || []).concat(store.get('seriesList') || [], store.get('novelasList') || []);
    var queue = [];
    var done = 0;
    for (var i = 0; i < all.length && queue.length < MAX_PER_RUN; i++) {
      var it = all[i];
      if (it.tmdbEnriched || !it.cleanTitle) continue;
      var key = normalizeLookupKey(it.cleanTitle);
      if (memoryCache[key]) { applyTmdbResult(it, memoryCache[key]); done++; continue; }
      queue.push({ item: it, key: key });
    }

    function finish(err) {
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('tmdbCache', memoryCache);
      callback(err || null, done);
    }
    function next() {
      var job = queue.shift();
      if (!job) return finish(null);
      searchTmdb(cfg, job.item, function (err, hit) {
        if (err) return finish(err);
        if (hit) { memoryCache[job.key] = hit; applyTmdbResult(job.item, hit); done++; }
        next();
      });
    }
    next();
  }

  global.LuminaTMDB = {
    enrichItem: enrichItem,
    applyTmdbResult: applyTmdbResult,
    enrichCatalogBatch: enrichCatalogBatch,
    getCache: function () { return memoryCache; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LuminaTMDB;
  }
})(typeof window !== 'undefined' ? window : global);
