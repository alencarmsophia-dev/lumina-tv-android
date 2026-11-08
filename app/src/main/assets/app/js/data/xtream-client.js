(function (global) {
  'use strict';

  var seriesInfoMemoryCache = {};
  var searchTokenCache = {}; // índice separado para não poluir os objetos persistidos (_searchKey)

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

  function buildLiveStreamUrl(creds, streamId, ext) {
    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username || '');
    var pass = encodeURIComponent(creds.password || '');
    var format = ext || 'm3u8';
    return base + '/live/' + user + '/' + pass + '/' + streamId + '.' + format;
  }

  // Interpreta user_info e server_info devolvidos por player_api.php sem action (B5)
  function parseAccountInfo(rawJson) {
    if (!rawJson || typeof rawJson !== 'object' || !rawJson.user_info) {
      return null;
    }
    var u = rawJson.user_info;
    var s = rawJson.server_info || {};
    var auth = Number(u.auth || 0) === 1 || String(u.status || '').toLowerCase() === 'active';
    var status = String(u.status || (auth ? 'Active' : 'Disabled'));
    var expTimestampSec = u.exp_date ? parseInt(u.exp_date, 10) : null;
    var expDateIso = null;
    var daysRemaining = null;
    var isExpired = false;
    var isExpiringSoon = false;

    if (expTimestampSec && !isNaN(expTimestampSec) && expTimestampSec > 0) {
      var expMs = expTimestampSec * 1000;
      expDateIso = new Date(expMs).toISOString().slice(0, 10);
      var diffDays = Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24));
      daysRemaining = diffDays;
      isExpired = diffDays < 0;
      isExpiringSoon = diffDays >= 0 && diffDays <= 7;
    }
    if (status.toLowerCase() === 'expired') isExpired = true;

    var allowedFormats = Array.isArray(u.allowed_output_formats)
      ? u.allowed_output_formats.map(function (f) { return String(f).toLowerCase(); })
      : ['m3u8', 'ts'];

    return {
      auth: auth && !isExpired,
      status: status,
      username: u.username || '',
      isTrial: String(u.is_trial || '0') === '1',
      activeCons: parseInt(u.active_cons || '0', 10) || 0,
      maxConnections: parseInt(u.max_connections || '1', 10) || 1,
      expDate: expDateIso,
      daysRemaining: daysRemaining,
      isExpired: isExpired,
      isExpiringSoon: isExpiringSoon,
      allowedOutputFormats: allowedFormats,
      serverProtocol: s.server_protocol || 'http',
      timezone: s.timezone || 'America/Sao_Paulo',
      checkedAt: Date.now()
    };
  }

  // Converte respostas de get_live_streams, get_vod_streams e get_series da API Xtream
  // B3 corrigido: NÃO cria mais episódios falsos quando sr.episodes está ausente!
  function convertXtreamPayloadToRawItems(creds, payload, preferredLiveExt) {
    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username || '');
    var pass = encodeURIComponent(creds.password || '');
    var liveExt = preferredLiveExt || 'm3u8';
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
        xtreamId: String(streamId),
        xtreamKind: 'live',
        tvgId: lv.epg_channel_id || ('xt_live_' + streamId),
        tvgName: lv.name || 'Canal Xtream',
        tvgLogo: lv.stream_icon || '',
        tvgType: 'live',
        groupTitle: liveCatMap[lv.category_id] || 'Xtream | Canais',
        title: lv.name || 'Canal Xtream',
        url: base + '/live/' + user + '/' + pass + '/' + streamId + '.' + liveExt,
        epgNow: lv.epg_now || 'Transmissão Ao Vivo',
        epgNext: lv.epg_next || 'Programação Contínua',
        addedAt: lv.added ? parseInt(lv.added, 10) * 1000 : (Date.now() - i),
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
        xtreamId: String(vodId),
        xtreamKind: 'movie',
        tvgId: 'xt_vod_' + vodId,
        tvgName: vd.name || 'Filme Xtream',
        tvgLogo: vd.stream_icon || '',
        tvgType: 'movie',
        tvgRating: String(vd.rating || ''),
        groupTitle: vodCatMap[vd.category_id] || 'Xtream | Filmes',
        title: vd.name || 'Filme Xtream',
        url: base + '/movie/' + user + '/' + pass + '/' + vodId + '.' + ext,
        addedAt: vd.added ? parseInt(vd.added, 10) * 1000 : (Date.now() - i),
        sourceId: 'xtream'
      });
    }

    // 3. Séries (get_series)
    // Se a fixture de teste já trouxe sr.episodes embutido, converte-os;
    // Se veio de um servidor Xtream real (sem sr.episodes), cria o item-pai da série para busca sob demanda via get_series_info!
    var seriesArr = payload.seriesStreams || [];
    for (i = 0; i < seriesArr.length; i++) {
      var sr = seriesArr[i];
      var seriesId = sr.series_id || (2000 + i);
      var catName = seriesCatMap[sr.category_id] || 'Xtream | Séries';
      var isNovelaCat = /novela|folhetim|vale a pena/i.test(catName);

      if (Array.isArray(sr.episodes) && sr.episodes.length > 0) {
        for (var e = 0; e < sr.episodes.length; e++) {
          var ep = sr.episodes[e];
          var epExt = ep.container_extension || 'mp4';
          rawItems.push({
            xtreamId: String(ep.id),
            xtreamSeriesId: String(seriesId),
            xtreamKind: isNovelaCat ? 'novela' : 'series',
            tvgId: 'xt_ser_' + ep.id,
            tvgName: ep.title,
            tvgLogo: sr.cover || '',
            tvgType: isNovelaCat ? 'novela' : 'series',
            tvgRating: String(sr.rating || ''),
            groupTitle: catName,
            title: ep.title,
            season: parseInt(ep.season || '1', 10) || 1,
            episode: parseInt(ep.episode_num || (e + 1), 10) || (e + 1),
            url: base + '/series/' + user + '/' + pass + '/' + ep.id + '.' + epExt,
            sourceId: 'xtream'
          });
        }
      } else {
        rawItems.push({
          xtreamId: String(seriesId),
          xtreamSeriesId: String(seriesId),
          xtreamKind: isNovelaCat ? 'novela-show' : 'series-show',
          needsSeriesInfo: true,
          tvgId: 'xt_show_' + seriesId,
          tvgName: sr.name || 'Série Xtream',
          tvgLogo: sr.cover || '',
          backdrop: (Array.isArray(sr.backdrop_path) && sr.backdrop_path[0]) ? sr.backdrop_path[0] : '',
          synopsis: sr.plot || '',
          tvgType: isNovelaCat ? 'novela-show' : 'series-show',
          tvgRating: String(sr.rating || ''),
          groupTitle: catName,
          title: sr.name || 'Série Xtream',
          url: '',
          addedAt: sr.last_modified ? parseInt(sr.last_modified, 10) * 1000 : (Date.now() - i),
          sourceId: 'xtream'
        });
      }
    }

    return rawItems;
  }

  // Converte a resposta de player_api.php?action=get_series_info&series_id=<id> em temporadas e episódios reais (B3)
  function convertSeriesInfoResponse(creds, parentShow, apiData) {
    var base = normalizeBaseUrl(creds.server);
    var user = encodeURIComponent(creds.username || '');
    var pass = encodeURIComponent(creds.password || '');
    var episodesBySeason = (apiData && apiData.episodes) || {};
    var info = (apiData && apiData.info) || {};
    var seasons = [];
    var totalEps = 0;

    var seasonKeys = Object.keys(episodesBySeason);
    seasonKeys.sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });

    for (var i = 0; i < seasonKeys.length; i++) {
      var sKey = seasonKeys[i];
      var sNum = parseInt(sKey, 10) || (i + 1);
      var rawEps = episodesBySeason[sKey];
      if (!Array.isArray(rawEps) || !rawEps.length) continue;

      var epList = [];
      for (var j = 0; j < rawEps.length; j++) {
        var ep = rawEps[j];
        var epId = String(ep.id || (parentShow.xtreamSeriesId + '_' + sNum + '_' + (j + 1)));
        var epNum = parseInt(ep.episode_num || (j + 1), 10) || (j + 1);
        var ext = String(ep.container_extension || 'mp4').replace(/^\.+/, '');
        var epInfo = ep.info || {};
        var rawTitle = ep.title || (parentShow.cleanTitle + ' - T' + sNum + ':E' + epNum);

        var epItem = {
          id: 'i:xt:ep:' + epId,
          xtreamId: epId,
          xtreamSeriesId: String(parentShow.xtreamSeriesId || ''),
          kind: 'episode',
          isNovela: !!parentShow.isNovela,
          title: rawTitle,
          cleanTitle: rawTitle,
          seriesTitle: parentShow.cleanTitle,
          seriesKey: parentShow.id,
          season: sNum,
          episode: epNum,
          durationSecs: parseInt(epInfo.duration_secs || '0', 10) || 0,
          synopsis: epInfo.plot || '',
          logo: epInfo.movie_image || parentShow.logo || info.cover || '',
          groupOriginal: parentShow.groupOriginal || 'Séries',
          groupDisplay: parentShow.groupDisplay || parentShow.groupOriginal || 'Séries',
          groupMapped: parentShow.isNovela ? 'Novelas' : 'Séries',
          quality: parentShow.quality || 'FHD',
          lang: parentShow.lang || 'DUB',
          adult: !!parentShow.adult,
          url: base + '/series/' + user + '/' + pass + '/' + epId + '.' + ext,
          sourceId: 'xtream'
        };
        epList.push(epItem);
        totalEps++;
      }

      epList.sort(function (a, b) { return a.episode - b.episode; });
      seasons.push({
        seasonNumber: sNum,
        episodes: epList
      });
    }

    return {
      seasons: seasons,
      totalEpisodes: totalEps,
      synopsis: info.plot || parentShow.synopsis || '',
      backdrop: (Array.isArray(info.backdrop_path) && info.backdrop_path[0]) ? info.backdrop_path[0] : (parentShow.backdrop || ''),
      cover: info.cover || parentShow.logo || ''
    };
  }

  function xhrGetJsonWithRetry(url, timeoutMs, maxRetries, cancelToken, cb) {
    var attempt = 0;
    var max = typeof maxRetries === 'number' ? maxRetries : 2;

    function tryOnce() {
      if (cancelToken && cancelToken.cancelled) {
        return cb(new Error('Operação cancelada pelo usuário.'));
      }
      attempt++;
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs || 35000;
      xhr.onload = function () {
        if (xhr.status === 401 || xhr.status === 403) {
          return cb(new Error('Servidor Xtream recusou o login (usuário/senha incorretos ou assinatura expirada).'));
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var parsed = JSON.parse(xhr.responseText);
            return cb(null, parsed);
          } catch (e) {
            return cb(new Error('Resposta inválida do servidor Xtream.'));
          }
        }
        retryOrFail(new Error('Erro HTTP ' + xhr.status));
      };
      xhr.onerror = function () {
        retryOrFail(new Error('Falha de rede ao conectar ao servidor Xtream.'));
      };
      xhr.ontimeout = function () {
        retryOrFail(new Error('Tempo limite esgotado ao aguardar o servidor Xtream.'));
      };
      try {
        xhr.send();
      } catch (ex) {
        retryOrFail(ex);
      }
    }

    function retryOrFail(err) {
      if (attempt <= max && !(cancelToken && cancelToken.cancelled)) {
        var delay = Math.min(1500 * Math.pow(2, attempt - 1), 6000);
        setTimeout(tryOnce, delay);
      } else {
        cb(err);
      }
    }

    tryOnce();
  }

  function fetchAccountInfo(creds, cb) {
    if (!creds || !creds.server || !creds.username || !creds.password) {
      return cb(new Error('Credenciais Xtream incompletas.'));
    }
    var url = buildApiUrl(creds, null);
    xhrGetJsonWithRetry(url, 15000, 1, null, function (err, data) {
      if (err) return cb(err, null);
      var info = parseAccountInfo(data);
      if (!info) return cb(new Error('Não foi possível validar os dados da conta Xtream.'), null);
      cb(null, info);
    });
  }

  // Carrega temporadas e episódios reais sob demanda (get_series_info) com cache em memória e no IndexedDB (B3)
  function fetchSeriesInfo(creds, parentShow, cb, forceRefresh) {
    if (!parentShow) return cb(new Error('Série inválida.'));
    if (!parentShow.needsSeriesInfo && parentShow.seasons && parentShow.seasons.length > 0 && !forceRefresh) {
      return cb(null, parentShow);
    }
    var seriesId = String(parentShow.xtreamSeriesId || '').trim();
    if (!seriesId) return cb(new Error('ID da série ausente para consulta Xtream.'));

    function applyConverted(converted) {
      parentShow.seasons = converted.seasons || [];
      parentShow.totalEpisodes = converted.totalEpisodes || 0;
      parentShow.needsSeriesInfo = false;
      if (converted.synopsis && !parentShow.synopsis) parentShow.synopsis = converted.synopsis;
      if (converted.backdrop && !parentShow.backdrop) parentShow.backdrop = converted.backdrop;
      if (converted.cover && !parentShow.logo) parentShow.logo = converted.cover;

      // Registra episódios no itemByIdMap global para que o player, favoritos e "Continuar Assistindo" os encontrem
      if (global.LuminaStore) {
        var byId = global.LuminaStore.get('itemByIdMap') || {};
        for (var s = 0; s < parentShow.seasons.length; s++) {
          var eps = parentShow.seasons[s].episodes || [];
          for (var e = 0; e < eps.length; e++) {
            byId[eps[e].id] = eps[e];
          }
        }
        global.LuminaStore.set('itemByIdMap', byId);
      }
      cb(null, parentShow);
    }

    if (!forceRefresh && seriesInfoMemoryCache[seriesId]) {
      return applyConverted(seriesInfoMemoryCache[seriesId]);
    }

    if (!forceRefresh && global.LuminaStorage && global.LuminaStorage.loadSeriesDetail) {
      global.LuminaStorage.loadSeriesDetail(seriesId, function (_, cachedRec) {
        var MAX_AGE_MS = 24 * 60 * 60 * 1000;
        if (cachedRec && cachedRec.data && (Date.now() - (cachedRec.updatedAt || 0) < MAX_AGE_MS)) {
          seriesInfoMemoryCache[seriesId] = cachedRec.data;
          return applyConverted(cachedRec.data);
        }
        fetchFromServer();
      });
      return;
    }

    fetchFromServer();

    function fetchFromServer() {
      var activeCreds = creds || (global.LuminaStore && global.LuminaStore.get('xtreamCreds'));
      if (!activeCreds || !activeCreds.server) {
        return cb(new Error('Credenciais Xtream não encontradas para carregar episódios.'));
      }
      var url = buildApiUrl(activeCreds, 'get_series_info', { series_id: seriesId });
      xhrGetJsonWithRetry(url, 25000, 2, null, function (err, data) {
        if (err) return cb(err);
        var converted = convertSeriesInfoResponse(activeCreds, parentShow, data);
        seriesInfoMemoryCache[seriesId] = converted;
        if (global.LuminaStorage && global.LuminaStorage.saveSeriesDetail) {
          global.LuminaStorage.saveSeriesDetail(seriesId, converted);
        }
        applyConverted(converted);
      });
    }
  }

  function fetchXtreamCatalog(creds, onProgress, onComplete, cancelToken) {
    if (!creds || !creds.server || !creds.username || !creds.password) {
      return onComplete(new Error('Login Xtream incompleto.'));
    }

    // Etapa 0: Valida conta (user_info) para checar expiração e formato preferido
    fetchAccountInfo(creds, function (accErr, accInfo) {
      if (accInfo && global.LuminaStore) {
        global.LuminaStore.set('accountInfo', accInfo);
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('accountInfo', accInfo);
        if (accInfo.isExpired || !accInfo.auth) {
          return onComplete(new Error('Sua conta Xtream está expirada ou inativa (status: ' + accInfo.status + ').'));
        }
      }

      var preferredExt = 'm3u8';
      if (accInfo && Array.isArray(accInfo.allowedOutputFormats)) {
        if (accInfo.allowedOutputFormats.indexOf('m3u8') !== -1) preferredExt = 'm3u8';
        else if (accInfo.allowedOutputFormats.indexOf('ts') !== -1) preferredExt = 'ts';
      }

      var actions = [
        { key: 'liveCategories', action: 'get_live_categories', label: 'categorias de canais', timeout: 25000 },
        { key: 'vodCategories', action: 'get_vod_categories', label: 'categorias de filmes', timeout: 25000 },
        { key: 'seriesCategories', action: 'get_series_categories', label: 'categorias de séries', timeout: 25000 },
        { key: 'liveStreams', action: 'get_live_streams', label: 'canais ao vivo', timeout: 45000 },
        { key: 'vodStreams', action: 'get_vod_streams', label: 'filmes VOD', timeout: 60000 },
        { key: 'seriesStreams', action: 'get_series', label: 'séries e novelas', timeout: 45000 }
      ];

      var collected = {};
      var stepReport = [];
      var idx = 0;

      function nextStep() {
        if (cancelToken && cancelToken.cancelled) {
          return onComplete(new Error('Atualização cancelada pelo usuário.'));
        }
        if (idx >= actions.length) {
          var rawItems = convertXtreamPayloadToRawItems(creds, collected, preferredExt);
          return onComplete(null, rawItems, { accountInfo: accInfo, stepReport: stepReport });
        }

        var step = actions[idx];
        if (onProgress) {
          onProgress({
            percent: Math.round(((idx + 1) / actions.length) * 100),
            status: 'Baixando ' + step.label + ' (' + (idx + 1) + '/' + actions.length + ')...'
          });
        }

        var url = buildApiUrl(creds, step.action);
        xhrGetJsonWithRetry(url, step.timeout, 2, cancelToken, function (err, data) {
          if (err) {
            // Se falhar logo na 1ª etapa e não tínhamos validação de conta, aborta
            if (idx === 0 && !accInfo) {
              return onComplete(err);
            }
            // Falha isolada em uma etapa (ex.: get_series) não derruba canais e filmes já baixados (B6.1)
            collected[step.key] = [];
            stepReport.push({ action: step.action, label: step.label, ok: false, error: err.message });
          } else {
            if (!Array.isArray(data)) {
              if (idx === 0 && !accInfo) {
                return onComplete(new Error('Servidor Xtream recusou o login (usuário/senha inválidos ou conta expirada).'));
              }
              collected[step.key] = [];
              stepReport.push({ action: step.action, label: step.label, ok: false, error: 'Formato inesperado' });
            } else {
              collected[step.key] = data;
              stepReport.push({ action: step.action, label: step.label, ok: true, count: data.length });
            }
          }
          idx++;
          nextStep();
        });
      }

      nextStep();
    });
  }

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

  function getSearchTokenForItem(it) {
    var id = it.id || it.cleanTitle;
    if (searchTokenCache[id]) return searchTokenCache[id];
    var tok = normalizeSearchText((it.cleanTitle || '') + ' ' + (it.groupOriginal || ''));
    searchTokenCache[id] = tok;
    return tok;
  }

  // Busca com relevância (início do título > início de palavra > substring) sem mutar objetos do catálogo (B7)
  function matchListFast(list, q, maxResults) {
    var exactPrefix = [];
    var wordPrefix = [];
    var substring = [];
    var cap = maxResults || 60;
    var wordBoundary = ' ' + q;

    for (var i = 0, len = list.length; i < len; i++) {
      var it = list[i];
      var tok = getSearchTokenForItem(it);
      var pos = tok.indexOf(q);
      if (pos === -1) continue;
      if (pos === 0) {
        exactPrefix.push(it);
      } else if (tok.indexOf(wordBoundary) !== -1) {
        wordPrefix.push(it);
      } else {
        substring.push(it);
      }
      if (exactPrefix.length >= cap) break;
    }

    return exactPrefix.concat(wordPrefix, substring).slice(0, cap);
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

  function clearSearchCache() {
    searchTokenCache = {};
  }

  var api = {
    buildApiUrl: buildApiUrl,
    buildLiveStreamUrl: buildLiveStreamUrl,
    parseAccountInfo: parseAccountInfo,
    convertXtreamPayloadToRawItems: convertXtreamPayloadToRawItems,
    convertSeriesInfoResponse: convertSeriesInfoResponse,
    fetchAccountInfo: fetchAccountInfo,
    fetchSeriesInfo: fetchSeriesInfo,
    fetchXtreamCatalog: fetchXtreamCatalog,
    normalizeSearchText: normalizeSearchText,
    searchCatalog: searchCatalog,
    clearSearchCache: clearSearchCache
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaXtream = api;
})(typeof window !== 'undefined' ? window : global);
