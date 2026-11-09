(function (global) {
  'use strict';

  var hideTimer = null;
  var fadeOutTimer = null;
  var sleepTimerId = null;
  var osdEl = null;
  var quickListOpen = false;
  var quickListOffset = 0;

  var SLEEP_OPTIONS = [0, 15, 30, 60, 90, 120];

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
    return h > 0 ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  function svgIcon(name) {
    if (name === 'play') {
      return '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
    }
    if (name === 'pause') {
      return '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    }
    if (name === 'rew') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 19 2 12 11 5"/><polyline points="22 19 13 12 22 5"/></svg>';
    }
    if (name === 'ff') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 19 22 12 13 5"/><polyline points="2 19 11 12 2 5"/></svg>';
    }
    if (name === 'subs') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="6" y1="12" x2="12" y2="12"/><line x1="15" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="18" y2="16"/></svg>';
    }
    if (name === 'ratio') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="15 8 19 8 19 12"/><polyline points="9 16 5 16 5 12"/></svg>';
    }
    if (name === 'sleep') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
    if (name === 'prev-ch') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
  }

  function showOsd() {
    if (!osdEl && typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    clearTimeout(fadeOutTimer);
    osdEl.classList.remove('hidden', 'is-hiding');
    clearTimeout(hideTimer);
    var st = global.LuminaPlayer.getState();
    if (st !== 'FAILED' && st !== 'RETRYING' && !quickListOpen && !global.LuminaStore.get('nextEpisodePrompt')) {
      hideTimer = setTimeout(function () {
        if (global.LuminaRouter.getCurrent() === 'player-fullscreen') {
          osdEl.classList.add('is-hiding');
          fadeOutTimer = setTimeout(function () {
            if (osdEl && osdEl.classList.contains('is-hiding')) {
              osdEl.classList.add('hidden');
            }
          }, 180);
        }
      }, 4500);
    }
  }

  function cycleSleepTimer() {
    var cur = Number(global.LuminaStore.get('sleepTimerMinutes') || 0);
    var idx = SLEEP_OPTIONS.indexOf(cur);
    var next = SLEEP_OPTIONS[(idx + 1) % SLEEP_OPTIONS.length];
    global.LuminaStore.set('sleepTimerMinutes', next);
    clearTimeout(sleepTimerId);
    if (next > 0) {
      sleepTimerId = setTimeout(function () {
        global.LuminaStore.set('sleepTimerMinutes', 0);
        if (global.LuminaPlayer && global.LuminaPlayer.stop) global.LuminaPlayer.stop();
        if (global.LuminaRouter && global.LuminaRouter.getCurrent() === 'player-fullscreen') {
          global.LuminaRouter.back();
        }
        if (global.LuminaUI && global.LuminaUI.toast) {
          global.LuminaUI.toast('Reprodução encerrada pelo temporizador Dormir.');
        }
      }, next * 60 * 1000);
      if (global.LuminaUI && global.LuminaUI.toast) {
        global.LuminaUI.toast('Dormir: desligar em ' + next + ' min');
      }
    } else if (global.LuminaUI && global.LuminaUI.toast) {
      global.LuminaUI.toast('Dormir: Desligado');
    }
    renderOsd();
  }

  function renderSquareBtn(id, action, iconKey, label, isPrimary) {
    return (
      '<div class="osd-sq-item">' +
        '<button id="' + escHtml(id) + '" class="osd-sq-btn' + (isPrimary ? ' is-primary' : '') + ' focusable" data-osd-action="' + escHtml(action) + '" data-scope="osd">' +
          svgIcon(iconKey) +
        '</button>' +
        '<span class="osd-sq-label">' + escHtml(label) + '</span>' +
      '</div>'
    );
  }

  function renderOsd(statePayload) {
    if (!osdEl && typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    var item = global.LuminaPlayer.getCurrentItem();
    var st = global.LuminaPlayer.getState();
    if (!item) return;

    var extra = (statePayload && statePayload.extra) || null;
    var isLive = item.kind === 'live';
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var savedProg = progMap[item.id] || { position: 0, duration: 0, percent: 0 };
    var nextPrompt = global.LuminaStore.get('nextEpisodePrompt');
    var diag = global.LuminaStore.get('diagnostics') || {};
    var sleepMin = Number(global.LuminaStore.get('sleepTimerMinutes') || 0);

    var nextEpBanner = '';
    if (nextPrompt && nextPrompt.nextEpisode) {
      var ne = nextPrompt.nextEpisode;
      nextEpBanner =
        '<div style="margin-bottom:16px;padding:18px 24px;background:var(--bg-panel);border:2px solid var(--accent);border-radius:var(--radius);display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="font-size:24px;"><strong>Próximo Episódio em ' + Number(nextPrompt.secondsLeft || 5) + 's:</strong> ' + escHtml(ne.cleanTitle) + ' (T' + Number(ne.season || 1) + ' \u00B7 E' + Number(ne.episode || 1) + ')</div>' +
          '<div style="display:flex;gap:12px;">' +
            '<button id="osd-btn-next-now" class="btn btn-primary btn-modal focusable" data-osd-action="next-ep-now" data-scope="osd">Assistir agora</button>' +
            '<button id="osd-btn-next-cancel" class="btn btn-secondary btn-modal focusable" data-osd-action="next-ep-cancel" data-scope="osd">Cancelar</button>' +
          '</div>' +
        '</div>';
    }

    // Seção A10: Pílula discreta no canto superior direito durante reconexão ("Tentando de novo… (2 de 3) · HLS")
    var topRetryPill = '';
    if (st === 'RETRYING') {
      var pillText = (extra && extra.message)
        ? extra.message
        : ('Tentando de novo\u2026 (2 de 3) \u00B7 ' + ((extra && extra.formatLabel) || 'HLS'));
      topRetryPill =
        '<div class="osd-retry-pill">' +
          '<span class="osd-retry-dot"></span>' +
          '<span>' + escHtml(pillText) + '</span>' +
        '</div>';
    }

    // Seção A10: Tela clara de erro humano com 5 ações ("Tentar de novo", "Trocar formato", "Trocar motor", "Ver diagnóstico", "Voltar")
    var statusBanner = '';
    if (st === 'FAILED') {
      var errTitle = (extra && extra.title) ? extra.title : 'Não foi possível reproduzir';
      var errMsg = (extra && extra.message) ? extra.message : (diag.lastError || 'Verifique sua conexão ou tente trocar o formato.');
      statusBanner =
        '<div style="margin-bottom:18px;padding:24px 28px;background:var(--bg-panel);border:2px solid var(--danger);border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:18px;">' +
          '<div>' +
            '<div style="font-size:28px;font-weight:800;color:var(--text);margin-bottom:6px;">' + escHtml(errTitle) + '</div>' +
            '<div style="font-size:24px;color:var(--text-2);">' + escHtml(errMsg) + '</div>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:14px;">' +
            '<button id="osd-btn-err-retry" class="btn btn-primary btn-modal focusable" data-osd-action="retry" data-scope="osd">Tentar de novo</button>' +
            '<button id="osd-btn-err-format" class="btn btn-secondary btn-modal focusable" data-osd-action="toggle-format" data-scope="osd">Trocar formato</button>' +
            '<button id="osd-btn-err-engine" class="btn btn-secondary btn-modal focusable" data-osd-action="switch-engine" data-scope="osd">Trocar motor</button>' +
            '<button id="osd-btn-err-diag" class="btn btn-secondary btn-modal focusable" data-osd-action="open-player-diag" data-scope="osd">Ver diagnóstico</button>' +
            '<button id="osd-btn-err-back" class="btn btn-secondary btn-modal focusable" data-osd-action="back" data-scope="osd">Voltar</button>' +
          '</div>' +
        '</div>';
    }

    var quickChannelDrawer = '';
    if (isLive && quickListOpen) {
      var allCh = global.LuminaStore.get('recentChannels') || [];
      var winSize = 6;
      var maxStart = Math.max(0, allCh.length - winSize);
      if (quickListOffset > maxStart) quickListOffset = maxStart;
      var qRows = '';
      for (var q = 0; q < winSize && (quickListOffset + q) < allCh.length; q++) {
        var cItem = allCh[quickListOffset + q];
        qRows +=
          '<button id="osd-qch-' + q + '" class="btn btn-secondary btn-modal focusable" data-osd-ch-id="' + escHtml(cItem.id) + '" data-scope="osd" style="justify-content:flex-start;width:270px;overflow:hidden;">' +
            '<span style="color:var(--accent);margin-right:10px;">#' + Number(cItem.channelNumber || (quickListOffset + q + 1)) + '</span>' +
            '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(cItem.cleanTitle) + '</span>' +
          '</button>';
      }
      quickChannelDrawer =
        '<div style="margin-bottom:16px;padding:18px 24px;background:var(--bg-panel);border:1px solid var(--line);border-radius:var(--radius);">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<strong style="font-size:24px;color:var(--accent);">Canais Ao Vivo</strong>' +
            '<div style="display:flex;gap:10px;">' +
              '<button id="osd-qch-prev" class="btn btn-secondary btn-modal focusable" data-osd-action="qch-prev" data-scope="osd">\u2039 Ant.</button>' +
              '<button id="osd-qch-next" class="btn btn-secondary btn-modal focusable" data-osd-action="qch-next" data-scope="osd">Próx. \u203A</button>' +
              '<button id="osd-qch-close" class="btn btn-secondary btn-modal focusable" data-osd-action="toggle-qch" data-scope="osd">Fechar</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + qRows + '</div>' +
        '</div>';
    }

    var timelineBlock = '';
    if (isLive) {
      timelineBlock =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 22px;">' +
          '<div style="display:flex;align-items:center;gap:16px;">' +
            '<span class="badge-live-red">AO VIVO</span>' +
            '<span style="font-size:24px;color:var(--text);">Agora: ' + escHtml(item.epgNow || (item.groupDisplay || item.groupOriginal || 'Transmissão contínua')) + '</span>' +
          '</div>' +
          '<span class="badge-quality">' + escHtml(item.quality || 'HD') + '</span>' +
        '</div>';
    } else {
      var pb = global.LuminaPlayback ? global.LuminaPlayback.getState() : { currentTime: 0, duration: 0 };
      var liveDur = pb.duration > 0 ? pb.duration : (savedProg.duration || item.durationSecs || 6485);
      var livePos = pb.currentTime > 0 ? pb.currentTime : (savedProg.position || 0);
      var pct = liveDur > 0 ? Math.min(100, Math.round((livePos / liveDur) * 100)) : (savedProg.percent || 0);
      timelineBlock =
        '<div id="osd-timeline-seek" class="osd-timeline-row focusable" data-osd-action="ff" data-scope="osd">' +
          '<span class="osd-time-label">' + formatTime(livePos) + '</span>' +
          '<div class="osd-seek-track">' +
            '<div class="osd-seek-fill" style="width:' + pct + '%;">' +
              '<div class="osd-seek-thumb"></div>' +
            '</div>' +
          '</div>' +
          '<span class="osd-time-label">' + formatTime(liveDur) + '</span>' +
        '</div>';
    }

    var chNumPrefix = (isLive && item.channelNumber) ? ('#' + item.channelNumber + ' \u00B7 ') : '';
    var metaText = (item.groupDisplay || item.groupOriginal || 'Catálogo') + ' \u00B7 ' + (item.quality || 'FHD') + (item.lang ? (' \u00B7 ' + item.lang) : '');
    var sleepLabel = sleepMin > 0 ? ('Dormir (' + sleepMin + 'm)') : 'Dormir';

    var deckButtons =
      renderSquareBtn('osd-ctrl-play', 'play', st === 'PAUSED' ? 'play' : 'pause', st === 'PAUSED' ? 'Reproduzir' : 'Pausar', true) +
      renderSquareBtn('osd-ctrl-rew', 'rew', 'rew', '-10 s', false) +
      renderSquareBtn('osd-ctrl-ff', 'ff', 'ff', '+10 s', false) +
      renderSquareBtn('osd-ctrl-sub', 'audio-sub', 'subs', 'Áudio e legendas', false) +
      renderSquareBtn('osd-ctrl-ratio', 'ratio', 'ratio', 'Proporção', false) +
      renderSquareBtn('osd-ctrl-sleep', 'sleep', 'sleep', sleepLabel, false);

    if (isLive) {
      deckButtons +=
        renderSquareBtn('osd-ctrl-prevch', 'prev-ch', 'prev-ch', 'Anterior', false) +
        renderSquareBtn('osd-ctrl-qch', 'toggle-qch', 'channels', 'Canais', false);
    }

    osdEl.innerHTML =
      '<div class="osd-scrim-top"></div>' +
      '<div class="osd-scrim-bottom"></div>' +
      '<div class="osd-top-layer">' + topRetryPill + '</div>' +
      '<div class="osd-bottom-layer">' +
        statusBanner +
        nextEpBanner +
        quickChannelDrawer +
        '<div>' +
          '<div class="osd-main-title">' + escHtml(chNumPrefix + item.cleanTitle) + '</div>' +
          '<div class="osd-main-meta">' + escHtml(metaText) + '</div>' +
        '</div>' +
        timelineBlock +
        '<div class="osd-square-deck">' + deckButtons + '</div>' +
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
    if (action === lastAction && nowT - lastActionAt < 240) return;
    lastAction = action;
    lastActionAt = nowT;

    var item = global.LuminaPlayer.getCurrentItem();
    var videoEl = global.LuminaPlayer.getVideoElement();
    var activeEngine = global.LuminaPlayer.getActiveEngine ? global.LuminaPlayer.getActiveEngine() : null;
    if (!item) return;

    if (targetEl) {
      var qChId = targetEl.getAttribute('data-osd-ch-id');
      if (qChId) {
        var allCh = global.LuminaStore.get('recentChannels') || [];
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
    else if (action === 'toggle-format') {
      var nextFmt = global.LuminaPlayer.toggleFormat ? global.LuminaPlayer.toggleFormat() : null;
      if (nextFmt && global.LuminaUI) {
        global.LuminaUI.toast('Alternando formato para: ' + (nextFmt === 'ts' ? 'MPEG-TS (.ts)' : 'HLS (.m3u8)'));
      }
    } else if (action === 'switch-engine') {
      var nextStep = global.LuminaPlayer.switchEngine();
      if (nextStep && global.LuminaUI) {
        global.LuminaUI.toast('Alternando para motor: ' + nextStep.engine);
      }
    } else if (action === 'open-player-diag') {
      global.LuminaRouter.navigate('player-diag');
    } else if (action === 'rew') {
      if (item.kind === 'live') global.LuminaPlayer.zapPrev();
      else global.LuminaPlayer.seekRelative(-10);
    } else if (action === 'ff') {
      if (item.kind === 'live') global.LuminaPlayer.zapNext();
      else global.LuminaPlayer.seekRelative(10);
    } else if (action === 'prev-ch') {
      global.LuminaPlayer.zapLastChannel();
    } else if (action === 'toggle-qch') {
      quickListOpen = !quickListOpen;
      if (quickListOpen) {
        var chs = global.LuminaStore.get('recentChannels') || [];
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
      var totalCh = (global.LuminaStore.get('recentChannels') || []).length;
      if (quickListOffset + 6 < totalCh) quickListOffset += 6;
      renderOsd();
      global.LuminaFocus.setFocus(document.getElementById('osd-qch-next'), 'osd');
    } else if (action === 'audio-sub') {
      var a = global.LuminaTracks.cycleAudioTrack(videoEl, activeEngine);
      var s = global.LuminaTracks.cycleSubtitleTrack(videoEl, activeEngine);
      global.LuminaUI.toast('Áudio: ' + a.label + ' \u00B7 Legenda: ' + s.label);
    } else if (action === 'ratio') {
      var r = global.LuminaTracks.cycleAspectRatio(videoEl, item.id);
      global.LuminaUI.toast('Proporção: ' + r.label);
    } else if (action === 'sleep') {
      cycleSleepTimer();
    } else if (action === 'next-ep-now') {
      var pr = global.LuminaStore.get('nextEpisodePrompt');
      if (pr && pr.nextEpisode) {
        global.LuminaPlayer.cancelNextEpisode();
        global.LuminaPlayer.open(pr.nextEpisode);
      }
    } else if (action === 'next-ep-cancel') {
      global.LuminaPlayer.cancelNextEpisode();
      global.LuminaUI.toast('Reprodução automática do próximo episódio cancelada.');
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
