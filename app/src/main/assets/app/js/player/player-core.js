(function (global) {
  'use strict';

  var videoEl = null;
  var currentEngine = null;
  var currentItem = null;
  var state = 'IDLE';
  var openSessionId = 0;
  var currentPlan = [];
  var currentPlanIndex = 0;
  var retryCount = 0;
  var MAX_RETRIES = 2;
  var retryTimer = null;
  var watchdogTimer = null;
  var saveProgressTimer = null;
  var nextEpCountdownTimer = null;
  var openStartTime = 0;
  var firstPlayDone = false;
  var resumeAppliedForItem = false;
  var lastToggleAt = 0;
  var lastWatchdogTime = -1;
  var stallSeconds = 0;
  var STALL_THRESHOLD_SEC = 8;

  function setState(nextState, extra) {
    state = nextState;
    if (global.LuminaStore) global.LuminaStore.set('playerState', nextState);
    if (global.LuminaEventBus) {
      global.LuminaEventBus.emit('player:state', { state: nextState, item: currentItem, extra: extra || null });
    }
  }

  function cleanUpEngineAndVideo() {
    clearTimeout(retryTimer);
    retryTimer = null;
    clearInterval(watchdogTimer);
    watchdogTimer = null;
    clearInterval(saveProgressTimer);
    saveProgressTimer = null;
    cancelNextEpisodeCountdown();

    if (currentEngine) {
      try { currentEngine.destroy(); } catch (e) {}
      currentEngine = null;
    }
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        if (typeof videoEl.load === 'function') videoEl.load();
      } catch (e) {}
    }
  }

  function buildFallbackPlan(item) {
    var rawUrl = String((item && item.url) || '').trim();
    var lower = rawUrl.toLowerCase();
    var isLive = item && item.kind === 'live';
    var urls = [rawUrl];

    // B4.3: Para ao vivo Xtream, adiciona URL alternativa (.m3u8 <-> .ts)
    if (isLive && /\/live\/[^\/]+\/[^\/]+\/\d+\.(m3u8|ts)$/i.test(rawUrl)) {
      var altUrl = /\.m3u8$/i.test(rawUrl)
        ? rawUrl.replace(/\.m3u8$/i, '.ts')
        : rawUrl.replace(/\.ts$/i, '.m3u8');
      var preferFmt = (global.LuminaStore && global.LuminaStore.get('preferOutputFormat')) || 'auto';
      if (preferFmt === 'ts' && /\.m3u8$/i.test(rawUrl)) {
        urls = [altUrl, rawUrl];
      } else {
        urls.push(altUrl);
      }
    }

    var canNativeHls = !!(global.LuminaPlatform && global.LuminaPlatform.canNativeHls);
    var canHlsJs = !!(global.LuminaHlsEngine && global.LuminaHlsEngine.isSupported && global.LuminaHlsEngine.isSupported());
    var canMpegts = !!(global.LuminaMpegtsEngine && global.LuminaMpegtsEngine.isSupported && global.LuminaMpegtsEngine.isSupported());

    var plan = [];
    for (var uIdx = 0; uIdx < urls.length; uIdx++) {
      var u = urls[uIdx];
      var ul = u.toLowerCase();
      var isHls = ul.indexOf('.m3u8') !== -1;
      var isTs = ul.indexOf('.ts') !== -1 || (isLive && !isHls && !/\.(mp4|mkv|webm)(\?|$)/i.test(ul));

      if (isHls) {
        if (canNativeHls) {
          plan.push({ engine: 'NativeEngine', url: u });
          if (canHlsJs) plan.push({ engine: 'HlsJsEngine', url: u });
        } else {
          if (canHlsJs) plan.push({ engine: 'HlsJsEngine', url: u });
          plan.push({ engine: 'NativeEngine', url: u });
        }
      } else if (isTs) {
        if (canMpegts) {
          plan.push({ engine: 'MpegtsEngine', url: u });
          plan.push({ engine: 'NativeEngine', url: u });
        } else {
          plan.push({ engine: 'NativeEngine', url: u });
          if (canHlsJs) plan.push({ engine: 'HlsJsEngine', url: u });
        }
      } else {
        plan.push({ engine: 'NativeEngine', url: u });
        if (canHlsJs) plan.push({ engine: 'HlsJsEngine', url: u });
      }
    }

    if (!plan.length) {
      plan.push({ engine: 'NativeEngine', url: rawUrl });
    }
    return plan;
  }

  function mapFriendlyErrorMessage(err) {
    var rawMsg = (err && err.message) ? String(err.message) : String(err || 'Erro desconhecido');
    var status = (err && err.httpStatus) ? Number(err.httpStatus) : 0;
    if (!status) {
      var m = rawMsg.match(/\b(401|403|404|429|500|502|503|504)\b/);
      if (m) status = parseInt(m[1], 10);
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        title: 'Sem conexão com a internet',
        message: 'Verifique o Wi-Fi ou cabo de rede da sua TV e tente novamente.',
        code: 'OFFLINE',
        suggestedAction: 'retry'
      };
    }
    if (status === 401 || status === 403 || /401|403|forbidden|unauthorized/i.test(rawMsg)) {
      return {
        title: 'Acesso recusado pelo servidor (401/403)',
        message: 'Verifique se sua assinatura está ativa ou se o limite de telas simultâneas foi atingido.',
        code: 'AUTH_OR_LIMIT',
        suggestedAction: 'check-account'
      };
    }
    if (status === 429 || /max_connections|limite/i.test(rawMsg)) {
      return {
        title: 'Limite de conexões simultâneas atingido',
        message: 'Feche a reprodução em outro aparelho ou aguarde alguns segundos antes de tentar de novo.',
        code: 'MAX_CONNECTIONS',
        suggestedAction: 'retry'
      };
    }
    if (status === 404 || /404|not found/i.test(rawMsg)) {
      return {
        title: 'Conteúdo não encontrado no servidor (404)',
        message: 'Este canal ou título mudou de endereço. Atualize sua lista em Parear / Fontes.',
        code: 'NOT_FOUND',
        suggestedAction: 'reload-source'
      };
    }
    if (/timeout/i.test(rawMsg) || (err && err.code === 'TIMEOUT')) {
      return {
        title: 'Servidor demorou demais para responder',
        message: 'O servidor do canal está lento no momento. Tente novamente ou troque de motor.',
        code: 'TIMEOUT',
        suggestedAction: 'switch-engine'
      };
    }
    if (/SRC_NOT_SUPPORTED|DECODE|formato|codec/i.test(rawMsg) || (err && (err.code === 3 || err.code === 4))) {
      return {
        title: 'Formato de vídeo ou áudio não suportado',
        message: 'O codec deste conteúdo não pôde ser decodificado pelo motor atual. Tente alternar o motor no player.',
        code: 'UNSUPPORTED_FORMAT',
        suggestedAction: 'switch-engine'
      };
    }
    return {
      title: 'Não foi possível reproduzir este conteúdo',
      message: 'Falha ao conectar ao fluxo de mídia (' + rawMsg + ').',
      code: 'GENERIC_ERROR',
      suggestedAction: 'retry'
    };
  }

  function findNextEpisode(epItem, cb) {
    if (!epItem || (!epItem.seriesKey && !epItem.xtreamSeriesId)) return cb(null);
    var allLists = ((global.LuminaStore && global.LuminaStore.get('seriesList')) || [])
      .concat((global.LuminaStore && global.LuminaStore.get('novelasList')) || []);

    var targetShow = null;
    for (var i = 0; i < allLists.length; i++) {
      var show = allLists[i];
      if (show.id === epItem.seriesKey || (epItem.xtreamSeriesId && String(show.xtreamSeriesId) === String(epItem.xtreamSeriesId))) {
        targetShow = show;
        break;
      }
    }
    if (!targetShow) return cb(null);

    function findInLoadedShow(sh) {
      var flat = [];
      var seasons = sh.seasons || [];
      for (var s = 0; s < seasons.length; s++) {
        flat = flat.concat(seasons[s].episodes || []);
      }
      for (var e = 0; e < flat.length - 1; e++) {
        if (flat[e].id === epItem.id) return flat[e + 1];
      }
      return null;
    }

    if (targetShow.needsSeriesInfo && global.LuminaXtream && global.LuminaXtream.fetchSeriesInfo) {
      var creds = global.LuminaStore ? global.LuminaStore.get('xtreamCreds') : null;
      global.LuminaXtream.fetchSeriesInfo(creds, targetShow, function (err, hydrated) {
        if (err || !hydrated) return cb(null);
        cb(findInLoadedShow(hydrated));
      });
      return;
    }

    cb(findInLoadedShow(targetShow));
  }

  function startNextEpisodeCountdown(nextEp) {
    cancelNextEpisodeCountdown();
    var sec = 5;
    global.LuminaStore.set('nextEpisodePrompt', { nextEpisode: nextEp, secondsLeft: sec });
    global.LuminaEventBus.emit('player:next-ep-tick', { nextEpisode: nextEp, secondsLeft: sec });

    nextEpCountdownTimer = setInterval(function () {
      sec--;
      if (sec <= 0) {
        cancelNextEpisodeCountdown();
        open(nextEp);
      } else {
        global.LuminaStore.set('nextEpisodePrompt', { nextEpisode: nextEp, secondsLeft: sec });
        global.LuminaEventBus.emit('player:next-ep-tick', { nextEpisode: nextEp, secondsLeft: sec });
      }
    }, 1000);
  }

  function cancelNextEpisodeCountdown() {
    if (nextEpCountdownTimer) {
      clearInterval(nextEpCountdownTimer);
      nextEpCountdownTimer = null;
    }
    if (global.LuminaStore) global.LuminaStore.set('nextEpisodePrompt', null);
  }

  function persistVodPosition(forceTime, forceDur, forceCompleted) {
    if (!currentItem || currentItem.kind === 'live') return;
    var realDur = (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : 0;
    var dur = (typeof forceDur === 'number' && forceDur > 0) ? forceDur : (realDur || currentItem.durationSecs || 0);
    if (dur <= 0) return;

    var pos = typeof forceTime === 'number' ? forceTime : ((videoEl && videoEl.currentTime) || 0);
    if (pos < 5 && !forceCompleted) return;

    var completed = !!forceCompleted || (dur > 0 && (pos / dur) >= 0.95);
    var map = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    map[currentItem.id] = {
      position: completed ? Math.floor(dur) : Math.floor(pos),
      duration: Math.floor(dur),
      percent: dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0,
      completed: completed,
      updatedAt: Date.now()
    };
    if (global.LuminaStore) global.LuminaStore.set('watchProgress', map);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', map);

    if (completed && currentItem.kind === 'episode' && !(global.LuminaStore && global.LuminaStore.get('nextEpisodePrompt'))) {
      findNextEpisode(currentItem, function (nextEp) {
        if (nextEp) startNextEpisodeCountdown(nextEp);
      });
    }
  }

  function tryApplySavedResume() {
    if (resumeAppliedForItem || !currentItem || currentItem.kind === 'live' || !videoEl) return;
    var map = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    var saved = map[currentItem.id];
    if (!saved || saved.completed || saved.position <= 5) {
      resumeAppliedForItem = true;
      return;
    }
    var dur = (isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : (saved.duration || 0);
    if (dur > 0 && (saved.position / dur) >= 0.95) {
      resumeAppliedForItem = true;
      return;
    }
    try {
      videoEl.currentTime = saved.position;
      resumeAppliedForItem = true;
    } catch (e) {}
  }

  function startWatchdog(sessionToken) {
    clearInterval(watchdogTimer);
    lastWatchdogTime = -1;
    stallSeconds = 0;

    watchdogTimer = setInterval(function () {
      if (sessionToken !== openSessionId || !videoEl || !currentItem) return;
      if (state !== 'PLAYING') {
        stallSeconds = 0;
        return;
      }
      if (videoEl.paused || videoEl.ended) return;

      var curT = Number(videoEl.currentTime || 0);
      if (lastWatchdogTime >= 0 && Math.abs(curT - lastWatchdogTime) < 0.05) {
        stallSeconds += 2;
        if (stallSeconds >= STALL_THRESHOLD_SEC) {
          stallSeconds = 0;
          var diag = (global.LuminaStore && global.LuminaStore.get('diagnostics')) || {};
          diag.reconnections = (diag.reconnections || 0) + 1;
          diag.lastError = 'Watchdog: congelamento detectado (' + STALL_THRESHOLD_SEC + 's sem avanço)';
          if (global.LuminaStore) global.LuminaStore.set('diagnostics', diag);
          setState('RETRYING', { attempt: retryCount + 1, max: MAX_RETRIES + 1, reason: 'Reconectando transmissão congelada...' });
          launchCurrentStep(sessionToken);
        }
      } else {
        stallSeconds = 0;
        lastWatchdogTime = curT;
      }
    }, 2000);
  }

  function handleError(err, sessionToken) {
    if (sessionToken !== openSessionId) return;
    var friendly = mapFriendlyErrorMessage(err);
    var diag = (global.LuminaStore && global.LuminaStore.get('diagnostics')) || {};
    diag.lastError = friendly.title + ' - ' + friendly.message;
    if (global.LuminaStore) global.LuminaStore.set('diagnostics', diag);

    // 1. Se for erro 401/403 (login/limite), não adianta trocar de motor: informa direto
    if (friendly.code === 'AUTH_OR_LIMIT' || friendly.code === 'OFFLINE') {
      setState('FAILED', friendly);
      return;
    }

    // 2. Tenta o próximo motor/URL na cadeia de fallback antes de gastar uma retentativa completa (B4.2)
    if (currentPlanIndex + 1 < currentPlan.length) {
      currentPlanIndex++;
      var nextStep = currentPlan[currentPlanIndex];
      setState('RETRYING', {
        attempt: currentPlanIndex + 1,
        max: currentPlan.length,
        engine: nextStep.engine,
        message: 'Alternando para ' + nextStep.engine + '...'
      });
      retryTimer = setTimeout(function () {
        launchCurrentStep(sessionToken);
      }, 450);
      return;
    }

    // 3. Se todos os motores da rodada falharam, repete a cadeia com backoff exponencial
    if (retryCount < MAX_RETRIES && currentItem) {
      retryCount++;
      currentPlanIndex = 0;
      diag.reconnections = (diag.reconnections || 0) + 1;
      if (global.LuminaStore) global.LuminaStore.set('diagnostics', diag);
      var delayMs = Math.min(1200 * Math.pow(1.8, retryCount - 1), 5000);
      setState('RETRYING', {
        attempt: retryCount,
        max: MAX_RETRIES,
        message: 'Reconectando... (tentativa ' + retryCount + '/' + MAX_RETRIES + ')'
      });
      retryTimer = setTimeout(function () {
        launchCurrentStep(sessionToken);
      }, delayMs);
    } else {
      setState('FAILED', friendly);
    }
  }

  function createEngineByName(engineName, isLive, perfMode, callbacks) {
    if (engineName === 'HlsJsEngine' && global.LuminaHlsEngine) {
      return global.LuminaHlsEngine.create(videoEl, callbacks, isLive, perfMode);
    }
    if (engineName === 'MpegtsEngine' && global.LuminaMpegtsEngine) {
      return global.LuminaMpegtsEngine.create(videoEl, callbacks, isLive);
    }
    return global.LuminaNativeEngine.create(videoEl, callbacks);
  }

  function launchCurrentStep(sessionToken) {
    if (sessionToken !== openSessionId || !currentItem || !videoEl) return;
    cleanUpEngineAndVideo();
    firstPlayDone = false;

    var step = currentPlan[currentPlanIndex] || { engine: 'NativeEngine', url: currentItem.url };
    var isLive = currentItem.kind === 'live';
    var perfMode = (global.LuminaStore && global.LuminaStore.get('performanceMode')) || 'auto';

    // Registra cabeçalhos customizados (#EXTVLCOPT:http-user-agent / http-referrer) no proxy Android se presentes (B4.9)
    if (global.LuminaPlatform && global.LuminaPlatform.registerStreamHeaders) {
      if (currentItem.httpUserAgent || currentItem.httpReferrer) {
        global.LuminaPlatform.registerStreamHeaders(step.url, currentItem.httpUserAgent, currentItem.httpReferrer);
      }
    }

    // Aplica proporção salva para o conteúdo ou padrão
    if (global.LuminaTracks && global.LuminaTracks.applyAspectRatio) {
      var ratioMap = (global.LuminaStore && global.LuminaStore.get('aspectRatioByContent')) || {};
      var ratioMode = ratioMap[currentItem.id] || (global.LuminaStore && global.LuminaStore.get('defaultAspectRatio')) || 'auto';
      global.LuminaTracks.applyAspectRatio(videoEl, ratioMode);
    }

    var diag = (global.LuminaStore && global.LuminaStore.get('diagnostics')) || {};
    diag.engine = step.engine;
    diag.attemptedChain = currentPlan.slice(0, currentPlanIndex + 1).map(function (p) { return p.engine; }).join(' -> ');
    if (global.LuminaStore) global.LuminaStore.set('diagnostics', diag);

    setState('LOADING', { engine: step.engine, url: step.url });

    var callbacks = {
      onLoadedMetadata: function () {
        if (sessionToken !== openSessionId) return;
        tryApplySavedResume();
      },
      onReady: function () {
        if (sessionToken !== openSessionId) return;
        tryApplySavedResume();
        setState('BUFFERING', { engine: step.engine });
      },
      onBuffering: function () {
        if (sessionToken !== openSessionId) return;
        if (state === 'PLAYING') setState('BUFFERING', { engine: step.engine });
      },
      onPause: function () {
        if (sessionToken !== openSessionId) return;
        if (videoEl && !videoEl.ended && (state === 'PLAYING' || state === 'BUFFERING')) {
          setState('PAUSED');
        }
      },
      onPlaying: function () {
        if (sessionToken !== openSessionId) return;
        tryApplySavedResume();
        if (firstPlayDone) {
          if (state !== 'PLAYING') setState('PLAYING', { engine: step.engine });
          return;
        }
        firstPlayDone = true;
        var ttff = Date.now() - openStartTime;
        var d = (global.LuminaStore && global.LuminaStore.get('diagnostics')) || {};
        d.engine = currentEngine ? currentEngine.name : step.engine;
        d.ttffMs = ttff;
        if (global.LuminaStore) global.LuminaStore.set('diagnostics', d);
        retryCount = 0;
        setState('PLAYING', { ttffMs: ttff, engine: d.engine });

        startWatchdog(sessionToken);

        if (!isLive) {
          clearInterval(saveProgressTimer);
          saveProgressTimer = setInterval(function () {
            if (sessionToken === openSessionId) persistVodPosition();
          }, 10000);
        }
      },
      onEnded: function () {
        if (sessionToken !== openSessionId) return;
        var realDur = (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0)
          ? videoEl.duration
          : (currentItem.durationSecs || 0);
        persistVodPosition(realDur, realDur, true);
      },
      onError: function (err) {
        handleError(err, sessionToken);
      }
    };

    currentEngine = createEngineByName(step.engine, isLive, perfMode, callbacks);
    currentEngine.load(step.url, isLive ? 7000 : 9000);
  }

  function open(item) {
    if (!item) return;
    if (!videoEl && typeof document !== 'undefined') videoEl = document.getElementById('main-video');

    openSessionId++;
    var sessionToken = openSessionId;

    if (currentItem && currentItem.kind === 'live' && item.kind === 'live' && currentItem.id !== item.id) {
      if (global.LuminaStore) global.LuminaStore.set('lastChannelId', currentItem.id);
    }
    currentItem = item;
    resumeAppliedForItem = false;
    if (item.kind === 'live' && global.LuminaStore) {
      global.LuminaStore.set('currentChannelId', item.id);
    }
    retryCount = 0;
    currentPlan = buildFallbackPlan(item);
    currentPlanIndex = 0;
    openStartTime = Date.now();

    if (typeof document !== 'undefined') {
      var stage = document.getElementById('video-stage');
      if (stage) stage.classList.add('is-active');
    }
    if (global.LuminaEventBus) global.LuminaEventBus.emit('player:item-changed', item);
    launchCurrentStep(sessionToken);
  }

  function switchEngineManually() {
    if (!currentItem || !currentPlan.length) return null;
    openSessionId++;
    var sessionToken = openSessionId;
    currentPlanIndex = (currentPlanIndex + 1) % currentPlan.length;
    retryCount = 0;
    launchCurrentStep(sessionToken);
    return currentPlan[currentPlanIndex];
  }

  function seekRelative(deltaSec) {
    if (!videoEl || !currentItem || currentItem.kind === 'live') return;
    var dur = (isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : (currentItem.durationSecs || 0);
    if (dur <= 0) return;
    var cur = (videoEl.currentTime || 0) + deltaSec;
    var target = Math.max(0, Math.min(dur, cur));
    try { videoEl.currentTime = target; } catch (e) {}
    persistVodPosition(target, dur, false);
    if (global.LuminaEventBus) global.LuminaEventBus.emit('player:state', { state: state, item: currentItem });
  }

  function zapRelative(offset) {
    var channels = (global.LuminaStore && global.LuminaStore.get('channels')) || [];
    if (!channels.length) return;
    var curId = (currentItem && currentItem.id) || (global.LuminaStore && global.LuminaStore.get('currentChannelId'));
    var idx = 0;
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === curId) { idx = i; break; }
    }
    open(channels[(idx + offset + channels.length) % channels.length]);
  }

  global.LuminaPlayer = {
    init: function (customVideoEl) {
      videoEl = customVideoEl || (typeof document !== 'undefined' ? document.getElementById('main-video') : null);
    },
    open: open,
    stop: function () {
      openSessionId++;
      persistVodPosition();
      cleanUpEngineAndVideo();
      if (typeof document !== 'undefined') {
        var stage = document.getElementById('video-stage');
        if (stage) stage.classList.remove('is-active');
      }
      currentItem = null;
      firstPlayDone = false;
      resumeAppliedForItem = false;
      setState('IDLE');
    },
    retry: function () {
      if (!currentItem) return;
      openSessionId++;
      retryCount = 0;
      currentPlanIndex = 0;
      launchCurrentStep(openSessionId);
    },
    switchEngine: switchEngineManually,
    togglePlayPause: function () {
      if (!videoEl || !currentItem) return;
      var nowT = Date.now();
      if (nowT - lastToggleAt < 350) return;
      lastToggleAt = nowT;
      if (videoEl.paused) {
        setState('BUFFERING');
        var p = videoEl.play();
        if (p && p.catch) p.catch(function () {});
      } else {
        videoEl.pause();
        persistVodPosition();
        setState('PAUSED');
      }
    },
    seekRelative: seekRelative,
    simulateProgressPercent: function (pct) {
      if (!currentItem) return;
      var dur = (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : 120;
      persistVodPosition(Math.round((pct / 100) * dur), dur, pct >= 95);
      if (global.LuminaEventBus) global.LuminaEventBus.emit('player:state', { state: state, item: currentItem });
    },
    cancelNextEpisode: function () {
      cancelNextEpisodeCountdown();
      if (global.LuminaEventBus) global.LuminaEventBus.emit('player:state', { state: state, item: currentItem });
    },
    zapNext: function () { zapRelative(1); },
    zapPrev: function () { zapRelative(-1); },
    zapLastChannel: function () {
      var lastId = global.LuminaStore && global.LuminaStore.get('lastChannelId');
      var channels = (global.LuminaStore && global.LuminaStore.get('channels')) || [];
      for (var i = 0; i < channels.length; i++) {
        if (channels[i].id === lastId) { open(channels[i]); break; }
      }
    },
    forceFail: function (reason) {
      openSessionId++;
      cleanUpEngineAndVideo();
      setState('FAILED', { title: 'Falha na reprodução', message: reason || 'Não foi possível abrir este canal.' });
    },
    buildFallbackPlan: buildFallbackPlan,
    mapFriendlyErrorMessage: mapFriendlyErrorMessage,
    getCurrentItem: function () { return currentItem; },
    getActiveEngine: function () { return currentEngine; },
    getState: function () { return state; },
    getVideoElement: function () { return videoEl; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaPlayer;
})(typeof window !== 'undefined' ? window : global);
