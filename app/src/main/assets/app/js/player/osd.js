(function (global) {
  'use strict';

  var hideTimer = null;
  var fadeOutTimer = null;
  var sleepTimerId = null;
  var osdTimelineTicker = null;
  var osdEl = null;

  // Gaveta de canais ao vivo (intocada)
  var quickListOpen = false;
  var quickListOffset = 0;

  // Gaveta de episódios de séries/novelas dentro do player (Feature 2)
  var epDrawerOpen = false;
  var epDrawerSeason = 1;
  var epDrawerOffset = 0;
  var epDrawerLoading = false;
  var epDrawerError = null;
  var EP_DRAWER_WIN_SIZE = 4;

  // Estado de busca livre / scrub na timeline e aceleração de botões (Feature 3)
  var ACCEL_RESET_MS = 500;
  var SCRUB_COMMIT_MS = 700;

  var scrubState = {
    active: false,
    originSec: 0,
    targetSec: 0,
    commitTimer: null
  };

  var scrubAccel = {
    count: 0,
    lastDir: null,
    lastAt: 0
  };

  var buttonSeekAccel = {
    count: 0,
    lastDir: null,
    lastAt: 0
  };

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

  function formatSignedDelta(deltaSec) {
    var d = Math.round(Number(deltaSec || 0));
    var sign = d >= 0 ? '+' : '-';
    var abs = Math.abs(d);
    var h = Math.floor(abs / 3600);
    var m = Math.floor((abs % 3600) / 60);
    var s = abs % 60;
    var ss = (s < 10 ? '0' + s : String(s));
    if (h > 0) {
      var mm = (m < 10 ? '0' + m : String(m));
      return sign + h + ':' + mm + ':' + ss;
    }
    return sign + m + ':' + ss;
  }

  function resetAccel(accelObj) {
    accelObj.count = 0;
    accelObj.lastDir = null;
    accelObj.lastAt = 0;
  }

  function computeAccelStep(accelObj, dir, durationSec) {
    var now = Date.now();
    if (accelObj.lastDir === dir && (now - accelObj.lastAt) <= ACCEL_RESET_MS) {
      accelObj.count++;
    } else {
      accelObj.count = 1;
    }
    accelObj.lastDir = dir;
    accelObj.lastAt = now;

    var step = 10;
    if (accelObj.count <= 3) step = 10;
    else if (accelObj.count <= 8) step = 30;
    else if (accelObj.count <= 15) step = 60;
    else step = 300;

    if (durationSec && isFinite(durationSec) && durationSec > 0) {
      var maxJump = Math.max(1, Math.floor(durationSec * 0.10));
      if (step > maxJump) step = maxJump;
    }
    return step;
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
    if (name === 'prev-ep') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>';
    }
    if (name === 'next-ep') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>';
    }
    if (name === 'episodes') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
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

  function stopTimelineTicker() {
    if (osdTimelineTicker) {
      clearInterval(osdTimelineTicker);
      osdTimelineTicker = null;
    }
  }

  function getResolvedPlaybackTimes(item) {
    var progMap = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    var savedProg = (item && progMap[item.id]) ? progMap[item.id] : { position: 0, duration: 0, percent: 0 };
    var pb = global.LuminaPlayback ? global.LuminaPlayback.getState() : { currentTime: 0, duration: 0 };
    var realDur = (pb && pb.duration > 0) ? pb.duration : 0;
    var dispDur = realDur > 0 ? realDur : (savedProg.duration || (item && item.durationSecs) || 0);
    var dispPos = (pb && pb.currentTime > 0) ? pb.currentTime : (savedProg.position || 0);
    var pct = dispDur > 0 ? Math.max(0, Math.min(100, Math.round((dispPos / dispDur) * 100))) : (savedProg.percent || 0);
    return {
      realDuration: realDur,
      duration: dispDur,
      position: dispPos,
      percent: pct
    };
  }

  function updateTimelineDomInPlace() {
    if (typeof document === 'undefined') return;
    if (scrubState.active) return;
    if (!osdEl || osdEl.classList.contains('hidden')) return;
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    if (!item || item.kind === 'live') return;

    var times = getResolvedPlaybackTimes(item);
    var elapsedEl = document.getElementById('osd-time-elapsed');
    var totalEl = document.getElementById('osd-time-total');
    var fillEl = document.getElementById('osd-seek-fill');
    var bubbleEl = document.getElementById('osd-seek-bubble');

    if (elapsedEl) elapsedEl.textContent = formatTime(times.position);
    if (totalEl) totalEl.textContent = formatTime(times.duration);
    if (fillEl) fillEl.style.width = times.percent + '%';
    if (bubbleEl) bubbleEl.classList.add('hidden');
  }

  function startTimelineTickerIfNeeded() {
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    if (!item || item.kind === 'live') {
      stopTimelineTicker();
      return;
    }
    if (!osdTimelineTicker) {
      osdTimelineTicker = setInterval(function () {
        if (!osdEl || osdEl.classList.contains('hidden') || global.LuminaRouter.getCurrent() !== 'player-fullscreen') {
          stopTimelineTicker();
          return;
        }
        updateTimelineDomInPlace();
      }, 1000);
    }
  }

  function showOsd() {
    if (!osdEl && typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    clearTimeout(fadeOutTimer);
    osdEl.classList.remove('hidden', 'is-hiding');
    startTimelineTickerIfNeeded();
    clearTimeout(hideTimer);
    var st = global.LuminaPlayer.getState();
    if (st !== 'FAILED' && st !== 'RETRYING' && !quickListOpen && !epDrawerOpen && !scrubState.active && !global.LuminaStore.get('nextEpisodePrompt')) {
      hideTimer = setTimeout(function () {
        if (global.LuminaRouter.getCurrent() === 'player-fullscreen' && !quickListOpen && !epDrawerOpen && !scrubState.active && !global.LuminaStore.get('nextEpisodePrompt')) {
          osdEl.classList.add('is-hiding');
          fadeOutTimer = setTimeout(function () {
            if (osdEl && osdEl.classList.contains('is-hiding')) {
              osdEl.classList.add('hidden');
              stopTimelineTicker();
            }
          }, 180);
        }
      }, 4500);
    }
  }

  function cancelScrub() {
    if (scrubState.commitTimer) {
      clearTimeout(scrubState.commitTimer);
      scrubState.commitTimer = null;
    }
    var wasActive = scrubState.active;
    scrubState.active = false;
    resetAccel(scrubAccel);
    if (wasActive) {
      updateTimelineDomInPlace();
      showOsd();
    }
    return wasActive;
  }

  function commitScrubSeek() {
    if (scrubState.commitTimer) {
      clearTimeout(scrubState.commitTimer);
      scrubState.commitTimer = null;
    }
    if (!scrubState.active) {
      seekWithButtonAccel('RIGHT');
      return;
    }
    var target = scrubState.targetSec;
    scrubState.active = false;
    resetAccel(scrubAccel);

    if (typeof document !== 'undefined') {
      var bubbleEl = document.getElementById('osd-seek-bubble');
      if (bubbleEl) bubbleEl.classList.add('hidden');
    }

    if (global.LuminaPlayback) {
      global.LuminaPlayback.seekTo(target);
    }
    if (global.LuminaPlayer) {
      if (typeof global.LuminaPlayer.saveProgress === 'function') {
        global.LuminaPlayer.saveProgress();
      }
      if (typeof global.LuminaPlayer.checkNextEpisodeOfferTick === 'function') {
        global.LuminaPlayer.checkNextEpisodeOfferTick();
      }
    }
    showOsd();
  }

  function handleSeekKey(dir) {
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    if (!item || item.kind === 'live') return false;

    var pb = global.LuminaPlayback ? global.LuminaPlayback.getState() : { currentTime: 0, duration: 0 };
    var dur = Number(pb.duration || 0);

    // Se a duração for desconhecida (0/NaN), desativa scrub e usa +/-10s tradicional (Requisito 3g)
    if (!dur || isNaN(dur) || dur <= 0) {
      global.LuminaPlayer.seekRelative(dir === 'RIGHT' ? 10 : -10);
      showOsd();
      return true;
    }

    if (!scrubState.active) {
      scrubState.active = true;
      scrubState.originSec = Number(pb.currentTime || 0);
      scrubState.targetSec = scrubState.originSec;
    }

    var stepSec = computeAccelStep(scrubAccel, dir, dur);
    var delta = (dir === 'RIGHT') ? stepSec : -stepSec;
    var maxSeek = Math.max(0, dur - 3);
    scrubState.targetSec = Math.max(0, Math.min(maxSeek, scrubState.targetSec + delta));

    var pct = Math.max(0, Math.min(100, Math.round((scrubState.targetSec / dur) * 100)));
    var totalDelta = scrubState.targetSec - scrubState.originSec;

    if (typeof document !== 'undefined') {
      var elapsedEl = document.getElementById('osd-time-elapsed');
      var fillEl = document.getElementById('osd-seek-fill');
      var bubbleEl = document.getElementById('osd-seek-bubble');
      if (elapsedEl) elapsedEl.textContent = formatTime(scrubState.targetSec);
      if (fillEl) fillEl.style.width = pct + '%';
      if (bubbleEl) {
        bubbleEl.textContent = formatTime(scrubState.targetSec) + '  (' + formatSignedDelta(totalDelta) + ')';
        bubbleEl.style.left = Math.max(8, Math.min(92, pct)) + '%';
        bubbleEl.classList.remove('hidden');
      }
    }

    showOsd();
    if (scrubState.commitTimer) clearTimeout(scrubState.commitTimer);
    scrubState.commitTimer = setTimeout(function () {
      commitScrubSeek();
    }, SCRUB_COMMIT_MS);

    return true;
  }

  function seekWithButtonAccel(dir) {
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    if (!item || item.kind === 'live') return;
    if (scrubState.active) {
      cancelScrub();
    }
    var pb = global.LuminaPlayback ? global.LuminaPlayback.getState() : { currentTime: 0, duration: 0 };
    var dur = Number(pb.duration || 0);
    var stepSec = (!dur || isNaN(dur) || dur <= 0) ? 10 : computeAccelStep(buttonSeekAccel, dir, dur);
    var signedStep = (dir === 'RIGHT') ? stepSec : -stepSec;
    global.LuminaPlayer.seekRelative(signedStep);
    updateTimelineDomInPlace();
    showOsd();
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

  function getActiveSeasonEpisodes(epCtx) {
    if (!epCtx || !epCtx.seasons || !epCtx.seasons.length) return [];
    for (var i = 0; i < epCtx.seasons.length; i++) {
      if (Number(epCtx.seasons[i].seasonNumber) === Number(epDrawerSeason)) {
        return epCtx.seasons[i].episodes || [];
      }
    }
    epDrawerSeason = epCtx.seasons[0].seasonNumber;
    return epCtx.seasons[0].episodes || [];
  }

  function syncEpDrawerToCurrentEpisode() {
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    var epCtx = (item && global.LuminaPlayer && global.LuminaPlayer.getEpisodeContext)
      ? global.LuminaPlayer.getEpisodeContext(item)
      : null;
    if (!item || !epCtx || !epCtx.seasons || !epCtx.seasons.length) {
      epDrawerSeason = (item && item.season) || 1;
      epDrawerOffset = 0;
      return;
    }

    var targetSeason = Number(item.season || epCtx.seasons[0].seasonNumber || 1);
    var seasonEps = [];
    for (var i = 0; i < epCtx.seasons.length; i++) {
      if (Number(epCtx.seasons[i].seasonNumber) === targetSeason) {
        seasonEps = epCtx.seasons[i].episodes || [];
        break;
      }
    }
    if (!seasonEps.length) {
      targetSeason = epCtx.seasons[0].seasonNumber;
      seasonEps = epCtx.seasons[0].episodes || [];
    }
    epDrawerSeason = targetSeason;

    var curIdxInSeason = 0;
    for (var j = 0; j < seasonEps.length; j++) {
      if (seasonEps[j].id === item.id) {
        curIdxInSeason = j;
        break;
      }
    }
    var maxStart = Math.max(0, seasonEps.length - EP_DRAWER_WIN_SIZE);
    epDrawerOffset = Math.max(0, Math.min(curIdxInSeason, maxStart));
  }

  function buildEpDrawerSeasonsHtml(epCtx) {
    if (!epCtx || !epCtx.seasons || !epCtx.seasons.length) return '';
    var html = '';
    var maxPills = Math.min(epCtx.seasons.length, 8);
    for (var i = 0; i < maxPills; i++) {
      var sNum = epCtx.seasons[i].seasonNumber;
      var actCls = (Number(sNum) === Number(epDrawerSeason)) ? ' is-active' : '';
      html +=
        '<button id="osd-ep-season-' + sNum + '" class="season-pill focusable' + actCls + '" ' +
                'data-lr-control="osd-ep-season" data-osd-action="select-ep-season" data-osd-season="' + sNum + '" data-scope="osd">' +
          'Temporada ' + sNum +
        '</button>';
    }
    return html;
  }

  function buildEpDrawerRowsHtml(epCtx, enterDir) {
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    var progMap = (global.LuminaStore && global.LuminaStore.get('watchProgress')) || {};
    var seasonEps = getActiveSeasonEpisodes(epCtx);
    if (!seasonEps.length) {
      return '<div class="osd-ep-row"><span>Nenhum episódio disponível nesta temporada.</span></div>';
    }

    var maxStart = Math.max(0, seasonEps.length - EP_DRAWER_WIN_SIZE);
    if (epDrawerOffset > maxStart) epDrawerOffset = maxStart;
    if (epDrawerOffset < 0) epDrawerOffset = 0;

    var end = Math.min(seasonEps.length, epDrawerOffset + EP_DRAWER_WIN_SIZE);
    var visCount = end - epDrawerOffset;
    var rows = '';

    for (var idx = epDrawerOffset; idx < end; idx++) {
      var ep = seasonEps[idx];
      var slot = idx - epDrawerOffset;
      var isCur = !!(item && ep.id === item.id);
      var epProg = progMap[ep.id] || { percent: 0, completed: false };
      var enterCls = '';
      if (enterDir === 'DOWN' && slot === visCount - 1) enterCls = ' vrow-enter-down';
      else if (enterDir === 'UP' && slot === 0) enterCls = ' vrow-enter-up';

      var statusHtml = '<span style="font-size:22px;color:var(--text-2);font-weight:600;">Assistir</span>';
      if (epProg.completed) {
        statusHtml = '<span style="font-size:22px;color:var(--green);font-weight:700;">\u2713 Assistido</span>';
      } else if (epProg.percent > 0) {
        statusHtml = '<span style="font-size:22px;color:var(--accent);font-weight:700;">' + Math.round(epProg.percent) + '%</span>';
      }

      var curBadge = isCur
        ? '<span style="margin-left:12px;padding:2px 10px;border-radius:6px;background:rgba(56,189,248,0.2);color:var(--accent);font-size:22px;font-weight:700;">Atual</span>'
        : '';

      rows +=
        '<div id="osd-ep-row-' + slot + '" class="osd-ep-row focusable' + (isCur ? ' is-current' : '') + enterCls + '" ' +
             'data-vlist="osd-episodes" data-vindex="' + idx + '" data-vtotal="' + seasonEps.length + '" ' +
             'data-osd-action="select-ep-row" data-osd-ep-id="' + escHtml(ep.id) + '" data-scope="osd">' +
          '<div style="display:flex;align-items:center;min-width:0;flex:1;margin-right:16px;">' +
            '<span style="color:var(--accent);font-weight:800;margin-right:10px;flex-shrink:0;">E' + Number(ep.episode || (idx + 1)) + ' \u00B7</span>' +
            '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;">' + escHtml(ep.cleanTitle) + '</span>' +
            curBadge +
          '</div>' +
          '<div style="flex-shrink:0;">' + statusHtml + '</div>' +
        '</div>';
    }
    return rows;
  }

  function updateEpDrawerListOnly(enterDir) {
    if (typeof document === 'undefined') return;
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    var epCtx = (item && global.LuminaPlayer && global.LuminaPlayer.getEpisodeContext)
      ? global.LuminaPlayer.getEpisodeContext(item)
      : null;
    var listBox = document.getElementById('osd-ep-drawer-list');
    var seasonsBox = document.getElementById('osd-ep-drawer-seasons');
    if (seasonsBox && epCtx) {
      seasonsBox.innerHTML = buildEpDrawerSeasonsHtml(epCtx);
    }
    if (listBox && epCtx) {
      listBox.innerHTML = buildEpDrawerRowsHtml(epCtx, enterDir || '');
    }
    showOsd();
  }

  function handleEpisodeBoundary(focusedEl, dir) {
    if (!epDrawerOpen || !focusedEl) return false;
    var vindex = parseInt(focusedEl.getAttribute('data-vindex') || '0', 10);
    var vtotal = parseInt(focusedEl.getAttribute('data-vtotal') || '0', 10);
    var slot = vindex - epDrawerOffset;

    if (dir === 'DOWN' && slot === EP_DRAWER_WIN_SIZE - 1 && vindex + 1 < vtotal) {
      epDrawerOffset++;
      updateEpDrawerListOnly('DOWN');
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        global.LuminaFocus.setFocus(document.getElementById('osd-ep-row-' + (EP_DRAWER_WIN_SIZE - 1)), 'osd');
      }
      return true;
    }
    if (dir === 'UP' && slot === 0 && epDrawerOffset > 0) {
      epDrawerOffset--;
      updateEpDrawerListOnly('UP');
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        global.LuminaFocus.setFocus(document.getElementById('osd-ep-row-0'), 'osd');
      }
      return true;
    }
    return false;
  }

  function handleSeasonKey(dir) {
    if (!epDrawerOpen) return false;
    var item = global.LuminaPlayer ? global.LuminaPlayer.getCurrentItem() : null;
    var epCtx = (item && global.LuminaPlayer && global.LuminaPlayer.getEpisodeContext)
      ? global.LuminaPlayer.getEpisodeContext(item)
      : null;
    if (!epCtx || !epCtx.seasons || epCtx.seasons.length <= 1) return true;

    var nums = epCtx.seasons.map(function (s) { return Number(s.seasonNumber); });
    var curIdx = nums.indexOf(Number(epDrawerSeason));
    if (curIdx === -1) curIdx = 0;
    var step = (dir === 'RIGHT') ? 1 : -1;
    var nextIdx = (curIdx + step + nums.length) % nums.length;
    epDrawerSeason = nums[nextIdx];
    epDrawerOffset = 0;
    updateEpDrawerListOnly('');
    if (typeof document !== 'undefined' && global.LuminaFocus) {
      global.LuminaFocus.setFocus(document.getElementById('osd-ep-season-' + epDrawerSeason), 'osd');
    }
    return true;
  }

  function isDrawerOpen() {
    return !!(epDrawerOpen || quickListOpen);
  }

  function closeDrawer() {
    if (epDrawerOpen) {
      epDrawerOpen = false;
      renderOsd();
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        var epBtn = document.getElementById('osd-ctrl-episodes') || document.getElementById('osd-ctrl-play');
        if (epBtn) global.LuminaFocus.setFocus(epBtn, 'osd');
      }
      return true;
    }
    if (quickListOpen) {
      quickListOpen = false;
      renderOsd();
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        var qBtn = document.getElementById('osd-ctrl-qch') || document.getElementById('osd-ctrl-play');
        if (qBtn) global.LuminaFocus.setFocus(qBtn, 'osd');
      }
      return true;
    }
    return false;
  }

  function renderOsd(statePayload) {
    if (!osdEl && typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
    if (!osdEl) return;
    var item = global.LuminaPlayer.getCurrentItem();
    var st = global.LuminaPlayer.getState();
    if (!item) return;

    var extra = (statePayload && statePayload.extra) || null;
    var isLive = (item.kind === 'live');
    var isEpisode = (item.kind === 'episode' || item.kind === 'series');
    var epCtx = (isEpisode && global.LuminaPlayer.getEpisodeContext)
      ? global.LuminaPlayer.getEpisodeContext(item)
      : null;
    var nextPrompt = global.LuminaStore.get('nextEpisodePrompt');
    var diag = global.LuminaStore.get('diagnostics') || {};
    var sleepMin = Number(global.LuminaStore.get('sleepTimerMinutes') || 0);

    var nextEpBanner = '';
    if (nextPrompt && nextPrompt.nextEpisode) {
      var ne = nextPrompt.nextEpisode;
      var isOfferMode = (nextPrompt.mode === 'offer');
      var bannerLabel = isOfferMode
        ? ('<strong>Próximo episódio:</strong> ' + escHtml(ne.cleanTitle) + ' (T' + Number(ne.season || 1) + ' \u00B7 E' + Number(ne.episode || 1) + ')')
        : ('<strong>Próximo Episódio em ' + Number(nextPrompt.secondsLeft || 5) + 's:</strong> ' + escHtml(ne.cleanTitle) + ' (T' + Number(ne.season || 1) + ' \u00B7 E' + Number(ne.episode || 1) + ')');
      var cancelAction = isOfferMode ? 'next-ep-dismiss' : 'next-ep-cancel';
      var cancelLabel = isOfferMode ? 'Dispensar' : 'Cancelar';

      nextEpBanner =
        '<div style="margin-bottom:16px;padding:18px 24px;background:var(--bg-panel);border:2px solid var(--accent);border-radius:var(--radius);display:flex;justify-content:space-between;align-items:center;">' +
          '<div style="font-size:24px;">' + bannerLabel + '</div>' +
          '<div style="display:flex;gap:12px;">' +
            '<button id="osd-btn-next-now" class="btn btn-primary btn-modal focusable" data-osd-action="next-ep-now" data-scope="osd">Assistir agora</button>' +
            '<button id="osd-btn-next-cancel" class="btn btn-secondary btn-modal focusable" data-osd-action="' + cancelAction + '" data-scope="osd">' + cancelLabel + '</button>' +
          '</div>' +
        '</div>';
    }

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
      var allCh = global.LuminaStore.get('channels') || [];
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

    var episodeDrawerHtml = '';
    if (isEpisode && epDrawerOpen) {
      var drawerBody = '';
      if (epDrawerLoading) {
        drawerBody =
          '<div style="padding:18px 0;font-size:24px;color:var(--text-2);">Carregando episódios\u2026</div>';
      } else if (epDrawerError || !epCtx || !epCtx.seasons || !epCtx.seasons.length) {
        var errText = epDrawerError || 'Não foi possível carregar a lista de episódios desta série.';
        drawerBody =
          '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;gap:16px;">' +
            '<span style="font-size:24px;color:var(--danger);">' + escHtml(errText) + '</span>' +
            '<button id="osd-ep-retry" class="btn btn-primary btn-modal focusable" data-osd-action="retry-ep-drawer" data-scope="osd">Tentar novamente</button>' +
          '</div>';
      } else {
        drawerBody =
          '<div id="osd-ep-drawer-seasons" class="season-pills-bar" style="margin:0 0 12px;">' +
            buildEpDrawerSeasonsHtml(epCtx) +
          '</div>' +
          '<div id="osd-ep-drawer-list">' +
            buildEpDrawerRowsHtml(epCtx, '') +
          '</div>';
      }

      var showHeading = (epCtx && epCtx.show && epCtx.show.cleanTitle)
        ? epCtx.show.cleanTitle
        : (item.seriesTitle || item.cleanTitle || 'Episódios');

      episodeDrawerHtml =
        '<div id="osd-ep-drawer" class="osd-ep-drawer">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<strong style="font-size:24px;color:var(--accent);">Episódios \u00B7 ' + escHtml(showHeading) + '</strong>' +
            '<button id="osd-ep-close" class="btn btn-secondary btn-modal focusable" data-osd-action="toggle-ep-drawer" data-scope="osd">Fechar</button>' +
          '</div>' +
          drawerBody +
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
      var times = getResolvedPlaybackTimes(item);
      var shownPos = scrubState.active ? scrubState.targetSec : times.position;
      var shownPct = (scrubState.active && times.duration > 0)
        ? Math.max(0, Math.min(100, Math.round((scrubState.targetSec / times.duration) * 100)))
        : times.percent;
      var bubbleText = scrubState.active
        ? (formatTime(scrubState.targetSec) + '  (' + formatSignedDelta(scrubState.targetSec - scrubState.originSec) + ')')
        : '';
      var bubbleLeft = Math.max(8, Math.min(92, shownPct));

      timelineBlock =
        '<div id="osd-timeline-seek" class="osd-timeline-row focusable" data-lr-control="osd-seek" data-osd-action="commit-seek" data-scope="osd">' +
          '<span id="osd-time-elapsed" class="osd-time-label">' + formatTime(shownPos) + '</span>' +
          '<div class="osd-seek-track">' +
            '<div id="osd-seek-bubble" class="osd-seek-bubble' + (scrubState.active ? '' : ' hidden') + '" style="left:' + bubbleLeft + '%;">' + escHtml(bubbleText) + '</div>' +
            '<div id="osd-seek-fill" class="osd-seek-fill" style="width:' + shownPct + '%;">' +
              '<div class="osd-seek-thumb"></div>' +
            '</div>' +
          '</div>' +
          '<span id="osd-time-total" class="osd-time-label">' + formatTime(times.duration) + '</span>' +
        '</div>';
    }

    var chNumPrefix = (isLive && item.channelNumber) ? ('#' + item.channelNumber + ' \u00B7 ') : '';
    var metaText = (item.groupDisplay || item.groupOriginal || 'Catálogo') + ' \u00B7 ' + (item.quality || 'FHD') + (item.lang ? (' \u00B7 ' + item.lang) : '');
    var sleepLabel = sleepMin > 0 ? ('Dormir (' + sleepMin + 'm)') : 'Dormir';
    var rewLabel = isLive ? '-10 s' : 'Voltar';
    var ffLabel = isLive ? '+10 s' : 'Avançar';

    var deckButtons =
      renderSquareBtn('osd-ctrl-play', 'play', st === 'PAUSED' ? 'play' : 'pause', st === 'PAUSED' ? 'Reproduzir' : 'Pausar', true) +
      renderSquareBtn('osd-ctrl-rew', 'rew', 'rew', rewLabel, false) +
      renderSquareBtn('osd-ctrl-ff', 'ff', 'ff', ffLabel, false);

    if (isEpisode) {
      if (epCtx && epCtx.prevEpisode) {
        deckButtons += renderSquareBtn('osd-ctrl-prev-ep', 'prev-ep', 'prev-ep', 'Ep. anterior', false);
      }
      if (epCtx && epCtx.nextEpisode) {
        deckButtons += renderSquareBtn('osd-ctrl-next-ep', 'next-ep', 'next-ep', 'Próx. ep.', false);
      }
      deckButtons += renderSquareBtn('osd-ctrl-episodes', 'toggle-ep-drawer', 'episodes', 'Episódios', false);
    }

    deckButtons +=
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
        episodeDrawerHtml +
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
      if (st === 'FAILED') {
        focusTarget = '#osd-btn-err-retry';
      } else if (nextPrompt) {
        focusTarget = '#osd-btn-next-now';
      } else if (isEpisode && epDrawerOpen) {
        if (epDrawerLoading) {
          focusTarget = '#osd-ep-close';
        } else if (epDrawerError || !epCtx || !epCtx.seasons || !epCtx.seasons.length) {
          focusTarget = '#osd-ep-retry';
        } else {
          var seasonEpsFocus = getActiveSeasonEpisodes(epCtx);
          var curFocusSlot = 0;
          for (var f = epDrawerOffset; f < Math.min(seasonEpsFocus.length, epDrawerOffset + EP_DRAWER_WIN_SIZE); f++) {
            if (seasonEpsFocus[f].id === item.id) {
              curFocusSlot = f - epDrawerOffset;
              break;
            }
          }
          focusTarget = '#osd-ep-row-' + curFocusSlot;
        }
      }
      global.LuminaFocus.restoreOrDefault('osd', focusTarget);
    }
  }

  var lastAction = '';
  var lastActionAt = 0;

  function handleAction(action, targetEl) {
    var nowT = Date.now();
    var bypassDebounce = (action === 'rew' || action === 'ff' || action === 'commit-seek');
    if (!bypassDebounce && action === lastAction && nowT - lastActionAt < 240) return;
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

      var epRowId = targetEl.getAttribute('data-osd-ep-id');
      if (epRowId) {
        var ctx = global.LuminaPlayer.getEpisodeContext ? global.LuminaPlayer.getEpisodeContext(item) : null;
        var flat = (ctx && ctx.flatEpisodes) || [];
        for (var e = 0; e < flat.length; e++) {
          if (flat[e].id === epRowId) {
            if (global.LuminaPlayer.saveProgress) global.LuminaPlayer.saveProgress();
            epDrawerOpen = false;
            global.LuminaPlayer.open(flat[e]);
            return;
          }
        }
      }
    }

    if (action === 'play') {
      global.LuminaPlayer.togglePlayPause();
    } else if (action === 'commit-seek') {
      commitScrubSeek();
    } else if (action === 'retry') {
      global.LuminaPlayer.retry();
    } else if (action === 'toggle-format') {
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
      else seekWithButtonAccel('LEFT');
    } else if (action === 'ff') {
      if (item.kind === 'live') global.LuminaPlayer.zapNext();
      else seekWithButtonAccel('RIGHT');
    } else if (action === 'prev-ep') {
      var ctxPrev = global.LuminaPlayer.getEpisodeContext ? global.LuminaPlayer.getEpisodeContext(item) : null;
      if (ctxPrev && ctxPrev.prevEpisode) {
        if (global.LuminaPlayer.saveProgress) global.LuminaPlayer.saveProgress();
        epDrawerOpen = false;
        global.LuminaPlayer.open(ctxPrev.prevEpisode);
      }
    } else if (action === 'next-ep') {
      var ctxNext = global.LuminaPlayer.getEpisodeContext ? global.LuminaPlayer.getEpisodeContext(item) : null;
      if (ctxNext && ctxNext.nextEpisode) {
        if (global.LuminaPlayer.saveProgress) global.LuminaPlayer.saveProgress();
        epDrawerOpen = false;
        global.LuminaPlayer.open(ctxNext.nextEpisode);
      }
    } else if (action === 'toggle-ep-drawer') {
      if (epDrawerOpen) {
        closeDrawer();
        return;
      }
      epDrawerOpen = true;
      quickListOpen = false;
      var ctxOpen = global.LuminaPlayer.getEpisodeContext ? global.LuminaPlayer.getEpisodeContext(item) : null;
      if (ctxOpen && ctxOpen.needsLazyLoad && global.LuminaPlayer.loadEpisodeListForCurrent) {
        epDrawerLoading = true;
        epDrawerError = null;
        renderOsd();
        global.LuminaPlayer.loadEpisodeListForCurrent(function (err) {
          epDrawerLoading = false;
          epDrawerError = err ? (err.message || 'Falha ao carregar episódios.') : null;
          syncEpDrawerToCurrentEpisode();
          renderOsd();
        });
        return;
      }
      epDrawerLoading = false;
      epDrawerError = null;
      syncEpDrawerToCurrentEpisode();
      renderOsd();
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        var seasonEpsOpen = getActiveSeasonEpisodes(ctxOpen);
        var openSlot = 0;
        for (var k = epDrawerOffset; k < Math.min(seasonEpsOpen.length, epDrawerOffset + EP_DRAWER_WIN_SIZE); k++) {
          if (seasonEpsOpen[k].id === item.id) {
            openSlot = k - epDrawerOffset;
            break;
          }
        }
        var rowEl = document.getElementById('osd-ep-row-' + openSlot);
        if (rowEl) global.LuminaFocus.setFocus(rowEl, 'osd');
      }
    } else if (action === 'retry-ep-drawer') {
      if (global.LuminaPlayer.loadEpisodeListForCurrent) {
        epDrawerLoading = true;
        epDrawerError = null;
        renderOsd();
        global.LuminaPlayer.loadEpisodeListForCurrent(function (err) {
          epDrawerLoading = false;
          epDrawerError = err ? (err.message || 'Falha ao carregar episódios.') : null;
          syncEpDrawerToCurrentEpisode();
          renderOsd();
        });
      }
    } else if (action === 'select-ep-season' && targetEl) {
      var sNumAttr = parseInt(targetEl.getAttribute('data-osd-season') || '1', 10);
      epDrawerSeason = sNumAttr;
      epDrawerOffset = 0;
      updateEpDrawerListOnly('');
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        global.LuminaFocus.setFocus(document.getElementById('osd-ep-season-' + sNumAttr), 'osd');
      }
    } else if (action === 'prev-ch') {
      global.LuminaPlayer.zapLastChannel();
    } else if (action === 'toggle-qch') {
      quickListOpen = !quickListOpen;
      if (quickListOpen) {
        epDrawerOpen = false;
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
        if (global.LuminaPlayer.markCurrentEpisodeCompleted) {
          global.LuminaPlayer.markCurrentEpisodeCompleted();
        }
        global.LuminaPlayer.cancelNextEpisode();
        global.LuminaPlayer.open(pr.nextEpisode);
      }
    } else if (action === 'next-ep-dismiss') {
      if (global.LuminaPlayer.dismissNextEpisodeOffer) {
        global.LuminaPlayer.dismissNextEpisodeOffer();
      } else {
        global.LuminaPlayer.cancelNextEpisode();
      }
      renderOsd();
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        var playBtn = document.getElementById('osd-ctrl-play');
        if (playBtn) global.LuminaFocus.setFocus(playBtn, 'osd');
      }
    } else if (action === 'next-ep-cancel') {
      global.LuminaPlayer.cancelNextEpisode();
      global.LuminaUI.toast('Reprodução automática do próximo episódio cancelada.');
      renderOsd();
    } else if (action === 'back') {
      quickListOpen = false;
      epDrawerOpen = false;
      cancelScrub();
      global.LuminaRouter.back();
    }
  }

  global.LuminaOSD = {
    init: function () {
      if (typeof document !== 'undefined') osdEl = document.getElementById('player-osd');
      global.LuminaEventBus.on('player:state', function (payload) {
        if (payload && payload.state === 'IDLE') {
          quickListOpen = false;
          epDrawerOpen = false;
          cancelScrub();
          stopTimelineTicker();
          return;
        }
        renderOsd(payload);
      });
      global.LuminaEventBus.on('player:item-changed', function () {
        quickListOpen = false;
        epDrawerOpen = false;
        epDrawerLoading = false;
        epDrawerError = null;
        cancelScrub();
        resetAccel(buttonSeekAccel);
        renderOsd();
      });
      global.LuminaEventBus.on('player:next-ep-tick', function (promptPayload) {
        renderOsd();
        if (promptPayload && typeof document !== 'undefined' && global.LuminaFocus) {
          var nextBtn = document.getElementById('osd-btn-next-now');
          if (nextBtn) global.LuminaFocus.setFocus(nextBtn, 'osd');
        }
      });
      global.LuminaEventBus.on('player:episodes-loaded', function () {
        if (global.LuminaRouter && global.LuminaRouter.getCurrent() === 'player-fullscreen') {
          if (epDrawerOpen) {
            epDrawerLoading = false;
            epDrawerError = null;
            syncEpDrawerToCurrentEpisode();
          }
          renderOsd();
        }
      });

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
        if (inPlayer()) {
          quickListOpen = false;
          epDrawerOpen = false;
          cancelScrub();
          global.LuminaRouter.back();
        }
      });
      global.LuminaEventBus.on('key:REWIND', function () {
        if (inPlayer()) {
          var it = global.LuminaPlayer.getCurrentItem();
          if (it.kind !== 'live') seekWithButtonAccel('LEFT');
          else global.LuminaPlayer.zapPrev();
        }
      });
      global.LuminaEventBus.on('key:FAST_FORWARD', function () {
        if (inPlayer()) {
          var it2 = global.LuminaPlayer.getCurrentItem();
          if (it2.kind !== 'live') seekWithButtonAccel('RIGHT');
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
    handleAction: handleAction,
    handleSeekKey: handleSeekKey,
    handleSeasonKey: handleSeasonKey,
    handleEpisodeBoundary: handleEpisodeBoundary,
    isDrawerOpen: isDrawerOpen,
    closeDrawer: closeDrawer,
    isScrubbing: function () { return !!scrubState.active; },
    cancelScrub: cancelScrub
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaOSD;
})(typeof window !== 'undefined' ? window : global);
