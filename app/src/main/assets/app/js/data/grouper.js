(function (global) {
  'use strict';

  function groupSeriesAndNovelas(items) {
    var seriesMap = {};
    var novelasMap = {};

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;

      // Caso 1: Série-pai ou Novela-pai vinda direto do Xtream (get_series sem episódios falsos, B3)
      if (it.kind === 'series-show' || it.kind === 'novela-show') {
        var parentMap = it.isNovela ? novelasMap : seriesMap;
        var pKey = it.id || it.seriesKey;
        if (!parentMap[pKey]) {
          parentMap[pKey] = {
            id: pKey,
            kind: it.isNovela ? 'novela-show' : 'series-show',
            isNovela: !!it.isNovela,
            cleanTitle: it.cleanTitle || it.seriesTitle,
            year: it.year || 2024,
            rating: it.rating || 8.5,
            quality: it.quality || 'FHD',
            lang: it.lang || 'DUB',
            logo: it.logo || '',
            backdrop: it.backdrop || '',
            synopsis: it.synopsis || '',
            groupOriginal: it.groupOriginal,
            groupDisplay: it.groupDisplay || it.groupOriginal,
            groupMapped: it.isNovela ? 'Novelas' : 'Séries',
            xtreamSeriesId: it.xtreamSeriesId || null,
            needsSeriesInfo: !!it.needsSeriesInfo,
            seasonsMap: {},
            seasons: it.seasons || [],
            totalEpisodes: it.totalEpisodes || 0,
            adult: !!it.adult,
            addedAt: it.addedAt || Date.now()
          };
        }
        continue;
      }

      if (it.kind !== 'episode' && it.kind !== 'series') continue;

      var targetMap = it.isNovela ? novelasMap : seriesMap;
      var key = it.seriesKey || ('s:show_' + it.id);

      if (!targetMap[key]) {
        targetMap[key] = {
          id: key,
          kind: it.isNovela ? 'novela-show' : 'series-show',
          isNovela: !!it.isNovela,
          cleanTitle: it.seriesTitle || it.cleanTitle,
          year: it.year || 2024,
          rating: it.rating || 8.5,
          quality: it.quality || 'FHD',
          lang: it.lang || 'DUB',
          logo: it.logo || '',
          backdrop: it.backdrop || '',
          synopsis: it.synopsis || '',
          groupOriginal: it.groupOriginal,
          groupDisplay: it.groupDisplay || it.groupOriginal,
          groupMapped: it.isNovela ? 'Novelas' : 'Séries',
          xtreamSeriesId: it.xtreamSeriesId || null,
          needsSeriesInfo: false,
          seasonsMap: {},
          seasons: [],
          totalEpisodes: 0,
          adult: !!it.adult,
          addedAt: it.addedAt || Date.now()
        };
      }

      var show = targetMap[key];
      if (!show.logo && it.logo) show.logo = it.logo;
      var sNum = it.season || 1;
      if (!show.seasonsMap[sNum]) {
        show.seasonsMap[sNum] = [];
      }
      show.seasonsMap[sNum].push(it);
      show.totalEpisodes++;
    }

    function finalizeList(mapObj) {
      var list = [];
      for (var k in mapObj) {
        if (!Object.prototype.hasOwnProperty.call(mapObj, k)) continue;
        var show = mapObj[k];
        var sKeys = Object.keys(show.seasonsMap || {});
        if (sKeys.length > 0) {
          var sNums = sKeys.map(function (n) { return parseInt(n, 10); });
          sNums.sort(function (a, b) { return a - b; });
          show.seasons = [];
          for (var idx = 0; idx < sNums.length; idx++) {
            var s = sNums[idx];
            var eps = show.seasonsMap[s];
            eps.sort(function (a, b) { return (a.episode || 1) - (b.episode || 1); });
            show.seasons.push({
              seasonNumber: s,
              episodes: eps
            });
          }
        }
        delete show.seasonsMap;
        list.push(show);
      }
      return list;
    }

    return {
      seriesList: finalizeList(seriesMap),
      novelasList: finalizeList(novelasMap)
    };
  }

  var api = { groupSeriesAndNovelas: groupSeriesAndNovelas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaGrouper = api;
})(typeof window !== 'undefined' ? window : global);
