(function (global) {
  'use strict';

  function groupSeriesAndNovelas(items) {
    var seriesMap = {};
    var novelasMap = {};

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind !== 'episode' && it.kind !== 'series') continue;

      var targetMap = it.isNovela ? novelasMap : seriesMap;
      var key = it.seriesKey || it.id;

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
          groupOriginal: it.groupOriginal,
          groupDisplay: it.groupDisplay || it.groupOriginal,
          seasonsMap: {},
          seasons: [],
          totalEpisodes: 0,
          addedAt: it.addedAt || Date.now()
        };
      }

      var show = targetMap[key];
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
        var sNums = Object.keys(show.seasonsMap).map(function (n) { return parseInt(n, 10); });
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
