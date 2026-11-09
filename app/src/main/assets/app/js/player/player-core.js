(function (global) {
  'use strict';

  var STATES = {
    IDLE: 'IDLE',
    LOADING: 'LOADING',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    BUFFERING: 'BUFFERING',
    RETRYING: 'RETRYING',
    ENDED: 'ENDED',
    FAILED: 'FAILED'
  };

  var DEFAULT_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';
  var ALT_USER_AGENTS = [
    'Lumina TV/2.1.0 (Android)',
    'okhttp/4.12.0',
    'Mozilla/5.0 (Linux; Android 11; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36'
  ];

  var USER_AGENT_PRESETS = {
    vlc: 'VLC/3.0.20 LibVLC/3.0.20',
    lumina: 'Lumina TV/2.1.0 (Android)',
    iptv: 'IPTVSmartersPlayer',
    chrome: 'Mozilla/5.0 (Linux; Android 11; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36'
  };

  var GLOBAL_FALLBACK_BUDGET_MS = 45000;
  var WATCHDOG_LIVE_MS = 20000;
  var WATCHDOG_VOD_MS = 30000;
  var NEXT_EP_OFFER_SECS = 30;

  var state = STATES.IDLE;
  var currentItem = null;
  var activeEngine = null;
  var fallbackPlan = [];
  var fallbackIndex = 0;
  var connectTimeout = null;
  var progressSaveInterval = null;
  var nextEpOfferTicker = null;
  var watchdogTimer = null;
  var nextEpCountdownTimer = null;
  var offeredEpisodeId = null;
  var dismissedNextEpForId = null;
  var openStartTime = 0;
  var stepStartTime = 0;
  var lastProgressAdvanceAt = 0;
  var lastObservedPositionSec = -1;
  var zapDebounceTimer = null;
  var hostUserAgentMap = {};
  var currentUaFallbackIdx = -1;
  var currentStepServerRetried = false;
  var currentStepWatchdogRetried = false;
  var forcedFormatOverride = null; // 'm3u8' | 'ts' | null
  var forcedEngineOverride = null; // 'exo' | 'web' | null

  function isHlsPath(url) {
    return /\.m3u8($|\?)/i.test(String(url || ''));
  }

  function isTsPath(url) {
    return /\.ts($|\?)/i.test(String(url || ''));
  }

  function isMkvPath(url) {
    return /\.mkv($|\?)/i.test(String(url || ''));
  }

  function isDirectVodPath(url) {
    return /\.(mp4|mkv|avi|mov|webm|flv)($|\?)/i.test(String(url || ''));
  }

  function detectFormatLabel(url) {
    var u = String(url || '');
    if (isHlsPath(u)) return 'HLS';
    if (isTsPath(u)) return 'MPEG-TS';
    if (/\.mp4($|\?)/i.test(u)) return 'MP4';
    if (isMkvPath(u)) return 'MKV';
    return 'HLS/TS';
  }

  function extractHost(url) {
    var m = String(url || '').match(/^https?:\/\/([^\/:?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  function resolveUserAgentForItem(item, url) {
    if (item && item.httpUserAgent && String(item.httpUserAgent).trim()) {
      return String(item.httpUserAgent).trim();
    }
    var host = extractHost(url || (item && item.url) || '');
    if (host && hostUserAgentMap[host]) {
      return hostUserAgentMap[host];
    }
    var preset = (global.LuminaStore && global.LuminaStore.get('playerUserAgent')) || 'vlc';
    if (preset === 'custom') {
      var customUa = (global.LuminaStore && global.LuminaStore.get('playerUserAgentCustom')) || '';
      return String(customUa).trim() || DEFAULT_USER_AGENT;
    }
    return USER_AGENT_PRESETS[preset] || DEFAULT_USER_AGENT;
  }

  function setState(newState, extra) {
    state = newState;
    if (global.LuminaStore) global.LuminaStore.set('playerState', newState);
    if (global.LuminaEventBus) {
      global.LuminaEventBus.emit('player:state', { state: newState, item: currentItem, extra: extra || null });
    }
  }

  function clearTimers() {
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
    if (progressSaveInterval) { clearInterval(progressSaveInterval); progressSaveInterval = null; }
    if (nextEpOfferTicker) { clearInterval(nextEpOfferTicker); nextEpOfferTicker = null; }
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  function cancelNextEpisodePrompt() {
    if (nextEpCountdownTimer) {
      clearInterval(nextEpCountdownTimer);
      nextEpCountdownTimer = null;
    }
    if (global.LuminaStore) global.LuminaStore.set('nextEpisodePrompt', null);
  }

  function destroyEngine() {
    clearTimers();
    if (global.LuminaPlayback) {
      global.LuminaPlayback.stop();
    } else if (activeEngine && typeof activeEngine.destroy === 'function') {
      var v = (typeof document !== 'undefined') ? document.getElementById('main-video') : null;
      activeEngine.destroy(v);
    }
    activeEngine = null;
  }

  function buildXtreamVariantUrl(url, kind, targetExt) {
    var u = String(url || '');
    if (!u) return '';
    var qIdx = u.indexOf('?');
    var pathPart = qIdx !== -1 ? u.slice(0, qIdx) : u;
    var queryPart = qIdx !== -1 ? u.slice(qIdx) : '';

    if (/\.(m3u8|ts|mp4|mkv|avi)$/i.test(pathPart)) {
      return pathPart.replace(/\.(m3u8|ts|mp4|mkv|avi)$/i, '.' + targetExt) + queryPart;
    }
    if (kind === 'live' && /\/(live\/)?[^\/]+\/[^\/]+\/\d+$/i.test(pathPart)) {
      return pathPart + '.' + targetExt + queryPart;
    }
    return '';
  }

  function isFormatAllowedByAccount(ext, accountInfo) {
    if (!accountInfo || !Array.isArray(accountInfo.allowedOutputFormats) || !accountInfo.allowedOutputFormats.length) {
      return true;
    }
    var allowed = accountInfo.allowedOutputFormats.map(function (f) { return String(f).toLowerCase(); });
    if (ext === 'm3u8') return allowed.indexOf('m3u8') !== -1 || allowed.indexOf('hls') !== -1;
    if (ext === 'ts') return allowed.indexOf('ts') !== -1 || allowed.indexOf('mpegts') !== -1;
    return true;
  }

  // Plano de fallback enxuto e determinístico (Seção A8: máximo 3 passos, teto global 45s)
  function buildFallbackPlan(item, options) {
    var opts = options || {};
    var url = (item && item.url) ? String(item.url) : '';
    var kind = (item && item.kind) || 'live';
    var isLive = (kind === 'live');
    var accountInfo = opts.accountInfo || (global.LuminaStore ? global.LuminaStore.get('accountInfo') : null);
    var preferFmt = opts.preferOutputFormat || forcedFormatOverride || (global.LuminaStore ? global.LuminaStore.get('preferOutputFormat') : 'auto') || 'auto';
    var enginePref = opts.playerEngine || forcedEngineOverride || (global.LuminaStore ? global.LuminaStore.get('playerEngine') : 'auto') || 'auto';

    var exoAvailable = typeof opts.exoAvailable === 'boolean'
      ? opts.exoAvailable
      : !!(global.LuminaExoEngine && global.LuminaExoEngine.isSupported());

    var hlsJsAvailable = typeof opts.hlsJsAvailable === 'boolean'
      ? opts.hlsJsAvailable
      : !!(global.LuminaHlsEngine && global.LuminaHlsEngine.isSupported());

    var mpegtsAvailable = typeof opts.mpegtsAvailable === 'boolean'
      ? opts.mpegtsAvailable
      : !!(global.LuminaMpegtsEngine && global.LuminaMpegtsEngine.isSupported());

    var nativeHlsAvailable = typeof opts.nativeHlsAvailable === 'boolean'
      ? opts.nativeHlsAvailable
      : !!(global.LuminaPlatform && global.LuminaPlatform.detectNativeHls && global.LuminaPlatform.detectNativeHls());

    var exoClass = global.LuminaExoEngine || { name: 'ExoPlayer', isNative: true };
    var hlsClass = global.LuminaHlsEngine || { name: 'HlsJsEngine', isNative: false };
    var tsClass = global.LuminaMpegtsEngine || { name: 'MpegtsEngine', isNative: false };
    var natClass = global.LuminaNativeEngine || { name: 'NativeEngine', isNative: false };

    var plan = [];

    function addStep(engineName, stepUrl, timeoutMs, engineClass) {
      if (!stepUrl || plan.length >= 3) return;
      for (var i = 0; i < plan.length; i++) {
        if (plan[i].engine === engineName && plan[i].url === stepUrl) return;
      }
      plan.push({
        engine: engineName,
        url: stepUrl,
        timeoutMs: timeoutMs,
        formatLabel: detectFormatLabel(stepUrl),
        classRef: engineClass
      });
    }

    var allowM3u8 = isFormatAllowedByAccount('m3u8', accountInfo);
    var allowTs = isFormatAllowedByAccount('ts', accountInfo);

    if (isLive) {
      var m3u8Url = allowM3u8 ? (isHlsPath(url) ? url : (buildXtreamVariantUrl(url, 'live', 'm3u8') || (isTsPath(url) ? '' : url))) : '';
      var tsUrl = allowTs ? (isTsPath(url) ? url : (buildXtreamVariantUrl(url, 'live', 'ts') || (!isHlsPath(url) ? url : ''))) : '';

      var primaryLiveUrl = url;
      var secondaryLiveUrl = '';

      if (preferFmt === 'ts') {
        primaryLiveUrl = tsUrl || m3u8Url || url;
        secondaryLiveUrl = (primaryLiveUrl === tsUrl) ? m3u8Url : tsUrl;
      } else {
        // 'auto' ou 'm3u8': prefere HLS primeiro quando permitido
        primaryLiveUrl = m3u8Url || tsUrl || url;
        secondaryLiveUrl = (primaryLiveUrl === m3u8Url) ? tsUrl : m3u8Url;
      }

      if (exoAvailable && enginePref !== 'web') {
        addStep('ExoPlayer', primaryLiveUrl, 15000, exoClass);
        if (secondaryLiveUrl && secondaryLiveUrl !== primaryLiveUrl) {
          addStep('ExoPlayer', secondaryLiveUrl, 15000, exoClass);
        }
        if (enginePref !== 'exo') {
          if (m3u8Url && hlsJsAvailable) {
            addStep('HlsJsEngine', m3u8Url, 12000, hlsClass);
          } else if (tsUrl && mpegtsAvailable) {
            addStep('MpegtsEngine', tsUrl, 12000, tsClass);
          }
        }
      } else {
        // Web / LG webOS ou modo WebView forçado
        if (preferFmt === 'ts' && tsUrl && mpegtsAvailable) {
          addStep('MpegtsEngine', tsUrl, 15000, tsClass);
          if (m3u8Url && hlsJsAvailable) addStep('HlsJsEngine', m3u8Url, 15000, hlsClass);
        } else {
          if (m3u8Url && hlsJsAvailable) addStep('HlsJsEngine', m3u8Url, 15000, hlsClass);
          if (tsUrl && mpegtsAvailable) addStep('MpegtsEngine', tsUrl, 15000, tsClass);
        }
        if (m3u8Url && nativeHlsAvailable) {
          addStep('NativeEngine', m3u8Url, 12000, natClass);
        }
        if (!plan.length) {
          addStep('NativeEngine', primaryLiveUrl, 12000, natClass);
        }
      }
      return plan.slice(0, 3);
    }

    // VOD (Filmes e Episódios de Séries/Novelas)
    var mp4Variant = (isMkvPath(url) || isTsPath(url)) ? buildXtreamVariantUrl(url, kind, 'mp4') : '';
    var m3u8VodVariant = item && item.hlsUrl ? item.hlsUrl : '';

    if (exoAvailable && enginePref !== 'web') {
      addStep('ExoPlayer', url, 20000, exoClass);
      if (mp4Variant && mp4Variant !== url) {
        addStep('ExoPlayer', mp4Variant, 15000, exoClass);
      } else if (m3u8VodVariant && m3u8VodVariant !== url) {
        addStep('ExoPlayer', m3u8VodVariant, 15000, exoClass);
      }
      if (enginePref !== 'exo') {
        if (isHlsPath(url) && hlsJsAvailable) {
          addStep('HlsJsEngine', url, 12000, hlsClass);
        } else if (!isMkvPath(url)) {
          addStep('NativeEngine', mp4Variant || url, 12000, natClass);
        } else if (mp4Variant) {
          addStep('NativeEngine', mp4Variant, 12000, natClass);
        }
      }
    } else {
      if (isHlsPath(url)) {
        if (hlsJsAvailable) addStep('HlsJsEngine', url, 18000, hlsClass);
        if (nativeHlsAvailable) addStep('NativeEngine', url, 12000, natClass);
      } else if (isTsPath(url)) {
        if (mpegtsAvailable) addStep('MpegtsEngine', url, 18000, tsClass);
        if (mp4Variant) addStep('NativeEngine', mp4Variant, 15000, natClass);
      } else {
        if (!isMkvPath(url)) {
          addStep('NativeEngine', url, 20000, natClass);
        } else if (mp4Variant) {
          addStep('NativeEngine', mp4Variant, 20000, natClass);
        } else {
          addStep('NativeEngine', url, 15000, natClass);
        }
        if (m3u8VodVariant && hlsJsAvailable) {
          addStep('HlsJsEngine', m3u8VodVariant, 15000, hlsClass);
        }
      }
    }

    return plan.slice(0, 3);
  }

  // Classificação semântica de erros de reprodução (Seções A8 e A10)
  function classifyPlaybackError(errDetail, context) {
    var d = errDetail || {};
    var ctx = context || {};
    var status = Number(d.httpStatus || 0);
    var code = String(d.code || '').toUpperCase();
    var msg = String(d.message || '');

    // Extrai HTTP status de mensagens se não veio explícito
    if (!status) {
      var mHttp = msg.match(/\bHTTP\s+(\d{3})\b/i) || msg.match(/\bstatus code:\s*(\d{3})\b/i);
      if (mHttp) status = parseInt(mHttp[1], 10);
    }

    var acc = ctx.accountInfo || (global.LuminaStore ? global.LuminaStore.get('accountInfo') : null);
    var isConnLimitAccount = !!(acc && acc.maxConnections > 0 && acc.activeCons >= acc.maxConnections);

    if (status === 429 || status === 458 || status === 884 || (isConnLimitAccount && (status === 401 || status === 403))) {
      return {
        category: 'CONN_LIMIT',
        action: 'STOP',
        httpStatus: status,
        title: 'Limite de conexões atingido',
        humanMessage: 'Limite de conexões simultâneas atingido nesta lista. Feche o app em outro aparelho e tente de novo.'
      };
    }

    if (status === 401 || status === 403) {
      return {
        category: 'AUTH_OR_UA',
        action: 'TRY_ALT_UA_THEN_STOP',
        httpStatus: status,
        title: 'Acesso negado pelo servidor',
        humanMessage: 'Acesso negado pelo servidor da lista (código ' + status + '). Sua assinatura pode ter vencido ou o canal está bloqueado.'
      };
    }

    if (status === 404 || code === 'IO_FILE_NOT_FOUND') {
      return {
        category: 'NOT_FOUND',
        action: ctx.isLive ? 'TRY_ALT_FORMAT_ONCE' : 'STOP',
        httpStatus: status || 404,
        title: 'Conteúdo indisponível',
        humanMessage: 'Este conteúdo não está disponível no servidor da lista (erro 404).'
      };
    }

    if (status >= 500 && status <= 599) {
      return {
        category: 'SERVER_5XX',
        action: 'RETRY_SAME_ONCE',
        httpStatus: status,
        title: 'Servidor instável',
        humanMessage: 'O servidor da lista está instável no momento (erro ' + status + '). Tente de novo em instantes.'
      };
    }

    if (code === 'IO_NETWORK_CONNECTION_FAILED' || /DNS|UnknownHost|ECONNREFUSED|ENETUNREACH/i.test(msg)) {
      return {
        category: 'NETWORK_DOWN',
        action: 'STOP',
        httpStatus: status,
        title: 'Sem conexão com o servidor',
        humanMessage: 'Não foi possível conectar ao servidor da lista. Verifique a internet da TV.'
      };
    }

    if (code === 'AUDIO_TRACK_INIT_FAILED' || (code === 'DECODING_FAILED' && /audio/i.test(msg))) {
      return {
        category: 'AUDIO_DECODER',
        action: 'TRY_NEXT_AUDIO_TRACK',
        httpStatus: status,
        title: 'Formato de áudio incompatível',
        humanMessage: 'Este aparelho não suporta o formato de vídeo ou áudio deste título.'
      };
    }

    if (code === 'DECODER_INIT_FAILED' || code === 'DECODING_FORMAT_UNSUPPORTED' || code === 'DECODING_FORMAT_EXCEEDS_CAPABILITIES' || code === 'DECODING_FAILED') {
      return {
        category: 'VIDEO_DECODER',
        action: 'NEXT_STEP',
        httpStatus: status,
        title: 'Formato incompatível',
        humanMessage: 'Este aparelho não suporta o formato de vídeo ou áudio deste título.'
      };
    }

    if (code === 'IO_NETWORK_CONNECTION_TIMEOUT' || code === 'TIMEOUT' || /timeout|tempo esgotado/i.test(msg)) {
      return {
        category: 'TIMEOUT',
        action: 'NEXT_STEP',
        httpStatus: status,
        title: 'Servidor demorou para responder',
        humanMessage: 'O servidor demorou demais para responder. Tente trocar o formato para MPEG-TS ou HLS.'
      };
    }

    if (code === 'PARSING_CONTAINER_UNSUPPORTED' || code === 'PARSING_CONTAINER_MALFORMED' || code === 'PARSING_MANIFEST_MALFORMED' || code === 'PARSING_MANIFEST_UNSUPPORTED') {
      return {
        category: 'CONTAINER_OR_MANIFEST',
        action: 'NEXT_STEP',
        httpStatus: status,
        title: 'Formato inválido ou vazio',
        humanMessage: 'O servidor enviou dados em formato inválido ou vazio.'
      };
    }

    return {
      category: 'GENERIC',
      action: 'NEXT_STEP',
      httpStatus: status,
      title: 'Não foi possível reproduzir',
      humanMessage: 'Não foi possível reproduzir este conteúdo agora. Tente trocar o formato ou o motor.'
    };
  }

  function updateDiagnosticsStore(fields) {
    if (!global.LuminaStore) return;
    var diag = global.LuminaStore.get('diagnostics') || {};
    var keys = Object.keys(fields || {});
    for (var i = 0; i < keys.length; i++) {
      diag[keys[i]] = fields[keys[i]];
    }
    global.LuminaStore.set('diagnostics', diag);
  }

  function saveCurrentWatchProgress() {
    if (!currentItem || currentItem.kind === 'live' || !global.LuminaPlayback) return;
    var st = global.LuminaPlayback.getState();
    var pos = st.currentTime || 0;
    var dur = st.duration || currentItem.durationSecs || 0;
    if (pos <= 2) return;

    var prog = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    var pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 15;
    var completed = pct >= 92;

    prog[currentItem.id] = {
      position: completed ? 0 : pos,
      duration: dur,
      percent: completed ? 100 : pct,
      completed: completed,
      updatedAt: Date.now()
    };
    if (global.LuminaStore) global.LuminaStore.set('watchProgress', prog);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', prog);
  }

  function markCurrentEpisodeCompleted() {
    if (!currentItem || currentItem.kind === 'live') return;
    var st = global.LuminaPlayback ? global.LuminaPlayback.getState() : { duration: 0 };
    var dur = st.duration || currentItem.durationSecs || 0;
    var prog = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    prog[currentItem.id] = {
      position: 0,
      duration: dur,
      percent: 100,
      completed: true,
      updatedAt: Date.now()
    };
    if (global.LuminaStore) global.LuminaStore.set('watchProgress', prog);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', prog);
  }

  function dismissNextEpisodeOffer() {
    if (currentItem) {
      dismissedNextEpForId = currentItem.id;
    }
    cancelNextEpisodePrompt();
    if (global.LuminaEventBus) {
      global.LuminaEventBus.emit('player:next-ep-tick', null);
    }
  }

  function getEpisodeContext(epItem) {
    var target = epItem || currentItem;
    if (!target || (target.kind !== 'episode' && target.kind !== 'series')) {
      return null;
    }
    var shows = [].concat(
      (global.LuminaStore && global.LuminaStore.get('seriesList')) || [],
      (global.LuminaStore && global.LuminaStore.get('novelasList')) || []
    );
    var targetShow = null;
    var sKey = target.seriesKey || '';

    if (sKey) {
      for (var i = 0; i < shows.length; i++) {
        if (shows[i].id === sKey || (shows[i].seriesKey && shows[i].seriesKey === sKey)) {
          targetShow = shows[i];
          break;
        }
      }
    }

    if (!targetShow) {
      for (var j = 0; j < shows.length; j++) {
        var sh = shows[j];
        var shSeasons = sh.seasons || [];
        for (var s = 0; s < shSeasons.length; s++) {
          var eps = shSeasons[s].episodes || [];
          for (var e = 0; e < eps.length; e++) {
            if (eps[e].id === target.id) {
              targetShow = sh;
              break;
            }
          }
          if (targetShow) break;
        }
        if (targetShow) break;
      }
    }

    if (!targetShow && target.seriesTitle) {
      var normTitle = String(target.seriesTitle).toLowerCase().trim();
      for (var m = 0; m < shows.length; m++) {
        if (String(shows[m].cleanTitle || '').toLowerCase().trim() === normTitle) {
          targetShow = shows[m];
          break;
        }
      }
    }

    if (!targetShow) {
      return {
        show: null,
        seasons: [],
        flatEpisodes: [],
        currentIndex: -1,
        prevEpisode: null,
        nextEpisode: null,
        needsLazyLoad: false
      };
    }

    var seasons = targetShow.seasons || [];
    var flat = [];
    for (var si = 0; si < seasons.length; si++) {
      var sEps = seasons[si].episodes || [];
      for (var ei = 0; ei < sEps.length; ei++) {
        flat.push(sEps[ei]);
      }
    }

    var curIdx = -1;
    for (var k = 0; k < flat.length; k++) {
      if (flat[k].id === target.id) {
        curIdx = k;
        break;
      }
    }
    if (curIdx === -1 && flat.length && target.season && target.episode) {
      for (var k2 = 0; k2 < flat.length; k2++) {
        if (Number(flat[k2].season || 1) === Number(target.season) && Number(flat[k2].episode || 1) === Number(target.episode)) {
          curIdx = k2;
          break;
        }
      }
    }

    var needsLazy = !!(targetShow.needsSeriesInfo || (!seasons.length && targetShow.xtreamSeriesId));

    return {
      show: targetShow,
      seasons: seasons,
      flatEpisodes: flat,
      currentIndex: curIdx,
      prevEpisode: (curIdx > 0) ? flat[curIdx - 1] : null,
      nextEpisode: (curIdx >= 0 && curIdx + 1 < flat.length) ? flat[curIdx + 1] : null,
      needsLazyLoad: needsLazy
    };
  }

  function loadEpisodeListForCurrent(callback) {
    var ctx = getEpisodeContext(currentItem);
    if (!ctx || !ctx.show) {
      if (callback) callback(new Error('Série não encontrada no catálogo.'));
      return;
    }
    if (!ctx.needsLazyLoad && ctx.seasons && ctx.seasons.length) {
      if (callback) callback(null, getEpisodeContext(currentItem));
      return;
    }
    if (!global.LuminaXtream || typeof global.LuminaXtream.fetchSeriesInfo !== 'function') {
      if (callback) callback(new Error('Cliente Xtream indisponível para carregar episódios.'));
      return;
    }
    var creds = global.LuminaStore ? global.LuminaStore.get('xtreamCreds') : null;
    global.LuminaXtream.fetchSeriesInfo(creds, ctx.show, function (err) {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (global.LuminaEventBus) {
        global.LuminaEventBus.emit('player:episodes-loaded', ctx.show);
      }
      if (callback) callback(null, getEpisodeContext(currentItem));
    });
  }

  function findNextEpisodeFor(epItem) {
    var ctx = getEpisodeContext(epItem);
    return ctx ? ctx.nextEpisode : null;
  }

  function checkNextEpisodeOfferTick() {
    if (!currentItem || (currentItem.kind !== 'episode' && currentItem.kind !== 'series')) return;
    if (!global.LuminaPlayback || !global.LuminaStore) return;
    var pb = global.LuminaPlayback.getState();
    var pos = Number(pb.currentTime || 0);
    var dur = Number(pb.duration || 0);
    var curPrompt = global.LuminaStore.get('nextEpisodePrompt');

    if (curPrompt && curPrompt.mode === 'offer') {
      if (dur > 0 && (dur - pos) > (NEXT_EP_OFFER_SECS + 5)) {
        offeredEpisodeId = null;
        global.LuminaStore.set('nextEpisodePrompt', null);
        if (global.LuminaEventBus) global.LuminaEventBus.emit('player:next-ep-tick', null);
      }
      return;
    }

    if (state !== STATES.PLAYING) return;
    if (dur < 300 || pos <= 0) return;
    var remaining = dur - pos;
    if (remaining <= 0 || remaining > NEXT_EP_OFFER_SECS) return;
    if (offeredEpisodeId === currentItem.id || dismissedNextEpForId === currentItem.id) return;
    if (curPrompt) return;

    var nextEp = findNextEpisodeFor(currentItem);
    if (!nextEp) return;

    offeredEpisodeId = currentItem.id;
    var offerPrompt = {
      nextEpisode: nextEp,
      mode: 'offer',
      secondsLeft: 0
    };
    global.LuminaStore.set('nextEpisodePrompt', offerPrompt);
    if (global.LuminaEventBus) {
      global.LuminaEventBus.emit('player:next-ep-tick', offerPrompt);
    }
  }

  function triggerNextEpisodeFlow(finishedItem) {
    if (finishedItem && dismissedNextEpForId === finishedItem.id) return;
    var nextEp = findNextEpisodeFor(finishedItem);
    if (!nextEp) return;
    cancelNextEpisodePrompt();
    var secLeft = 5;
    var promptObj = { nextEpisode: nextEp, mode: 'countdown', secondsLeft: secLeft };
    global.LuminaStore.set('nextEpisodePrompt', promptObj);
    global.LuminaEventBus.emit('player:next-ep-tick', promptObj);

    nextEpCountdownTimer = setInterval(function () {
      secLeft--;
      var currentPrompt = global.LuminaStore.get('nextEpisodePrompt');
      if (!currentPrompt || currentPrompt.mode !== 'countdown') {
        clearInterval(nextEpCountdownTimer);
        nextEpCountdownTimer = null;
        return;
      }
      if (secLeft <= 0) {
        cancelNextEpisodePrompt();
        open(nextEp);
      } else {
        var nextObj = { nextEpisode: nextEp, mode: 'countdown', secondsLeft: secLeft };
        global.LuminaStore.set('nextEpisodePrompt', nextObj);
        global.LuminaEventBus.emit('player:next-ep-tick', nextObj);
      }
    }, 1000);
  }

  function startWatchdog(isLive) {
    if (watchdogTimer) clearInterval(watchdogTimer);
    lastProgressAdvanceAt = Date.now();
    lastObservedPositionSec = -1;
    var thresholdMs = isLive ? WATCHDOG_LIVE_MS : WATCHDOG_VOD_MS;

    watchdogTimer = setInterval(function () {
      if (state !== STATES.PLAYING && state !== STATES.BUFFERING) {
        lastProgressAdvanceAt = Date.now();
        return;
      }
      var pbState = global.LuminaPlayback ? global.LuminaPlayback.getState() : null;
      var curPos = pbState ? pbState.currentTime : 0;
      if (curPos !== lastObservedPositionSec && curPos > 0) {
        lastObservedPositionSec = curPos;
        lastProgressAdvanceAt = Date.now();
        return;
      }
      if (Date.now() - lastProgressAdvanceAt >= thresholdMs) {
        lastProgressAdvanceAt = Date.now();
        if (!currentStepWatchdogRetried) {
          currentStepWatchdogRetried = true;
          if (global.LuminaDiagLog) {
            global.LuminaDiagLog.record('retry', {
              engine: activeEngine ? activeEngine.name : '-',
              url: fallbackPlan[fallbackIndex] ? fallbackPlan[fallbackIndex].url : '',
              format: fallbackPlan[fallbackIndex] ? fallbackPlan[fallbackIndex].formatLabel : '-',
              code: 'WATCHDOG_STALL',
              elapsedMs: thresholdMs,
              message: 'Fluxo parado por ' + Math.round(thresholdMs / 1000) + 's; reconectando passo atual'
            });
          }
          executeStep(fallbackIndex, resolveCurrentUserAgent());
        } else {
          handleStepError({
            code: 'TIMEOUT',
            httpStatus: 0,
            message: 'Fluxo sem avanço de posição (watchdog)'
          });
        }
      }
    }, 2500);
  }

  function resolveCurrentUserAgent() {
    var step = fallbackPlan[fallbackIndex];
    var stepUrl = step ? step.url : (currentItem ? currentItem.url : '');
    if (currentUaFallbackIdx >= 0 && currentUaFallbackIdx < ALT_USER_AGENTS.length) {
      return ALT_USER_AGENTS[currentUaFallbackIdx];
    }
    return resolveUserAgentForItem(currentItem, stepUrl);
  }

  function executeStep(index, overrideUa) {
    if (!currentItem) return;
    var totalElapsed = Date.now() - openStartTime;
    if (index >= fallbackPlan.length || totalElapsed >= GLOBAL_FALLBACK_BUDGET_MS) {
      finalizeFailure({
        title: 'Não foi possível reproduzir',
        message: 'O servidor demorou demais para responder ou o formato não é compatível. Tente trocar o formato para MPEG-TS ou HLS.'
      });
      return;
    }

    fallbackIndex = index;
    var step = fallbackPlan[index];
    activeEngine = step.classRef;
    if (global.LuminaPlayback) global.LuminaPlayback.setActiveEngine(activeEngine);

    var uaToUse = overrideUa || resolveUserAgentForItem(currentItem, step.url);
    var refererToUse = (currentItem && currentItem.httpReferrer) ? String(currentItem.httpReferrer) : '';
    var isLive = (currentItem.kind === 'live');
    var bufferProfile = (global.LuminaStore && global.LuminaStore.get('bufferProfile')) || 'normal';

    if (global.LuminaPlatform && global.LuminaPlatform.registerStreamHeaders) {
      global.LuminaPlatform.registerStreamHeaders(step.url, uaToUse, refererToUse);
    }

    var progMap = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    var savedProg = (!isLive && progMap[currentItem.id]) ? progMap[currentItem.id] : null;
    var startPosMs = (savedProg && savedProg.position > 2 && !savedProg.completed)
      ? Math.round(savedProg.position * 1000)
      : 0;

    var chainDesc = fallbackPlan.map(function (s, idx) {
      return (idx === index ? '[' + s.engine + ':' + s.formatLabel + ']' : (s.engine + ':' + s.formatLabel));
    }).join(' -> ');

    updateDiagnosticsStore({
      engine: step.engine,
      userAgent: uaToUse,
      attemptedChain: chainDesc
    });

    if (index === 0 && currentUaFallbackIdx < 0 && !currentStepServerRetried) {
      setState(STATES.LOADING, {
        stepIndex: 1,
        totalSteps: fallbackPlan.length,
        formatLabel: step.formatLabel,
        engine: step.engine
      });
    } else {
      var pillMsg = 'Tentando de novo\u2026 (' + (index + 1) + ' de ' + fallbackPlan.length + ') \u00B7 ' + step.formatLabel;
      setState(STATES.RETRYING, {
        stepIndex: index + 1,
        totalSteps: fallbackPlan.length,
        formatLabel: step.formatLabel,
        engine: step.engine,
        message: pillMsg
      });
    }

    stepStartTime = Date.now();
    if (global.LuminaDiagLog) {
      global.LuminaDiagLog.record('open', {
        engine: step.engine,
        url: step.url,
        format: step.formatLabel,
        userAgent: uaToUse,
        code: 'STEP_' + (index + 1),
        elapsedMs: 0,
        message: 'Iniciando passo ' + (index + 1) + '/' + fallbackPlan.length
      });
    }

    clearTimers();
    var remainingBudget = Math.max(5000, GLOBAL_FALLBACK_BUDGET_MS - (Date.now() - openStartTime));
    var stepTimeoutMs = Math.min(step.timeoutMs || 15000, remainingBudget);

    connectTimeout = setTimeout(function () {
      handleStepError({
        code: 'IO_NETWORK_CONNECTION_TIMEOUT',
        httpStatus: 0,
        message: 'Timeout após ' + stepTimeoutMs + 'ms em ' + step.engine
      });
    }, stepTimeoutMs);

    var videoEl = global.LuminaPlayback ? global.LuminaPlayback.getVideoElement() : null;
    var byContent = (global.LuminaStore && global.LuminaStore.get('aspectRatioByContent')) || {};
    var targetRatio = byContent[currentItem.id] || (global.LuminaStore && global.LuminaStore.get('defaultAspectRatio')) || 'auto';
    if (global.LuminaTracks) {
      global.LuminaTracks.applyAspectRatio(videoEl, targetRatio);
    }

    step.classRef.play(videoEl, step.url, {
      onReady: function () {
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = setTimeout(function () {
            handleStepError({
              code: 'IO_NETWORK_CONNECTION_TIMEOUT',
              httpStatus: 0,
              message: 'Timeout aguardando primeiro quadro em ' + step.engine
            });
          }, 12000);
        }
        if (global.LuminaDiagLog) {
          global.LuminaDiagLog.record('ready', {
            engine: step.engine,
            url: step.url,
            format: step.formatLabel,
            userAgent: uaToUse,
            code: 'READY',
            elapsedMs: Date.now() - stepStartTime
          });
        }
        if (!step.classRef.isNative && videoEl && startPosMs > 0) {
          try { videoEl.currentTime = Math.floor(startPosMs / 1000); } catch (e) {}
        }
      },
      onPlaying: function () {
        clearTimeout(connectTimeout);
        connectTimeout = null;
        var ttff = Date.now() - stepStartTime;
        var host = extractHost(step.url);
        if (host && currentUaFallbackIdx >= 0) {
          hostUserAgentMap[host] = uaToUse;
        }
        updateDiagnosticsStore({
          engine: step.engine,
          userAgent: uaToUse,
          ttffMs: ttff,
          lastError: '-'
        });
        if (global.LuminaDiagLog) {
          global.LuminaDiagLog.record('playing', {
            engine: step.engine,
            url: step.url,
            format: step.formatLabel,
            userAgent: uaToUse,
            httpStatus: 200,
            code: 'OK',
            elapsedMs: ttff,
            message: 'Reprodução iniciada'
          });
        }
        setState(STATES.PLAYING, { formatLabel: step.formatLabel, engine: step.engine });
        startWatchdog(isLive);

        if (!isLive) {
          if (progressSaveInterval) clearInterval(progressSaveInterval);
          progressSaveInterval = setInterval(saveCurrentWatchProgress, 5000);
          if (nextEpOfferTicker) clearInterval(nextEpOfferTicker);
          nextEpOfferTicker = setInterval(checkNextEpisodeOfferTick, 1000);
        }
      },
      onVideoSize: function (sz) {
        if (!sz) return;
        var vw = Number(sz.width || 0);
        var vh = Number(sz.height || 0);
        var sw = Number(sz.surfaceWidth || 0);
        var sh = Number(sz.surfaceHeight || 0);
        updateDiagnosticsStore({
          videoResolution: (vw > 0 && vh > 0) ? (vw + 'x' + vh) : '-',
          surfaceResolution: (sw > 0 && sh > 0) ? (sw + 'x' + sh) : '-'
        });
        if (global.LuminaDiagLog && vw > 0 && vh > 0) {
          global.LuminaDiagLog.record('video-size', {
            engine: step.engine,
            url: step.url,
            format: step.formatLabel,
            code: vw + 'x' + vh,
            elapsedMs: Date.now() - stepStartTime,
            message: 'Video ' + vw + 'x' + vh + (sw > 0 ? (' em superficie ' + sw + 'x' + sh) : '')
          });
        }
      },
      onPaused: function () {
        if (state === STATES.PLAYING || state === STATES.BUFFERING) {
          setState(STATES.PAUSED);
        }
      },
      onWaiting: function () {
        if (state === STATES.PLAYING) {
          setState(STATES.BUFFERING);
        }
      },
      onPosition: function () {
        lastProgressAdvanceAt = Date.now();
      },
      onEnded: function () {
        saveCurrentWatchProgress();
        setState(STATES.ENDED);
        if (currentItem && (currentItem.kind === 'episode' || currentItem.kind === 'series')) {
          triggerNextEpisodeFlow(currentItem);
        }
      },
      onError: function (errDetail) {
        handleStepError(errDetail || { code: 'ERROR_CODE_UNSPECIFIED', httpStatus: 0, message: 'Erro de mídia' });
      }
    }, {
      isLive: isLive,
      startPositionMs: startPosMs,
      timeoutMs: stepTimeoutMs,
      userAgent: uaToUse,
      referer: refererToUse,
      bufferProfile: bufferProfile,
      preferredAudioLang: 'pt'
    });
  }

  function finalizeFailure(info) {
    destroyEngine();
    var title = (info && info.title) || 'Não foi possível reproduzir';
    var msg = (info && info.message) || 'Não foi possível reproduzir este conteúdo agora.';
    updateDiagnosticsStore({ lastError: msg });
    setState(STATES.FAILED, {
      title: title,
      message: msg,
      httpStatus: (info && info.httpStatus) || 0,
      category: (info && info.category) || 'GENERIC'
    });
  }

  function handleStepError(errDetail) {
    clearTimeout(connectTimeout);
    var step = fallbackPlan[fallbackIndex] || { engine: 'none', url: '', formatLabel: '-' };
    var elapsed = Date.now() - stepStartTime;
    var isLive = !!(currentItem && currentItem.kind === 'live');
    var decision = classifyPlaybackError(errDetail, {
      isLive: isLive,
      accountInfo: global.LuminaStore ? global.LuminaStore.get('accountInfo') : null
    });

    if (global.LuminaDiagLog) {
      global.LuminaDiagLog.record('error', {
        engine: step.engine,
        url: step.url,
        format: step.formatLabel,
        userAgent: resolveCurrentUserAgent(),
        httpStatus: decision.httpStatus || Number(errDetail && errDetail.httpStatus) || 0,
        code: (errDetail && errDetail.code) || decision.category,
        elapsedMs: elapsed,
        message: (errDetail && errDetail.message) || decision.humanMessage
      });
    }

    var diag = (global.LuminaStore && global.LuminaStore.get('diagnostics')) || {};
    updateDiagnosticsStore({
      reconnections: (diag.reconnections || 0) + 1,
      lastError: decision.humanMessage
    });

    // 1. Falha de decodificador de áudio: tenta selecionar outra faixa de áudio suportada no ExoPlayer
    if (decision.action === 'TRY_NEXT_AUDIO_TRACK' && global.LuminaPlayback && global.LuminaPlayback.isNativeActive()) {
      var tracks = global.LuminaPlayback.getTracks().audio || [];
      if (tracks.length > 1) {
        for (var t = 0; t < tracks.length; t++) {
          if (!tracks[t].selected) {
            global.LuminaPlayback.setAudioTrack(tracks[t].id);
            global.LuminaPlayback.play();
            return;
          }
        }
      }
    }

    // 2. HTTP 403 / 401: tenta User-Agents alternativos antes de desistir (Seção A6)
    if (decision.action === 'TRY_ALT_UA_THEN_STOP') {
      var nextUaIdx = currentUaFallbackIdx + 1;
      if (nextUaIdx < ALT_USER_AGENTS.length && (Date.now() - openStartTime) < GLOBAL_FALLBACK_BUDGET_MS) {
        currentUaFallbackIdx = nextUaIdx;
        var altUa = ALT_USER_AGENTS[currentUaFallbackIdx];
        if (global.LuminaDiagLog) {
          global.LuminaDiagLog.record('fallback', {
            engine: step.engine,
            url: step.url,
            format: step.formatLabel,
            userAgent: altUa,
            httpStatus: decision.httpStatus,
            code: 'ALT_USER_AGENT',
            elapsedMs: elapsed,
            message: 'Tentando User-Agent alternativo após HTTP ' + decision.httpStatus
          });
        }
        destroyEngine();
        executeStep(fallbackIndex, altUa);
        return;
      }
      finalizeFailure({
        title: decision.title,
        message: decision.humanMessage,
        httpStatus: decision.httpStatus,
        category: decision.category
      });
      return;
    }

    // 3. Erros terminais imediatos (429/458/884 limite de conexões, DNS/rede caída, 404 em VOD)
    if (decision.action === 'STOP') {
      finalizeFailure({
        title: decision.title,
        message: decision.humanMessage,
        httpStatus: decision.httpStatus,
        category: decision.category
      });
      return;
    }

    // 4. Erro 5xx do servidor: 1 retry no mesmo passo após 1.5s
    if (decision.action === 'RETRY_SAME_ONCE' && !currentStepServerRetried) {
      currentStepServerRetried = true;
      destroyEngine();
      setTimeout(function () {
        if (currentItem) executeStep(fallbackIndex);
      }, 1500);
      return;
    }

    // 5. 404 em canal ao vivo: só tenta 1 vez se o próximo passo for outro formato (.m3u8 <-> .ts)
    if (decision.action === 'TRY_ALT_FORMAT_ONCE') {
      var nextFmtIdx = -1;
      for (var i = fallbackIndex + 1; i < fallbackPlan.length; i++) {
        if (fallbackPlan[i].url !== step.url) {
          nextFmtIdx = i;
          break;
        }
      }
      if (nextFmtIdx !== -1 && (Date.now() - openStartTime) < GLOBAL_FALLBACK_BUDGET_MS) {
        destroyEngine();
        currentUaFallbackIdx = -1;
        currentStepServerRetried = false;
        currentStepWatchdogRetried = false;
        executeStep(nextFmtIdx);
        return;
      }
      finalizeFailure({
        title: decision.title,
        message: decision.humanMessage,
        httpStatus: decision.httpStatus,
        category: decision.category
      });
      return;
    }

    // 6. Avança para o próximo passo do plano se houver tempo dentro do orçamento global de 45s
    var nextStepIdx = fallbackIndex + 1;
    if (nextStepIdx < fallbackPlan.length && (Date.now() - openStartTime) < GLOBAL_FALLBACK_BUDGET_MS) {
      if (global.LuminaDiagLog) {
        global.LuminaDiagLog.record('fallback', {
          engine: fallbackPlan[nextStepIdx].engine,
          url: fallbackPlan[nextStepIdx].url,
          format: fallbackPlan[nextStepIdx].formatLabel,
          userAgent: resolveCurrentUserAgent(),
          httpStatus: decision.httpStatus,
          code: 'STEP_FALLBACK',
          elapsedMs: elapsed,
          message: 'Alternando para passo ' + (nextStepIdx + 1) + ' (' + fallbackPlan[nextStepIdx].engine + ')'
        });
      }
      destroyEngine();
      currentUaFallbackIdx = -1;
      currentStepServerRetried = false;
      currentStepWatchdogRetried = false;
      executeStep(nextStepIdx);
      return;
    }

    finalizeFailure({
      title: decision.title,
      message: decision.humanMessage,
      httpStatus: decision.httpStatus,
      category: decision.category
    });
  }

  function open(item, options) {
    if (!item || !item.url) return;
    var opts = options || {};
    cancelNextEpisodePrompt();
    saveCurrentWatchProgress();
    destroyEngine();

    if (!opts.keepOverrides) {
      forcedFormatOverride = null;
      forcedEngineOverride = null;
    }

    if (item.kind === 'live' && global.LuminaStore) {
      var prevCh = global.LuminaStore.get('currentChannelId');
      if (prevCh && prevCh !== item.id) {
        global.LuminaStore.set('lastChannelId', prevCh);
      }
      global.LuminaStore.set('currentChannelId', item.id);
    }

    currentItem = item;
    offeredEpisodeId = null;
    dismissedNextEpForId = null;
    openStartTime = Date.now();
    currentUaFallbackIdx = -1;
    currentStepServerRetried = false;
    currentStepWatchdogRetried = false;

    if (item.kind === 'episode' || item.kind === 'series') {
      var epCtxInit = getEpisodeContext(item);
      if (epCtxInit && epCtxInit.needsLazyLoad) {
        loadEpisodeListForCurrent();
      }
    }

    var stage = (typeof document !== 'undefined') ? document.getElementById('video-stage') : null;
    if (stage) stage.classList.add('is-active');
    if (global.LuminaViewportFit && typeof global.LuminaViewportFit.applyFit === 'function') {
      global.LuminaViewportFit.applyFit();
    }

    fallbackPlan = buildFallbackPlan(item);
    fallbackIndex = 0;

    if (global.LuminaEventBus) {
      global.LuminaEventBus.emit('player:item-changed', item);
    }
    executeStep(0);
  }

  function stop() {
    offeredEpisodeId = null;
    dismissedNextEpForId = null;
    cancelNextEpisodePrompt();
    saveCurrentWatchProgress();
    destroyEngine();
    var stage = (typeof document !== 'undefined') ? document.getElementById('video-stage') : null;
    if (stage) stage.classList.remove('is-active');
    setState(STATES.IDLE);
  }

  function togglePlayPause() {
    if (!currentItem || !global.LuminaPlayback) return;
    if (state === STATES.PLAYING || state === STATES.BUFFERING) {
      global.LuminaPlayback.pause();
      setState(STATES.PAUSED);
    } else if (state === STATES.PAUSED) {
      global.LuminaPlayback.play();
      setState(STATES.PLAYING);
    } else if (state === STATES.FAILED || state === STATES.ENDED) {
      open(currentItem, { keepOverrides: true });
    }
  }

  function seekRelative(deltaSec) {
    if (!currentItem || currentItem.kind === 'live' || !global.LuminaPlayback) return;
    global.LuminaPlayback.seekBy(deltaSec);
    saveCurrentWatchProgress();
    checkNextEpisodeOfferTick();
  }

  function switchEngine() {
    if (!currentItem) return null;
    var curEng = activeEngine ? activeEngine.name : 'ExoPlayer';
    forcedEngineOverride = (curEng === 'ExoPlayer') ? 'web' : 'exo';
    open(currentItem, { keepOverrides: true });
    return fallbackPlan[0] || null;
  }

  function toggleFormat() {
    if (!currentItem) return null;
    var step = fallbackPlan[fallbackIndex] || fallbackPlan[0];
    var curUrl = step ? step.url : currentItem.url;
    forcedFormatOverride = isHlsPath(curUrl) ? 'ts' : 'm3u8';
    open(currentItem, { keepOverrides: true });
    return forcedFormatOverride;
  }

  function zapChannel(delta) {
    var channels = (global.LuminaStore && global.LuminaStore.get('channels')) || [];
    if (!channels.length || !currentItem) return;
    var idx = -1;
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === currentItem.id) { idx = i; break; }
    }
    var nextIdx = (idx + delta + channels.length) % channels.length;
    var targetCh = channels[nextIdx];
    if (!targetCh) return;

    currentItem = targetCh;
    if (global.LuminaEventBus) global.LuminaEventBus.emit('player:item-changed', targetCh);
    clearTimeout(zapDebounceTimer);
    zapDebounceTimer = setTimeout(function () {
      open(targetCh);
    }, 180);
  }

  function zapLastChannel() {
    var lastId = global.LuminaStore && global.LuminaStore.get('lastChannelId');
    if (!lastId) return false;
    var channels = (global.LuminaStore && global.LuminaStore.get('channels')) || [];
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === lastId) {
        open(channels[i]);
        return true;
      }
    }
    return false;
  }


  function mapFriendlyErrorMessage(errDetail) {
    var c = classifyPlaybackError(errDetail, {});
    var legacyCode = c.category;
    if (c.category === 'AUTH_OR_UA' || c.category === 'CONN_LIMIT') legacyCode = 'AUTH_OR_LIMIT';
    return {
      code: legacyCode,
      category: c.category,
      action: c.action,
      title: c.title,
      message: c.humanMessage
    };
  }

  var api = {
    STATES: STATES,
    NEXT_EP_OFFER_SECS: NEXT_EP_OFFER_SECS,
    mapFriendlyErrorMessage: mapFriendlyErrorMessage,
    DEFAULT_USER_AGENT: DEFAULT_USER_AGENT,
    ALT_USER_AGENTS: ALT_USER_AGENTS,
    USER_AGENT_PRESETS: USER_AGENT_PRESETS,
    GLOBAL_FALLBACK_BUDGET_MS: GLOBAL_FALLBACK_BUDGET_MS,
    isHlsPath: isHlsPath,
    isTsPath: isTsPath,
    isMkvPath: isMkvPath,
    isDirectVodPath: isDirectVodPath,
    detectFormatLabel: detectFormatLabel,
    buildFallbackPlan: buildFallbackPlan,
    classifyPlaybackError: classifyPlaybackError,
    resolveUserAgentForItem: resolveUserAgentForItem,
    init: function () {
      if (typeof document !== 'undefined' && global.LuminaPlayback) {
        global.LuminaPlayback.setVideoElement(document.getElementById('main-video'));
      }
    },
    open: open,
    stop: stop,
    retry: function () { if (currentItem) open(currentItem, { keepOverrides: true }); },
    switchEngine: switchEngine,
    toggleFormat: toggleFormat,
    togglePlayPause: togglePlayPause,
    seekRelative: seekRelative,
    zapNext: function () { zapChannel(1); },
    zapPrev: function () { zapChannel(-1); },
    zapLastChannel: zapLastChannel,
    cancelNextEpisode: cancelNextEpisodePrompt,
    dismissNextEpisodeOffer: dismissNextEpisodeOffer,
    markCurrentEpisodeCompleted: markCurrentEpisodeCompleted,
    getEpisodeContext: getEpisodeContext,
    loadEpisodeListForCurrent: loadEpisodeListForCurrent,
    saveProgress: saveCurrentWatchProgress,
    checkNextEpisodeOfferTick: checkNextEpisodeOfferTick,
    getCurrentItem: function () { return currentItem; },
    getState: function () { return state; },
    getVideoElement: function () { return global.LuminaPlayback ? global.LuminaPlayback.getVideoElement() : null; },
    getActiveEngine: function () { return activeEngine; },
    getFallbackPlan: function () { return fallbackPlan.slice(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaPlayer = api;
})(typeof window !== 'undefined' ? window : global);
