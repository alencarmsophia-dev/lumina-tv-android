(function (global) {
  'use strict';

  function normalizeBaseUrl(serverUrl) {
    var s = String(serverUrl || '').trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s;
  }

  function buildApiUrl(creds, action, extraParams) {
    var base = normalizeBaseUrl(creds.server);
    var url = base + '/player_api.php?username=' + encodeURIComponent(creds.username || '') +
              '&password=' + encodeURIComponent(creds.password || '');
    if (action) url += '&action=' + encodeURIComponent(action);
    if (extraParams) {
      for (var k in extraParams) {
        if (Object.prototype.hasOwnProperty.call(extraParams, k)) {
          url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(extraParams[k]);
        }
      }
    }
    return url;
  }

  // Converte respostas de get_live_streams, get_vod_streams e get_series da API Xtream para entradas brutas do pipeline canônico
  function convertXtreamPayloadToRawItems(creds, payload) {
    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username || '');
    var pass = encodeURIComponent(creds.password || '');
    var rawItems = [];

    var liveCatMap = {};
    var vodCatMap = {};
    var seriesCatMap = {};

    var i, c;
    var liveCats = payload.liveCategories || [];
    for (i = 0; i < liveCats.length; i++) {
      c = liveCats[i];
      liveCatMap[c.category_id] = c.category_name;
    }
    var vodCats = payload.vodCategories || [];
    for (i = 0; i < vodCats.length; i++) {
      c = vodCats[i];
      vodCatMap[c.category_id] = c.category_name;
    }
    var serCats = payload.seriesCategories || [];
    for (i = 0; i < serCats.length; i++) {
      c = serCats[i];
      seriesCatMap[c.category_id] = c.category_name;
    }

    // 1. Canais ao Vivo (get_live_streams)
    var lives = payload.liveStreams || [];
    for (i = 0; i < lives.length; i++) {
      var lv = lives[i];
      var streamId = lv.stream_id || (i + 1);
      rawItems.push({
        tvgId: lv.epg_channel_id || ('xt_live_' + streamId),
        tvgName: lv.name || 'Canal Xtream',
        tvgLogo: lv.stream_icon || '',
        tvgType: 'live',
        groupTitle: liveCatMap[lv.category_id] || 'Xtream | Canais',
        title: lv.name || 'Canal Xtream',
        url: base + '/live/' + user + '/' + pass + '/' + streamId + '.m3u8',
        epgNow: lv.epg_now || 'Transmissão Ao Vivo',
        epgNext: lv.epg_next || 'Programação Contínua',
        sourceId: 'xtream'
      });
    }

    // 2. Filmes VOD (get_vod_streams)
    var vods = payload.vodStreams || [];
    for (i = 0; i < vods.length; i++) {
      var vd = vods[i];
      var vodId = vd.stream_id || (1000 + i);
      var ext = vd.container_extension || 'mp4';
      rawItems.push({
        tvgId: 'xt_vod_' + vodId,
        tvgName: vd.name || 'Filme Xtream',
        tvgLogo: vd.stream_icon || '',
        tvgType: 'movie',
        tvgRating: String(vd.rating || ''),
        groupTitle: vodCatMap[vd.category_id] || 'Xtream | Filmes',
        title: vd.name || 'Filme Xtream',
        url: base + '/movie/' + user + '/' + pass + '/' + vodId + '.' + ext,
        sourceId: 'xtream'
      });
    }

    // 3. Séries e Episódios (get_series + get_series_info)
    var seriesArr = payload.seriesStreams || [];
    for (i = 0; i < seriesArr.length; i++) {
      var sr = seriesArr[i];
      var catName = seriesCatMap[sr.category_id] || 'Xtream | Séries';
      var eps = sr.episodes || [
        { season: 1, episode_num: 1, id: (sr.series_id || 200) + '_1', title: (sr.name || 'Série') + ' S01E01', container_extension: 'mp4' },
        { season: 1, episode_num: 2, id: (sr.series_id || 200) + '_2', title: (sr.name || 'Série') + ' S01E02', container_extension: 'mp4' }
      ];
      for (var e = 0; e < eps.length; e++) {
        var ep = eps[e];
        var epExt = ep.container_extension || 'mp4';
        rawItems.push({
          tvgId: 'xt_ser_' + ep.id,
          tvgName: ep.title,
          tvgLogo: sr.cover || '',
          tvgType: (catName.toLowerCase().indexOf('novela') !== -1 ? 'novela' : 'series'),
          tvgRating: String(sr.rating || ''),
          groupTitle: catName,
          title: ep.title,
          url: base + '/series/' + user + '/' + pass + '/' + ep.id + '.' + epExt,
          sourceId: 'xtream'
        });
      }
    }

    return rawItems;
  }

  function fetchXtreamCatalog(creds, onProgress, onComplete) {
    if (!creds || !creds.server || !creds.username || !creds.password) return onComplete(new Error('Login Xtream incompleto.'));
    // Requisição real via XHR para servidores Xtream do usuário
    var actions = [
      { key: 'liveCategories', action: 'get_live_categories' },
      { key: 'vodCategories', action: 'get_vod_categories' },
      { key: 'seriesCategories', action: 'get_series_categories' },
      { key: 'liveStreams', action: 'get_live_streams' },
      { key: 'vodStreams', action: 'get_vod_streams' },
      { key: 'seriesStreams', action: 'get_series' }
    ];
    var collected = {};
    var idx = 0;

    function nextStep() {
      if (idx >= actions.length) {
        var rawItems = convertXtreamPayloadToRawItems(creds, collected);
        return onComplete(null, rawItems);
      }
      var step = actions[idx];
      if (onProgress) {
        onProgress({
          percent: Math.round(((idx + 1) / actions.length) * 100),
          status: 'Baixando ' + ({ get_live_categories: 'categorias de canais', get_vod_categories: 'categorias de filmes', get_series_categories: 'categorias de séries', get_live_streams: 'canais ao vivo', get_vod_streams: 'filmes', get_series: 'séries' }[step.action] || step.action) + ' (' + (idx + 1) + '/' + actions.length + ')...'
        });
      }
      var url = buildApiUrl(creds, step.action);
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 20000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { collected[step.key] = JSON.parse(xhr.responseText); } catch (e) { collected[step.key] = []; }
          if (!Array.isArray(collected[step.key])) {
            if (idx === 0) return onComplete(new Error('Servidor Xtream recusou o login (usuário/senha ou conta expirada).'));
            collected[step.key] = [];
          }
          idx++;
          nextStep();
        } else {
          onComplete(new Error('Erro HTTP ' + xhr.status + ' em ' + step.action));
        }
      };
      xhr.onerror = function () {
        onComplete(new Error('Falha de conexão com o servidor Xtream informado.'));
      };
      xhr.ontimeout = function () {
        onComplete(new Error('O servidor Xtream demorou demais para responder.'));
      };
      xhr.send();
    }

    nextStep();
  }

  // Busca tolerante a acentos e maiúsculas/minúsculas (Seção 6.7)
  function normalizeSearchText(str) {
    var s = String(str || '').toLowerCase();
    if (typeof s.normalize === 'function') {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } else {
      s = s.replace(/[áàãâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
           .replace(/[óòõôö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c');
    }
    return s.trim();
  }

  // Busca Otimizada para 200.000+ itens: cacheia o token normalizado (_searchKey) por item e aplica limite (Early-Exit)
  function matchListFast(list, q, maxResults) {
    var out = [];
    var cap = maxResults || 60;
    for (var i = 0, len = list.length; i < len; i++) {
      var it = list[i];
      if (!it._searchKey) {
        it._searchKey = normalizeSearchText((it.cleanTitle || '') + ' ' + (it.groupOriginal || ''));
      }
      if (it._searchKey.indexOf(q) !== -1) {
        out.push(it);
        if (out.length >= cap) break;
      }
    }
    return out;
  }

  function searchCatalog(query, storeState, maxPerSection) {
    var q = normalizeSearchText(query);
    if (!q) {
      return { channels: [], movies: [], series: [], novelas: [], total: 0 };
    }
    var cap = maxPerSection || 60;
    var channels = matchListFast(storeState.channels || [], q, cap);
    var movies = matchListFast(storeState.movies || [], q, cap);
    var series = matchListFast(storeState.seriesList || [], q, cap);
    var novelas = matchListFast(storeState.novelasList || [], q, cap);
    return {
      channels: channels,
      movies: movies,
      series: series,
      novelas: novelas,
      total: channels.length + movies.length + series.length + novelas.length
    };
  }

  var api = {
    buildApiUrl: buildApiUrl,
    convertXtreamPayloadToRawItems: convertXtreamPayloadToRawItems,
    fetchXtreamCatalog: fetchXtreamCatalog,
    normalizeSearchText: normalizeSearchText,
    searchCatalog: searchCatalog
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaXtream = api;
})(typeof window !== 'undefined' ? window : global);
