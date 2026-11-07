(function (global) {
  'use strict';

  var videoEl = null;
  var currentEngine = null;
  var currentItem = null;
  var state = 'IDLE';
  var retryCount = 0;
  var MAX_RETRIES = 3;
  var retryTimer = null;
  var watchdogTimer = null;
  var saveProgressTimer = null;
  var nextEpCountdownTimer = null;
  var openStartTime = 0;
  var firstPlayDone = false; // o 'playing' dispara a cada retomada/seek; a abertura só vale uma vez
  var lastToggleAt = 0;

  function setState(nextState, extra) {
    state = nextState;
    global.LuminaStore.set('playerState', nextState);
    global.LuminaEventBus.emit('player:state', { state: nextState, item: currentItem, extra: extra || null });
  }

  function cleanUpEngineAndVideo() {
    clearTimeout(retryTimer);
    clearInterval(watchdogTimer);
    clearInterval(saveProgressTimer);
    cancelNextEpisodeCountdown();
    if (currentEngine) {
      try { currentEngine.destroy(); } catch (e) {}
      currentEngine = null;
    }
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch (e) {}
    }
  }

  function findNextEpisode(epItem) {
    if (!epItem || !epItem.seriesKey) return null;
    var allLists = (global.LuminaStore.get('seriesList') || []).concat(global.LuminaStore.get('novelasList') || []);
    for (var i = 0; i < allLists.length; i++) {
      var show = allLists[i];
      if (show.id !== epItem.seriesKey) continue;
      var flat = [];
      for (var s = 0; s < show.seasons.length; s++) {
        flat = flat.concat(show.seasons[s].episodes);
      }
      for (var e = 0; e < flat.length - 1; e++) {
        if (flat[e].id === epItem.id) return flat[e + 1];
      }
    }
    return null;
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
    global.LuminaStore.set('nextEpisodePrompt', null);
  }

  function persistVodPosition(forceTime, forceDur) {
    if (!currentItem || currentItem.kind === 'live') return;
    if (!forceDur && (!videoEl || !isFinite(videoEl.duration) || videoEl.duration <= 0)) return;
    var dur = forceDur || videoEl.duration || 120;
    var pos = typeof forceTime === 'number' ? forceTime : ((videoEl && videoEl.currentTime) || 0);
    if (pos < 2) return;
    var completed = (dur > 0 && (pos / dur) >= 0.90);
    var map = global.LuminaStore.get('watchProgress') || {};
    map[currentItem.id] = {
      position: completed ? Math.floor(dur) : Math.floor(pos),
      duration: Math.floor(dur),
      percent: dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0,
      completed: completed,
      updatedAt: Date.now()
    };
    global.LuminaStore.set('watchProgress', map);
    global.LuminaStorage.saveMeta('watchProgress', map);

    if (completed && currentItem.kind === 'episode' && !global.LuminaStore.get('nextEpisodePrompt')) {
      var nextEp = findNextEpisode(currentItem);
      if (nextEp) startNextEpisodeCountdown(nextEp);
    }
  }

  function handleError(err) {
    var diag = global.LuminaStore.get('diagnostics');
    diag.lastError = err && err.message ? err.message : String(err);
    global.LuminaStore.set('diagnostics', diag);
    setState('ERROR', { message: diag.lastError });

    if (retryCount < MAX_RETRIES && currentItem) {
      retryCount++;
      diag.reconnections++;
      global.LuminaStore.set('diagnostics', diag);
      var delayMs = Math.min(1200 * Math.pow(1.8, retryCount - 1), 6000);
      setState('RETRYING', { attempt: retryCount, max: MAX_RETRIES });
      retryTimer = setTimeout(function () { launchEngine(); }, delayMs);
    } else {
      setState('FAILED', { message: 'Não foi possível abrir este conteúdo.' });
    }
  }

  function launchEngine() {
    if (!currentItem || !videoEl) return;
    cleanUpEngineAndVideo();
    firstPlayDone = false;
    setState('LOADING');

    var callbacks = {
      onReady: function () { setState('BUFFERING'); },
      onBuffering: function () { if (state === 'PLAYING') setState('BUFFERING'); },
      onPause: function () {
        // Pausa feita pelo próprio webOS (tecla de mídia): mantém a tela em sincronia
        if (videoEl && !videoEl.ended && (state === 'PLAYING' || state === 'BUFFERING')) setState('PAUSED');
      },
      onPlaying: function () {
        if (firstPlayDone) {
          // Retomada após pausa/buffer/seek: NÃO refaz a abertura (era o que gerava o loop pausa/play)
          if (state !== 'PLAYING') setState('PLAYING');
          return;
        }
        firstPlayDone = true;
        var ttff = Date.now() - openStartTime;
        var diag = global.LuminaStore.get('diagnostics');
        diag.engine = currentEngine ? currentEngine.name : 'NativeEngine';
        diag.ttffMs = ttff;
        global.LuminaStore.set('diagnostics', diag);
        retryCount = 0;
        setState('PLAYING', { ttffMs: ttff });

        if (currentItem.kind !== 'live') {
          var map = global.LuminaStore.get('watchProgress') || {};
          var saved = map[currentItem.id];
          if (saved && saved.position > 5 && !saved.completed) {
            try { videoEl.currentTime = saved.position; } catch (e) {}
          }
          clearInterval(saveProgressTimer);
          saveProgressTimer = setInterval(function () { persistVodPosition(); }, 10000);
        }
      },
      onEnded: function () {
        persistVodPosition(120, 120);
      },
      onError: handleError
    };

    currentEngine = global.LuminaNativeEngine.create(videoEl, callbacks);
    currentEngine.load(currentItem.url, 6000);
  }

  function open(item) {
    if (!item) return;
    if (!videoEl) videoEl = document.getElementById('main-video');
    if (currentItem && currentItem.kind === 'live' && item.kind === 'live' && currentItem.id !== item.id) {
      global.LuminaStore.set('lastChannelId', currentItem.id);
    }
    currentItem = item;
    if (item.kind === 'live') global.LuminaStore.set('currentChannelId', item.id);
    retryCount = 0;
    openStartTime = Date.now();
    var stage = document.getElementById('video-stage');
    if (stage) stage.classList.add('is-active');
    global.LuminaEventBus.emit('player:item-changed', item);
    launchEngine();
  }

  function seekRelative(deltaSec) {
    if (!videoEl || !currentItem || currentItem.kind === 'live') return;
    var dur = videoEl.duration || 120;
    var cur = (videoEl.currentTime || 0) + deltaSec;
    var target = Math.max(0, Math.min(dur, cur));
    try { videoEl.currentTime = target; } catch (e) {}
    persistVodPosition(target, dur);
    global.LuminaEventBus.emit('player:state', { state: state, item: currentItem });
  }

  function zapRelative(offset) {
    var channels = global.LuminaStore.get('channels') || [];
    if (!channels.length) return;
    var curId = (currentItem && currentItem.id) || global.LuminaStore.get('currentChannelId');
    var idx = 0;
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === curId) { idx = i; break; }
    }
    open(channels[(idx + offset + channels.length) % channels.length]);
  }

  global.LuminaPlayer = {
    init: function () { videoEl = document.getElementById('main-video'); },
    open: open,
    stop: function () {
      persistVodPosition();
      cleanUpEngineAndVideo();
      var stage = document.getElementById('video-stage');
      if (stage) stage.classList.remove('is-active');
      currentItem = null;
      firstPlayDone = false;
      setState('IDLE');
    },
    retry: function () { retryCount = 0; launchEngine(); },
    togglePlayPause: function () {
      if (!videoEl || !currentItem) return;
      // Ignora comando duplicado (tecla + clique do Magic Remote chegando juntos)
      var nowT = Date.now();
      if (nowT - lastToggleAt < 400) return;
      lastToggleAt = nowT;
      if (videoEl.paused) {
        var p = videoEl.play();
        if (p && p.catch) p.catch(function () {});
        setState('PLAYING');
      } else {
        videoEl.pause();
        persistVodPosition();
        setState('PAUSED');
      }
    },
    seekRelative: seekRelative,
    simulateProgressPercent: function (pct) {
      if (!currentItem) return;
      persistVodPosition(Math.round((pct / 100) * 120), 120);
      global.LuminaEventBus.emit('player:state', { state: state, item: currentItem });
    },
    cancelNextEpisode: function () {
      cancelNextEpisodeCountdown();
      global.LuminaEventBus.emit('player:state', { state: state, item: currentItem });
    },
    zapNext: function () { zapRelative(1); },
    zapPrev: function () { zapRelative(-1); },
    zapLastChannel: function () {
      var lastId = global.LuminaStore.get('lastChannelId');
      var channels = global.LuminaStore.get('channels') || [];
      for (var i = 0; i < channels.length; i++) {
        if (channels[i].id === lastId) { open(channels[i]); break; }
      }
    },
    forceFail: function (reason) {
      cleanUpEngineAndVideo();
      setState('FAILED', { message: reason || 'Não foi possível abrir este canal.' });
    },
    getCurrentItem: function () { return currentItem; },
    getState: function () { return state; },
    getVideoElement: function () { return videoEl; }
  };
})(typeof window !== 'undefined' ? window : global);
