(function (global) {
  'use strict';

  var hideTimer = null;
  var osdEl = null;
  var quickListOpen = false;
  var quickListOffset = 0;

  function escHtml(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '00:00';
    var s = Math.floor(sec);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rem = s % 60;
    var mm = (m < 10 ? '0' + m : String(m));
    var ss = (rem < 10 ? '0' + rem : String(rem));
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  function showOsd() {
    if (!osdEl && typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    osdEl.classList.remove('hidden');
    clearTimeout(hideTimer);
    var st = global.LuminaPlayer.getState();
    if (st !== 'FAILED' && st !== 'RETRYING' && !quickListOpen && !global.LuminaStore.get('nextEpisodePrompt')) {
      hideTimer = setTimeout(function () {
        if (global.LuminaRouter.getCurrent() === 'player-fullscreen') {
          osdEl.classList.add('hidden');
        }
      }, 4500);
    }
  }

  function renderOsd(statePayload) {
    if (!osdEl && typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    var item = global.LuminaPlayer.getCurrentItem();
    var st = global.LuminaPlayer.getState();
    if (!item) return;

    var extra = (statePayload && statePayload.extra) || null;
    var isLive = item.kind === 'live';
    var isFav = global.LuminaStore.isFavorite(item.id);
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var savedProg = progMap[item.id] || { position: 0, duration: 0, percent: 0 };
    var nextPrompt = global.LuminaStore.get('nextEpisodePrompt');
    var diag = global.LuminaStore.get('diagnostics') || {};
    var engineName = diag.engine || 'NativeEngine';

    var nextEpBanner = '';
    if (nextPrompt && nextPrompt.nextEpisode) {
      var ne = nextPrompt.nextEpisode;
      nextEpBanner =
        '<div class="osd-banner-box">' +
          '<div><strong>Próximo Episódio em ' + Number(nextPrompt.secondsLeft || 5) + 's:</strong> ' + escHtml(ne.cleanTitle) + ' (T' + Number(ne.season || 1) + ':E' + Number(ne.episode || 1) + ')</div>' +
          '<div>' +
            '<button id="osd-btn-next-now" class="osd-btn focusable" data-osd-action="next-ep-now" data-scope="osd">▶ Reproduzir Agora</button>' +
            '<button id="osd-btn-next-cancel" class="osd-btn focusable" data-osd-action="next-ep-cancel" data-scope="osd">Cancelar</button>' +
          '</div>' +
        '</div>';
    }

    var statusBanner = '';
    if (st === 'RETRYING') {
      var retryMsg = (extra && extra.message) ? extra.message : 'Reconectando ao fluxo de mídia...';
      statusBanner =
        '<div class="osd-banner-box osd-banner-warn">' +
          '<div><strong>⟳ ' + escHtml(retryMsg) + '</strong> · Motor: ' + escHtml(engineName) + '</div>' +
          '<div><button id="osd-btn-switch-eng" class="osd-btn focusable" data-osd-action="switch-engine" data-scope="osd">⚙ Trocar Motor</button></div>' +
        '</div>';
    } else if (st === 'FAILED') {
      var errTitle = (extra && extra.title) ? extra.title : 'Falha ao abrir este conteúdo';
      var errMsg = (extra && extra.message) ? extra.message : (diag.lastError || 'Verifique sua conexão ou tente outro motor.');
      statusBanner =
        '<div class="osd-banner-box osd-banner-danger">' +
          '<div style="max-width:980px;">' +
            '<div style="font-size:24px;font-weight:700;color:#FCA5A5;margin-bottom:4px;">⚠ ' + escHtml(errTitle) + '</div>' +
            '<div style="font-size:19px;color:#E2E8F0;">' + escHtml(errMsg) + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;">' +
            '<button id="osd-btn-err-retry" class="osd-btn focusable" data-osd-action="retry" data-scope="osd">↻ Tentar de Novo</button>' +
            '<button id="osd-btn-err-engine" class="osd-btn focusable" data-osd-action="switch-engine" data-scope="osd">⚙ Outro Motor</button>' +
            (isLive ? '<button id="osd-btn-err-nextch" class="osd-btn focusable" data-osd-action="ff" data-scope="osd">Próximo Canal ▶▶</button>' : '') +
          '</div>' +
        '</div>';
    }

    var quickChannelDrawer = '';
    if (isLive && quickListOpen) {
      var allCh = global.LuminaStore.get('channels') || [];
      var winSize = 6;
      var maxStart = Math.max(0, allCh.length - winSize);
      if (quickListOffset > maxStart) quickListOffset = maxStart;
      var qRows = '';
      for (var q = 0; q < winSize && (quickListOffset + q) < allCh.length; q++) {
        var cItem = allCh[quickListOffset + q];
        var isCur = cItem.id === item.id;
        qRows +=
          '<button id="osd-qch-' + q + '" class="osd-btn focusable' + (isCur ? ' is-active-target' : '') + '" data-osd-ch-id="' + escHtml(cItem.id) + '" data-scope="osd" style="margin-bottom:8px;justify-content:flex-start;width:270px;overflow:hidden;">' +
            '<span style="color:var(--accent-cyan);font-family:var(--font-mono);margin-right:10px;">#' + Number(cItem.channelNumber || (quickListOffset + q + 1)) + '</span>' +
            '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(cItem.cleanTitle) + '</span>' +
          '</button>';
      }
      quickChannelDrawer =
        '<div style="margin-bottom:14px;padding:14px 18px;background:rgba(11,15,23,0.92);border:1px solid rgba(56,189,248,0.35);border-radius:var(--radius-md);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
            '<strong style="font-size:20px;color:var(--accent-cyan);">Troca Rápida de Canais (' + (quickListOffset + 1) + '–' + Math.min(allCh.length, quickListOffset + winSize) + ' de ' + allCh.length + ')</strong>' +
            '<div>' +
              '<button id="osd-qch-prev" class="osd-btn focusable" data-osd-action="qch-prev" data-scope="osd" style="height:42px;padding:0 14px;">◀ Ant.</button>' +
              '<button id="osd-qch-next" class="osd-btn focusable" data-osd-action="qch-next" data-scope="osd" style="height:42px;padding:0 14px;">Próx. ▶</button>' +
              '<button id="osd-qch-close" class="osd-btn focusable" data-osd-action="toggle-qch" data-scope="osd" style="height:42px;padding:0 14px;">Fechar</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;">' + qRows + '</div>' +
        '</div>';
    }

    var progressBlock = '';
    if (isLive) {
      progressBlock =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<div>' +
            '<div style="font-size:24px;font-weight:600;">Agora: ' + escHtml(item.epgNow || ('Programação Ao Vivo (' + (item.groupDisplay || item.groupOriginal) + ')')) + '</div>' +
            '<div style="font-size:19px;color:var(--text-secondary);">A seguir: ' + escHtml(item.epgNext || 'Programação Contínua') + ' · Use CH+/CH- para zapping</div>' +
          '</div>' +
          '<div style="font-size:21px;color:var(--accent-success);">● AO VIVO · ' + escHtml(item.quality || 'HD') + ' · ' + escHtml(engineName) + '</div>' +
        '</div>';
    } else {
      var videoEl = global.LuminaPlayer.getVideoElement();
      var liveDur = (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0) ? Math.floor(videoEl.duration) : (savedProg.duration || item.durationSecs || 0);
      var livePos = (videoEl && videoEl.currentTime > 0) ? Math.floor(videoEl.currentTime) : (savedProg.position || 0);
      var pct = liveDur > 0 ? Math.min(100, Math.round((livePos / liveDur) * 100)) : (savedProg.percent || 0);
      progressBlock =
        '<div class="osd-progress-row">' +
          '<div class="osd-seek-bar"><div class="osd-seek-fill" style="width:' + pct + '%;"></div></div>' +
          '<div style="font-family:var(--font-mono);font-size:21px;">' + formatTime(livePos) + ' / ' + formatTime(liveDur) + ' (' + pct + '%)</div>' +
        '</div>';
    }

    var chNumPrefix = (isLive && item.channelNumber) ? ('#' + item.channelNumber + ' · ') : '';

    osdEl.innerHTML =
      '<div class="osd-top-bar">' +
        '<div class="osd-channel-badge">' +
          '<div style="font-size:32px;font-weight:700;">' + escHtml(chNumPrefix + item.cleanTitle) + '</div>' +
          '<div style="font-size:20px;color:var(--text-secondary);">' + escHtml(item.groupDisplay || item.groupOriginal) + ' · ' + escHtml(item.quality || 'HD') + ' · ' + escHtml(item.lang || 'DUB') + ' · Motor: ' + escHtml(engineName) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="osd-bottom-panel">' +
        statusBanner +
        nextEpBanner +
        quickChannelDrawer +
        progressBlock +
        '<div class="osd-controls-row">' +
          '<div class="osd-btn-group">' +
            '<button id="osd-ctrl-rew" class="osd-btn focusable" data-osd-action="rew" data-scope="osd">' + (isLive ? '◀◀ Canal Ant.' : '◀◀ -10s') + '</button>' +
            '<button id="osd-ctrl-play" class="osd-btn focusable" data-osd-action="play" data-scope="osd">' + (st === 'PAUSED' ? '▶ Reproduzir' : '❚❚ Pausar') + '</button>' +
            '<button id="osd-ctrl-ff" class="osd-btn focusable" data-osd-action="ff" data-scope="osd">' + (isLive ? 'Próx. Canal ▶▶' : '▶▶ +10s') + '</button>' +
            (isLive ? '<button id="osd-ctrl-qch" class="osd-btn focusable" data-osd-action="toggle-qch" data-scope="osd">☰ Canais</button>' : '') +
          '</div>' +
          '<div class="osd-btn-group">' +
            '<button id="osd-ctrl-audio" class="osd-btn focusable" data-osd-action="audio" data-scope="osd">Áudio</button>' +
            '<button id="osd-ctrl-sub" class="osd-btn focusable" data-osd-action="sub" data-scope="osd">Legenda</button>' +
            '<button id="osd-ctrl-ratio" class="osd-btn focusable" data-osd-action="ratio" data-scope="osd">Tela</button>' +
            (!isLive ? '<button id="osd-ctrl-speed" class="osd-btn focusable" data-osd-action="speed" data-scope="osd">Velocidade</button>' : '') +
            '<button id="osd-ctrl-engine" class="osd-btn focusable" data-osd-action="switch-engine" data-scope="osd">Motor</button>' +
            '<button id="osd-ctrl-fav" class="osd-btn focusable" data-osd-action="fav" data-scope="osd">' + (isFav ? '♥ Favorito' : '♡ Favoritar') + '</button>' +
            '<button id="osd-ctrl-back" class="osd-btn focusable" data-osd-action="back" data-scope="osd">Voltar</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (global.LuminaRouter.getCurrent() === 'player-fullscreen') {
      showOsd();
      var focusTarget = '#osd-ctrl-play';
      if (st === 'FAILED') focusTarget = '#osd-btn-err-retry';
      else if (nextPrompt) focusTarget = '#osd-btn-next-now';
      global.LuminaFocus.restoreOrDefault('osd', focusTarget);
    }
  }

  var lastAction = '';
  var lastActionAt = 0;

  function handleAction(action, targetEl) {
    var nowT = Date.now();
    if (action === lastAction && nowT - lastActionAt < 280) return;
    lastAction = action;
    lastActionAt = nowT;

    var item = global.LuminaPlayer.getCurrentItem();
    var videoEl = global.LuminaPlayer.getVideoElement();
    var activeEngine = global.LuminaPlayer.getActiveEngine ? global.LuminaPlayer.getActiveEngine() : null;
    if (!item) return;

    if (targetEl) {
      var qChId = targetEl.getAttribute('data-osd-ch-id');
      if (qChId) {
        var allCh = global.LuminaStore.get('channels') || [];
        for (var i = 0; i < allCh.length; i++) {
          if (allCh[i].id === qChId) {
            quickListOpen = false;
            global.LuminaPlayer.open(allCh[i]);
            return;
          }
        }
      }
    }

    if (action === 'play') global.LuminaPlayer.togglePlayPause();
    else if (action === 'retry') global.LuminaPlayer.retry();
    else if (action === 'switch-engine') {
      var nextStep = global.LuminaPlayer.switchEngine();
      if (nextStep && global.LuminaUI) {
        global.LuminaUI.toast('Alternando para motor: ' + nextStep.engine);
      }
    } else if (action === 'rew') {
      if (item.kind === 'live') global.LuminaPlayer.zapPrev();
      else global.LuminaPlayer.seekRelative(-10);
    } else if (action === 'ff') {
      if (item.kind === 'live') global.LuminaPlayer.zapNext();
      else global.LuminaPlayer.seekRelative(10);
    } else if (action === 'toggle-qch') {
      quickListOpen = !quickListOpen;
      if (quickListOpen) {
        var chs = global.LuminaStore.get('channels') || [];
        for (var c = 0; c < chs.length; c++) {
          if (chs[c].id === item.id) {
            quickListOffset = Math.max(0, c - 2);
            break;
          }
        }
      }
      renderOsd();
    } else if (action === 'qch-prev') {
      quickListOffset = Math.max(0, quickListOffset - 6);
      renderOsd();
      global.LuminaFocus.setFocus(document.getElementById('osd-qch-prev'), 'osd');
    } else if (action === 'qch-next') {
      var totalCh = (global.LuminaStore.get('channels') || []).length;
      if (quickListOffset + 6 < totalCh) quickListOffset += 6;
      renderOsd();
      global.LuminaFocus.setFocus(document.getElementById('osd-qch-next'), 'osd');
    } else if (action === 'audio') {
      var a = global.LuminaTracks.cycleAudioTrack(videoEl, activeEngine);
      global.LuminaUI.toast('Áudio: ' + a.label);
    } else if (action === 'sub') {
      var s = global.LuminaTracks.cycleSubtitleTrack(videoEl, activeEngine);
      global.LuminaUI.toast('Legenda: ' + s.label);
    } else if (action === 'ratio') {
      var r = global.LuminaTracks.cycleAspectRatio(videoEl, item.id);
      global.LuminaUI.toast('Proporção: ' + r.label);
    } else if (action === 'speed') {
      var sp = global.LuminaTracks.cyclePlaybackSpeed(videoEl);
      global.LuminaUI.toast('Velocidade: ' + sp.label);
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
      quickListOpen = false;
      global.LuminaRouter.back();
    }
  }

  global.LuminaOSD = {
    init: function () {
      if (typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
      global.LuminaEventBus.on('player:state', renderOsd);
      global.LuminaEventBus.on('player:item-changed', function () {
        quickListOpen = false;
        renderOsd();
      });
      global.LuminaEventBus.on('player:next-ep-tick', renderOsd);

      function inPlayer() {
        return global.LuminaRouter.getCurrent() === 'player-fullscreen' && !!global.LuminaPlayer.getCurrentItem();
      }
      global.LuminaEventBus.on('key:PLAY', function () {
        if (inPlayer() && global.LuminaPlayer.getState() === 'PAUSED') global.LuminaPlayer.togglePlayPause();
      });
      global.LuminaEventBus.on('key:PAUSE', function () {
        var st = global.LuminaPlayer.getState();
        if (inPlayer() && (st === 'PLAYING' || st === 'BUFFERING')) global.LuminaPlayer.togglePlayPause();
      });
      global.LuminaEventBus.on('key:STOP', function () {
        if (inPlayer()) global.LuminaRouter.back();
      });
      global.LuminaEventBus.on('key:REWIND', function () {
        if (inPlayer()) {
          var it = global.LuminaPlayer.getCurrentItem();
          if (it.kind !== 'live') global.LuminaPlayer.seekRelative(-10);
          else global.LuminaPlayer.zapPrev();
        }
      });
      global.LuminaEventBus.on('key:FAST_FORWARD', function () {
        if (inPlayer()) {
          var it2 = global.LuminaPlayer.getCurrentItem();
          if (it2.kind !== 'live') global.LuminaPlayer.seekRelative(10);
          else global.LuminaPlayer.zapNext();
        }
      });
      global.LuminaEventBus.on('key:any', function () {
        if (global.LuminaRouter.getCurrent() === 'player-fullscreen') showOsd();
      });
      global.LuminaEventBus.on('key:CH_UP', function () {
        if (inPlayer()) global.LuminaPlayer.zapNext();
      });
      global.LuminaEventBus.on('key:CH_DOWN', function () {
        if (inPlayer()) global.LuminaPlayer.zapPrev();
      });
    },
    render: renderOsd,
    show: showOsd,
    handleAction: handleAction
  };
})(typeof window !== 'undefined' ? window : global);
