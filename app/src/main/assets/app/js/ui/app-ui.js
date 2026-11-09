(function (global) {
  'use strict';

  // Variável única de controle da identidade visual ('A' | 'B' | 'C') — Seção 11
  var BRAND_LOGO = 'A';

  var MENU_ITEMS = [
    { route: 'home', label: 'Início', iconId: 'icon-home' },
    { route: 'search', label: 'Busca', iconId: 'icon-search' },
    { route: 'live', label: 'Canais', iconId: 'icon-live' },
    { route: 'movies', label: 'Filmes', iconId: 'icon-movies' },
    { route: 'series', label: 'Séries', iconId: 'icon-series' },
    { route: 'favorites', label: 'Favoritos', iconId: 'icon-favorites' }
  ];

  var SETTINGS_TABS = [
    { id: 'source', label: 'Fonte e Pareamento' },
    { id: 'playback', label: 'Reprodução' },
    { id: 'screen', label: 'Tela e Desempenho' },
    { id: 'organizer', label: 'Organizar Lista' },
    { id: 'parental', label: 'Controle Parental' },
    { id: 'updates', label: 'Atualizações' },
    { id: 'backup', label: 'Backup e Dados' },
    { id: 'about', label: 'Sobre' }
  ];

  // Seção 3: 12 paletas de degradê determinísticas (topo -> base) + 6 motivos geométricos planos
  var POSTER_PALETTES = [
    ['#1D3A8A', '#0B1130'],
    ['#6D28D9', '#2E1065'],
    ['#0F766E', '#022C22'],
    ['#C2410C', '#431407'],
    ['#0369A1', '#082F49'],
    ['#334155', '#0F172A'],
    ['#0D9488', '#042F2E'],
    ['#7C3AED', '#1E1B4B'],
    ['#B45309', '#451A03'],
    ['#1E40AF', '#172554'],
    ['#BE185D', '#500724'],
    ['#4D7C0F', '#1A2E05']
  ];

  var POSTER_MOTIFS = ['moon', 'sun', 'mountains', 'city', 'forest', 'waves'];

  var selectedLiveCat = 'Todos os Canais';
  var selectedMovieCat = 'Todos os Filmes';
  var selectedSeriesCat = 'Todas as Séries';
  var selectedNovelaCat = 'Todas as Novelas';
  var currentSeriesKind = 'series'; // 'series' | 'novelas' (controlado pelo seletor "Tipo" em Séries)
  var currentSort = 'recent'; // 'recent' | 'name' | 'rating'
  var currentLangFilter = 'Todos'; // 'Todos' | idiomas existentes
  var currentLetterFilter = 'Todas'; // 'Todas' | 'A'..'Z'
  var activeSettingsTab = 'source';

  // Estados de janelas virtualizadas
  var liveCatWindowStart = 0;
  var LIVE_CAT_WIN_SIZE = 10;
  var liveChWindowStart = 0;
  var LIVE_CH_WIN_SIZE = 9;
  var focusedLiveChannelId = null;

  var filterCatWindowStart = { movies: 0, series: 0, novelas: 0 };
  var FILTER_CAT_WIN_SIZE = 8;

  var posterWindowStart = { movies: 0, series: 0, novelas: 0 };
  var POSTER_COLS = 4;
  var POSTER_ROWS = 2;
  var POSTER_WIN_SIZE = POSTER_COLS * POSTER_ROWS; // 8 cartões 301x452 visíveis por janela (4x2)

  var detailEpWindowStart = 0;
  var DETAIL_EP_WIN_SIZE = 3;

  var orgGroupWindowStart = 0;
  var ORG_GROUP_WIN_SIZE = 5;

  var favWindowStart = 0;
  var FAV_WIN_SIZE = 8;

  var sideMenuOpen = false;
  var lastFocusedBeforeMenuId = null;
  var lastRouteRendered = null;

  var bootCompleted = false;
  var introAnimationFinished = false;
  var introWaitTimer = null;
  var introFinishTimer = null;

  var pairingStarting = false;
  var pinDraft = '';
  var pinModalMode = 'unlock';
  var pinChangeTempCurrent = '';
  var pinChangeTempNew = '';
  var pendingPinCallback = null;

  var KB_KEYS = [
    'A','B','C','D','E','F',
    'G','H','I','J','K','L',
    'M','N','O','P','Q','R',
    'S','T','U','V','W','X',
    'Y','Z','0','1','2','3',
    '4','5','6','7','8','9'
  ];

  var LETTERS_LIST = ['Todas','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];

  function escHtml(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(t) {
    return escHtml(t);
  }

  function fmtCountPt(n) {
    var num = Math.max(0, parseInt(n || 0, 10));
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function fmtRatingPt(r) {
    if (!r && r !== 0) return '';
    var num = parseFloat(String(r).replace(',', '.'));
    if (isNaN(num) || num <= 0) return '';
    return num.toFixed(1).replace('.', ',');
  }

  function fmtDateBr(ts) {
    if (!ts) return 'Nunca';
    try {
      var d = new Date(ts);
      var now = new Date();
      if (d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        return 'Atualizada hoje';
      }
      var dd = ('0' + d.getDate()).slice(-2);
      var mm = ('0' + (d.getMonth() + 1)).slice(-2);
      return 'Atualizada em ' + dd + '/' + mm;
    } catch (e) {
      return 'Atualizada';
    }
  }

  function getBrandLogoSvg(variant, idSuffix) {
    var v = variant || BRAND_LOGO || 'A';
    var sfx = idSuffix || Math.floor(Math.random() * 100000);
    if (v === 'B') {
      return (
        '<svg viewBox="0 0 64 64">' +
          '<defs><linearGradient id="ldeluz_' + sfx + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#67E8F9"/><stop offset="55%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/>' +
          '</linearGradient></defs>' +
          '<path class="brand-part brand-blade-1" d="M 16 15 C 16 12.2 18.2 10 21 10 C 23.8 10 26 12.2 26 15 V 40 H 38 V 33.5 L 52 43.5 L 38 53.5 V 47 H 21 C 18.2 47 16 44.8 16 42 Z" fill="url(#ldeluz_' + sfx + ')"/>' +
          '<path class="brand-part brand-blade-2" d="M 30 20 L 46 30 L 30 36 Z" fill="#38BDF8" opacity="0.45"/>' +
          '<circle class="brand-part brand-spark-dot" cx="21" cy="6.2" r="2.4" fill="#FDE68A"/>' +
        '</svg>'
      );
    }
    if (v === 'C') {
      return (
        '<svg viewBox="0 0 64 64">' +
          '<defs><linearGradient id="horiz_' + sfx + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#67E8F9"/><stop offset="100%" stop-color="#0284C7"/>' +
          '</linearGradient></defs>' +
          '<path class="brand-part brand-blade-1" fill-rule="evenodd" d="M 10 44 A 22 22 0 0 1 54 44 H 46 A 14 14 0 0 0 18 44 Z M 28 27 L 40 34.5 L 28 42 Z" fill="url(#horiz_' + sfx + ')"/>' +
          '<path class="brand-part brand-blade-2" d="M 16 22 A 24 24 0 0 1 48 22 L 45 25.5 A 19 19 0 0 0 19 25.5 Z" fill="#38BDF8"/>' +
          '<rect class="brand-part brand-blade-3" x="10" y="48" width="44" height="5" rx="2.5" fill="#38BDF8"/>' +
          '<circle class="brand-part brand-spark-dot" cx="32" cy="11.5" r="2.2" fill="#FDE68A"/>' +
        '</svg>'
      );
    }
    return (
      '<svg viewBox="0 0 64 64">' +
        '<defs>' +
          '<linearGradient id="fb1_' + sfx + '" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#67E8F9"/><stop offset="100%" stop-color="#38BDF8"/></linearGradient>' +
          '<linearGradient id="fb2_' + sfx + '" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0284C7"/></linearGradient>' +
          '<linearGradient id="fb3_' + sfx + '" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0284C7"/><stop offset="100%" stop-color="#6D5BFF"/></linearGradient>' +
        '</defs>' +
        '<path class="brand-part brand-blade-1" d="M 14 14.5 Q 14 10.5 17.6 12.6 L 25.5 17.1 L 19.5 51.1 L 17.6 52.2 Q 14 54.3 14 50.3 Z" fill="url(#fb1_' + sfx + ')"/>' +
        '<path class="brand-part brand-blade-2" d="M 29.2 19.2 L 40.2 25.5 L 36.2 41.5 L 23.2 49.0 Z" fill="url(#fb2_' + sfx + ')"/>' +
        '<path class="brand-part brand-blade-3" d="M 43.8 27.6 L 51.8 32.2 Q 55.2 34.1 51.8 36.0 L 39.8 42.9 Z" fill="url(#fb3_' + sfx + ')"/>' +
        '<circle class="brand-part brand-spark-dot" cx="15.8" cy="8.2" r="2.2" fill="#FDE68A"/>' +
      '</svg>'
    );
  }

  function computeTitleHash(title) {
    var s = String(title || 'Lumina');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul ? Math.imul(h, 16777619) : ((h * 16777619) | 0);
    }
    return Math.abs(h | 0);
  }

  function getTitlePalette(title) {
    var h = computeTitleHash(title);
    return POSTER_PALETTES[h % POSTER_PALETTES.length];
  }

  function getTitleGradient(title) {
    var pair = getTitlePalette(title);
    return 'linear-gradient(180deg, ' + pair[0] + ' 0%, ' + pair[1] + ' 100%)';
  }

  function getTitleMotif(title) {
    var h = computeTitleHash(String(title || '') + ':motif');
    return POSTER_MOTIFS[h % POSTER_MOTIFS.length];
  }

  function generateDeterministicArtSvg(title) {
    var pair = getTitlePalette(title);
    var baseColor = pair[1];
    var motif = getTitleMotif(title);
    var shapes = '';

    if (motif === 'moon') {
      shapes =
        '<circle cx="222" cy="84" r="34" fill="#FDE68A" opacity="0.88"/>' +
        '<polygon points="0,336 0,210 72,148 148,218 228,132 301,196 301,336" fill="' + baseColor + '" opacity="0.55"/>' +
        '<polygon points="0,336 0,250 96,192 184,262 254,188 301,238 301,336" fill="' + baseColor + '"/>';
    } else if (motif === 'sun') {
      shapes =
        '<circle cx="214" cy="96" r="42" fill="#FDBA74" opacity="0.90"/>' +
        '<circle cx="214" cy="96" r="62" fill="#FDBA74" opacity="0.18"/>' +
        '<polygon points="0,336 0,232 88,176 176,244 252,168 301,220 301,336" fill="' + baseColor + '" opacity="0.65"/>' +
        '<rect x="0" y="276" width="301" height="60" fill="' + baseColor + '"/>';
    } else if (motif === 'mountains') {
      shapes =
        '<polygon points="-10,336 -10,185 68,68 132,208 202,38 268,195 312,110 312,336" fill="' + baseColor + '" opacity="0.55"/>' +
        '<polygon points="-10,336 -10,236 92,135 174,256 248,122 312,224 312,336" fill="' + baseColor + '"/>';
    } else if (motif === 'city') {
      shapes =
        '<circle cx="226" cy="78" r="28" fill="#FDE68A" opacity="0.82"/>' +
        '<rect x="6" y="190" width="40" height="146" fill="' + baseColor + '" opacity="0.92"/>' +
        '<rect x="52" y="164" width="48" height="172" fill="' + baseColor + '" opacity="0.92"/>' +
        '<rect x="106" y="224" width="38" height="112" fill="' + baseColor + '" opacity="0.92"/>' +
        '<rect x="150" y="142" width="46" height="194" fill="' + baseColor + '" opacity="0.92"/>' +
        '<rect x="202" y="178" width="42" height="158" fill="' + baseColor + '" opacity="0.92"/>' +
        '<rect x="250" y="152" width="46" height="184" fill="' + baseColor + '" opacity="0.92"/>';
    } else if (motif === 'forest') {
      shapes =
        '<ellipse cx="150" cy="72" rx="115" ry="30" fill="#67E8F9" opacity="0.20"/>' +
        '<polygon points="32,162 68,336 -4,336" fill="' + baseColor + '"/>' +
        '<polygon points="84,132 124,336 44,336" fill="' + baseColor + '"/>' +
        '<polygon points="138,174 176,336 100,336" fill="' + baseColor + '"/>' +
        '<polygon points="194,124 236,336 152,336" fill="' + baseColor + '"/>' +
        '<polygon points="252,154 292,336 212,336" fill="' + baseColor + '"/>';
    } else {
      shapes =
        '<circle cx="220" cy="82" r="34" fill="#E8EEFF" opacity="0.88"/>' +
        '<path d="M 0 228 Q 75 196 150 228 T 301 228 L 301 336 L 0 336 Z" fill="' + baseColor + '" opacity="0.58"/>' +
        '<path d="M 0 268 Q 75 240 150 268 T 301 268 L 301 336 L 0 336 Z" fill="' + baseColor + '"/>';
    }

    return '<svg class="poster-motif-svg" viewBox="0 0 301 336" preserveAspectRatio="none">' + shapes + '</svg>';
  }

  function formatDurationHuman(secondsOrMins) {
    var sec = Number(secondsOrMins || 0);
    if (!sec || sec <= 0) return '2 h 05 min';
    var totalMin = sec > 300 ? Math.round(sec / 60) : Math.round(sec);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) {
      return h + ' h ' + ('0' + m).slice(-2) + ' min';
    }
    return m + ' min';
  }

  function formatResumeClock(sec) {
    var s = Math.max(0, Math.floor(Number(sec || 0)));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    var mm = ('0' + m).slice(-2);
    var ss = ('0' + r).slice(-2);
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  function getClockStringNow() {
    var d = new Date();
    var hh = ('0' + d.getHours()).slice(-2);
    var mm = ('0' + d.getMinutes()).slice(-2);
    return hh + ':' + mm;
  }

  function getGreetingByHour(hour) {
    var h = (typeof hour === 'number') ? hour : (new Date()).getHours();
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h >= 12 && h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function renderSwitchControl(isOn) {
    var cls = isOn ? ' is-on' : '';
    var txt = isOn ? 'Ligado' : 'Desligado';
    return (
      '<div class="switch-wrap' + cls + '">' +
        '<span class="switch-label-state">' + txt + '</span>' +
        '<div class="switch-track"><div class="switch-thumb"></div></div>' +
      '</div>'
    );
  }

  function getMonogram(title) {
    var clean = String(title || 'TV').replace(/[^a-zA-Z0-9À-ÿ ]/g, ' ').trim();
    if (!clean) return 'TV';
    var parts = clean.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function svgChevLeft() {
    return '<svg class="i" viewBox="0 0 24 24"><use href="#icon-chev-left"/></svg>';
  }

  function svgChevRight() {
    return '<svg class="i" viewBox="0 0 24 24"><use href="#icon-chev-right"/></svg>';
  }

  // ── Carregamento de Lista ──
  function showLoading(title) {
    global.LuminaStore.set('loading', true);
    if (typeof document === 'undefined') return;
    var el = document.getElementById('loading-overlay');
    if (!el) return;
    var titleEl = document.getElementById('loading-title');
    if (titleEl) titleEl.textContent = title || 'Carregando';
    setLoading('Preparando...', null);
    el.classList.remove('hidden');
    var cancelBtn = document.getElementById('btn-loading-cancel');
    if (cancelBtn) global.LuminaFocus.setFocus(cancelBtn, 'loading');
  }

  function setLoading(status, percent) {
    if (typeof document === 'undefined') return;
    var st = document.getElementById('loading-status');
    var bar = document.getElementById('loading-bar');
    var pc = document.getElementById('loading-percent');
    if (!st || !bar || !pc) return;
    st.textContent = status || '';
    if (percent == null) {
      bar.classList.add('is-indeterminate');
      bar.style.width = '';
      pc.textContent = '';
    } else {
      bar.classList.remove('is-indeterminate');
      bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
      pc.textContent = Math.round(percent) + '%';
    }
  }

  function hideLoading() {
    global.LuminaStore.set('loading', false);
    if (typeof document === 'undefined') return;
    var el = document.getElementById('loading-overlay');
    if (el) el.classList.add('hidden');
  }

  function onLoadProgress(p) {
    setLoading(p.status, p.percent);
  }

  function toast(msg) {
    if (typeof document === 'undefined') return;
    var box = document.getElementById('toast-container');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = String(msg || '');
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 140);
    }, 3000);
  }

  function isItemLockedByParental(item) {
    if (!item || !item.adult) return false;
    if (global.LuminaSettings && global.LuminaSettings.checkAndExpireParentalSession) {
      global.LuminaSettings.checkAndExpireParentalSession();
    }
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
    return !!(par.enabled && !par.unlockedSession);
  }

  function filterAdultForPublicViews(list) {
    if (global.LuminaSettings && global.LuminaSettings.checkAndExpireParentalSession) {
      global.LuminaSettings.checkAndExpireParentalSession();
    }
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false, hideAdultInSearchAndHome: true };
    if (!par.enabled || par.unlockedSession || !par.hideAdultInSearchAndHome) return list;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i].adult) out.push(list[i]);
    }
    return out;
  }

  // ── Modal de PIN Parental ──
  function openParentalPinModal(onUnlocked, mode) {
    pinDraft = '';
    pinModalMode = mode || 'unlock';
    if (pinModalMode === 'change-current') {
      pinChangeTempCurrent = '';
      pinChangeTempNew = '';
    }
    pendingPinCallback = onUnlocked || null;
    renderParentalPinModal();
  }

  function closeParentalPinModal() {
    pinDraft = '';
    pinModalMode = 'unlock';
    pendingPinCallback = null;
    if (typeof document !== 'undefined') {
      var modal = document.getElementById('pin-modal-backdrop');
      if (modal) modal.classList.add('hidden');
    }
    global.LuminaFocus.setTrap(null);
    renderCurrentRoute();
  }

  function renderParentalPinModal(statusText) {
    if (typeof document === 'undefined') return;
    var modal = document.getElementById('pin-modal-backdrop');
    if (!modal) return;
    modal.classList.remove('hidden');
    global.LuminaFocus.setTrap(modal);

    var masked = '';
    for (var i = 0; i < 4; i++) {
      masked += (i < pinDraft.length) ? '●' : '○';
    }

    var digits = ['1','2','3','4','5','6','7','8','9','0'];
    var padHtml = '';
    for (var d = 0; d < digits.length; d++) {
      var dg = digits[d];
      padHtml += '<div id="pin-key-' + dg + '" class="pin-key focusable" data-pin-digit="' + dg + '" data-scope="pin-modal">' + dg + '</div>';
    }

    var heading = 'Controle Parental';
    var subtitle = 'Digite o seu PIN de 4 dígitos (padrão inicial: 0000).';
    if (pinModalMode === 'change-current') {
      heading = 'Alterar PIN · Passo 1 de 3';
      subtitle = 'Digite o seu PIN atual de 4 dígitos.';
    } else if (pinModalMode === 'change-new') {
      heading = 'Alterar PIN · Passo 2 de 3';
      subtitle = 'Digite o novo PIN de 4 dígitos.';
    } else if (pinModalMode === 'change-confirm') {
      heading = 'Alterar PIN · Passo 3 de 3';
      subtitle = 'Confirme o novo PIN de 4 dígitos.';
    }

    modal.innerHTML =
      '<div class="modal-card" style="width:680px;text-align:center;">' +
        '<div class="modal-title">' + escHtml(heading) + '</div>' +
        '<div class="modal-body">' + escHtml(statusText || subtitle) + '</div>' +
        '<div class="pin-dots-display">' + masked + '</div>' +
        '<div class="pin-pad-grid">' + padHtml + '</div>' +
        '<div class="modal-actions" style="justify-content:center;margin-top:24px;">' +
          '<button id="pin-btn-clear" class="btn btn-secondary btn-modal focusable" data-pin-action="clear" data-scope="pin-modal">Limpar</button>' +
          '<button id="pin-btn-cancel" class="btn btn-primary btn-modal focusable" data-pin-action="cancel" data-scope="pin-modal">Cancelar</button>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.setFocus(document.getElementById('pin-key-0'), 'pin-modal');
  }

  // ── Painel de Diagnóstico ──
  function buildDiagnosticsReportText() {
    var diag = global.LuminaStore.get('diagnostics') || {};
    var domCount = (typeof document !== 'undefined' && document.getElementsByTagName) ? document.getElementsByTagName('*').length : 0;
    var plat = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Web';
    var ver = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '2.0.0';
    var items = global.LuminaStore.get('items') || [];
    var unclass = global.LuminaStore.get('unclassifiedList') || [];
    var estMemMb = Math.round(((items.length * 320) / (1024 * 1024)) * 10) / 10;

    return [
      'LUMINA TV v' + ver + ' · ' + plat,
      'Motor Ativo: ' + (diag.engine || 'NativeEngine') + ' (' + (diag.attemptedChain || '-') + ')',
      'TTFF: ' + (diag.ttffMs || 0) + ' ms · Reconexões: ' + (diag.reconnections || 0),
      'Nós no DOM: ' + domCount + ' · Memória Catálogo: ~' + estMemMb + ' MB',
      'Itens: ' + items.length + ' · Não classificados: ' + unclass.length
    ].join('\n');
  }

  function renderDiagnosticsOverlay() {
    if (typeof document === 'undefined') return;
    var box = document.getElementById('diag-overlay');
    if (!box) return;
    var visible = global.LuminaStore.get('diagnosticsVisible');
    if (!visible) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    var diag = global.LuminaStore.get('diagnostics') || {};
    var domCount = document.getElementsByTagName('*').length;
    diag.domNodes = domCount;
    var appVer = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '2.0.0';
    var platLabel = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Smart TV';
    var itemsCount = (global.LuminaStore.get('items') || []).length;

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:12px;">' +
        '<strong style="color:var(--accent);font-size:24px;">Diagnóstico Lumina TV v' + escHtml(appVer) + '</strong>' +
        '<span class="badge-quality">MENU 2s</span>' +
      '</div>' +
      '<div style="font-size:22px;margin-bottom:6px;">Plataforma: <strong>' + escHtml(platLabel) + '</strong></div>' +
      '<div style="font-size:22px;margin-bottom:6px;">Motor: <strong style="color:var(--accent);">' + escHtml(diag.engine || 'NativeEngine') + '</strong></div>' +
      '<div style="font-size:22px;margin-bottom:6px;">Nós DOM: <strong style="color:var(--green);">' + domCount + '</strong> · Catálogo: <strong>' + fmtCountPt(itemsCount) + '</strong></div>' +
      '<div style="font-size:22px;color:var(--text-2);">Último erro: ' + escHtml(diag.lastError || 'Nenhum') + '</div>';
  }

  function sortItems(list, mode) {
    var copy = list.slice();
    if (mode === 'name') {
      copy.sort(function (a, b) { return (a.cleanTitle || '').localeCompare(b.cleanTitle || ''); });
    } else if (mode === 'rating') {
      copy.sort(function (a, b) { return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0); });
    } else {
      copy.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    }
    return copy;
  }

  function getContinueWatchingItems() {
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var byId = global.LuminaStore.get('itemByIdMap') || {};
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false, hideAdultInSearchAndHome: true };
    var hideAdult = par.enabled && !par.unlockedSession && par.hideAdultInSearchAndHome;
    var result = [];
    var progKeys = Object.keys(progMap);
    for (var i = 0; i < progKeys.length; i++) {
      var id = progKeys[i];
      var pr = progMap[id];
      if (pr && pr.position > 0 && !pr.completed) {
        var it = byId[id];
        if (it && (!hideAdult || !it.adult)) {
          result.push({ item: it, progress: pr });
        }
      }
    }
    result.sort(function (a, b) { return (b.progress.updatedAt || 0) - (a.progress.updatedAt || 0); });
    return result;
  }

  // ── Menu Lateral Recolhido (120px) e Painel Sobreposto Aberto (360px) — Seção 5 ──
  function getActiveNavRoute(route) {
    if (route === 'novelas') return 'series';
    if (route === 'onboarding' || route === 'organizer') return 'settings';
    return route;
  }

  function renderSideNav(activeRoute) {
    if (typeof document === 'undefined') return;
    var rail = document.getElementById('side-nav');
    var drawer = document.getElementById('side-nav-drawer');
    var backdrop = document.getElementById('nav-backdrop');
    if (!rail || !drawer || !backdrop) return;

    if (activeRoute === 'player-fullscreen') {
      rail.classList.add('hidden');
      drawer.classList.add('hidden');
      backdrop.classList.add('hidden');
      return;
    }
    rail.classList.remove('hidden');
    drawer.classList.remove('hidden');
    backdrop.classList.remove('hidden');

    var navActive = getActiveNavRoute(activeRoute);
    var logoSvg = getBrandLogoSvg(BRAND_LOGO);

    // 1. Barra recolhida (120px): logo 64x64 no topo, itens de 72px com ícone 38px sem texto, Ajustes no rodapé
    var awaitingCls = isBootSplashVisible() ? ' is-awaiting-flip' : '';
    var railHtml = '<div id="side-nav-logo" class="brand-logo-box' + awaitingCls + '">' + getBrandLogoSvg(BRAND_LOGO, 'rail') + '</div><div class="nav-list">';
    for (var i = 0; i < MENU_ITEMS.length; i++) {
      var it = MENU_ITEMS[i];
      var actCls = (navActive === it.route) ? ' is-active' : '';
      railHtml +=
        '<div class="nav-item-rail' + actCls + '">' +
          '<svg class="i" viewBox="0 0 24 24"><use href="#' + escAttr(it.iconId) + '"/></svg>' +
        '</div>';
    }
    railHtml += '</div><div class="nav-spacer"></div><div class="nav-list-bottom">';
    railHtml +=
      '<div class="nav-item-rail' + (navActive === 'settings' ? ' is-active' : '') + '">' +
        '<svg class="i" viewBox="0 0 24 24"><use href="#icon-settings"/></svg>' +
      '</div></div>';
    rail.innerHTML = railHtml;

    // 2. Painel aberto sobreposto (360px): logo + "Lumina TV" (34px/800), itens de 76px com ícone 38px + rótulo 28px/600
    var drawerHtml =
      '<div class="brand-row"><div class="brand-logo-box">' + logoSvg + '</div><b>Lumina TV</b></div>' +
      '<div class="nav-list">';
    for (var j = 0; j < MENU_ITEMS.length; j++) {
      var m = MENU_ITEMS[j];
      var mAct = (navActive === m.route) ? ' is-active' : '';
      drawerHtml +=
        '<div id="nav-' + m.route + '" class="nav-item focusable' + mAct + '" data-nav="' + escAttr(m.route) + '" data-scope="nav">' +
          '<svg class="i" viewBox="0 0 24 24"><use href="#' + escAttr(m.iconId) + '"/></svg>' +
          '<span>' + escHtml(m.label) + '</span>' +
        '</div>';
    }
    drawerHtml += '</div><div class="nav-spacer"></div><div class="nav-list-bottom">';
    drawerHtml +=
      '<div id="nav-settings" class="nav-item focusable' + (navActive === 'settings' ? ' is-active' : '') + '" data-nav="settings" data-scope="nav">' +
        '<svg class="i" viewBox="0 0 24 24"><use href="#icon-settings"/></svg>' +
        '<span>Ajustes</span>' +
      '</div></div>';
    drawer.innerHTML = drawerHtml;

    if (sideMenuOpen) {
      drawer.classList.add('is-open');
      backdrop.classList.add('is-open');
    } else {
      drawer.classList.remove('is-open');
      backdrop.classList.remove('is-open');
    }
  }

  function openSideMenu() {
    if (typeof document === 'undefined') return false;
    var route = global.LuminaRouter.getCurrent();
    if (route === 'player-fullscreen') return false;
    var cur = global.LuminaFocus.getCurrent();
    if (cur && cur.id && cur.getAttribute('data-scope') !== 'nav') {
      lastFocusedBeforeMenuId = cur.id;
    }
    sideMenuOpen = true;
    var drawer = document.getElementById('side-nav-drawer');
    var backdrop = document.getElementById('nav-backdrop');
    if (drawer) drawer.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-open');
    global.LuminaFocus.setTrap(drawer);
    var activeNavId = 'nav-' + getActiveNavRoute(route);
    var targetEl = document.getElementById(activeNavId) || document.getElementById('nav-home');
    if (targetEl) global.LuminaFocus.setFocus(targetEl, 'nav');
    return true;
  }

  function closeSideMenu(restoreFocus) {
    if (typeof document === 'undefined') return false;
    sideMenuOpen = false;
    var drawer = document.getElementById('side-nav-drawer');
    var backdrop = document.getElementById('nav-backdrop');
    if (drawer) drawer.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    global.LuminaFocus.setTrap(null);
    if (restoreFocus) {
      if (lastFocusedBeforeMenuId) {
        var prevEl = document.getElementById(lastFocusedBeforeMenuId);
        if (prevEl && global.LuminaFocus.setFocus(prevEl)) return true;
      }
      var route = global.LuminaRouter.getCurrent() || 'home';
      global.LuminaFocus.restoreOrDefault(route);
    }
    return true;
  }

  function isSideMenuOpen() {
    return !!sideMenuOpen;
  }

  // ── Cabeçalho Técnico da Viewport (mantém T4 compatível com viewport-fit.js) ──
  function buildHomeViewportHeaderHtml() {
    var platName = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Smart TV';
    var appVer = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '2.0.0';
    var baseText = 'LUMINA TV v' + appVer + ' \u2022 ' + platName.toUpperCase();
    var vInfo = (typeof global.__luminaViewportInfo === 'function')
      ? global.__luminaViewportInfo()
      : { viewW: 1920, viewH: 1080, scale: 1 };
    var scalePct = (Number(vInfo.scale || 1) * 100).toFixed(1).replace('.', ',');
    var fullText = baseText + ' \u2022 TELA ' + Math.round(vInfo.viewW || 1920) + '\u00D7' + Math.round(vInfo.viewH || 1080) + ' \u2022 ESCALA ' + scalePct + '%';
    return '<div id="home-viewport-header" class="hidden" data-base-header="' + escAttr(baseText) + '">' + escHtml(fullText) + '</div>';
  }

  // ── 1. Tela Início v2.0.0 (Seção 4: Saudação, Relógio 30s, Carrossel 8s Ken Burns, "Ver tudo" e 1º Cartão Continuar 420x236) ──
  var homeCarouselTimer = null;
  var homeClockTimer = null;

  function isFocusInsideHeroBanner() {
    if (typeof document === 'undefined') return false;
    var cur = global.LuminaFocus && global.LuminaFocus.getCurrent ? global.LuminaFocus.getCurrent() : null;
    if (!cur) return false;
    var banner = document.getElementById('home-hero-banner');
    return !!(banner && banner.contains && banner.contains(cur));
  }

  function scheduleHomeCarouselTick() {
    clearTimeout(homeCarouselTimer);
    if (typeof document === 'undefined') return;
    if (global.LuminaRouter.getCurrent() !== 'home') return;
    homeCarouselTimer = setTimeout(function () {
      if (global.LuminaRouter.getCurrent() !== 'home') return;
      if (!isFocusInsideHeroBanner() && !sideMenuOpen) {
        var curIdx = global.LuminaStore.get('heroBannerIndex') || 0;
        global.LuminaStore.set('heroBannerIndex', curIdx + 1);
        renderCurrentRoute();
      } else {
        scheduleHomeCarouselTick();
      }
    }, 8000);
  }

  function startHomeClockUpdater() {
    clearInterval(homeClockTimer);
    if (typeof document === 'undefined') return;
    homeClockTimer = setInterval(function () {
      var el = document.getElementById('home-clock-display');
      if (el) el.textContent = getClockStringNow();
    }, 30000);
  }

  function getScreenEnterClass() {
    var dir = global.LuminaStore ? global.LuminaStore.get('navDirection') : 'forward';
    return dir === 'back' ? 'screen-enter-back' : 'screen-enter-forward';
  }

  function renderHomeTile(item, tileId, progressPct, actionAttr, isLeadContinue) {
    var grad = getTitleGradient(item.cleanTitle);
    var motifSvg = generateDeterministicArtSvg(item.cleanTitle);
    var mono = escHtml(getMonogram(item.cleanTitle));
    var imgTag = item.logo
      ? '<img class="home-tile-img lazy-fade" src="' + escAttr(item.logo) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.style.display=\'none\'">'
      : '';
    var progHtml = (typeof progressPct === 'number' && progressPct > 0)
      ? '<div class="progress-track"><b class="progress-fill" style="width:' + Math.min(100, Math.round(progressPct)) + '%"></b></div>'
      : '';
    var leadCls = isLeadContinue ? ' is-lead-continue' : '';

    return (
      '<div id="' + escAttr(tileId) + '" class="home-tile' + leadCls + ' focusable" style="background:' + grad + ';" ' + actionAttr + ' data-scope="home">' +
        motifSvg +
        imgTag +
        '<div class="card-focus-sheen"></div>' +
        '<div class="home-tile-mono">' + mono + '</div>' +
        '<div class="home-tile-shade"></div>' +
        '<div class="home-tile-title">' + escHtml(item.cleanTitle) + '</div>' +
        progHtml +
      '</div>'
    );
  }

  function renderEmptyListIllustrationSvg() {
    return (
      '<svg width="240" height="160" viewBox="0 0 240 160" style="flex-shrink:0;">' +
        '<defs>' +
          '<linearGradient id="empScreenGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#172554"/><stop offset="100%" stop-color="#0B0F17"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect x="12" y="16" width="146" height="96" rx="14" fill="url(#empScreenGrad)" stroke="#38BDF8" stroke-width="2"/>' +
        '<polygon points="74,48 104,64 74,80" fill="#38BDF8"/>' +
        '<rect x="56" y="120" width="58" height="6" rx="3" fill="#334155"/>' +
        '<rect x="174" y="28" width="54" height="96" rx="10" fill="#131B2E" stroke="#67E8F9" stroke-width="2"/>' +
        '<rect x="186" y="46" width="30" height="30" rx="4" fill="rgba(56,189,248,0.18)" stroke="#38BDF8" stroke-width="1.5"/>' +
        '<circle cx="201" cy="106" r="4" fill="#FDE68A"/>' +
      '</svg>'
    );
  }

  function renderHome(viewport) {
    var allItems = global.LuminaStore.get('items') || [];
    var allChannels = global.LuminaStore.get('channels') || [];
    var allMovies = global.LuminaStore.get('movies') || [];
    var series = global.LuminaStore.get('seriesList') || [];
    var novelas = global.LuminaStore.get('novelasList') || [];
    var unclass = global.LuminaStore.get('unclassifiedList') || [];

    var channels = allChannels.length ? filterAdultForPublicViews(allChannels.slice(0, 30)) : [];
    var movies = allMovies.length ? filterAdultForPublicViews(allMovies.slice(0, 30)) : [];
    var publicSeries = series.length ? filterAdultForPublicViews(series.slice(0, 20)) : [];
    var publicNovelas = novelas.length ? filterAdultForPublicViews(novelas.slice(0, 20)) : [];

    var greetingText = getGreetingByHour();
    var clockText = getClockStringNow();
    var enterCls = getScreenEnterClass();

    // Estado vazio (sem lista — Seção 4): ilustração, título "Vamos colocar sua lista aqui" (36px/800), texto 26px #94A3B8 sem corte e botão "Parear agora"
    if (!allItems.length && !unclass.length) {
      viewport.innerHTML =
        '<div class="' + enterCls + '">' +
          buildHomeViewportHeaderHtml() +
          '<div class="home-top-bar">' +
            '<div class="home-greeting">' + escHtml(greetingText) + '</div>' +
            '<div id="home-clock-display" class="home-clock">' + escHtml(clockText) + '</div>' +
          '</div>' +
          '<div class="home-empty-card">' +
            renderEmptyListIllustrationSvg() +
            '<div>' +
              '<div class="home-empty-title">Vamos colocar sua lista aqui</div>' +
              '<div class="home-empty-sub">Use o pareamento rápido por código ou QR Code para trazer seus canais, filmes e séries.</div>' +
              '<div style="display:flex;gap:20px;">' +
                '<button id="home-btn-phone" class="btn btn-primary focusable" data-action="go-phone-pairing" data-scope="home">' +
                  '<svg class="i" viewBox="0 0 24 24"><use href="#icon-play"/></svg>Parear agora' +
                '</button>' +
                '<button id="home-btn-settings" class="btn btn-secondary focusable" data-nav="settings" data-scope="home">' +
                  '<svg class="i" viewBox="0 0 24 24"><use href="#icon-settings"/></svg>Ajustes' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      startHomeClockUpdater();
      global.LuminaFocus.restoreOrDefault('home', '#home-btn-phone');
      return;
    }

    var favMap = global.LuminaStore.get('favorites') || {};
    var byId = global.LuminaStore.get('itemByIdMap') || {};
    var favItems = [];
    var favKeys = Object.keys(favMap);
    for (var fk = 0; fk < favKeys.length && favItems.length < 3; fk++) {
      var fIt = byId[favKeys[fk]];
      if (fIt && !isItemLockedByParental(fIt)) favItems.push(fIt);
    }

    var highlights = [].concat(favItems.slice(0, 2), movies.slice(0, 3), publicSeries.slice(0, 2)).slice(0, 5);
    if (!highlights.length) highlights = [].concat(channels.slice(0, 3), publicNovelas.slice(0, 2)).slice(0, 5);
    if (!highlights.length) highlights = allItems.slice(0, 5);

    var bIdx = ((global.LuminaStore.get('heroBannerIndex') || 0) % highlights.length + highlights.length) % highlights.length;
    var hero = highlights[bIdx];
    var isHeroFav = global.LuminaStore.isFavorite(hero.id);

    var dotsHtml = '';
    for (var d = 0; d < highlights.length; d++) {
      if (d === bIdx) {
        dotsHtml += '<i class="home-banner-dot is-active"><b class="home-banner-dot-fill"></b></i>';
      } else {
        dotsHtml += '<i class="home-banner-dot"></i>';
      }
    }

    var heroPlayAttr = (hero.kind === 'series-show' || hero.kind === 'novela-show')
      ? ('data-detail-id="' + escAttr(hero.id) + '"')
      : (hero.kind === 'live' ? ('data-play-id="' + escAttr(hero.id) + '"') : ('data-play-vod="' + escAttr(hero.id) + '"'));

    var heroSub = hero.synopsis
      ? hero.synopsis
      : ((hero.year ? hero.year + ' \u00B7 ' : '') + (hero.groupDisplay || hero.groupOriginal || 'Destaque do seu catálogo'));

    var heroGrad = getTitleGradient(hero.cleanTitle);
    var heroMotif = generateDeterministicArtSvg(hero.cleanTitle);
    var bannerImg = hero.logo
      ? '<img class="home-banner-art lazy-fade" src="' + escAttr(hero.logo) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.style.display=\'none\'">'
      : '';

    var html =
      '<div class="' + enterCls + '">' +
        buildHomeViewportHeaderHtml() +
        '<div class="home-top-bar">' +
          '<div class="home-greeting">' + escHtml(greetingText) + '</div>' +
          '<div id="home-clock-display" class="home-clock">' + escHtml(clockText) + '</div>' +
        '</div>' +
        '<div id="home-hero-banner" class="home-banner">' +
          '<div class="home-banner-bg-wrap">' +
            '<div class="ken-burns-bg" style="background:' + heroGrad + ';">' +
              heroMotif +
              bannerImg +
            '</div>' +
          '</div>' +
          '<div class="home-banner-scrim-side"></div>' +
          '<div class="home-banner-scrim-bottom"></div>' +
          '<div class="home-banner-content">' +
            '<span class="badge-new is-inline">NOVO</span>' +
            '<div class="home-banner-title">' + escHtml(hero.cleanTitle) + '</div>' +
            '<div class="home-banner-sub">' + escHtml(heroSub) + '</div>' +
            '<div class="home-banner-actions">' +
              '<button id="home-hero-play" class="btn btn-primary focusable" data-hero-control="play" ' + heroPlayAttr + ' data-scope="home">' +
                '<svg class="i" viewBox="0 0 24 24"><use href="#icon-play"/></svg>Assistir' +
              '</button>' +
              '<button id="home-hero-fav" class="btn btn-secondary focusable" data-hero-control="fav" data-fav-id="' + escAttr(hero.id) + '" data-scope="home">' +
                '<svg class="i" viewBox="0 0 24 24"><use href="#' + (isHeroFav ? 'icon-star' : 'icon-plus') + '"/></svg>' +
                (isHeroFav ? 'Nos favoritos' : 'Favoritar') +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="home-banner-dots">' + dotsHtml + '</div>' +
        '</div>';

    var continueList = getContinueWatchingItems();
    var favChannels = [];
    for (var fc = 0; fc < channels.length && favChannels.length < 5; fc++) {
      if (favMap[channels[fc].id]) favChannels.push(channels[fc]);
    }

    var rows = [];
    if (continueList.length) {
      rows.push({
        id: 'continue',
        title: 'Continuar assistindo',
        seeAllRoute: 'movies',
        leadFirst: true,
        items: continueList.slice(0, 5).map(function (entry) {
          return {
            item: entry.item,
            progress: Number(entry.progress.percent || 30),
            attr: 'data-play-vod="' + escAttr(entry.item.id) + '"'
          };
        })
      });
    }

    if (movies.length) {
      var progMap = global.LuminaStore.get('watchProgress') || {};
      rows.push({
        id: 'movies',
        title: 'Filmes recentes',
        seeAllRoute: 'movies',
        leadFirst: false,
        items: movies.slice(0, 5).map(function (mv) {
          var pr = progMap[mv.id];
          return {
            item: mv,
            progress: (pr && pr.percent > 0 && !pr.completed) ? Number(pr.percent) : 0,
            attr: 'data-detail-id="' + escAttr(mv.id) + '"'
          };
        })
      });
    }

    if (publicSeries.length || publicNovelas.length) {
      var featuredShows = publicSeries.slice(0, 5);
      if (featuredShows.length < 5) {
        featuredShows = featuredShows.concat(publicNovelas.slice(0, 5 - featuredShows.length));
      }
      rows.push({
        id: 'series',
        title: 'Séries em destaque',
        seeAllRoute: 'series',
        leadFirst: false,
        items: featuredShows.slice(0, 5).map(function (sh) {
          return {
            item: sh,
            progress: 0,
            attr: 'data-detail-id="' + escAttr(sh.id) + '"'
          };
        })
      });
    }

    if (favChannels.length) {
      rows.push({
        id: 'favchannels',
        title: 'Canais favoritos',
        seeAllRoute: 'live',
        leadFirst: false,
        items: favChannels.slice(0, 5).map(function (ch) {
          return {
            item: ch,
            progress: 0,
            attr: 'data-play-id="' + escAttr(ch.id) + '"'
          };
        })
      });
    } else if (channels.length && rows.length < 2) {
      rows.push({
        id: 'livechannels',
        title: 'Canais ao vivo',
        seeAllRoute: 'live',
        leadFirst: false,
        items: channels.slice(0, 5).map(function (ch) {
          return {
            item: ch,
            progress: 0,
            attr: 'data-play-id="' + escAttr(ch.id) + '"'
          };
        })
      });
    }

    var maxVisibleRows = Math.min(rows.length, 2);
    for (var r = 0; r < maxVisibleRows; r++) {
      var row = rows[r];
      var staggerCls = ' stagger-' + (r + 1);
      html +=
        '<div class="home-row-section' + staggerCls + '">' +
          '<div class="home-row-header">' +
            '<div class="home-row-heading">' + escHtml(row.title) + '</div>' +
            '<div id="home-seeall-' + escAttr(row.id) + '" class="home-row-see-all focusable" data-nav="' + escAttr(row.seeAllRoute) + '" data-scope="home">Ver tudo</div>' +
          '</div>' +
          '<div class="home-tile-grid">';
      var maxCardsInRow = row.leadFirst ? Math.min(row.items.length, 4) : Math.min(row.items.length, 5);
      for (var c = 0; c < maxCardsInRow; c++) {
        var entry = row.items[c];
        html += renderHomeTile(entry.item, 'home-tile-' + row.id + '-' + c, entry.progress, entry.attr, row.leadFirst && c === 0);
      }
      html += '</div></div>';
    }

    html += '</div>';
    viewport.innerHTML = html;
    startHomeClockUpdater();
    scheduleHomeCarouselTick();
    global.LuminaFocus.restoreOrDefault('home', '#home-hero-play');
  }

  // ── 2. Tela Canais (Seção 7 — Referência 02) ──
  function renderLive(viewport) {
    var channels = global.LuminaStore.get('channels') || [];
    var categories = global.LuminaStore.get('categories') || [];
    if (!channels.length) {
      renderHome(viewport);
      return;
    }

    var filtered = [];
    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      var g = ch.groupDisplay || ch.groupOriginal;
      if (selectedLiveCat === 'Todos os Canais' || g === selectedLiveCat) {
        if (!isItemLockedByParental(ch)) filtered.push(ch);
      }
    }

    var maxCatStart = Math.max(0, categories.length - LIVE_CAT_WIN_SIZE);
    if (liveCatWindowStart > maxCatStart) liveCatWindowStart = maxCatStart;
    if (liveCatWindowStart < 0) liveCatWindowStart = 0;

    var catHtml = '';
    var catEnd = Math.min(categories.length, liveCatWindowStart + LIVE_CAT_WIN_SIZE);
    for (var k = liveCatWindowStart; k < catEnd; k++) {
      var cat = categories[k];
      var slotIdx = k - liveCatWindowStart;
      var selCls = (cat.name === selectedLiveCat) ? ' is-selected' : '';
      catHtml +=
        '<div id="live-cat-slot-' + slotIdx + '" class="cat-row focusable' + selCls + '" ' +
             'data-col="live-cats" data-vlist="live-cats" data-vindex="' + k + '" data-vtotal="' + categories.length + '" ' +
             'data-cat-name="' + escAttr(cat.name) + '" data-scope="live">' +
          '<span class="cat-row-title">' + escHtml(cat.name) + '</span>' +
          '<span class="count-pill">' + fmtCountPt(cat.count || 0) + '</span>' +
        '</div>';
    }

    var maxChStart = Math.max(0, filtered.length - LIVE_CH_WIN_SIZE);
    if (liveChWindowStart > maxChStart) liveChWindowStart = maxChStart;
    if (liveChWindowStart < 0) liveChWindowStart = 0;

    var chHtml = '';
    var chEnd = Math.min(filtered.length, liveChWindowStart + LIVE_CH_WIN_SIZE);
    for (var j = liveChWindowStart; j < chEnd; j++) {
      var item = filtered[j];
      var chSlot = j - liveChWindowStart;
      var isFav = global.LuminaStore.isFavorite(item.id);
      var qBadge = (String(item.quality || 'HD').toUpperCase().indexOf('FHD') !== -1 || String(item.quality || '').indexOf('1080') !== -1) ? 'FHD' : 'HD';
      var starHtml = isFav
        ? '<span class="channel-star"><svg class="i" viewBox="0 0 24 24"><use href="#icon-star"/></svg></span>'
        : '';

      chHtml +=
        '<div id="live-ch-slot-' + chSlot + '" class="channel-row focusable" ' +
             'data-col="live-list" data-vlist="live-channels" data-vindex="' + j + '" data-vtotal="' + filtered.length + '" ' +
             'data-channel-id="' + escAttr(item.id) + '" data-scope="live">' +
          '<span class="channel-num">#' + Number(item.channelNumber || (j + 1)) + '</span>' +
          '<span class="channel-title">' + escHtml(item.cleanTitle) + '</span>' +
          starHtml +
          '<span class="badge-quality">' + qBadge + '</span>' +
        '</div>';
    }

    var activeCh = filtered[liveChWindowStart] || filtered[0] || channels[0];
    if (focusedLiveChannelId) {
      for (var m = 0; m < filtered.length; m++) {
        if (filtered[m].id === focusedLiveChannelId) {
          activeCh = filtered[m];
          break;
        }
      }
    }
    var isPreviewFav = activeCh ? global.LuminaStore.isFavorite(activeCh.id) : false;

    viewport.innerHTML =
      '<div class="screen-enter">' +
        '<div class="screen-head">' +
          '<div class="screen-head-left"><h1>Canais</h1><span class="screen-count">' + fmtCountPt(filtered.length) + ' canais</span></div>' +
        '</div>' +
        '<div class="live-columns">' +
          '<div class="live-col-cats">' +
            '<div class="col-label">Categorias</div>' +
            catHtml +
          '</div>' +
          '<div class="live-col-list">' +
            '<div class="col-label">Lista de Canais</div>' +
            (chHtml || '<div class="cat-row"><span>Nenhum canal nesta categoria</span></div>') +
          '</div>' +
          '<div class="live-col-preview">' +
            (activeCh ? (
              '<div>' +
                '<div class="live-preview-stage" style="background:' + getTitleGradient(activeCh.cleanTitle) + ';">' +
                  (activeCh.logo ? '<img class="poster-img" src="' + escAttr(activeCh.logo) + '" alt="" loading="lazy" decoding="async" style="object-fit:contain;padding:24px;" onerror="this.style.display=\'none\'">' : '') +
                  '<div class="live-preview-play-icon"><svg viewBox="0 0 24 24"><use href="#icon-play"/></svg></div>' +
                '</div>' +
                '<div class="live-preview-title">' + escHtml(activeCh.cleanTitle) + '</div>' +
                '<div class="live-preview-now">Agora: ' + escHtml(activeCh.epgNow || 'Programação Ao Vivo') + '</div>' +
              '</div>' +
              '<div class="live-preview-actions">' +
                '<button id="btn-fullscreen-live" class="btn btn-primary focusable" data-col="live-preview" data-play-id="' + escAttr(activeCh.id) + '" data-scope="live">' +
                  '<svg class="i" viewBox="0 0 24 24"><use href="#icon-play"/></svg>Assistir' +
                '</button>' +
                '<button id="btn-fav-live" class="btn btn-secondary focusable" data-col="live-preview" data-fav-id="' + escAttr(activeCh.id) + '" data-scope="live">' +
                  '<svg class="i" viewBox="0 0 24 24"><use href="#icon-star"/></svg>' + (isPreviewFav ? 'Favorito' : 'Favoritar') +
                '</button>' +
              '</div>'
            ) : '') +
          '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('live', '#live-ch-slot-0');
  }

  // ── 3. Telas Filmes, Séries e Novelas com Coluna Lateral de Filtros de 360px + Grade 4 Colunas (Seção 8 — Referências 03 e 04) ──
  function collectAvailableLanguages(list) {
    var map = {};
    var out = ['Todos'];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i].lang || '').trim();
      if (l && !map[l]) {
        map[l] = true;
        out.push(l);
      }
    }
    if (out.length === 1) {
      out.push('Dublado', 'Legendado');
    }
    return out;
  }

  function renderPosterCard(item, slotId, sectionKey, vIndex, vTotal) {
    var grad = getTitleGradient(item.cleanTitle);
    var mono = escHtml(getMonogram(item.cleanTitle));
    var recentMap = global.LuminaStore.get('recentAddedIds') || {};
    var isNew = !!recentMap[item.id] || (Number(item.year || 0) >= 2024);
    var ratingStr = fmtRatingPt(item.rating);
    var isShow = (item.kind === 'series-show' || item.kind === 'novela-show');

    var subLine = '';
    if (isShow) {
      var sCount = (item.seasons && item.seasons.length) ? item.seasons.length : 1;
      subLine = sCount + (sCount === 1 ? ' temporada' : ' temporadas');
    } else {
      var yr = item.year || 2024;
      var catLabel = String(item.groupDisplay || item.groupOriginal || 'Filme').replace(/^Filmes\s*\|\s*/i, '');
      subLine = yr + ' \u00B7 ' + catLabel;
    }

    var motifSvg = generateDeterministicArtSvg(item.cleanTitle);
    var imgTag = item.logo
      ? '<img class="poster-img lazy-fade" src="' + escAttr(item.logo) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.style.display=\'none\'">'
      : '';

    return (
      '<div id="' + escAttr(slotId) + '" class="poster-card focusable" ' +
           'data-col="catalog-grid" data-grid-col="' + (vIndex % POSTER_COLS) + '" ' +
           'data-vlist="poster-' + escAttr(sectionKey) + '" data-vindex="' + vIndex + '" data-vtotal="' + vTotal + '" ' +
           'data-detail-id="' + escAttr(item.id) + '" data-scope="' + escAttr(sectionKey) + '">' +
        '<div class="card-focus-sheen"></div>' +
        (isNew ? '<span class="badge-new">NOVO</span>' : '') +
        (ratingStr ? '<span class="badge-rate">\u2605 ' + escHtml(ratingStr) + '</span>' : '') +
        '<div class="poster-art" style="background:' + grad + ';">' +
          motifSvg +
          imgTag +
          '<span class="poster-monogram">' + mono + '</span>' +
        '</div>' +
        '<div class="poster-meta">' +
          '<div class="poster-title">' + escHtml(item.cleanTitle) + '</div>' +
          '<div class="poster-sub">' + escHtml(subLine) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderPosterCatalog(viewport, routeType) {
    var effectiveType = routeType;
    if (routeType === 'series') {
      effectiveType = (currentSeriesKind === 'novelas') ? 'novelas' : 'series';
    } else if (routeType === 'novelas') {
      currentSeriesKind = 'novelas';
      effectiveType = 'novelas';
    }

    var screenTitle = 'Filmes';
    var list = [];
    var cats = [];
    var activeCat = '';
    var allLabel = '';

    if (effectiveType === 'movies') {
      screenTitle = 'Filmes';
      list = global.LuminaStore.get('movies') || [];
      cats = global.LuminaStore.get('movieCategories') || [];
      allLabel = 'Todos os Filmes';
      activeCat = selectedMovieCat;
    } else if (effectiveType === 'series') {
      screenTitle = 'Séries';
      list = global.LuminaStore.get('seriesList') || [];
      cats = global.LuminaStore.get('seriesCategories') || [];
      allLabel = 'Todas as Séries';
      activeCat = selectedSeriesCat;
    } else {
      screenTitle = 'Novelas';
      list = global.LuminaStore.get('novelasList') || [];
      cats = global.LuminaStore.get('novelaCategories') || [];
      allLabel = 'Todas as Novelas';
      activeCat = selectedNovelaCat;
    }

    // Garante que a primeira linha de categoria seja sempre "Todos os Filmes" / "Todas as Séries" / "Todas as Novelas"
    var normalizedCats = [];
    var hasAllRow = false;
    for (var cIdx = 0; cIdx < cats.length; cIdx++) {
      if (cats[cIdx].name === allLabel) hasAllRow = true;
      normalizedCats.push(cats[cIdx]);
    }
    if (!hasAllRow) {
      normalizedCats.unshift({ name: allLabel, count: list.length });
    }

    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (isItemLockedByParental(it)) continue;
      var g = it.groupDisplay || it.groupOriginal;
      if (activeCat !== allLabel && g !== activeCat) continue;
      if (currentLangFilter !== 'Todos' && String(it.lang || '') !== currentLangFilter) continue;
      if (currentSort === 'name' && currentLetterFilter !== 'Todas') {
        var firstCh = String(it.cleanTitle || '').trim().charAt(0).toUpperCase();
        if (firstCh !== currentLetterFilter) continue;
      }
      filtered.push(it);
    }
    filtered = sortItems(filtered, currentSort);

    var winStart = posterWindowStart[effectiveType] || 0;
    var maxStart = Math.max(0, Math.floor((filtered.length - 1) / POSTER_COLS) * POSTER_COLS - POSTER_COLS);
    if (winStart > maxStart) winStart = maxStart;
    if (winStart < 0) winStart = 0;
    posterWindowStart[effectiveType] = winStart;

    var sortLabels = {
      'recent': 'Recentes',
      'name': 'A\u2013Z',
      'rating': 'Nota \u2605'
    };
    var sortDisplay = sortLabels[currentSort] || 'Recentes';

    var selectorsHtml = '';
    if (routeType === 'series' || routeType === 'novelas') {
      var tipoLabel = (effectiveType === 'novelas') ? 'Novelas' : 'Séries';
      selectorsHtml +=
        '<div id="flt-sel-kind" class="filter-select-row focusable" data-col="filter-col" data-lr-control="series-kind" data-action="cycle-series-kind" data-scope="' + escAttr(routeType) + '">' +
          '<span>Tipo</span>' +
          '<span class="filter-select-val">' + svgChevLeft() + escHtml(tipoLabel) + svgChevRight() + '</span>' +
        '</div>';
    }

    selectorsHtml +=
      '<div id="flt-sel-sort" class="filter-select-row focusable" data-col="filter-col" data-lr-control="catalog-sort" data-action="cycle-sort" data-scope="' + escAttr(routeType) + '">' +
        '<span>Ordenar</span>' +
        '<span class="filter-select-val">' + svgChevLeft() + escHtml(sortDisplay) + svgChevRight() + '</span>' +
      '</div>' +
      '<div id="flt-sel-lang" class="filter-select-row focusable" data-col="filter-col" data-lr-control="catalog-lang" data-action="cycle-lang-filter" data-scope="' + escAttr(routeType) + '">' +
        '<span>Idioma</span>' +
        '<span class="filter-select-val">' + svgChevLeft() + escHtml(currentLangFilter) + svgChevRight() + '</span>' +
      '</div>';

    // Quando Ordenar = "A–Z", aparece o seletor extra "Letra" (valores "Todas", "A" a "Z"); fora disso ele não existe
    if (currentSort === 'name') {
      selectorsHtml +=
        '<div id="flt-sel-letter" class="filter-select-row focusable" data-col="filter-col" data-lr-control="catalog-letter" data-action="cycle-letter-filter" data-scope="' + escAttr(routeType) + '">' +
          '<span>Letra</span>' +
          '<span class="filter-select-val">' + svgChevLeft() + escHtml(currentLetterFilter) + svgChevRight() + '</span>' +
        '</div>';
    }

    var catWinStart = filterCatWindowStart[effectiveType] || 0;
    var maxCatWin = Math.max(0, normalizedCats.length - FILTER_CAT_WIN_SIZE);
    if (catWinStart > maxCatWin) catWinStart = maxCatWin;
    if (catWinStart < 0) catWinStart = 0;
    filterCatWindowStart[effectiveType] = catWinStart;

    var catRowsHtml = '';
    var catEnd = Math.min(normalizedCats.length, catWinStart + FILTER_CAT_WIN_SIZE);
    for (var k = catWinStart; k < catEnd; k++) {
      var cat = normalizedCats[k];
      var catSlot = k - catWinStart;
      var isSel = (cat.name === activeCat) ? ' is-selected' : '';
      catRowsHtml +=
        '<div id="flt-cat-slot-' + catSlot + '" class="cat-row focusable' + isSel + '" ' +
             'data-col="filter-col" data-vlist="filter-cats-' + escAttr(effectiveType) + '" data-vindex="' + k + '" data-vtotal="' + normalizedCats.length + '" ' +
             'data-cat-section="' + escAttr(effectiveType) + '" data-cat-val="' + escAttr(cat.name) + '" data-scope="' + escAttr(routeType) + '">' +
          '<span class="cat-row-title">' + escHtml(cat.name) + '</span>' +
          '<span class="count-pill">' + fmtCountPt(cat.count || 0) + '</span>' +
        '</div>';
    }

    var cardsHtml = '';
    var winEnd = Math.min(filtered.length, winStart + POSTER_WIN_SIZE);
    for (var j = winStart; j < winEnd; j++) {
      var item = filtered[j];
      var slot = j - winStart;
      cardsHtml += renderPosterCard(item, 'poster-' + routeType + '-slot-' + slot, routeType, j, filtered.length);
    }

    viewport.innerHTML =
      '<div class="screen-enter">' +
        '<div class="screen-head">' +
          '<div class="screen-head-left">' +
            '<h1>' + escHtml(screenTitle) + '</h1>' +
            '<span class="screen-count">' + fmtCountPt(filtered.length) + ' títulos</span>' +
          '</div>' +
        '</div>' +
        '<div class="catalog-columns">' +
          '<div class="filter-col">' +
            selectorsHtml +
            '<div style="height:16px;"></div>' +
            '<div class="col-label">Categorias</div>' +
            catRowsHtml +
          '</div>' +
          '<div class="catalog-grid">' +
            (cardsHtml || '<div style="grid-column:1 / span 4;color:var(--text-2);font-size:26px;padding:24px 0;">Nenhum título encontrado para este filtro.</div>') +
          '</div>' +
        '</div>' +
      '</div>';

    var defaultFocusSelector = filtered.length ? ('#poster-' + routeType + '-slot-0') : '#flt-sel-sort';
    global.LuminaFocus.restoreOrDefault(routeType, defaultFocusSelector);
  }

  // ── 4. Tela de Detalhes Cinematográfica v2.0.0 (Seção 5) ──
  function renderDetail(viewport) {
    var item = global.LuminaStore.get('selectedDetailItem');
    if (!item) {
      global.LuminaRouter.navigate('home');
      return;
    }

    var isShow = (item.kind === 'series-show' || item.kind === 'novela-show');
    var isFav = global.LuminaStore.isFavorite(item.id);
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var mono = escHtml(getMonogram(item.cleanTitle));
    var grad = getTitleGradient(item.cleanTitle);
    var motifSvg = generateDeterministicArtSvg(item.cleanTitle);
    var enterCls = getScreenEnterClass();

    var backdropHtml = item.logo
      ? '<img class="detail-backdrop-img lazy-fade" src="' + escAttr(item.logo) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.style.display=\'none\'">'
      : '<div class="detail-backdrop-generated" style="background:' + grad + ';">' + motifSvg + '</div>';

    var posterImgHtml = item.logo
      ? '<img class="poster-img lazy-fade" src="' + escAttr(item.logo) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.style.display=\'none\'">'
      : '';

    var ratingStr = fmtRatingPt(item.rating) || '8,4';
    var ageBadgeText = item.adult ? '18' : (item.ageRating || '14');
    var genresText = String(item.groupDisplay || item.groupOriginal || (isShow ? 'Drama \u00B7 Série' : 'Suspense \u00B7 Filme')).replace(/^(Filmes|Séries|Novelas)\s*\|\s*/i, '');
    var durationLabel = formatDurationHuman(item.durationSecs || 7500);
    var favBtnLabel = isFav ? '\u2605 Nos favoritos' : '+ Favoritar';

    if (!isShow) {
      var pr = progMap[item.id];
      var playBtnText = (pr && pr.position > 5 && !pr.completed)
        ? ('\u25B6 Continuar \u00B7 ' + formatResumeClock(pr.position))
        : '\u25B6 Assistir';

      viewport.innerHTML =
        '<div class="' + enterCls + '">' +
          '<div class="detail-fullbleed-bg">' +
            backdropHtml +
            '<div class="detail-backdrop-grad-side"></div>' +
            '<div class="detail-backdrop-grad-bottom"></div>' +
          '</div>' +
          '<div class="detail-stage">' +
            '<div class="detail-top-layout">' +
              '<div class="detail-poster-card" style="background:' + grad + ';">' +
                motifSvg +
                posterImgHtml +
                '<span class="poster-monogram">' + mono + '</span>' +
              '</div>' +
              '<div class="detail-text-col">' +
                '<div class="detail-title detail-stagger st-1">' + escHtml(item.cleanTitle) + '</div>' +
                '<div class="detail-meta-strip detail-stagger st-2">' +
                  '<span>' + escHtml(item.year || 2024) + '</span>' +
                  '<span>' + escHtml(durationLabel) + '</span>' +
                  '<span class="badge-age">' + escHtml(ageBadgeText) + '</span>' +
                  '<span style="color:var(--amber);">\u2605 ' + escHtml(ratingStr) + '</span>' +
                '</div>' +
                '<div class="detail-genres detail-stagger st-2">' + escHtml(genresText) + '</div>' +
                '<div class="detail-synopsis detail-stagger st-3">' +
                  escHtml(item.synopsis || 'Reprodução em alta definição com retomada automática do ponto exato onde você parou.') +
                '</div>' +
                '<div class="detail-actions detail-stagger st-4">' +
                  '<button id="detail-btn-play" class="btn btn-primary focusable" ' + (item.kind === 'live' ? ('data-play-id="' + escAttr(item.id) + '"') : ('data-play-vod="' + escAttr(item.id) + '"')) + ' data-scope="detail">' +
                    escHtml(playBtnText) +
                  '</button>' +
                  '<button id="detail-btn-fav" class="btn btn-secondary focusable" data-fav-id="' + escAttr(item.id) + '" data-scope="detail">' +
                    escHtml(favBtnLabel) +
                  '</button>' +
                  '<button id="detail-btn-back" class="btn btn-secondary focusable" data-action="back" data-scope="detail">Voltar</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('detail', '#detail-btn-play');
      return;
    }

    // Se a série Xtream ainda precisa buscar temporadas sob demanda (usa skeleton em vez de texto cru "Carregando...")
    if (item.needsSeriesInfo) {
      var detailLoading = global.LuminaStore.get('detailLoading');
      var detailError = global.LuminaStore.get('detailError');

      if (!detailLoading && !detailError) {
        global.LuminaStore.set('detailLoading', true);
        var creds = global.LuminaStore.get('xtreamCreds');
        global.LuminaXtream.fetchSeriesInfo(creds, item, function (err) {
          global.LuminaStore.set('detailLoading', false);
          global.LuminaStore.set('detailError', err ? (err.message || 'Falha ao buscar episódios.') : null);
          if (global.LuminaRouter.getCurrent() === 'detail') {
            renderCurrentRoute();
          }
        });
      }

      var skelRows = '';
      for (var sk = 0; sk < 3; sk++) {
        skelRows += '<div class="skeleton-box" style="height:108px;margin-bottom:10px;"><div class="skeleton-shimmer"></div></div>';
      }

      viewport.innerHTML =
        '<div class="' + enterCls + '">' +
          '<div class="detail-fullbleed-bg">' +
            backdropHtml +
            '<div class="detail-backdrop-grad-side"></div>' +
            '<div class="detail-backdrop-grad-bottom"></div>' +
          '</div>' +
          '<div class="detail-stage is-series">' +
            '<div class="detail-top-layout">' +
              '<div class="detail-poster-card" style="background:' + grad + ';">' + motifSvg + posterImgHtml + '<span class="poster-monogram">' + mono + '</span></div>' +
              '<div class="detail-text-col">' +
                '<div class="detail-title">' + escHtml(item.cleanTitle) + '</div>' +
                (detailError
                  ? '<div class="detail-synopsis" style="color:var(--danger);">' + escHtml(detailError) + '</div>'
                  : '<div class="skeleton-box" style="width:420px;height:56px;margin-bottom:18px;"><div class="skeleton-shimmer"></div></div>') +
                '<div class="detail-actions">' +
                  (detailError ? '<button id="detail-btn-retry-series" class="btn btn-primary focusable" data-action="retry-series-info" data-scope="detail">Tentar Novamente</button>' : '') +
                  '<button id="detail-btn-back" class="btn btn-secondary focusable" data-action="back" data-scope="detail">Voltar</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:24px;">' + skelRows + '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('detail', detailError ? '#detail-btn-retry-series' : '#detail-btn-back');
      return;
    }

    var seasons = item.seasons || [];
    var selSeason = global.LuminaStore.get('selectedSeason') || (seasons[0] ? seasons[0].seasonNumber : 1);
    var activeEpisodes = [];
    for (var s = 0; s < seasons.length; s++) {
      if (seasons[s].seasonNumber === selSeason) {
        activeEpisodes = seasons[s].episodes || [];
        break;
      }
    }
    if (!activeEpisodes.length && seasons[0]) {
      activeEpisodes = seasons[0].episodes || [];
      selSeason = seasons[0].seasonNumber;
    }

    var seasonPillsHtml = '';
    var maxPills = Math.min(seasons.length, 8);
    for (var sp = 0; sp < maxPills; sp++) {
      var sNum = seasons[sp].seasonNumber;
      var actCls = (sNum === selSeason) ? ' is-active' : '';
      seasonPillsHtml +=
        '<div id="season-pill-' + sNum + '" class="season-pill focusable' + actCls + '" data-season-num="' + sNum + '" data-scope="detail">' +
          'Temporada ' + sNum +
        '</div>';
    }

    var DETAIL_EP_VISIBLE = 3;
    var maxEpStart = Math.max(0, activeEpisodes.length - DETAIL_EP_VISIBLE);
    if (detailEpWindowStart > maxEpStart) detailEpWindowStart = maxEpStart;
    if (detailEpWindowStart < 0) detailEpWindowStart = 0;

    var epRows = '';
    var epEnd = Math.min(activeEpisodes.length, detailEpWindowStart + DETAIL_EP_VISIBLE);
    var resumeEp = activeEpisodes[0] || null;
    var resumeEpPr = null;
    for (var rIdx = 0; rIdx < activeEpisodes.length; rIdx++) {
      var candEp = activeEpisodes[rIdx];
      var cPr = progMap[candEp.id];
      if (cPr && cPr.percent > 0 && !cPr.completed) {
        resumeEp = candEp;
        resumeEpPr = cPr;
        break;
      }
    }

    for (var e = detailEpWindowStart; e < epEnd; e++) {
      var ep = activeEpisodes[e];
      var epSlot = e - detailEpWindowStart;
      var epProg = progMap[ep.id] || { percent: 0, completed: false };
      var epGrad = getTitleGradient(ep.cleanTitle || item.cleanTitle);
      var epMotif = generateDeterministicArtSvg(ep.cleanTitle || item.cleanTitle);
      var epThumbImg = (ep.logo || item.logo)
        ? '<img class="poster-img lazy-fade" src="' + escAttr(ep.logo || item.logo) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'is-loaded\')" onerror="this.style.display=\'none\'">'
        : '';
      var epDur = formatDurationHuman(ep.durationSecs || 2700);

      var stateHtml = '<span style="font-size:22px;font-weight:700;color:var(--text);">Assistir</span>';
      if (epProg.completed) {
        stateHtml = '<span style="font-size:22px;font-weight:700;color:var(--green);">\u2713 Assistido</span>';
      } else if (epProg.percent > 0) {
        stateHtml =
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;width:120px;">' +
            '<span style="font-size:22px;font-weight:700;color:var(--accent);">' + Math.round(epProg.percent) + '%</span>' +
            '<div style="width:100%;height:6px;background:rgba(255,255,255,0.22);border-radius:3px;overflow:hidden;">' +
              '<div style="width:' + Math.min(100, Math.round(epProg.percent)) + '%;height:100%;background:var(--accent);"></div>' +
            '</div>' +
          '</div>';
      }

      epRows +=
        '<div id="ep-row-slot-' + epSlot + '" class="episode-row focusable" ' +
             'data-vlist="detail-episodes" data-vindex="' + e + '" data-vtotal="' + activeEpisodes.length + '" ' +
             'data-play-ep="' + escAttr(ep.id) + '" data-scope="detail">' +
          '<div style="display:flex;align-items:center;min-width:0;flex:1;">' +
            '<div class="episode-thumb" style="background:' + epGrad + ';">' +
              epMotif +
              epThumbImg +
            '</div>' +
            '<div style="min-width:0;flex:1;">' +
              '<div class="episode-code">T' + Number(ep.season || selSeason) + ' \u00B7 E' + Number(ep.episode || (e + 1)) + '</div>' +
              '<div class="episode-title">' + escHtml(ep.cleanTitle) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;flex-shrink:0;">' +
            '<span class="episode-dur">' + escHtml(epDur) + '</span>' +
            stateHtml +
          '</div>' +
        '</div>';
    }

    var mainPlayLabel = '\u25B6 Assistir';
    if (resumeEp && resumeEpPr && resumeEpPr.position > 5) {
      mainPlayLabel = '\u25B6 Continuar \u00B7 ' + formatResumeClock(resumeEpPr.position);
    }

    viewport.innerHTML =
      '<div class="' + enterCls + '">' +
        '<div class="detail-fullbleed-bg">' +
          backdropHtml +
          '<div class="detail-backdrop-grad-side"></div>' +
          '<div class="detail-backdrop-grad-bottom"></div>' +
        '</div>' +
        '<div class="detail-stage is-series">' +
          '<div class="detail-top-layout">' +
            '<div class="detail-poster-card" style="background:' + grad + ';">' +
              motifSvg +
              posterImgHtml +
              '<span class="poster-monogram" style="font-size:72px;">' + mono + '</span>' +
            '</div>' +
            '<div class="detail-text-col">' +
              '<div class="detail-title detail-stagger st-1">' + escHtml(item.cleanTitle) + '</div>' +
              '<div class="detail-meta-strip detail-stagger st-2">' +
                '<span>' + escHtml(item.year || 2024) + '</span>' +
                '<span>' + seasons.length + (seasons.length === 1 ? ' temporada' : ' temporadas') + '</span>' +
                '<span class="badge-age">' + escHtml(ageBadgeText) + '</span>' +
                '<span style="color:var(--amber);">\u2605 ' + escHtml(ratingStr) + '</span>' +
              '</div>' +
              '<div class="detail-genres detail-stagger st-2">' + escHtml(genresText) + '</div>' +
              '<div class="detail-synopsis detail-stagger st-3">' +
                escHtml(item.synopsis || 'Temporadas e episódios organizados automaticamente com retomada de progresso.') +
              '</div>' +
              '<div class="detail-actions detail-stagger st-4">' +
                (resumeEp ? '<button id="detail-btn-play-ep0" class="btn btn-primary focusable" data-play-ep="' + escAttr(resumeEp.id) + '" data-scope="detail">' + escHtml(mainPlayLabel) + '</button>' : '') +
                '<button id="detail-btn-fav" class="btn btn-secondary focusable" data-fav-id="' + escAttr(item.id) + '" data-scope="detail">' + escHtml(favBtnLabel) + '</button>' +
                '<button id="detail-btn-back" class="btn btn-secondary focusable" data-action="back" data-scope="detail">Voltar</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="season-pills-bar">' + seasonPillsHtml + '</div>' +
          '<div>' + (epRows || '<div class="cat-row"><span>Nenhum episódio disponível nesta temporada.</span></div>') + '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('detail', '#ep-row-slot-0');
  }

  // ── 5. Tela Busca Global ──
  function renderSearch(viewport) {
    var q = global.LuminaStore.get('searchQuery') || '';
    var safeState = {
      channels: filterAdultForPublicViews(global.LuminaStore.get('channels') || []),
      movies: filterAdultForPublicViews(global.LuminaStore.get('movies') || []),
      seriesList: filterAdultForPublicViews(global.LuminaStore.get('seriesList') || []),
      novelasList: filterAdultForPublicViews(global.LuminaStore.get('novelasList') || [])
    };
    var results = global.LuminaXtream.searchCatalog(q, safeState);

    var keysHtml = '';
    for (var i = 0; i < KB_KEYS.length; i++) {
      var ch = KB_KEYS[i];
      keysHtml +=
        '<div id="kb-key-' + ch + '" class="kb-key focusable" data-kb-char="' + escAttr(ch) + '" data-scope="search">' + escHtml(ch) + '</div>';
    }
    keysHtml +=
      '<div id="kb-key-space" class="kb-key kb-wide focusable" data-kb-action="space" data-scope="search">ESPAÇO</div>' +
      '<div id="kb-key-back" class="kb-key kb-wide focusable" data-kb-action="backspace" data-scope="search">APAGAR</div>' +
      '<div id="kb-key-clear" class="kb-key kb-wide focusable" data-kb-action="clear" data-scope="search">LIMPAR</div>';

    var combined = [].concat(
      results.channels.slice(0, 4),
      results.movies.slice(0, 4),
      results.series.slice(0, 4),
      results.novelas.slice(0, 4)
    ).slice(0, 8);

    var rowsHtml = '';
    for (var r = 0; r < combined.length; r++) {
      var it = combined[r];
      var actAttr = it.kind === 'live' ? ('data-play-id="' + escAttr(it.id) + '"') : ('data-detail-id="' + escAttr(it.id) + '"');
      var badgeLbl = it.kind === 'live' ? 'CANAL' : (it.isNovela ? 'NOVELA' : (it.kind === 'series-show' ? 'SÉRIE' : 'FILME'));
      rowsHtml +=
        '<div id="sr-item-' + r + '" class="channel-row focusable" ' + actAttr + ' data-scope="search">' +
          '<span class="channel-title">' + escHtml(it.cleanTitle) + '</span>' +
          '<span style="font-size:22px;color:var(--text-2);">' + escHtml(it.groupDisplay || it.groupOriginal) + '</span>' +
          '<span class="badge-quality">' + badgeLbl + '</span>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div class="screen-enter">' +
        '<div class="screen-head">' +
          '<div class="screen-head-left"><h1>Busca</h1><span class="screen-count">' + fmtCountPt(results.total) + ' resultados</span></div>' +
        '</div>' +
        '<div class="search-columns">' +
          '<div class="keyboard-card">' +
            '<div>' +
              '<div class="search-input-box">' +
                '<span>' + escHtml(q || 'Digite para buscar...') + '</span>' +
              '</div>' +
              '<div class="kb-grid">' + keysHtml + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="flex:1;">' +
            '<div class="col-label">Resultados</div>' +
            (rowsHtml || '<div class="cat-row"><span>' + (q ? 'Nenhum título encontrado.' : 'Use o teclado ao lado para buscar canais, filmes e séries.') + '</span></div>') +
          '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('search', '#kb-key-A');
  }

  // ── 6. Tela Favoritos ──
  function renderFavorites(viewport) {
    var byId = global.LuminaStore.get('itemByIdMap') || {};
    var favMap = global.LuminaStore.get('favorites') || {};
    var favKeys = Object.keys(favMap);
    var favs = [];
    for (var i = 0; i < favKeys.length; i++) {
      var it = byId[favKeys[i]];
      if (it && !isItemLockedByParental(it)) favs.push(it);
    }

    var maxStart = Math.max(0, Math.floor((favs.length - 1) / POSTER_COLS) * POSTER_COLS - POSTER_COLS);
    if (favWindowStart > maxStart) favWindowStart = maxStart;
    if (favWindowStart < 0) favWindowStart = 0;

    var cardsHtml = '';
    var end = Math.min(favs.length, favWindowStart + POSTER_WIN_SIZE);
    for (var j = favWindowStart; j < end; j++) {
      var item = favs[j];
      var slot = j - favWindowStart;
      cardsHtml += renderPosterCard(item, 'fav-slot-' + slot, 'favorites', j, favs.length);
    }

    viewport.innerHTML =
      '<div class="screen-enter">' +
        '<div class="screen-head">' +
          '<div class="screen-head-left"><h1>Favoritos</h1><span class="screen-count">' + fmtCountPt(favs.length) + ' títulos</span></div>' +
        '</div>' +
        (favs.length
          ? '<div class="catalog-grid" style="grid-template-columns:repeat(5, var(--card-w));">' + cardsHtml + '</div>'
          : '<div class="settings-panel" style="height:auto;padding:44px;">' +
              '<div class="settings-panel-title">Sua lista de Favoritos está vazia</div>' +
              '<div style="font-size:26px;color:var(--text-2);margin-bottom:28px;">Adicione canais, filmes ou séries aos Favoritos para acessá-los rapidamente aqui.</div>' +
              '<div><button id="fav-go-home" class="btn btn-primary focusable" data-nav="home" data-scope="favorites">Ir para Início</button></div>' +
            '</div>') +
      '</div>';

    global.LuminaFocus.restoreOrDefault('favorites', favs.length ? '#fav-slot-0' : '#fav-go-home');
  }

  // ── 7. Pareamento pelo Celular (fluxo QR Code acionado por Ajustes > Fonte e Pareamento) ──
  function formatDiffSummary(updateRec) {
    if (!updateRec || !updateRec.diff || !updateRec.diff.hasPrev) return '';
    var d = updateRec.diff;
    var parts = [];
    if (d.liveDelta) parts.push((d.liveDelta > 0 ? '+' : '') + d.liveDelta + ' canais');
    if (d.movieDelta) parts.push((d.movieDelta > 0 ? '+' : '') + d.movieDelta + ' filmes');
    if (d.seriesDelta) parts.push((d.seriesDelta > 0 ? '+' : '') + d.seriesDelta + ' séries');
    return parts.length ? (' (' + parts.join(', ') + ')') : '';
  }

  function onPairingPayload(payload) {
    showLoading('Lista recebida do celular');
    global.LuminaPairing.applyMobilePayload(payload, function (err, list, _pl, updateRec) {
      hideLoading();
      if (err) {
        global.LuminaStore.set('pairingError', err.message);
        renderCurrentRoute();
        return;
      }
      toast('Lista atualizada: ' + fmtCountPt(list ? list.length : 0) + ' itens' + formatDiffSummary(updateRec));
      global.LuminaStore.set('pairingError', null);
      global.LuminaStore.set('pairingStep', 'cards');
      global.LuminaRouter.navigate('home');
    }, onLoadProgress);
  }

  function beginPairing() {
    if (pairingStarting) return;
    pairingStarting = true;
    var baseUrl = global.LuminaStore.get('pairingBaseUrl') || global.LuminaPairing.DEFAULT_PAIRING_BASE_URL;
    global.LuminaStore.set('pairingError', null);
    global.LuminaStore.set('pairingStep', 'phone-qr');
    global.LuminaPairing.startSession(baseUrl, function (err) {
      pairingStarting = false;
      if (err) global.LuminaStore.set('pairingError', err.message);
      renderCurrentRoute();
    }, onPairingPayload, function (err) {
      global.LuminaStore.set('pairingError', err.message);
      renderCurrentRoute();
    });
  }

  function renderOnboarding(viewport) {
    var baseUrl = global.LuminaStore.get('pairingBaseUrl') || global.LuminaPairing.DEFAULT_PAIRING_BASE_URL;
    var shownUrl = baseUrl.replace(/^https?:\/\//, '');
    var sess = global.LuminaPairing.getCurrentSession();
    var pairErr = global.LuminaStore.get('pairingError');

    if (!sess) {
      viewport.innerHTML =
        '<div class="screen-enter">' +
          '<div class="screen-head"><div class="screen-head-left"><h1>Pareamento pelo celular</h1></div></div>' +
          '<div class="settings-panel" style="height:auto;">' +
            '<div class="settings-panel-title">' + escHtml(pairErr ? 'Falha ao gerar código' : 'Gerando código de pareamento...') + '</div>' +
            '<div style="font-size:26px;color:var(--text-2);margin-bottom:28px;">' + escHtml(pairErr || 'Conectando ao servidor seguro de pareamento...') + '</div>' +
            '<div style="display:flex;gap:20px;">' +
              '<button id="btn-pair-renew" class="btn btn-primary focusable" data-action="renew-phone-code" data-scope="onboarding">Tentar Novamente</button>' +
              '<button id="btn-pair-back" class="btn btn-secondary focusable" data-action="back" data-scope="onboarding">Voltar</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('onboarding', '#btn-pair-renew');
      return;
    }

    var code = sess.code;
    var qrSvg = global.LuminaPairing.renderQrSvg(baseUrl + '/#' + code, 6);

    viewport.innerHTML =
      '<div class="screen-enter">' +
        '<div class="screen-head"><div class="screen-head-left"><h1>Pareamento pelo celular</h1></div></div>' +
        '<div class="settings-panel" style="flex-direction:row;align-items:center;justify-content:space-between;height:auto;padding:44px 52px;">' +
          '<div style="max-width:960px;">' +
            '<div style="font-size:26px;color:var(--text-2);margin-bottom:8px;">1. Escaneie o QR Code ou acesse no celular:</div>' +
            '<div style="font-size:34px;font-weight:800;color:var(--accent);margin-bottom:24px;">' + escHtml(shownUrl) + '</div>' +
            '<div style="font-size:26px;color:var(--text-2);margin-bottom:10px;">2. Confira ou digite este código de 6 caracteres:</div>' +
            '<div style="display:inline-block;font-family:var(--font-mono);font-size:52px;font-weight:800;letter-spacing:14px;color:var(--accent);background:var(--bg);border:2px solid var(--accent);border-radius:var(--radius);padding:14px 28px;margin-bottom:24px;">' + escHtml(code) + '</div>' +
            '<div style="font-size:24px;color:var(--green);margin-bottom:28px;">Aguardando envio pelo celular...</div>' +
            '<div style="display:flex;gap:20px;">' +
              '<button id="btn-pair-renew" class="btn btn-primary focusable" data-action="renew-phone-code" data-scope="onboarding">Novo Código</button>' +
              '<button id="btn-pair-back" class="btn btn-secondary focusable" data-action="back" data-scope="onboarding">Voltar</button>' +
            '</div>' +
          '</div>' +
          '<div style="background:#FFFFFF;padding:22px;border-radius:var(--radius-lg);display:flex;flex-direction:column;align-items:center;flex-shrink:0;">' +
            qrSvg +
            '<div style="color:#0B0F17;font-size:22px;font-weight:700;margin-top:12px;">Aponte a câmera</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('onboarding', '#btn-pair-renew');
  }

  // ── 8. Tela Ajustes (Seção 9 — Referência 05: 8 Abas sem numeração, 420px esquerda + Painel direito) ──
  function renderSettings(viewport) {
    var perfMode = global.LuminaStore.get('performanceMode') || 'auto';
    var ratio = global.LuminaStore.get('defaultAspectRatio') || 'auto';
    var preferFmt = global.LuminaStore.get('preferOutputFormat') || 'auto';
    var autoUpdHours = global.LuminaStore.get('autoUpdateHours');
    if (typeof autoUpdHours !== 'number') autoUpdHours = 12;
    var includeCreds = !!global.LuminaStore.get('includeCredentialsInBackup');
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false, hideAdultInSearchAndHome: true };
    var tmdb = global.LuminaStore.get('tmdb') || { enabled: false, apiKey: '', enrichedCount: 0 };
    var src = global.LuminaStore.get('source');
    var lastUpd = global.LuminaStore.get('lastUpdateInfo');
    var appUpd = global.LuminaStore.get('appUpdateInfo');
    var isAndroid = !!(global.LuminaPlatform && global.LuminaPlatform.isAndroid);
    var appVer = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '2.0.0';
    var platLabel = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Smart TV';

    var chCount = (global.LuminaStore.get('channels') || []).length;
    var mvCount = (global.LuminaStore.get('movies') || []).length;
    var srCount = (global.LuminaStore.get('seriesList') || []).length + (global.LuminaStore.get('novelasList') || []).length;

    var tabsHtml = '';
    for (var t = 0; t < SETTINGS_TABS.length; t++) {
      var tb = SETTINGS_TABS[t];
      var sel = (activeSettingsTab === tb.id) ? ' is-selected' : '';
      tabsHtml +=
        '<div id="set-tab-' + tb.id + '" class="settings-tab focusable' + sel + '" data-col="settings-tabs" data-settings-tab="' + escAttr(tb.id) + '" data-scope="settings">' +
          '<span>' + escHtml(tb.label) + '</span>' +
        '</div>';
    }

    var safeMarginVal = Number(global.LuminaStore.get('screenSafeMargin') || 0);
    var safeMarginPct = Math.round(safeMarginVal * 100) + '%';
    var autoUpdLabel = autoUpdHours === 0 ? 'Manual' : (autoUpdHours === 12 ? 'Ao abrir' : ('A cada ' + autoUpdHours + 'h'));
    var listName = (src && src.name) ? src.name : 'Minha Lista';
    var statusPillText = fmtDateBr(lastUpd && lastUpd.updatedAt);

    var panelBody = '';

    if (activeSettingsTab === 'source') {
      // Exatamente como na Referência 05 (05-ajustes.html)
      panelBody =
        '<div class="settings-panel-title">Fonte e Pareamento</div>' +
        '<div class="settings-current-list-card">' +
          '<div>' +
            '<div style="font-size:22px;color:var(--text-2);">Lista atual</div>' +
            '<div style="font-size:32px;font-weight:700;margin:4px 0;">' + escHtml(listName) + '</div>' +
            '<div style="font-size:24px;color:var(--text-2);">' + fmtCountPt(chCount) + ' canais \u00B7 ' + fmtCountPt(mvCount) + ' filmes \u00B7 ' + fmtCountPt(srCount) + ' séries</div>' +
          '</div>' +
          '<span class="settings-status-pill">' + escHtml(statusPillText) + '</span>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Pareamento pelo celular</div>' +
            '<div class="setting-row-desc">Envie sua lista pelo celular com código ou QR Code.</div>' +
          '</div>' +
          '<div><button id="set-btn-pair" class="btn btn-primary focusable" data-col="settings-panel" data-action="go-phone-pairing" data-scope="settings">Parear</button></div>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Atualizar lista agora</div>' +
            '<div class="setting-row-desc">Baixa de novo os canais, filmes e séries.</div>' +
          '</div>' +
          '<div><button id="set-btn-reload" class="btn btn-secondary focusable" data-col="settings-panel" data-action="reload-source" data-scope="settings">Atualizar</button></div>' +
        '</div>' +
        '<div id="set-row-autoupd" class="setting-row focusable" data-col="settings-panel" data-lr-control="auto-update" data-action="cycle-auto-update-hours" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Atualizar automaticamente</div>' +
            '<div class="setting-row-desc">Define quando a lista é baixada de novo.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(autoUpdLabel) + svgChevRight() + '</div>' +
        '</div>' +
        '<div id="set-safe-margin" class="setting-row focusable" data-col="settings-panel" data-lr-control="safe-margin" data-action="cycle-safe-margin" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Margem de segurança da tela</div>' +
            '<div class="setting-row-desc">Reduz a imagem para não cortar as bordas em projetores.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(safeMarginPct) + svgChevRight() + '</div>' +
        '</div>';
    } else if (activeSettingsTab === 'playback') {
      var ratioLabel = ratio === 'auto' ? 'Auto' : ratio.toUpperCase();
      var fmtLabel = preferFmt === 'auto' ? 'Auto' : preferFmt.toUpperCase();
      panelBody =
        '<div class="settings-panel-title">Reprodução</div>' +
        '<div id="set-ratio-cycle" class="setting-row focusable" data-col="settings-panel" data-lr-control="default-ratio" data-action="cycle-default-ratio" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Proporção de vídeo</div>' +
            '<div class="setting-row-desc">Ajusta o formato da imagem nos canais e filmes.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(ratioLabel) + svgChevRight() + '</div>' +
        '</div>' +
        '<div id="set-fmt-cycle" class="setting-row focusable" data-col="settings-panel" data-lr-control="prefer-format" data-action="cycle-prefer-format" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Formato preferido ao vivo</div>' +
            '<div class="setting-row-desc">Alterna entre HLS (.m3u8) e MPEG-TS (.ts) automaticamente se falhar.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(fmtLabel) + svgChevRight() + '</div>' +
        '</div>';
    } else if (activeSettingsTab === 'screen') {
      var perfLabels = { 'auto': 'Automático', 'normal': 'Padrão 60fps', 'lite': 'Modo Leve' };
      var motionLevel = global.LuminaStore.get('motionLevel') || 'Completas';
      panelBody =
        '<div class="settings-panel-title">Tela e Desempenho</div>' +
        '<div id="set-motion-level" class="setting-row focusable" data-col="settings-panel" data-lr-control="motion-level" data-action="cycle-motion-level" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Animações</div>' +
            '<div class="setting-row-desc">Controla o movimento da interface.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(motionLevel) + svgChevRight() + '</div>' +
        '</div>' +
        '<div id="set-safe-margin-2" class="setting-row focusable" data-col="settings-panel" data-lr-control="safe-margin" data-action="cycle-safe-margin" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Margem de segurança da tela</div>' +
            '<div class="setting-row-desc">Reduz a imagem para não cortar as bordas em projetores.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(safeMarginPct) + svgChevRight() + '</div>' +
        '</div>' +
        '<div id="set-perf-cycle" class="setting-row focusable" data-col="settings-panel" data-lr-control="perf-mode" data-action="cycle-perf-mode" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Modo de desempenho</div>' +
            '<div class="setting-row-desc">Ajusta recursos gráficos conforme a capacidade do aparelho.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(perfLabels[perfMode] || 'Automático') + svgChevRight() + '</div>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Capas e sinopses TMDB</div>' +
            '<div class="setting-row-desc">Títulos enriquecidos em português: ' + fmtCountPt(tmdb.enrichedCount || 0) + '.</div>' +
          '</div>' +
          '<div><button id="set-tmdb-run" class="btn btn-secondary focusable" data-col="settings-panel" data-action="run-tmdb-enrich" data-scope="settings">Enriquecer</button></div>' +
        '</div>';
    } else if (activeSettingsTab === 'organizer') {
      var allGroups = global.LuminaStore.get('originalGroups') || [];
      var profile = global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {} };
      var undoStack = global.LuminaStore.get('organizerUndoStack') || [];
      var maxG = Math.max(0, allGroups.length - ORG_GROUP_WIN_SIZE);
      if (orgGroupWindowStart > maxG) orgGroupWindowStart = maxG;
      if (orgGroupWindowStart < 0) orgGroupWindowStart = 0;

      var targetLabels = { 'live': 'Canais', 'movie': 'Filmes', 'series': 'Séries', 'novela': 'Novelas', 'hidden': 'Oculto' };
      var gRows = '';
      var gEnd = Math.min(allGroups.length, orgGroupWindowStart + ORG_GROUP_WIN_SIZE);
      for (var gIdx = orgGroupWindowStart; gIdx < gEnd; gIdx++) {
        var grp = allGroups[gIdx];
        var slot = gIdx - orgGroupWindowStart;
        var curRule = (profile.mode === 'all_live')
          ? 'live'
          : ((profile.customGroupRules && profile.customGroupRules[grp.originalName]) || grp.suggested || 'live');
        gRows +=
          '<div id="org-slot-' + slot + '" class="setting-row focusable" style="height:96px;" ' +
               'data-col="settings-panel" data-vlist="org-groups" data-vindex="' + gIdx + '" data-vtotal="' + allGroups.length + '" ' +
               'data-lr-control="org-group" data-org-group="' + escAttr(grp.originalName) + '" data-org-cur="' + escAttr(curRule) + '" data-action="cycle-org-group" data-scope="settings">' +
            '<div>' +
              '<div class="setting-row-label">' + escHtml(grp.displayName) + '</div>' +
              '<div class="setting-row-desc">' + fmtCountPt(grp.count || 0) + ' itens</div>' +
            '</div>' +
            '<div class="setting-row-value">' + svgChevLeft() + escHtml(targetLabels[curRule] || 'Canais') + svgChevRight() + '</div>' +
          '</div>';
      }

      panelBody =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<div class="settings-panel-title" style="margin-bottom:0;">Organizar Lista</div>' +
          '<div style="display:flex;gap:14px;">' +
            '<button id="org-prof-auto" class="btn btn-secondary btn-modal focusable" data-col="settings-panel" data-org-profile="auto" data-scope="settings">Automático</button>' +
            (undoStack.length ? '<button id="org-btn-undo" class="btn btn-secondary btn-modal focusable" data-col="settings-panel" data-action="org-undo" data-scope="settings">Desfazer</button>' : '') +
          '</div>' +
        '</div>' +
        (gRows || '<div class="setting-row"><div class="setting-row-label">Importe uma lista para organizar os grupos.</div></div>');
    } else if (activeSettingsTab === 'parental') {
      panelBody =
        '<div class="settings-panel-title">Controle Parental</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Sessão +18</div>' +
            '<div class="setting-row-desc">' + (par.unlockedSession ? 'Desbloqueada temporariamente (bloqueia após 15 min).' : 'Bloqueada por PIN de 4 dígitos.') + '</div>' +
          '</div>' +
          '<div><button id="set-pin-toggle" class="btn btn-primary focusable" data-col="settings-panel" data-action="toggle-parental-lock" data-scope="settings">' + (par.unlockedSession ? 'Bloquear' : 'Desbloquear') + '</button></div>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Alterar PIN de 4 dígitos</div>' +
            '<div class="setting-row-desc">Protegido com hash SHA-256 e bloqueio contra tentativas.</div>' +
          '</div>' +
          '<div><button id="set-pin-change" class="btn btn-secondary focusable" data-col="settings-panel" data-action="change-parental-pin" data-scope="settings">Alterar PIN</button></div>' +
        '</div>' +
        '<div id="set-pin-enable" class="setting-row focusable" data-col="settings-panel" data-lr-control="parental-enable" data-action="toggle-parental-enabled" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Proteção parental (+18)</div>' +
            '<div class="setting-row-desc">Oculta canais e títulos adultos na Início e na Busca.</div>' +
          '</div>' +
          renderSwitchControl(!!par.enabled) +
        '</div>';
    } else if (activeSettingsTab === 'updates') {
      var updDesc = appUpd && appUpd.hasUpdate
        ? ('Nova versão ' + appUpd.latestVersion + ' disponível para instalar.')
        : ('Versão instalada: v' + appVer + '.');
      panelBody =
        '<div class="settings-panel-title">Atualizações</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Atualizar lista agora</div>' +
            '<div class="setting-row-desc">Sincroniza novos canais, filmes e séries mantendo seus favoritos.</div>' +
          '</div>' +
          '<div><button id="set-upd-list-now" class="btn btn-primary focusable" data-col="settings-panel" data-action="reload-source" data-scope="settings">Atualizar</button></div>' +
        '</div>' +
        '<div id="set-upd-cycle-hours" class="setting-row focusable" data-col="settings-panel" data-lr-control="auto-update" data-action="cycle-auto-update-hours" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Atualizar automaticamente</div>' +
            '<div class="setting-row-desc">Define quando a lista é baixada de novo.</div>' +
          '</div>' +
          '<div class="setting-row-value">' + svgChevLeft() + escHtml(autoUpdLabel) + svgChevRight() + '</div>' +
        '</div>' +
        (isAndroid ? (
          '<div class="setting-row">' +
            '<div>' +
              '<div class="setting-row-label">Atualização do aplicativo (APK)</div>' +
              '<div class="setting-row-desc">' + escHtml(updDesc) + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:14px;">' +
              '<button id="set-upd-apk-check" class="btn btn-secondary focusable" data-col="settings-panel" data-action="check-apk-update" data-scope="settings">Verificar</button>' +
              (appUpd && appUpd.hasUpdate ? '<button id="set-upd-apk-install" class="btn btn-primary focusable" data-col="settings-panel" data-action="install-apk-update" data-scope="settings">Instalar ' + escHtml(appUpd.latestVersion) + '</button>' : '') +
            '</div>' +
          '</div>'
        ) : '');
    } else if (activeSettingsTab === 'backup') {
      panelBody =
        '<div class="settings-panel-title">Backup e Dados</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Exportar backup JSON</div>' +
            '<div class="setting-row-desc">Salva favoritos, histórico de reprodução e ajustes.</div>' +
          '</div>' +
          '<div><button id="set-backup-export" class="btn btn-primary focusable" data-col="settings-panel" data-action="backup-export" data-scope="settings">Exportar</button></div>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Restaurar último backup</div>' +
            '<div class="setting-row-desc">Recupera seus favoritos e configurações salvas.</div>' +
          '</div>' +
          '<div><button id="set-backup-restore" class="btn btn-secondary focusable" data-col="settings-panel" data-action="backup-restore" data-scope="settings">Restaurar</button></div>' +
        '</div>' +
        '<div id="set-backup-creds" class="setting-row focusable" data-col="settings-panel" data-lr-control="backup-creds" data-action="toggle-backup-creds" data-scope="settings">' +
          '<div>' +
            '<div class="setting-row-label">Incluir credenciais no backup</div>' +
            '<div class="setting-row-desc">Se desativado, não exporta senha Xtream nem URL em texto puro.</div>' +
          '</div>' +
          renderSwitchControl(!!includeCreds) +
        '</div>';
    } else {
      // Aba Sobre (Seção 8: logo grande 160px centralizado no topo, "Lumina TV" 40px/800, "Versão 1.9.0" 26px #94A3B8 e frase de apoio 24px #94A3B8)
      panelBody =
        '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:12px 0 24px;border-bottom:1px solid var(--line);margin-bottom:12px;">' +
          '<div style="width:160px;height:160px;margin-bottom:16px;">' + getBrandLogoSvg(BRAND_LOGO, 'about') + '</div>' +
          '<div style="font-size:40px;font-weight:800;color:var(--text);">Lumina TV</div>' +
          '<div style="font-size:26px;color:var(--text-2);font-weight:600;margin-top:6px;">Versão ' + escHtml(appVer) + ' · ' + escHtml(platLabel) + '</div>' +
          '<div style="font-size:24px;color:var(--text-2);margin-top:8px;">Sua TV e cinema em casa</div>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Atalhos do controle remoto</div>' +
            '<div class="setting-row-desc">Esquerda na 1ª coluna: Menu · Amarelo/Menu: Favoritar · CH+/CH−: Pular página/canal · Menu 2s: Diagnóstico</div>' +
          '</div>' +
        '</div>' +
        '<div class="setting-row">' +
          '<div>' +
            '<div class="setting-row-label">Painel de diagnóstico</div>' +
            '<div class="setting-row-desc">Exibe informações de motor, quadros e memória na tela.</div>' +
          '</div>' +
          '<div style="display:flex;gap:14px;">' +
            '<button id="set-diag-toggle" class="btn btn-primary focusable" data-col="settings-panel" data-action="toggle-diag" data-scope="settings">Diagnóstico</button>' +
            '<button id="set-diag-copy" class="btn btn-secondary focusable" data-col="settings-panel" data-action="copy-diag-report" data-scope="settings">Salvar Log</button>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div class="screen-enter">' +
        '<div class="screen-head"><div class="screen-head-left"><h1>Ajustes</h1></div></div>' +
        '<div class="settings-columns">' +
          '<div class="settings-tabs-col">' + tabsHtml + '</div>' +
          '<div class="settings-panel">' + panelBody + '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('settings', '#set-tab-' + activeSettingsTab);
  }

  // ── Controles trocados com ESQUERDA / DIREITA (Seções 8 e 9) ──
  function cycleArrayValue(arr, cur, dir) {
    var idx = arr.indexOf(cur);
    if (idx === -1) idx = 0;
    var step = (dir === 'RIGHT') ? 1 : -1;
    var nextIdx = (idx + step + arr.length) % arr.length;
    return arr[nextIdx];
  }

  function handleLeftRightControl(focusedEl, dir) {
    if (!focusedEl) return false;
    var ctrl = focusedEl.getAttribute('data-lr-control');
    var focusId = focusedEl.id;
    var route = global.LuminaRouter.getCurrent();

    if (ctrl === 'safe-margin' && global.LuminaSettings && typeof global.LuminaSettings.stepSafeMargin === 'function') {
      var delta = (dir === 'RIGHT') ? 1 : -1;
      var nextVal = global.LuminaSettings.stepSafeMargin(delta);
      toast('Margem de segurança da tela: ' + Math.round(nextVal * 100) + '%');
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    if (ctrl === 'series-kind') {
      currentSeriesKind = (currentSeriesKind === 'series') ? 'novelas' : 'series';
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), route);
      return true;
    }

    if (ctrl === 'catalog-sort') {
      var sorts = ['recent', 'name', 'rating'];
      currentSort = cycleArrayValue(sorts, currentSort, dir);
      if (currentSort !== 'name') currentLetterFilter = 'Todas';
      posterWindowStart.movies = 0;
      posterWindowStart.series = 0;
      posterWindowStart.novelas = 0;
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), route);
      return true;
    }

    if (ctrl === 'catalog-lang') {
      var srcList = (route === 'movies')
        ? (global.LuminaStore.get('movies') || [])
        : ((currentSeriesKind === 'novelas') ? (global.LuminaStore.get('novelasList') || []) : (global.LuminaStore.get('seriesList') || []));
      var langs = collectAvailableLanguages(srcList);
      currentLangFilter = cycleArrayValue(langs, currentLangFilter, dir);
      posterWindowStart.movies = 0;
      posterWindowStart.series = 0;
      posterWindowStart.novelas = 0;
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), route);
      return true;
    }

    if (ctrl === 'catalog-letter') {
      currentLetterFilter = cycleArrayValue(LETTERS_LIST, currentLetterFilter, dir);
      posterWindowStart.movies = 0;
      posterWindowStart.series = 0;
      posterWindowStart.novelas = 0;
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), route);
      return true;
    }

    if (ctrl === 'detail-season') {
      var item = global.LuminaStore.get('selectedDetailItem');
      var seasons = (item && item.seasons) || [];
      if (seasons.length > 1) {
        var nums = seasons.map(function (s) { return s.seasonNumber; });
        var curS = global.LuminaStore.get('selectedSeason') || nums[0];
        var nextS = cycleArrayValue(nums, curS, dir);
        detailEpWindowStart = 0;
        global.LuminaStore.set('selectedSeason', nextS);
        renderCurrentRoute();
        if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'detail');
      }
      return true;
    }

    if (ctrl === 'auto-update') {
      var opts = [12, 24, 6, 0];
      var curH = global.LuminaStore.get('autoUpdateHours');
      if (typeof curH !== 'number') curH = 12;
      var nextH = cycleArrayValue(opts, curH, dir);
      global.LuminaStore.set('autoUpdateHours', nextH);
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    if (ctrl === 'default-ratio') {
      var ratios = ['auto', '16:9', '4:3', 'fill'];
      var curR = global.LuminaStore.get('defaultAspectRatio') || 'auto';
      global.LuminaStore.set('defaultAspectRatio', cycleArrayValue(ratios, curR, dir));
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    if (ctrl === 'prefer-format') {
      var fmts = ['auto', 'm3u8', 'ts'];
      var curF = global.LuminaStore.get('preferOutputFormat') || 'auto';
      global.LuminaStore.set('preferOutputFormat', cycleArrayValue(fmts, curF, dir));
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    if (ctrl === 'motion-level') {
      var mLevels = ['Completas', 'Reduzidas', 'Desligadas'];
      var curM = global.LuminaStore.get('motionLevel') || 'Completas';
      global.LuminaStore.set('motionLevel', cycleArrayValue(mLevels, curM, dir));
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    if (ctrl === 'perf-mode') {
      var pModes = ['auto', 'normal', 'lite'];
      var curP = global.LuminaStore.get('performanceMode') || 'auto';
      global.LuminaStore.set('performanceMode', cycleArrayValue(pModes, curP, dir));
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    if (ctrl === 'org-group') {
      var grpName = focusedEl.getAttribute('data-org-group');
      var curTarget = focusedEl.getAttribute('data-org-cur') || 'live';
      var targets = ['live', 'movie', 'series', 'novela', 'hidden'];
      var nextTarget = cycleArrayValue(targets, curTarget, dir);
      var prof = JSON.parse(JSON.stringify(global.LuminaStore.get('mappingProfile') || { mode: 'custom', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }));
      prof.mode = 'custom';
      prof.customGroupRules[grpName] = nextTarget;
      global.LuminaRepository.applyMappingAndPersist(prof, function () {
        renderCurrentRoute();
        if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      });
      return true;
    }

    if (ctrl === 'parental-enable') {
      var pe = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
      if (pe.enabled && !pe.unlockedSession) {
        openParentalPinModal(function () {
          pe.enabled = false;
          global.LuminaStore.set('parental', pe);
          renderCurrentRoute();
        }, 'unlock');
      } else {
        pe.enabled = !pe.enabled;
        global.LuminaStore.set('parental', pe);
        renderCurrentRoute();
        if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      }
      return true;
    }

    if (ctrl === 'backup-creds') {
      var curInc = !!global.LuminaStore.get('includeCredentialsInBackup');
      global.LuminaStore.set('includeCredentialsInBackup', !curInc);
      renderCurrentRoute();
      if (focusId) global.LuminaFocus.setFocus(document.getElementById(focusId), 'settings');
      return true;
    }

    return false;
  }

  // ── Navegação Determinística entre Colunas e Menu Lateral (Seções 5, 7, 8 e 9) ──
  function handleColumnNavigation(focusedEl, dir) {
    if (!focusedEl || typeof document === 'undefined') return false;

    // Se o menu lateral sobreposto estiver aberto e apertar DIREITA, fecha o menu e volta para a tela
    if (sideMenuOpen && dir === 'RIGHT') {
      return closeSideMenu(true);
    }

    // No banner da Início, ESQUERDA na borda ou DIREITA após o botão Favoritar alternam os slides do carrossel
    var heroCtrl = focusedEl.getAttribute('data-hero-control');
    if (heroCtrl === 'fav' && dir === 'RIGHT') {
      var curIdx = global.LuminaStore.get('heroBannerIndex') || 0;
      global.LuminaStore.set('heroBannerIndex', curIdx + 1);
      renderCurrentRoute();
      global.LuminaFocus.setFocus(document.getElementById('home-hero-fav'), 'home');
      return true;
    }

    var col = focusedEl.getAttribute('data-col');
    var route = global.LuminaRouter.getCurrent();

    // Filmes / Séries / Novelas (Seção 8):
    // - ESQUERDA na primeira coluna da grade vai para a coluna de filtros
    // - ESQUERDA na coluna de filtros abre o menu lateral
    // - DIREITA na coluna de filtros volta para a grade
    if (col === 'catalog-grid' && dir === 'LEFT') {
      var gridCol = parseInt(focusedEl.getAttribute('data-grid-col') || '0', 10);
      if (gridCol === 0) {
        var catTarget = document.querySelector('.filter-col .cat-row.is-selected') ||
                        document.getElementById('flt-cat-slot-0') ||
                        document.getElementById('flt-sel-sort');
        if (catTarget && global.LuminaFocus.setFocus(catTarget, route)) return true;
      }
    }

    if (col === 'filter-col') {
      if (dir === 'LEFT') {
        return openSideMenu();
      }
      if (dir === 'RIGHT') {
        var firstCard = document.getElementById('poster-' + route + '-slot-0');
        if (firstCard && global.LuminaFocus.setFocus(firstCard, route)) return true;
      }
    }

    // Canais (Seção 7): Categorias <-> Lista de Canais <-> Painel de Prévia
    if (col === 'live-cats') {
      if (dir === 'LEFT') return openSideMenu();
      if (dir === 'RIGHT') {
        var ch0 = document.getElementById('live-ch-slot-0');
        if (ch0 && global.LuminaFocus.setFocus(ch0, 'live')) return true;
      }
    }
    if (col === 'live-list') {
      if (dir === 'LEFT') {
        var catSel = document.querySelector('.live-col-cats .cat-row.is-selected') || document.getElementById('live-cat-slot-0');
        if (catSel && global.LuminaFocus.setFocus(catSel, 'live')) return true;
      }
      if (dir === 'RIGHT') {
        var playBtn = document.getElementById('btn-fullscreen-live');
        if (playBtn && global.LuminaFocus.setFocus(playBtn, 'live')) return true;
      }
    }

    // Ajustes (Seção 9): Abas à esquerda <-> Painel à direita
    if (col === 'settings-tabs') {
      if (dir === 'LEFT') return openSideMenu();
      if (dir === 'RIGHT') {
        var panelFocus = document.querySelector('.settings-panel .focusable');
        if (panelFocus && global.LuminaFocus.setFocus(panelFocus, 'settings')) return true;
      }
    }
    if (col === 'settings-panel' && dir === 'LEFT') {
      var tabEl = document.getElementById('set-tab-' + activeSettingsTab) || document.getElementById('set-tab-source');
      if (tabEl && global.LuminaFocus.setFocus(tabEl, 'settings')) return true;
    }

    return false;
  }

  // ── Rolagem de Fronteira das Listas e Grades Virtualizadas ──
  function handleVirtualBoundary(focusedEl, dir) {
    var vlist = focusedEl.getAttribute('data-vlist');
    var vindex = parseInt(focusedEl.getAttribute('data-vindex') || '0', 10);
    var vtotal = parseInt(focusedEl.getAttribute('data-vtotal') || '0', 10);
    if (!vlist || vtotal <= 0) return false;

    if (vlist === 'live-channels') {
      var chSlot = vindex - liveChWindowStart;
      if (dir === 'DOWN' && chSlot === LIVE_CH_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        liveChWindowStart++;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('live-ch-slot-' + (LIVE_CH_WIN_SIZE - 1)), 'live');
        return true;
      }
      if (dir === 'UP' && chSlot === 0 && liveChWindowStart > 0) {
        liveChWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('live-ch-slot-0'), 'live');
        return true;
      }
    } else if (vlist === 'live-cats') {
      var catSlot = vindex - liveCatWindowStart;
      if (dir === 'DOWN' && catSlot === LIVE_CAT_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        liveCatWindowStart++;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('live-cat-slot-' + (LIVE_CAT_WIN_SIZE - 1)), 'live');
        return true;
      }
      if (dir === 'UP' && catSlot === 0 && liveCatWindowStart > 0) {
        liveCatWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('live-cat-slot-0'), 'live');
        return true;
      }
    } else if (vlist.indexOf('filter-cats-') === 0) {
      var effType = vlist.replace('filter-cats-', '');
      var fcStart = filterCatWindowStart[effType] || 0;
      var fcSlot = vindex - fcStart;
      var curRoute = global.LuminaRouter.getCurrent();
      if (dir === 'DOWN' && fcSlot === FILTER_CAT_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        filterCatWindowStart[effType] = fcStart + 1;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('flt-cat-slot-' + (FILTER_CAT_WIN_SIZE - 1)), curRoute);
        return true;
      }
      if (dir === 'UP' && fcSlot === 0 && fcStart > 0) {
        filterCatWindowStart[effType] = fcStart - 1;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('flt-cat-slot-0'), curRoute);
        return true;
      }
    } else if (vlist.indexOf('poster-') === 0) {
      var routeKey = vlist.replace('poster-', '');
      var secKey = (routeKey === 'series' && currentSeriesKind === 'novelas') ? 'novelas' : routeKey;
      if (routeKey === 'favorites') {
        var fSlot = vindex - favWindowStart;
        var fCol = fSlot % 5;
        if (dir === 'DOWN' && fSlot >= 5 && (favWindowStart + 10) < vtotal) {
          favWindowStart += 5;
          renderCurrentRoute();
          global.LuminaFocus.setFocus(document.getElementById('fav-slot-' + Math.min(5 + fCol, vtotal - favWindowStart - 1)), 'favorites');
          return true;
        }
        if (dir === 'UP' && fSlot < 5 && favWindowStart >= 5) {
          favWindowStart = Math.max(0, favWindowStart - 5);
          renderCurrentRoute();
          global.LuminaFocus.setFocus(document.getElementById('fav-slot-' + fCol), 'favorites');
          return true;
        }
        return false;
      }

      var pStart = posterWindowStart[secKey] || 0;
      var pSlot = vindex - pStart;
      var col = pSlot % POSTER_COLS;
      var isBottomRow = pSlot >= POSTER_COLS;
      var isTopRow = pSlot < POSTER_COLS;

      if (dir === 'DOWN' && isBottomRow && (pStart + POSTER_WIN_SIZE) < vtotal) {
        posterWindowStart[secKey] = pStart + POSTER_COLS;
        renderCurrentRoute();
        var nextSlot = Math.min(POSTER_COLS + col, (vtotal - posterWindowStart[secKey]) - 1);
        global.LuminaFocus.setFocus(document.getElementById('poster-' + routeKey + '-slot-' + nextSlot), routeKey);
        return true;
      }
      if (dir === 'UP' && isTopRow && pStart >= POSTER_COLS) {
        posterWindowStart[secKey] = Math.max(0, pStart - POSTER_COLS);
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('poster-' + routeKey + '-slot-' + col), routeKey);
        return true;
      }
    } else if (vlist === 'detail-episodes') {
      var epSlot = vindex - detailEpWindowStart;
      if (dir === 'DOWN' && epSlot === DETAIL_EP_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        detailEpWindowStart++;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('ep-row-slot-' + (DETAIL_EP_WIN_SIZE - 1)), 'detail');
        return true;
      }
      if (dir === 'UP' && epSlot === 0 && detailEpWindowStart > 0) {
        detailEpWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('ep-row-slot-0'), 'detail');
        return true;
      }
    } else if (vlist === 'org-groups') {
      var orgSlot = vindex - orgGroupWindowStart;
      if (dir === 'DOWN' && orgSlot === ORG_GROUP_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        orgGroupWindowStart++;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('org-slot-' + (ORG_GROUP_WIN_SIZE - 1)), 'settings');
        return true;
      }
      if (dir === 'UP' && orgSlot === 0 && orgGroupWindowStart > 0) {
        orgGroupWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('org-slot-0'), 'settings');
        return true;
      }
    }
    return false;
  }

  function renderCurrentRoute() {
    if (typeof document === 'undefined') return;
    var route = global.LuminaRouter.getCurrent();
    var viewport = document.getElementById('screen-viewport');
    var osd = document.getElementById('player-osd');
    if (!viewport || !osd) return;

    // Redireciona rotas legadas para suas novas casas mantendo 100% da lógica (Seções 5 e 9)
    if (route === 'organizer') {
      activeSettingsTab = 'organizer';
      route = 'settings';
    } else if (route === 'continue') {
      route = 'home';
    }

    renderSideNav(route);

    if (route === 'player-fullscreen') {
      viewport.classList.add('hidden');
      osd.classList.remove('hidden');
      global.LuminaOSD.render();
      renderDiagnosticsOverlay();
      return;
    }
    osd.classList.add('hidden');
    viewport.classList.remove('hidden');

    if (route === 'search') renderSearch(viewport);
    else if (route === 'live') renderLive(viewport);
    else if (route === 'movies') renderPosterCatalog(viewport, 'movies');
    else if (route === 'series') renderPosterCatalog(viewport, 'series');
    else if (route === 'novelas') renderPosterCatalog(viewport, 'novelas');
    else if (route === 'detail') renderDetail(viewport);
    else if (route === 'favorites') renderFavorites(viewport);
    else if (route === 'onboarding') renderOnboarding(viewport);
    else if (route === 'settings') renderSettings(viewport);
    else renderHome(viewport);

    lastRouteRendered = route;
    renderDiagnosticsOverlay();
  }

  function findShowOrItemById(id) {
    if (!id) return null;
    var byId = global.LuminaStore.get('itemByIdMap');
    if (byId && byId[id]) return byId[id];
    var items = global.LuminaStore.get('items') || [];
    for (var m = 0; m < items.length; m++) if (items[m].id === id) return items[m];
    return null;
  }

  function closeExitConfirmModal() {
    if (typeof document === 'undefined') return;
    var modal = document.getElementById('modal-backdrop');
    if (modal) modal.classList.add('hidden');
    global.LuminaFocus.setTrap(null);
    var route = global.LuminaRouter.getCurrent() || 'home';
    global.LuminaFocus.restoreOrDefault(route);
  }

  // ── Abertura Coreografada v1.9.0 ("A Luz Acende a Tela" — Seções 6 e 7) ──
  // Calcula determinísticamente todos os marcos da linha do tempo a partir de --intro-dur (3500ms padrão)
  function computeIntroTimeline(totalDurMs, mode) {
    var m = mode || 'COMPLETA';
    if (m === 'REDUZIDA') {
      return {
        mode: 'REDUZIDA',
        totalMs: 300,
        continuityStartMs: 0,
        continuityEndMs: 100,
        ignitionStartMs: 0,
        ignitionEndMs: 0,
        fieldStartMs: 0,
        fieldEndMs: 0,
        brandStartMs: 0,
        brandBladeStaggerMs: 0,
        brandEndMs: 150,
        shimmerStartMs: 0,
        shimmerEndMs: 0,
        nameStartMs: 0,
        nameLetterStaggerMs: 0,
        nameEndMs: 0,
        subtitleStartMs: 0,
        subtitleEndMs: 0,
        breathStartMs: 150,
        breathEndMs: 200,
        flipStartMs: 200,
        flipDurationMs: 0,
        flipEndMs: 300,
        homeEnterStartMs: 220,
        homeEnterEndMs: 540
      };
    }
    if (m === 'CURTA') {
      return {
        mode: 'CURTA',
        totalMs: 1100,
        continuityStartMs: 0,
        continuityEndMs: 150,
        ignitionStartMs: 150,
        ignitionEndMs: 450,
        fieldStartMs: 150,
        fieldEndMs: 450,
        brandStartMs: 150,
        brandBladeStaggerMs: 40,
        brandEndMs: 450,
        shimmerStartMs: 300,
        shimmerEndMs: 600,
        nameStartMs: 320,
        nameLetterStaggerMs: 25,
        nameEndMs: 620,
        subtitleStartMs: 450,
        subtitleEndMs: 650,
        breathStartMs: 550,
        breathEndMs: 650,
        flipStartMs: 650,
        flipDurationMs: 380,
        flipEndMs: 1100,
        homeEnterStartMs: 850,
        homeEnterEndMs: 1250
      };
    }

    var d = (typeof totalDurMs === 'number' && totalDurMs > 0) ? totalDurMs : 3500;
    var r = d / 3500.0;
    return {
      mode: 'COMPLETA',
      totalMs: Math.round(3500 * r),
      continuityStartMs: 0,
      continuityEndMs: Math.round(250 * r),
      ignitionStartMs: Math.round(250 * r),
      ignitionEndMs: Math.round(800 * r),
      fieldStartMs: Math.round(600 * r),
      fieldEndMs: Math.round(1100 * r),
      brandStartMs: Math.round(700 * r),
      brandBladeStaggerMs: Math.round(90 * r),
      brandEndMs: Math.round(1300 * r),
      shimmerStartMs: Math.round(1100 * r),
      shimmerEndMs: Math.round(1700 * r),
      nameStartMs: Math.round(1400 * r),
      nameLetterStaggerMs: Math.round(55 * r),
      nameEndMs: Math.round(2100 * r),
      subtitleStartMs: Math.round(1900 * r),
      subtitleEndMs: Math.round(2400 * r),
      breathStartMs: Math.round(2400 * r),
      breathEndMs: Math.round(3000 * r),
      flipStartMs: Math.round(3000 * r),
      flipDurationMs: Math.round(380 * r),
      flipEndMs: Math.round(3500 * r),
      homeEnterStartMs: Math.round(3200 * r),
      homeEnterEndMs: Math.round(3700 * r)
    };
  }

  function evaluateFrameBenchmark(frameDeltasMs) {
    if (!Array.isArray(frameDeltasMs) || !frameDeltasMs.length) {
      return { meanMs: 16.7, medianMs: 16.7, p95Ms: 16.7, chosenLevel: 'COMPLETA', downgraded: false };
    }
    var sorted = frameDeltasMs.slice().sort(function (a, b) { return a - b; });
    var sum = 0;
    for (var i = 0; i < sorted.length; i++) sum += sorted[i];
    var mean = Math.round((sum / sorted.length) * 10) / 10;
    var mid = Math.floor(sorted.length / 2);
    var median = (sorted.length % 2 !== 0)
      ? sorted[mid]
      : ((sorted[mid - 1] + sorted[mid]) / 2.0);
    median = Math.round(median * 10) / 10;
    var p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    var p95 = Math.round(sorted[p95Idx] * 10) / 10;
    var downgraded = median > 24.0;
    return {
      meanMs: mean,
      medianMs: median,
      p95Ms: p95,
      chosenLevel: downgraded ? 'REDUZIDA' : 'ALTA',
      downgraded: downgraded
    };
  }

  function computeFlipDelta(fromRect, toRect, canvasScale) {
    var s = (typeof canvasScale === 'number' && canvasScale > 0) ? canvasScale : 1;
    var fromW = (fromRect.width || 176) / s;
    var fromH = (fromRect.height || 176) / s;
    var toW = (toRect.width || 64) / s;
    var toH = (toRect.height || 64) / s;

    var fromCx = (fromRect.left + (fromRect.width || 0) / 2.0) / s;
    var fromCy = (fromRect.top + (fromRect.height || 0) / 2.0) / s;
    var toCx = (toRect.left + (toRect.width || 0) / 2.0) / s;
    var toCy = (toRect.top + (toRect.height || 0) / 2.0) / s;

    return {
      dx: Math.round((toCx - fromCx) * 10) / 10,
      dy: Math.round((toCy - fromCy) * 10) / 10,
      scale: Math.round(((toW / Math.max(1, fromW)) + (toH / Math.max(1, fromH))) * 5000) / 10000
    };
  }

  function isBootSplashVisible() {
    if (typeof document === 'undefined') return false;
    var splash = document.getElementById('boot-splash');
    return !!(splash && !splash.classList.contains('is-dismissed') && splash.style.display !== 'none');
  }

  function revealSidebarLogoAfterFlip() {
    if (typeof document === 'undefined') return;
    var navLogo = document.getElementById('side-nav-logo');
    if (navLogo) navLogo.classList.remove('is-awaiting-flip');
  }

  function dismissBootSplash(forceImmediate) {
    if (typeof document === 'undefined') return;
    var splash = document.getElementById('boot-splash');
    if (!splash || splash.classList.contains('is-dismissed')) return;

    if (!forceImmediate && !bootCompleted) {
      var waitBar = document.getElementById('boot-wait-track');
      if (waitBar) waitBar.classList.add('is-visible');
      return;
    }

    clearTimeout(introWaitTimer);
    clearTimeout(introFinishTimer);

    // Se foi pulado com OK/Voltar ou está em modo reduzido, revela o logo do menu e faz fade imediato
    if (forceImmediate || splash.classList.contains('is-minimal')) {
      revealSidebarLogoAfterFlip();
      splash.classList.remove('is-animating');
      splash.classList.add('is-dismissed');
      setTimeout(function () {
        if (splash.parentNode) splash.style.display = 'none';
      }, 240);
      return;
    }

    // 3000–3500ms "Entrega": transição FLIP do símbolo central (176x176) até o logo do menu lateral (64x64)
    splash.classList.add('is-handing-off');
    var bootLogo = document.getElementById('boot-logo-wrap');
    var navLogo = document.getElementById('side-nav-logo');
    var vInfo = (typeof global.__luminaViewportInfo === 'function')
      ? global.__luminaViewportInfo()
      : { scale: 1 };

    if (bootLogo && navLogo && bootLogo.getBoundingClientRect && navLogo.getBoundingClientRect) {
      var flip = computeFlipDelta(
        bootLogo.getBoundingClientRect(),
        navLogo.getBoundingClientRect(),
        vInfo.scale || 1
      );
      bootLogo.style.animation = 'none';
      bootLogo.style.transition = 'transform 380ms cubic-bezier(0.65, 0, 0.35, 1)';
      bootLogo.style.transform = 'translate(' + flip.dx + 'px, ' + flip.dy + 'px) scale(' + flip.scale + ')';
    }

    setTimeout(function () {
      revealSidebarLogoAfterFlip();
      if (bootLogo) bootLogo.style.opacity = '0';
      splash.classList.remove('is-animating');
      splash.classList.add('is-dismissed');
      setTimeout(function () {
        if (splash.parentNode) splash.style.display = 'none';
      }, 220);
    }, 380);
  }

  function notifyCatalogReadyForIntro() {
    bootCompleted = true;
    if (introAnimationFinished) {
      dismissBootSplash(false);
    }
  }

  function runIntroFrameBenchmark(splash) {
    if (typeof global.requestAnimationFrame !== 'function') return;
    var deltas = [];
    var startTs = 0;
    var lastTs = 0;

    function step(now) {
      if (!isBootSplashVisible()) return;
      if (!startTs) {
        startTs = now;
        lastTs = now;
        global.requestAnimationFrame(step);
        return;
      }
      var dt = now - lastTs;
      lastTs = now;
      if (dt > 0 && dt < 250) deltas.push(dt);

      if (now - startTs < 500) {
        global.requestAnimationFrame(step);
      } else {
        var stats = evaluateFrameBenchmark(deltas);
        global.__luminaPerf = stats;
        if (stats.downgraded && splash && !splash.classList.contains('is-minimal')) {
          splash.classList.remove('is-full', 'is-short');
          splash.classList.add('is-minimal');
          clearTimeout(introFinishTimer);
          introAnimationFinished = true;
          dismissBootSplash(true);
        }
      }
    }
    global.requestAnimationFrame(step);
  }

  function setupIntroChoreography() {
    if (typeof document === 'undefined') return;
    var splash = document.getElementById('boot-splash');
    if (!splash) return;

    var logoWrap = document.getElementById('boot-logo-wrap');
    if (logoWrap) {
      logoWrap.innerHTML = getBrandLogoSvg(BRAND_LOGO, 'boot') + '<div id="boot-shimmer-band" class="boot-shimmer-band"></div>';
    }

    var isLite = !!global.LuminaStore.get('liteModeActive') || global.LuminaStore.get('performanceMode') === 'lite';
    var prefersReduced = false;
    try {
      if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        prefersReduced = true;
      }
    } catch (e) {}

    if (isLite || prefersReduced) {
      global.__luminaPerf = { meanMs: 0, medianMs: 0, p95Ms: 0, chosenLevel: 'REDUZIDA', downgraded: false };
      splash.classList.add('is-minimal');
      introFinishTimer = setTimeout(function () {
        introAnimationFinished = true;
        dismissBootSplash(true);
      }, 300);
      return;
    }

    var todayKey = new Date().toISOString().slice(0, 10);
    var lastIntroDay = '';
    try {
      if (global.localStorage) {
        lastIntroDay = global.localStorage.getItem('lumina_intro_day') || '';
        global.localStorage.setItem('lumina_intro_day', todayKey);
      }
    } catch (e) {}

    var mode = (lastIntroDay === todayKey) ? 'CURTA' : 'COMPLETA';
    var timeline = computeIntroTimeline(3500, mode);

    splash.classList.add('is-animating');
    if (mode === 'CURTA') {
      splash.classList.add('is-short');
    } else {
      splash.classList.add('is-full');
    }

    runIntroFrameBenchmark(splash);

    introFinishTimer = setTimeout(function () {
      introAnimationFinished = true;
      if (bootCompleted) {
        dismissBootSplash(false);
      } else {
        var waitBar = document.getElementById('boot-wait-track');
        if (waitBar) waitBar.classList.add('is-visible');
      }
    }, timeline.flipStartMs);
  }

  function bindGlobalActions() {
    global.LuminaEventBus.on('route:changed', renderCurrentRoute);

    global.LuminaEventBus.on('diag:toggle', function () {
      var cur = !!global.LuminaStore.get('diagnosticsVisible');
      global.LuminaStore.set('diagnosticsVisible', !cur);
      renderDiagnosticsOverlay();
      toast(!cur ? 'Painel de Diagnóstico ativado' : 'Painel de Diagnóstico ocultado');
    });

    global.LuminaEventBus.on('app:confirm-exit', function () {
      if (typeof document === 'undefined') return;
      var modal = document.getElementById('modal-backdrop');
      if (!modal) return;
      modal.classList.remove('hidden');
      global.LuminaFocus.setTrap(modal);
      var cancelBtn = document.getElementById('btn-modal-cancel');
      if (cancelBtn) global.LuminaFocus.setFocus(cancelBtn, 'modal');
    });

    global.LuminaEventBus.on('modal:close', closeExitConfirmModal);
    global.LuminaEventBus.on('pin-modal:close', closeParentalPinModal);

    // Tecla Amarela / Menu curto na Fire TV: Favoritar item em foco
    global.LuminaEventBus.on('key:YELLOW', function () {
      var cur = global.LuminaFocus.getCurrent();
      if (!cur) return;
      var targetId = cur.getAttribute('data-detail-id') ||
                     cur.getAttribute('data-channel-id') ||
                     cur.getAttribute('data-play-id') ||
                     cur.getAttribute('data-play-vod') ||
                     cur.getAttribute('data-fav-id');
      if (targetId) {
        var nowFav = global.LuminaStore.toggleFavorite(targetId);
        toast(nowFav ? 'Adicionado aos Favoritos' : 'Removido dos Favoritos');
        renderCurrentRoute();
      }
    });

    // Salto de página com CH+ / CH-
    global.LuminaEventBus.on('key:CH_UP', function () {
      var r = global.LuminaRouter.getCurrent();
      if (r === 'live') {
        liveChWindowStart = Math.max(0, liveChWindowStart - LIVE_CH_WIN_SIZE);
        renderCurrentRoute();
      } else if (r === 'movies' || r === 'series' || r === 'novelas') {
        var sec = (r === 'series' && currentSeriesKind === 'novelas') ? 'novelas' : r;
        posterWindowStart[sec] = Math.max(0, (posterWindowStart[sec] || 0) - POSTER_WIN_SIZE);
        renderCurrentRoute();
      }
    });

    global.LuminaEventBus.on('key:CH_DOWN', function () {
      var r = global.LuminaRouter.getCurrent();
      if (r === 'live') {
        var total = (global.LuminaStore.get('channels') || []).length;
        if (liveChWindowStart + LIVE_CH_WIN_SIZE < total) {
          liveChWindowStart += LIVE_CH_WIN_SIZE;
          renderCurrentRoute();
        }
      } else if (r === 'movies' || r === 'series' || r === 'novelas') {
        var sec2 = (r === 'series' && currentSeriesKind === 'novelas') ? 'novelas' : r;
        posterWindowStart[sec2] = (posterWindowStart[sec2] || 0) + POSTER_WIN_SIZE;
        renderCurrentRoute();
      }
    });

    global.LuminaEventBus.on('focus:changed', function (el) {
      var bannerEl = (typeof document !== 'undefined') ? document.getElementById('home-hero-banner') : null;
      if (bannerEl) {
        if (el && bannerEl.contains && bannerEl.contains(el)) bannerEl.classList.add('is-paused');
        else bannerEl.classList.remove('is-paused');
      }
      if (typeof document === 'undefined' || !el) return;
      var chId = el.getAttribute('data-channel-id');
      if (chId && chId !== focusedLiveChannelId) {
        focusedLiveChannelId = chId;
      }
    });

    global.LuminaEventBus.on('focus:select', function (el) {
      if (!el) return;

      var actImmediate = el.getAttribute('data-action');
      if (actImmediate === 'cancel-loading') {
        if (global.LuminaRepository && global.LuminaRepository.cancelActiveLoad) {
          global.LuminaRepository.cancelActiveLoad();
        }
        hideLoading();
        toast('Operação cancelada.');
        renderCurrentRoute();
        return;
      }

      if (global.LuminaStore.get('loading')) return;

      if (global.LuminaRouter.getCurrent() === 'player-fullscreen') {
        var osdBox = document.getElementById('player-osd');
        if (osdBox && osdBox.classList.contains('hidden')) {
          global.LuminaOSD.show();
          return;
        }
      }

      // 1. Teclado de PIN Parental
      var pinDigit = el.getAttribute('data-pin-digit');
      if (pinDigit !== null && pinDigit !== undefined) {
        pinDraft += String(pinDigit);
        if (pinDraft.length >= 4) {
          if (pinModalMode === 'unlock') {
            var res = global.LuminaStore.verifyParentalPinDetailed(pinDraft);
            if (res.ok) {
              var cb = pendingPinCallback;
              closeParentalPinModal();
              toast('PIN validado.');
              if (cb) cb();
            } else {
              pinDraft = '';
              toast(res.message);
              renderParentalPinModal(res.message);
            }
          } else if (pinModalMode === 'change-current') {
            var chk = global.LuminaStore.verifyParentalPinDetailed(pinDraft);
            if (chk.ok) {
              pinChangeTempCurrent = pinDraft;
              pinDraft = '';
              pinModalMode = 'change-new';
              renderParentalPinModal();
            } else {
              pinDraft = '';
              toast(chk.message);
              renderParentalPinModal(chk.message);
            }
          } else if (pinModalMode === 'change-new') {
            pinChangeTempNew = pinDraft;
            pinDraft = '';
            pinModalMode = 'change-confirm';
            renderParentalPinModal();
          } else if (pinModalMode === 'change-confirm') {
            var changeRes = global.LuminaSettings.changePin(pinChangeTempCurrent, pinChangeTempNew, pinDraft);
            if (changeRes.ok) {
              closeParentalPinModal();
              toast(changeRes.message);
            } else {
              pinDraft = '';
              pinModalMode = 'change-new';
              toast(changeRes.message);
              renderParentalPinModal(changeRes.message);
            }
          }
        } else {
          renderParentalPinModal();
        }
        return;
      }

      var pinAct = el.getAttribute('data-pin-action');
      if (pinAct) {
        if (pinAct === 'clear') {
          pinDraft = '';
          renderParentalPinModal();
        } else if (pinAct === 'cancel') {
          closeParentalPinModal();
        }
        return;
      }

      var navRoute = el.getAttribute('data-nav');
      if (navRoute) {
        closeSideMenu(false);
        global.LuminaRouter.navigate(navRoute);
        return;
      }

      var osdAction = el.getAttribute('data-osd-action') || el.getAttribute('data-osd-ch-id');
      if (osdAction) {
        global.LuminaOSD.handleAction(el.getAttribute('data-osd-action') || 'select-ch', el);
        return;
      }

      var settingsTab = el.getAttribute('data-settings-tab');
      if (settingsTab) {
        activeSettingsTab = settingsTab;
        renderCurrentRoute();
        return;
      }

      var liveCatName = el.getAttribute('data-cat-name');
      if (liveCatName) {
        var isAdultCat = /adult|\+18|xxx/i.test(liveCatName);
        var parState = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
        if (isAdultCat && parState.enabled && !parState.unlockedSession) {
          openParentalPinModal(function () {
            selectedLiveCat = liveCatName;
            liveChWindowStart = 0;
            renderCurrentRoute();
          });
          return;
        }
        selectedLiveCat = liveCatName;
        liveChWindowStart = 0;
        renderCurrentRoute();
        return;
      }

      var chRowId = el.getAttribute('data-channel-id');
      if (chRowId) {
        var targetCh = findShowOrItemById(chRowId);
        if (targetCh) {
          focusedLiveChannelId = chRowId;
          if (isItemLockedByParental(targetCh)) {
            openParentalPinModal(function () {
              global.LuminaPlayer.open(targetCh);
              global.LuminaRouter.navigate('player-fullscreen');
            });
            return;
          }
          global.LuminaPlayer.open(targetCh);
          global.LuminaRouter.navigate('player-fullscreen');
        }
        return;
      }

      var kbChar = el.getAttribute('data-kb-char');
      if (kbChar) {
        var curQ = global.LuminaStore.get('searchQuery') || '';
        global.LuminaStore.set('searchQuery', curQ + kbChar);
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('kb-key-' + kbChar), 'search');
        return;
      }

      var kbAct = el.getAttribute('data-kb-action');
      if (kbAct) {
        var q = global.LuminaStore.get('searchQuery') || '';
        if (kbAct === 'space') q += ' ';
        else if (kbAct === 'backspace') q = q.slice(0, -1);
        else if (kbAct === 'clear') q = '';
        global.LuminaStore.set('searchQuery', q);
        renderCurrentRoute();
        return;
      }

      var catSection = el.getAttribute('data-cat-section');
      if (catSection) {
        var val = el.getAttribute('data-cat-val');
        var curFocusId = el.id;
        if (catSection === 'movies') selectedMovieCat = val;
        else if (catSection === 'series') selectedSeriesCat = val;
        else if (catSection === 'novelas') selectedNovelaCat = val;
        posterWindowStart[catSection] = 0;
        renderCurrentRoute();
        if (curFocusId) global.LuminaFocus.setFocus(document.getElementById(curFocusId), global.LuminaRouter.getCurrent());
        return;
      }

      var seasonNumAttr = el.getAttribute('data-season-num');
      if (seasonNumAttr) {
        detailEpWindowStart = 0;
        global.LuminaStore.set('selectedSeason', parseInt(seasonNumAttr, 10));
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('season-pill-' + seasonNumAttr), 'detail');
        return;
      }

      var detailId = el.getAttribute('data-detail-id');
      if (detailId) {
        if (global.LuminaRouter.getCurrent() === 'search') {
          global.LuminaStore.addSearchHistory(global.LuminaStore.get('searchQuery'));
        }
        var found = findShowOrItemById(detailId);
        if (found) {
          if (isItemLockedByParental(found)) {
            openParentalPinModal(function () {
              detailEpWindowStart = 0;
              global.LuminaStore.set('detailError', null);
              global.LuminaStore.set('selectedDetailItem', found);
              global.LuminaStore.set('selectedSeason', 1);
              global.LuminaRouter.navigate('detail');
            });
            return;
          }
          detailEpWindowStart = 0;
          global.LuminaStore.set('detailError', null);
          global.LuminaStore.set('selectedDetailItem', found);
          global.LuminaStore.set('selectedSeason', 1);
          global.LuminaRouter.navigate('detail');
        }
        return;
      }

      var playVodId = el.getAttribute('data-play-vod') || el.getAttribute('data-play-ep') || el.getAttribute('data-play-id');
      if (playVodId) {
        if (global.LuminaRouter.getCurrent() === 'search') {
          global.LuminaStore.addSearchHistory(global.LuminaStore.get('searchQuery'));
        }
        var targetItem = findShowOrItemById(playVodId);
        if (targetItem) {
          if (isItemLockedByParental(targetItem)) {
            openParentalPinModal(function () {
              global.LuminaPlayer.open(targetItem);
              global.LuminaRouter.navigate('player-fullscreen');
            });
            return;
          }
          global.LuminaPlayer.open(targetItem);
          global.LuminaRouter.navigate('player-fullscreen');
        }
        return;
      }

      var favId = el.getAttribute('data-fav-id');
      if (favId) {
        var nowFav = global.LuminaStore.toggleFavorite(favId);
        toast(nowFav ? 'Adicionado aos Favoritos' : 'Removido dos Favoritos');
        renderCurrentRoute();
        return;
      }

      var orgProfile = el.getAttribute('data-org-profile');
      if (orgProfile) {
        var pr = JSON.parse(JSON.stringify(global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }));
        pr.mode = orgProfile;
        if (orgProfile === 'auto') pr.customGroupRules = {};
        global.LuminaRepository.applyMappingAndPersist(pr, function () {
          toast('Classificação automática restaurada');
          renderCurrentRoute();
        });
        return;
      }

      // Se clicou OK em um seletor ‹ valor ›, avança para a direita
      if (el.getAttribute('data-lr-control')) {
        handleLeftRightControl(el, 'RIGHT');
        return;
      }

      var action = el.getAttribute('data-action');
      if (action === 'modal-cancel') {
        closeExitConfirmModal();
      } else if (action === 'modal-exit') {
        closeExitConfirmModal();
        if (global.LuminaPlatform && global.LuminaPlatform.exitApp) {
          global.LuminaPlatform.exitApp();
        }
      } else if (action === 'go-phone-pairing' || action === 'open-phone-pairing' || action === 'renew-phone-code') {
        global.LuminaPairing.resetSession();
        pairingStarting = false;
        global.LuminaStore.set('pairingStep', 'phone-qr');
        global.LuminaStore.set('pairingError', null);
        global.LuminaRouter.navigate('onboarding');
        renderCurrentRoute();
        beginPairing();
      } else if (action === 'reload-source') {
        var curSrc = global.LuminaStore.get('source');
        if (!curSrc) {
          toast('Nenhuma lista salva. Use o pareamento pelo celular.');
          return;
        }
        showLoading('Atualizando lista');
        global.LuminaPairing.applyMobilePayload(
          curSrc.type === 'xtream'
            ? { type: 'xtream', name: curSrc.name, host: curSrc.creds.server, port: 0, username: curSrc.creds.username, password: curSrc.creds.password }
            : curSrc,
          function (err, list, _pl, updateRec) {
            hideLoading();
            if (err) { toast(err.message); return; }
            if (updateRec && updateRec.unchanged) {
              toast('Sua lista já está atualizada.');
            } else {
              toast('Lista atualizada: ' + fmtCountPt(list ? list.length : 0) + ' itens' + formatDiffSummary(updateRec));
            }
            renderCurrentRoute();
          },
          onLoadProgress
        );
      } else if (action === 'retry-series-info') {
        global.LuminaStore.set('detailError', null);
        renderCurrentRoute();
      } else if (action === 'org-undo') {
        global.LuminaRepository.undoLastMappingChange(function (undone) {
          if (undone) toast('Última alteração desfeita.');
          renderCurrentRoute();
        });
      } else if (action === 'toggle-parental-lock') {
        var p = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
        if (p.unlockedSession) {
          global.LuminaSettings.lockParentalSession();
          toast('Sessão +18 bloqueada.');
          renderCurrentRoute();
        } else {
          openParentalPinModal(function () {
            renderCurrentRoute();
          }, 'unlock');
        }
      } else if (action === 'change-parental-pin') {
        openParentalPinModal(null, 'change-current');
      } else if (action === 'run-tmdb-enrich') {
        var tmdbCfg = global.LuminaStore.get('tmdb') || { enabled: false, apiKey: '' };
        toast('Buscando capas e sinopses no TMDB...');
        global.LuminaTMDB.enrichCatalogBatch(tmdbCfg, function (err, count) {
          if (err) { toast(err.message); return; }
          tmdbCfg.enrichedCount = (tmdbCfg.enrichedCount || 0) + count;
          global.LuminaStore.set('tmdb', tmdbCfg);
          toast(count + ' títulos enriquecidos.');
          renderCurrentRoute();
        });
      } else if (action === 'check-apk-update') {
        toast('Verificando atualização no GitHub...');
        global.LuminaPlatform.checkForAppUpdate(function (err, info) {
          if (err) { toast(err.message); return; }
          global.LuminaStore.set('appUpdateInfo', info);
          if (info && info.hasUpdate) {
            toast('Nova versão disponível: ' + info.latestVersion);
          } else {
            toast('Você já está na versão mais recente.');
          }
          renderCurrentRoute();
        });
      } else if (action === 'install-apk-update') {
        var upd = global.LuminaStore.get('appUpdateInfo');
        if (!upd || !upd.downloadUrl) {
          toast('Nenhuma URL de APK disponível.');
          return;
        }
        if (!global.LuminaPlatform.canInstallUnknownApps()) {
          toast('Permita a instalação de fontes desconhecidas para o Lumina TV.');
          global.LuminaPlatform.openUnknownAppsSettings();
          return;
        }
        toast('Baixando ' + upd.latestVersion + '...');
        global.LuminaPlatform.downloadAndInstallUpdate(
          upd.downloadUrl,
          upd.assetSize || 0,
          upd.sha256 || '',
          function (prog) {
            global.LuminaStore.set('appUpdateProgress', prog);
            if (global.LuminaRouter.getCurrent() === 'settings') renderCurrentRoute();
          },
          function (err) {
            global.LuminaStore.set('appUpdateProgress', null);
            if (err) toast(err.message);
            else toast('Instalador aberto.');
            renderCurrentRoute();
          }
        );
      } else if (action === 'backup-export') {
        var bkp = global.LuminaStore.exportFullBackupJson();
        global.LuminaStorage.saveMeta('lastBackupMeta', bkp);
        if (global.LuminaPlatform && global.LuminaPlatform.saveBackupToDisk) {
          global.LuminaPlatform.saveBackupToDisk('lumina-backup.json', bkp);
        }
        toast('Backup JSON exportado.');
      } else if (action === 'backup-restore') {
        var diskBkp = (global.LuminaPlatform && global.LuminaPlatform.readBackupFromDisk)
          ? global.LuminaPlatform.readBackupFromDisk('lumina-backup.json')
          : '';
        if (diskBkp) {
          try {
            global.LuminaStore.importFullBackupJson(diskBkp);
            toast('Backup restaurado com sucesso.');
            renderCurrentRoute();
            return;
          } catch (e) {}
        }
        global.LuminaStorage.loadMeta('lastBackupMeta', null, function (savedBkp) {
          if (!savedBkp) {
            toast('Nenhum backup encontrado.');
            return;
          }
          try {
            global.LuminaStore.importFullBackupJson(savedBkp);
            toast('Backup restaurado com sucesso.');
            renderCurrentRoute();
          } catch (ex) {
            toast('Erro ao restaurar backup.');
          }
        });
      } else if (action === 'copy-diag-report') {
        var rep = buildDiagnosticsReportText();
        if (global.LuminaPlatform && global.LuminaPlatform.saveBackupToDisk) {
          global.LuminaPlatform.saveBackupToDisk('lumina-diagnostico.txt', rep);
        }
        toast('Relatório salvo.');
      } else if (action === 'toggle-diag') {
        global.LuminaEventBus.emit('diag:toggle');
      } else if (action === 'back') {
        global.LuminaRouter.back();
      }
    });
  }

  global.LuminaUI = {
    BRAND_LOGO: BRAND_LOGO,
    MENU_ITEMS: MENU_ITEMS,
    SETTINGS_TABS: SETTINGS_TABS,
    init: function () {
      setupIntroChoreography();
      bindGlobalActions();
      renderCurrentRoute();
    },
    escHtml: escHtml,
    escAttr: escAttr,
    toast: toast,
    showLoading: showLoading,
    setLoading: setLoading,
    hideLoading: hideLoading,
    renderCurrentRoute: renderCurrentRoute,
    openParentalPinModal: openParentalPinModal,
    openSideMenu: openSideMenu,
    closeSideMenu: closeSideMenu,
    isSideMenuOpen: isSideMenuOpen,
    handleLeftRightControl: handleLeftRightControl,
    handleColumnNavigation: handleColumnNavigation,
    handleVirtualBoundary: handleVirtualBoundary,
    POSTER_PALETTES: POSTER_PALETTES,
    POSTER_MOTIFS: POSTER_MOTIFS,
    getTitlePalette: getTitlePalette,
    getTitleMotif: getTitleMotif,
    generateDeterministicArtSvg: generateDeterministicArtSvg,
    getGreetingByHour: getGreetingByHour,
    computeIntroTimeline: computeIntroTimeline,
    evaluateFrameBenchmark: evaluateFrameBenchmark,
    computeFlipDelta: computeFlipDelta,
    isBootSplashVisible: isBootSplashVisible,
    dismissBootSplash: dismissBootSplash,
    notifyCatalogReadyForIntro: notifyCatalogReadyForIntro
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaUI;
})(typeof window !== 'undefined' ? window : global);
