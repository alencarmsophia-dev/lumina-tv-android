(function (global) {
  'use strict';
  var hideTimer = null;
  var osdEl = null;

  function formatTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '00:00';
    var s = Math.floor(sec);
    var m = Math.floor(s / 60);
    var rem = s % 60;
    return (m < 10 ? '0' + m : m) + ':' + (rem < 10 ? '0' + rem : rem);
  }

  function showOsd() {
    if (!osdEl) osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    osdEl.classList.remove('hidden');
    clearTimeout(hideTimer);
    var st = global.LuminaPlayer.getState();
    if (st !== 'FAILED' && !global.LuminaStore.get('nextEpisodePrompt')) {
      hideTimer = setTimeout(function () {
        if (global.LuminaRouter.getCurrent() === 'player-fullscreen') osdEl.classList.add('hidden');
      }, 4000);
    }
  }

  function renderOsd() {
    if (!osdEl) osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    var item = global.LuminaPlayer.getCurrentItem();
    var st = global.LuminaPlayer.getState();
    if (!item) return;

    var isLive = item.kind === 'live';
    var isFav = global.LuminaStore.isFavorite(item.id);
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var savedProg = progMap[item.id] || { position: 0, duration: 120, percent: 0 };
    var nextPrompt = global.LuminaStore.get('nextEpisodePrompt');

    var nextEpBanner = '';
    if (nextPrompt && nextPrompt.nextEpisode) {
      var ne = nextPrompt.nextEpisode;
      nextEpBanner =
        '<div style="margin-bottom:18px;padding:18px 24px;background:rgba(56,189,248,0.18);border:2px solid var(--accent-cyan);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;">' +
          '<div><strong>Próximo Episódio em ' + nextPrompt.secondsLeft + 's:</strong> ' + ne.cleanTitle + ' (T' + ne.season + ':E' + ne.episode + ')</div>' +
          '<div>' +
            '<button id="osd-btn-next-now" class="osd-btn focusable" data-osd-action="next-ep-now">▶ Reproduzir Agora</button>' +
            '<button id="osd-btn-next-cancel" class="osd-btn focusable" data-osd-action="next-ep-cancel">Cancelar</button>' +
          '</div>' +
        '</div>';
    }

    var progressBlock = '';
    if (isLive) {
      progressBlock =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<div>' +
            '<div style="font-size:25px;font-weight:600;">Agora: Programação Ao Vivo (' + item.groupDisplay + ')</div>' +
            '<div style="font-size:20px;color:var(--text-secondary);">Use CH+/CH- para zapping rápido</div>' +
          '</div>' +
          '<div style="font-size:22px;color:var(--accent-success);">● No Ar · ' + item.quality + '</div>' +
        '</div>';
    } else {
      progressBlock =
        '<div class="osd-progress-row">' +
          '<div class="osd-seek-bar"><div class="osd-seek-fill" style="width:' + (savedProg.percent || 0) + '%;"></div></div>' +
          '<div style="font-family:var(--font-mono);font-size:22px;">' + formatTime(savedProg.position) + ' / ' + formatTime(savedProg.duration || 120) + ' (' + (savedProg.percent || 0) + '%)</div>' +
        '</div>';
    }

    osdEl.innerHTML =
      '<div class="osd-top-bar">' +
        '<div class="osd-channel-badge">' +
          '<div style="font-size:32px;font-weight:700;">' + item.cleanTitle + '</div>' +
          '<div style="font-size:21px;color:var(--text-secondary);">' + (item.groupDisplay || item.groupOriginal) + ' · ' + item.quality + ' · ' + item.lang + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="osd-bottom-panel">' +
        nextEpBanner +
        progressBlock +
        '<div class="osd-controls-row">' +
          '<div class="osd-btn-group">' +
            '<button id="osd-ctrl-rew" class="osd-btn focusable" data-osd-action="rew">◀◀ -10s</button>' +
            '<button id="osd-ctrl-play" class="osd-btn focusable" data-osd-action="play">' + (st === 'PAUSED' ? '▶ Reproduzir' : '❚❚ Pausar') + '</button>' +
            '<button id="osd-ctrl-ff" class="osd-btn focusable" data-osd-action="ff">▶▶ +10s</button>' +
          '</div>' +
          '<div class="osd-btn-group">' +
            '<button id="osd-ctrl-audio" class="osd-btn focusable" data-osd-action="audio">Áudio</button>' +
            '<button id="osd-ctrl-sub" class="osd-btn focusable" data-osd-action="sub">Legenda</button>' +
            '<button id="osd-ctrl-ratio" class="osd-btn focusable" data-osd-action="ratio">Tela</button>' +
            '<button id="osd-ctrl-fav" class="osd-btn focusable" data-osd-action="fav">' + (isFav ? '♥ Favorito' : '♡ Favoritar') + '</button>' +
            '<button id="osd-ctrl-back" class="osd-btn focusable" data-osd-action="back">Voltar</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (global.LuminaRouter.getCurrent() === 'player-fullscreen') {
      showOsd();
      var focusTarget = nextPrompt ? '#osd-btn-next-now' : '#osd-ctrl-play';
      global.LuminaFocus.restoreOrDefault('osd', focusTarget);
    }
  }

  var lastAction = '';
  var lastActionAt = 0;

  function handleAction(action) {
    // Mesmo comando duas vezes em menos de 300 ms = duplicado (tecla + clique)
    var nowT = Date.now();
    if (action === lastAction && nowT - lastActionAt < 300) return;
    lastAction = action; lastActionAt = nowT;
    var item = global.LuminaPlayer.getCurrentItem();
    var videoEl = global.LuminaPlayer.getVideoElement();
    if (!item) return;
    if (action === 'play') global.LuminaPlayer.togglePlayPause();
    else if (action === 'rew') {
      if (item.kind === 'live') global.LuminaPlayer.zapPrev();
      else global.LuminaPlayer.seekRelative(-10);
    } else if (action === 'ff') {
      if (item.kind === 'live') global.LuminaPlayer.zapNext();
      else global.LuminaPlayer.seekRelative(10);
    } else if (action === 'audio') {
      var a = global.LuminaTracks.cycleAudioTrack(videoEl);
      global.LuminaUI.toast('Áudio: ' + a.label);
    } else if (action === 'sub') {
      var s = global.LuminaTracks.cycleSubtitleTrack(videoEl);
      global.LuminaUI.toast('Legenda: ' + s.label);
    } else if (action === 'ratio') {
      var r = global.LuminaTracks.cycleAspectRatio(videoEl, item.id);
      global.LuminaUI.toast('Proporção: ' + r.label);
    } else if (action === 'fav') {
      global.LuminaStore.toggleFavorite(item.id);
      renderOsd();
    } else if (action === 'next-ep-now') {
      var pr = global.LuminaStore.get('nextEpisodePrompt');
      if (pr && pr.nextEpisode) {
        global.LuminaPlayer.cancelNextEpisode();
        global.LuminaPlayer.open(pr.nextEpisode);
      }
    } else if (action === 'next-ep-cancel') {
      global.LuminaPlayer.cancelNextEpisode();
      global.LuminaUI.toast('Reprodução automática do próximo episódio cancelada');
    } else if (action === 'back') {
      global.LuminaRouter.back();
    }
  }

  global.LuminaOSD = {
    init: function () {
      osdEl = document.getElementById('player-osd');
      global.LuminaEventBus.on('player:state', renderOsd);
      global.LuminaEventBus.on('player:item-changed', renderOsd);
      global.LuminaEventBus.on('player:next-ep-tick', renderOsd);
      function inPlayer() { return global.LuminaRouter.getCurrent() === 'player-fullscreen' && !!global.LuminaPlayer.getCurrentItem(); }
      global.LuminaEventBus.on('key:PLAY', function () { if (inPlayer() && global.LuminaPlayer.getState() === 'PAUSED') global.LuminaPlayer.togglePlayPause(); });
      global.LuminaEventBus.on('key:PAUSE', function () {
        var st = global.LuminaPlayer.getState();
        if (inPlayer() && (st === 'PLAYING' || st === 'BUFFERING')) global.LuminaPlayer.togglePlayPause();
      });
      global.LuminaEventBus.on('key:STOP', function () { if (inPlayer()) global.LuminaRouter.back(); });
      global.LuminaEventBus.on('key:REWIND', function () { if (inPlayer()) { var it = global.LuminaPlayer.getCurrentItem(); if (it.kind !== 'live') global.LuminaPlayer.seekRelative(-10); } });
      global.LuminaEventBus.on('key:FAST_FORWARD', function () { if (inPlayer()) { var it2 = global.LuminaPlayer.getCurrentItem(); if (it2.kind !== 'live') global.LuminaPlayer.seekRelative(10); } });
      // Qualquer tecla no player mostra o painel e reinicia o tempo para esconder
      global.LuminaEventBus.on('key:any', function () { if (global.LuminaRouter.getCurrent() === 'player-fullscreen') showOsd(); });
      global.LuminaEventBus.on('key:CH_UP', function () { global.LuminaPlayer.zapNext(); });
      global.LuminaEventBus.on('key:CH_DOWN', function () { global.LuminaPlayer.zapPrev(); });
    },
    render: renderOsd,
    show: showOsd,
    handleAction: handleAction
  };
})(typeof window !== 'undefined' ? window : global);
