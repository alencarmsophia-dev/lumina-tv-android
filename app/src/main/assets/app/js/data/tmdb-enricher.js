(function (global) {
  'use strict';

  var TMDB_API_BASE = 'https://api.themoviedb.org/3';
  var TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w500';
  var memoryCache = {};

  function applyTmdbResult(item, tmdbItem) {
    if (!item || !tmdbItem) return item;
    if (tmdbItem.overview) item.synopsis = tmdbItem.overview;
    if (tmdbItem.poster_path && !item.logo) item.logo = TMDB_IMG_BASE + tmdbItem.poster_path;
    if (tmdbItem.backdrop_path) item.backdrop = TMDB_IMG_BASE + tmdbItem.backdrop_path;
    if (typeof tmdbItem.vote_average === 'number' && tmdbItem.vote_average > 0) {
      item.rating = tmdbItem.vote_average.toFixed(1);
    }
    var dateStr = tmdbItem.release_date || tmdbItem.first_air_date || '';
    if (dateStr && /^\d{4}/.test(dateStr)) {
      item.year = parseInt(dateStr.slice(0, 4), 10);
    }
    item.tmdbEnriched = true;
    return item;
  }

  // Parte 6.8: Enriquece apenas o item individual ao abrir a tela de detalhes, com cache
  function enrichSingleItemOnDemand(item, tmdbConfig, cb) {
    if (!item || item.tmdbEnriched) return cb && cb(null, item);
    var cfg = tmdbConfig || (global.LuminaStore ? global.LuminaStore.get('tmdb') : null) || {};
    if (!cfg.enabled || !cfg.apiKey) {
      return cb && cb(null, item);
    }
    var cacheKey = (item.section || item.kind || 'movie') + ':' + String(item.cleanTitle || '').toLowerCase();
    if (memoryCache[cacheKey]) {
      applyTmdbResult(item, memoryCache[cacheKey]);
      return cb && cb(null, item);
    }
    if (typeof XMLHttpRequest === 'undefined') {
      return cb && cb(null, item);
    }
    var endpoint = (item.section === 'series' || item.kind === 'series-show') ? '/search/tv' : '/search/movie';
    var url = TMDB_API_BASE + endpoint +
      '?api_key=' + encodeURIComponent(cfg.apiKey) +
      '&language=' + encodeURIComponent(cfg.language || 'pt-BR') +
      '&query=' + encodeURIComponent(item.cleanTitle || '');

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 6000;
    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);
        var hit = data && data.results && data.results[0];
        if (hit) {
          memoryCache[cacheKey] = hit;
          applyTmdbResult(item, hit);
        }
      } catch (e) {}
      if (cb) cb(null, item);
    };
    xhr.onerror = function () { if (cb) cb(null, item); };
    xhr.ontimeout = function () { if (cb) cb(null, item); };
    xhr.send();
  }

  function enrichCatalogBatch(tmdbConfig, cb) {
    if (cb) cb(null, 0);
  }

  var api = {
    applyTmdbResult: applyTmdbResult,
    enrichSingleItemOnDemand: enrichSingleItemOnDemand,
    enrichCatalogBatch: enrichCatalogBatch
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaTMDB = api;
})(typeof window !== 'undefined' ? window : global);
