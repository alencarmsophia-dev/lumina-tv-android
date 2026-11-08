(function (global) {
  'use strict';

  var selectedLiveCat = 'Todos os Canais';
  var selectedMovieCat = 'Todos os Filmes';
  var selectedSeriesCat = 'Todas as Séries';
  var selectedNovelaCat = 'Todas as Novelas';
  var currentSort = 'recent'; // 'recent' | 'name' | 'rating' | 'year'
  var currentLangFilter = 'ALL'; // 'ALL' | 'DUB' | 'LEG'
  var currentQualityFilter = 'ALL'; // 'ALL' | '4K' | 'FHD' | 'HD'
  var currentLetterFilter = 'ALL'; // 'ALL' | 'A'..'Z'
  var activeSettingsTab = 'account'; // 'account' | 'playback' | 'appearance' | 'parental' | 'updates' | 'backup' | 'about'
  var organizerSearchQuery = '';

  // Estados de janelas virtualizadas (permitem navegar em listas de 100.000+ itens mantendo < 150 nós no DOM)
  var liveCatWindowStart = 0;
  var LIVE_CAT_WIN_SIZE = 9;
  var liveChWindowStart = 0;
  var LIVE_CH_WIN_SIZE = 8;
  var focusedLiveChannelId = null;

  var posterWindowStart = { movies: 0, series: 0, novelas: 0 };
  var POSTER_COLS = 6;
  var POSTER_ROWS = 2;
  var POSTER_WIN_SIZE = POSTER_COLS * POSTER_ROWS; // 12 cartões visíveis por janela, rolando suavemente

  var detailEpWindowStart = 0;
  var DETAIL_EP_WIN_SIZE = 6;

  var orgGroupWindowStart = 0;
  var ORG_GROUP_WIN_SIZE = 7;

  var favWindowStart = 0;
  var FAV_WIN_SIZE = 8;

  var contWindowStart = 0;
  var CONT_WIN_SIZE = 6;

  var pairingStarting = false;
  var pinDraft = '';
  var pinModalMode = 'unlock'; // 'unlock' | 'change-current' | 'change-new' | 'change-confirm'
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

  var LETTERS_BAR = ['ALL', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];

  // Escape rigoroso de HTML e de Atributos (corrige vulnerabilidade/quebra de layout da Seção 4.2)
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

  function fmtDateBr(ts) {
    if (!ts) return 'Nunca';
    try {
      var d = new Date(ts);
      var dd = ('0' + d.getDate()).slice(-2);
      var mm = ('0' + (d.getMonth() + 1)).slice(-2);
      var hh = ('0' + d.getHours()).slice(-2);
      var mi = ('0' + d.getMinutes()).slice(-2);
      return dd + '/' + mm + '/' + d.getFullYear() + ' às ' + hh + ':' + mi;
    } catch (e) {
      return String(ts);
    }
  }

  // ── Tela de progresso (carregamento de lista com opção de Cancelar) ──
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

  var hintTimer = null;
  var lastHintRoute = null;
  function updateRemoteHints(route) {
    if (typeof document === 'undefined') return;
    var el = document.querySelector('.remote-hints');
    if (!el || route === lastHintRoute) return;
    lastHintRoute = route;
    clearTimeout(hintTimer);
    if (route === 'player-fullscreen') {
      el.classList.add('is-hidden');
      return;
    }
    el.classList.remove('is-hidden');
    hintTimer = setTimeout(function () { el.classList.add('is-hidden'); }, 7000);
  }

  function toast(msg) {
    if (typeof document === 'undefined') return;
    var box = document.getElementById('toast-container');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = String(msg || '');
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3400);
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

  // ── Modal de PIN Parental (Desbloqueio + Troca de PIN com confirmação e bloqueio por tentativas) ──
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

    var heading = 'Digite o PIN de 4 dígitos';
    var subtitle = 'Conteúdo restrito (+18). Digite o seu PIN Parental (padrão inicial: 0000).';
    if (pinModalMode === 'change-current') {
      heading = 'Alterar PIN · Passo 1 de 3';
      subtitle = 'Digite o seu PIN ATUAL de 4 dígitos para continuar.';
    } else if (pinModalMode === 'change-new') {
      heading = 'Alterar PIN · Passo 2 de 3';
      subtitle = 'Digite o NOVO PIN de 4 dígitos que deseja salvar.';
    } else if (pinModalMode === 'change-confirm') {
      heading = 'Alterar PIN · Passo 3 de 3';
      subtitle = 'Confirme digitando novamente o NOVO PIN de 4 dígitos.';
    }

    modal.innerHTML =
      '<div class="pin-modal-box">' +
        '<div style="color:var(--accent-amber);font-size:19px;font-weight:700;letter-spacing:1.5px;">🔒 CONTROLE PARENTAL (+18)</div>' +
        '<h2 style="font-size:32px;margin:8px 0;">' + escHtml(heading) + '</h2>' +
        '<p style="color:var(--text-secondary);font-size:20px;">' + escHtml(statusText || subtitle) + '</p>' +
        '<div class="pin-dots-display">' + masked + '</div>' +
        '<div class="pin-pad-grid">' + padHtml + '</div>' +
        '<div style="margin-top:16px;">' +
          '<button id="pin-btn-clear" class="btn btn-sm focusable" data-pin-action="clear" data-scope="pin-modal">Limpar</button>' +
          '<button id="pin-btn-cancel" class="btn btn-sm focusable" data-pin-action="cancel" data-scope="pin-modal">Cancelar</button>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.setFocus(document.getElementById('pin-key-0'), 'pin-modal');
  }

  // ── Painel de Diagnóstico Multiplataforma (Seção 4.13 e 6.10) ──
  function buildDiagnosticsReportText() {
    var diag = global.LuminaStore.get('diagnostics') || {};
    var domCount = (typeof document !== 'undefined' && document.getElementsByTagName) ? document.getElementsByTagName('*').length : 0;
    var plat = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Web';
    var ver = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '1.6.0';
    var items = global.LuminaStore.get('items') || [];
    var unclass = global.LuminaStore.get('unclassifiedList') || [];
    var estMemMb = Math.round(((items.length * 320) / (1024 * 1024)) * 10) / 10;

    return [
      '=== RELATÓRIO DE DIAGNÓSTICO LUMINA TV v' + ver + ' ===',
      'Plataforma: ' + plat,
      'Motor Ativo: ' + (diag.engine || 'NativeEngine'),
      'Cadeia Tentada: ' + (diag.attemptedChain || '-'),
      'TTFF (1º Quadro): ' + (diag.ttffMs || 0) + ' ms',
      'Reconexões: ' + (diag.reconnections || 0) + ' | Quadros Perdidos: ' + (diag.droppedFrames || 0),
      'Nós no DOM: ' + domCount + ' | Memória Catálogo Est.: ~' + estMemMb + ' MB',
      'Itens Visíveis: ' + items.length + ' | Não Classificados: ' + unclass.length,
      'Geração Catálogo: ' + (diag.catalogGeneration || '-'),
      'Último Erro: ' + (diag.lastError || '-')
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
    var isLite = global.LuminaStore.get('liteModeActive');
    var platLabel = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Smart TV';
    var appVer = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '1.6.0';
    var itemsCount = (global.LuminaStore.get('items') || []).length;
    var estMemMb = Math.round(((itemsCount * 320) / (1024 * 1024)) * 10) / 10;
    var logs = (global.LuminaLog && global.LuminaLog.getRecent) ? global.LuminaLog.getRecent().slice(-3) : [];
    var logHtml = '';
    for (var i = 0; i < logs.length; i++) {
      logHtml += '<div style="font-size:15px;color:#94A3B8;margin-top:3px;">[' + escHtml(logs[i].ts) + '] ' + escHtml(logs[i].tag) + ': ' + escHtml(logs[i].msg) + '</div>';
    }

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(56,189,248,0.3);padding-bottom:8px;margin-bottom:10px;">' +
        '<strong style="color:var(--accent-cyan);font-size:18px;">DIAGNÓSTICO LUMINA TV v' + escHtml(appVer) + '</strong>' +
        '<span class="badge-pill">R·G·Y·B / MENU 2s</span>' +
      '</div>' +
      '<div>Plataforma: <strong>' + escHtml(platLabel) + '</strong></div>' +
      '<div>Motor Ativo: <strong style="color:#38BDF8;">' + escHtml(diag.engine || 'NativeEngine') + '</strong> (' + escHtml(diag.attemptedChain || '-') + ')</div>' +
      '<div>TTFF (1º Quadro): <strong>' + Number(diag.ttffMs || 0) + ' ms</strong> · Reconexões: <strong>' + Number(diag.reconnections || 0) + '</strong></div>' +
      '<div>Nós no DOM: <strong style="color:#22C55E;">' + domCount + '</strong> · RAM Catálogo: <strong>~' + estMemMb + ' MB</strong> (' + itemsCount + ' itens)</div>' +
      '<div>Geração IDB: <strong>' + escHtml(diag.catalogGeneration || '-') + '</strong> · Desempenho: <strong style="color:' + (isLite ? '#F59E0B' : '#22C55E') + ';">' + (isLite ? 'MODO LEVE' : 'PADRÃO 60fps') + '</strong></div>' +
      '<div style="color:#FCA5A5;font-size:15px;margin-top:4px;">Último erro: ' + escHtml(diag.lastError || 'Nenhum') + '</div>' +
      '<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;">' + (logHtml || '<div style="font-size:15px;color:#94A3B8;">Log limpo · Sem erros recentes</div>') + '</div>';
  }

  function sortItems(list, mode) {
    var copy = list.slice();
    if (mode === 'name') {
      copy.sort(function (a, b) { return (a.cleanTitle || '').localeCompare(b.cleanTitle || ''); });
    } else if (mode === 'rating') {
      copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    } else if (mode === 'year') {
      copy.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
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

  // Renderiza capa/logo com lazy-load e fallback automático para monograma em caso de erro de imagem (Seção 4.3)
  function renderPosterVisual(item, themeCls) {
    var mono = escHtml((item.cleanTitle || 'TV').slice(0, 2).toUpperCase());
    var badgeRight = item.totalEpisodes ? (item.totalEpisodes + ' eps') : escHtml(item.quality || 'FHD');
    var recentMap = global.LuminaStore.get('recentAddedIds') || {};
    var isNew = !!recentMap[item.id];
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var pr = progMap[item.id];
    var progStrip = (pr && pr.percent > 0 && !pr.completed)
      ? '<div class="poster-progress-strip"><div class="poster-progress-fill" style="width:' + Math.min(100, Number(pr.percent || 0)) + '%;"></div></div>'
      : '';

    var imgTag = item.logo
      ? '<img class="poster-img" src="' + escAttr(item.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';

    return (
      '<div class="poster-art ' + themeCls + '">' +
        imgTag +
        '<div class="poster-badge-top">' +
          '<span>' + (isNew ? '<span class="badge-new" style="margin-right:6px;">NOVO</span>' : '') + '<span class="badge-pill">' + badgeRight + '</span></span>' +
          (item.rating ? '<span class="badge-rating">★ ' + escHtml(item.rating) + '</span>' : '') +
        '</div>' +
        '<div class="poster-monogram">' + mono + '</div>' +
        '<div style="font-size:17px;color:rgba(255,255,255,0.78);">' + escHtml(item.year || 2024) + ' · ' + escHtml(item.lang || 'DUB') + '</div>' +
        progStrip +
      '</div>'
    );
  }

  function renderSideNav(activeRoute) {
    if (typeof document === 'undefined') return;
    var nav = document.getElementById('side-nav');
    if (!nav) return;
    if (activeRoute === 'player-fullscreen') {
      nav.classList.add('hidden');
      return;
    }
    nav.classList.remove('hidden');

    var unclassCount = (global.LuminaStore.get('unclassifiedList') || []).length;
    var hasAppUpdate = !!(global.LuminaStore.get('appUpdateInfo') && global.LuminaStore.get('appUpdateInfo').hasUpdate);

    var items = [
      { route: 'home', label: 'Início', iconId: 'icon-home' },
      { route: 'search', label: 'Busca', iconId: 'icon-search' },
      { route: 'live', label: 'Canais', iconId: 'icon-live' },
      { route: 'movies', label: 'Filmes', iconId: 'icon-movies' },
      { route: 'series', label: 'Séries', iconId: 'icon-series' },
      { route: 'novelas', label: 'Novelas', iconId: 'icon-novelas' },
      { route: 'continue', label: 'Continuar', iconId: 'icon-continue' },
      { route: 'favorites', label: 'Favoritos', iconId: 'icon-favorites' },
      { route: 'organizer', label: unclassCount > 0 ? ('Organizar (' + unclassCount + ')') : 'Organizar', iconId: 'icon-organizer' },
      { route: 'onboarding', label: 'Parear / Fontes', iconId: 'icon-phone' },
      { route: 'settings', label: hasAppUpdate ? 'Ajustes ●' : 'Ajustes', iconId: 'icon-settings' }
    ];

    var html =
      '<div>' +
        '<div class="brand-header">' +
          '<div class="brand-mark">L</div>' +
          '<div class="brand-title">Lumina TV</div>' +
        '</div>' +
        '<div class="nav-list">';

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var activeCls = (activeRoute === it.route) ? ' is-active' : '';
      html +=
        '<div id="nav-' + it.route + '" class="nav-item focusable' + activeCls + '" data-nav="' + escAttr(it.route) + '" data-scope="nav">' +
          '<span style="width:28px;display:inline-flex;align-items:center;justify-content:center;"><svg class="ui-icon"><use href="#' + escAttr(it.iconId) + '"/></svg></span>' +
          '<span class="nav-label">' + escHtml(it.label) + '</span>' +
        '</div>';
    }
    html += '</div></div>';
    nav.innerHTML = html;
  }

  // ── 1. Tela Inicial (Hero + Carrosséis Horizontais) ──
  function renderHome(viewport) {
    var allItems = global.LuminaStore.get('items') || [];
    var allChannels = global.LuminaStore.get('channels') || [];
    var allMovies = global.LuminaStore.get('movies') || [];
    var series = global.LuminaStore.get('seriesList') || [];
    var novelas = global.LuminaStore.get('novelasList') || [];
    var unclass = global.LuminaStore.get('unclassifiedList') || [];

    var items = allItems.length ? filterAdultForPublicViews(allItems.slice(0, 30)) : [];
    var channels = allChannels.length ? filterAdultForPublicViews(allChannels.slice(0, 30)) : [];
    var movies = allMovies.length ? filterAdultForPublicViews(allMovies.slice(0, 30)) : [];
    var publicSeries = series.length ? filterAdultForPublicViews(series.slice(0, 20)) : [];
    var publicNovelas = novelas.length ? filterAdultForPublicViews(novelas.slice(0, 20)) : [];

    var platName = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Smart TV';
    var accInfo = global.LuminaStore.get('accountInfo');
    var expBanner = '';
    if (accInfo && accInfo.isExpiringSoon && accInfo.daysRemaining != null) {
      expBanner =
        '<div style="background:rgba(245,158,11,0.18);border:1px solid var(--accent-amber);border-radius:var(--radius-md);padding:10px 18px;margin-bottom:14px;font-size:19px;color:#FDE68A;">' +
          '⚠ Sua assinatura Xtream vence em <strong>' + Number(accInfo.daysRemaining) + ' dia(s)</strong> (' + escHtml(accInfo.expDate || '') + '). Confira em Ajustes → Minha Conta.' +
        '</div>';
    }

    if (!allItems.length && !unclass.length) {
      viewport.innerHTML =
        '<div style="display:flex;flex-direction:column;justify-content:center;height:840px;max-width:1380px;">' +
          '<div style="font-size:20px;color:var(--accent-cyan);font-weight:700;letter-spacing:2px;margin-bottom:10px;">LUMINA TV v1.6.0 · ' + escHtml(platName.toUpperCase()) + '</div>' +
          '<div class="empty-state-panel">' +
            '<div class="empty-state-illustration">' +
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 150" style="width:100%;height:100%;">' +
                '<rect x="10" y="14" width="150" height="104" rx="14" fill="#131B2E" stroke="#38BDF8" stroke-width="2.5"/>' +
                '<polygon points="74,50 106,66 74,82" fill="#38BDF8"/>' +
                '<rect x="182" y="26" width="64" height="106" rx="10" fill="#131B2E" stroke="#F59E0B" stroke-width="2.5"/>' +
                '<rect x="196" y="46" width="36" height="36" rx="4" fill="rgba(245,158,11,0.25)" stroke="#F59E0B" stroke-width="1.8"/>' +
                '<circle cx="214" cy="116" r="4" fill="#F59E0B"/>' +
                '<path d="M164 66 H178" stroke="#38BDF8" stroke-width="2.5" stroke-dasharray="4 4"/>' +
              '</svg>' +
            '</div>' +
            '<div>' +
              '<h1 style="font-size:42px;margin-bottom:12px;">Envie sua lista pelo Celular ou conecte uma fonte</h1>' +
              '<p style="color:var(--text-secondary);font-size:22px;margin-bottom:26px;">Use o pareamento rápido por código/QR Code no celular (criptografia ponta-a-ponta via Surubim Pairing) para carregar sua lista M3U ou login Xtream Codes.</p>' +
              '<div>' +
                '<button id="home-btn-phone" class="btn btn-primary focusable" data-action="go-phone-pairing" data-scope="home">📱 Parear pelo Celular (Código / QR)</button>' +
                '<button id="home-btn-xtream" class="btn focusable" data-action="go-onboarding" data-scope="home">Fontes & Atualização</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('home', '#home-btn-phone');
      return;
    }

    var highlights = [].concat(movies.slice(0, 2), publicSeries.slice(0, 2), publicNovelas.slice(0, 1));
    if (!highlights.length) highlights = items.slice(0, 3);
    if (!highlights.length && unclass.length) highlights = unclass.slice(0, 1);

    var bIdx = (global.LuminaStore.get('heroBannerIndex') || 0) % highlights.length;
    var hero = highlights[bIdx];
    var isHeroFav = global.LuminaStore.isFavorite(hero.id);

    var dotsHtml = '';
    for (var d = 0; d < highlights.length; d++) {
      dotsHtml += '<div class="hero-dot' + (d === bIdx ? ' is-active' : '') + '"></div>';
    }

    var heroPlayAttr = (hero.kind === 'series-show' || hero.kind === 'novela-show')
      ? ('data-detail-id="' + escAttr(hero.id) + '"')
      : (hero.kind === 'live' ? ('data-play-id="' + escAttr(hero.id) + '"') : ('data-play-vod="' + escAttr(hero.id) + '"'));

    var heroSynopsis = hero.synopsis
      ? ('Sinopse: ' + hero.synopsis)
      : ((hero.quality ? 'Qualidade ' + hero.quality + ' · ' : '') +
         (hero.rating ? 'Nota ★ ' + hero.rating + ' · ' : '') +
         (hero.lang ? 'Idioma ' + hero.lang + ' · ' : '') +
         'Catálogo com ' + allChannels.length + ' canais, ' + allMovies.length + ' filmes, ' + series.length + ' séries e ' + novelas.length + ' novelas.');

    var html =
      '<div class="home-scroll-area">' +
        expBanner +
        '<div class="hero-banner">' +
          '<div class="hero-top-meta">' +
            '<div style="color:var(--accent-cyan);font-size:19px;font-weight:700;letter-spacing:1.5px;">DESTAQUE (' + (bIdx + 1) + '/' + highlights.length + ') · ' + escHtml((hero.groupDisplay || hero.groupOriginal || '').toUpperCase()) + (hero.tmdbEnriched ? ' · ✓ TMDB' : '') + '</div>' +
            '<div class="hero-dots">' + dotsHtml + '</div>' +
          '</div>' +
          '<div>' +
            '<h1 style="font-size:42px;margin-bottom:6px;">' + escHtml(hero.cleanTitle) + ' (' + escHtml(hero.year || 2024) + ')</h1>' +
            '<p style="color:var(--text-secondary);font-size:21px;max-width:1240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(heroSynopsis) + '</p>' +
          '</div>' +
          '<div>' +
            '<button id="home-hero-play" class="btn btn-primary focusable" ' + heroPlayAttr + ' data-scope="home">▶ Assistir Agora</button>' +
            '<button id="home-hero-info" class="btn focusable" data-detail-id="' + escAttr(hero.id) + '" data-scope="home">ℹ Mais Informações</button>' +
            '<button id="home-hero-fav" class="btn focusable" data-fav-id="' + escAttr(hero.id) + '" data-scope="home">' + (isHeroFav ? '♥ Favorito' : '♡ Favoritar') + '</button>' +
            '<button id="home-hero-next" class="btn focusable" data-action="next-banner" data-scope="home">Próximo ↻</button>' +
          '</div>' +
        '</div>';

    var continueList = getContinueWatchingItems();
    var favMap = global.LuminaStore.get('favorites') || {};
    var byId = global.LuminaStore.get('itemByIdMap') || {};
    var favKeys = Object.keys(favMap);
    var favItems = [];
    for (var fk = 0; fk < favKeys.length && favItems.length < 10; fk++) {
      var fIt = byId[favKeys[fk]];
      if (fIt && !isItemLockedByParental(fIt)) favItems.push(fIt);
    }

    var rowsSpec = [];
    if (continueList.length) {
      rowsSpec.push({
        id: 'continue',
        title: 'Continuar Assistindo (' + continueList.length + ')',
        cards: continueList.slice(0, 6).map(function (entry) {
          return {
            id: entry.item.id,
            title: entry.item.cleanTitle,
            sub: 'Retomar em ' + Number(entry.progress.percent || 0) + '%',
            badge: Number(entry.progress.percent || 0) + '%',
            attr: 'data-play-vod="' + escAttr(entry.item.id) + '"',
            cls: 'kind-continue'
          };
        })
      });
    }

    if (favItems.length) {
      rowsSpec.push({
        id: 'favs',
        title: 'Meus Favoritos ★ (' + favItems.length + ')',
        cards: favItems.slice(0, 6).map(function (it) {
          var attr = it.kind === 'live' ? ('data-play-id="' + escAttr(it.id) + '"') : ('data-detail-id="' + escAttr(it.id) + '"');
          return {
            id: it.id,
            title: it.cleanTitle,
            sub: it.groupMapped || it.groupDisplay || '',
            badge: '★',
            attr: attr,
            cls: 'kind-novela'
          };
        })
      });
    }

    if (channels.length) {
      rowsSpec.push({
        id: 'live',
        title: 'Canais ao Vivo (' + allChannels.length + ')',
        cards: channels.slice(0, 6).map(function (ch) {
          return {
            id: ch.id,
            title: '#' + Number(ch.channelNumber || 1) + ' ' + ch.cleanTitle,
            sub: ch.epgNow || ch.groupDisplay || ch.groupOriginal,
            badge: ch.quality || 'HD',
            attr: 'data-play-id="' + escAttr(ch.id) + '"',
            cls: 'kind-movie'
          };
        })
      });
    }

    if (movies.length) {
      rowsSpec.push({
        id: 'movies',
        title: 'Filmes Adicionados Recentemente (' + allMovies.length + ')',
        cards: movies.slice(0, 6).map(function (mv) {
          return {
            id: mv.id,
            title: mv.cleanTitle,
            sub: (mv.year || 2024) + ' · ★ ' + mv.rating,
            badge: mv.quality || 'FHD',
            attr: 'data-detail-id="' + escAttr(mv.id) + '"',
            cls: 'kind-movie'
          };
        })
      });
    }

    if (publicSeries.length || publicNovelas.length) {
      var combinedShows = publicSeries.slice(0, 4).concat(publicNovelas.slice(0, 2));
      rowsSpec.push({
        id: 'shows',
        title: 'Séries & Novelas em Destaque (' + (series.length + novelas.length) + ')',
        cards: combinedShows.map(function (sh) {
          var epCountLabel = sh.needsSeriesInfo ? 'Sob demanda' : (Number(sh.totalEpisodes || 0) + ' eps');
          return {
            id: sh.id,
            title: sh.cleanTitle,
            sub: (sh.isNovela ? 'Novela' : 'Série') + ' · ' + epCountLabel,
            badge: '★ ' + sh.rating,
            attr: 'data-detail-id="' + escAttr(sh.id) + '"',
            cls: sh.isNovela ? 'kind-novela' : 'kind-series'
          };
        })
      });
    }

    var visibleRows = rowsSpec.slice(0, 3);
    for (var r = 0; r < visibleRows.length; r++) {
      var row = visibleRows[r];
      html += '<div class="home-row-block"><div class="home-row-title">' + escHtml(row.title) + '</div><div class="home-row-strip">';
      for (var c = 0; c < row.cards.length; c++) {
        var card = row.cards[c];
        html +=
          '<div id="home-row-' + escAttr(row.id) + '-' + c + '" class="mini-card ' + escAttr(card.cls) + ' focusable" ' + card.attr + ' data-scope="home">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-size:21px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:185px;">' + escHtml(card.title) + '</span>' +
              '<span class="badge-pill" style="font-size:15px;">' + escHtml(card.badge) + '</span>' +
            '</div>' +
            '<div style="font-size:18px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(card.sub) + '</div>' +
          '</div>';
      }
      html += '</div></div>';
    }

    html += '</div>';
    viewport.innerHTML = html;
    global.LuminaFocus.restoreOrDefault('home', '#home-hero-play');
  }

  // ── 2. Canais ao Vivo (3 Colunas com Virtualização + Logo + EPG + Mini-Preview) ──
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

    // Janela virtualizada de categorias (esquerda)
    var maxCatStart = Math.max(0, categories.length - LIVE_CAT_WIN_SIZE);
    if (liveCatWindowStart > maxCatStart) liveCatWindowStart = maxCatStart;
    if (liveCatWindowStart < 0) liveCatWindowStart = 0;

    var catHtml = '';
    var catEnd = Math.min(categories.length, liveCatWindowStart + LIVE_CAT_WIN_SIZE);
    for (var k = liveCatWindowStart; k < catEnd; k++) {
      var cat = categories[k];
      var slotIdx = k - liveCatWindowStart;
      var selCls = (cat.name === selectedLiveCat) ? ' is-selected' : '';
      var isAdultCat = /adult|\+18|xxx/i.test(cat.name);
      catHtml +=
        '<div id="live-cat-slot-' + slotIdx + '" class="cat-item focusable' + selCls + '" ' +
             'data-vlist="live-cats" data-vindex="' + k + '" data-vtotal="' + categories.length + '" ' +
             'data-cat-name="' + escAttr(cat.name) + '" data-scope="live">' +
          '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">' + (isAdultCat ? '🔒 ' : '') + escHtml(cat.name) + '</span>' +
          '<span class="cat-count">' + Number(cat.count || 0) + '</span>' +
        '</div>';
    }

    // Janela virtualizada de canais (centro)
    var maxChStart = Math.max(0, filtered.length - LIVE_CH_WIN_SIZE);
    if (liveChWindowStart > maxChStart) liveChWindowStart = maxChStart;
    if (liveChWindowStart < 0) liveChWindowStart = 0;

    var chHtml = '';
    var chEnd = Math.min(filtered.length, liveChWindowStart + LIVE_CH_WIN_SIZE);
    for (var j = liveChWindowStart; j < chEnd; j++) {
      var item = filtered[j];
      var chSlot = j - liveChWindowStart;
      var isFav = global.LuminaStore.isFavorite(item.id);
      var mono = escHtml((item.cleanTitle || 'TV').slice(0, 2).toUpperCase());
      var logoInner = item.logo
        ? '<img class="channel-logo-img" src="' + escAttr(item.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : mono;

      chHtml +=
        '<div id="live-ch-slot-' + chSlot + '" class="channel-row-item focusable" ' +
             'data-vlist="live-channels" data-vindex="' + j + '" data-vtotal="' + filtered.length + '" ' +
             'data-channel-id="' + escAttr(item.id) + '" data-scope="live">' +
          '<div class="channel-num">#' + Number(item.channelNumber || (j + 1)) + '</div>' +
          '<div class="channel-logo-box">' + logoInner + '</div>' +
          '<div class="channel-info">' +
            '<div class="channel-name">' + escHtml(item.cleanTitle) + '</div>' +
            '<div class="channel-epg">' + escHtml(item.epgNow || (item.groupDisplay || item.groupOriginal)) + ' · ' + escHtml(item.quality || 'HD') + '</div>' +
          '</div>' +
          (isFav ? '<div class="fav-badge">★</div>' : '') +
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
      '<div>' +
        '<div class="screen-header-row">' +
          '<div>' +
            '<h1 class="screen-title">Canais ao Vivo</h1>' +
            '<p class="screen-subtitle" style="margin-bottom:0;">Categoria: ' + escHtml(selectedLiveCat) + ' · Use CH+/CH- para pular páginas de canais</p>' +
          '</div>' +
          '<div class="pagination-pill">Canais ' + (filtered.length ? (liveChWindowStart + 1) : 0) + '–' + chEnd + ' de ' + filtered.length + '</div>' +
        '</div>' +
        '<div class="live-layout">' +
          '<div class="live-cats">' + catHtml + '</div>' +
          '<div class="live-channels">' + (chHtml || '<p style="color:var(--text-secondary);">Nenhum canal nesta categoria.</p>') + '</div>' +
          '<div class="live-preview-pane">' +
            (activeCh ? (
              '<div class="preview-stage-box">' +
                '<div style="font-size:20px;color:var(--accent-cyan);font-weight:700;margin-bottom:8px;">CANAL #' + Number(activeCh.channelNumber || 1) + ' · ' + escHtml(activeCh.quality || 'HD') + '</div>' +
                '<div style="font-size:32px;font-weight:800;margin-bottom:10px;">' + escHtml(activeCh.cleanTitle) + '</div>' +
                '<div style="color:var(--text-primary);font-size:21px;margin-bottom:6px;">Agora: ' + escHtml(activeCh.epgNow || 'Transmissão Ao Vivo') + '</div>' +
                '<div style="color:var(--text-secondary);font-size:18px;">A seguir: ' + escHtml(activeCh.epgNext || 'Programação Contínua') + '</div>' +
                '<div style="color:var(--text-muted);font-size:17px;margin-top:12px;">Grupo: ' + escHtml(activeCh.groupDisplay || activeCh.groupOriginal) + '</div>' +
              '</div>' +
              '<div>' +
                '<div style="display:flex;margin-bottom:10px;">' +
                  '<button id="btn-fullscreen-live" class="btn btn-primary focusable" data-play-id="' + escAttr(activeCh.id) + '" data-scope="live">▶ Assistir Tela Cheia</button>' +
                  '<button id="btn-fav-live" class="btn focusable" data-fav-id="' + escAttr(activeCh.id) + '" data-scope="live">' + (isPreviewFav ? '♥ Favorito' : '♡ Favoritar') + '</button>' +
                '</div>' +
                '<div style="display:flex;">' +
                  '<button id="btn-live-pgup" class="btn btn-sm focusable" data-action="live-page-prev" data-scope="live">▲ Página Anterior</button>' +
                  '<button id="btn-live-pgdn" class="btn btn-sm focusable" data-action="live-page-next" data-scope="live">▼ Próxima Página</button>' +
                  '<button id="btn-last-ch" class="btn btn-sm focusable" data-action="last-channel" data-scope="live">↺ Último Canal</button>' +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('live', '#live-ch-slot-0');
  }

  // ── 3. Grade Virtualizada de Filmes / Séries / Novelas (com Filtros + Barra A-Z + Capas Reais) ──
  function renderPosterCatalog(viewport, sectionType) {
    var title = 'Filmes';
    var subtitle = 'Grade virtualizada 2:3 com capas, filtros e salto rápido A–Z (CH+/CH− pula página)';
    var list = [];
    var cats = [];
    var activeCat = '';
    var allLabel = '';
    var themeCls = 'theme-movie';

    if (sectionType === 'movies') {
      title = 'Filmes VOD';
      list = global.LuminaStore.get('movies') || [];
      cats = global.LuminaStore.get('movieCategories') || [];
      allLabel = 'Todos os Filmes';
      activeCat = selectedMovieCat;
      themeCls = 'theme-movie';
    } else if (sectionType === 'series') {
      title = 'Séries';
      subtitle = 'Temporadas e episódios organizados automaticamente · CH+/CH− pula página';
      list = global.LuminaStore.get('seriesList') || [];
      cats = global.LuminaStore.get('seriesCategories') || [];
      allLabel = 'Todas as Séries';
      activeCat = selectedSeriesCat;
      themeCls = 'theme-series';
    } else {
      title = 'Novelas';
      subtitle = 'Coleção virtual dedicada a novelas e folhetins · CH+/CH− pula página';
      list = global.LuminaStore.get('novelasList') || [];
      cats = global.LuminaStore.get('novelaCategories') || [];
      allLabel = 'Todas as Novelas';
      activeCat = selectedNovelaCat;
      themeCls = 'theme-novela';
    }

    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (isItemLockedByParental(it)) continue;
      var g = it.groupDisplay || it.groupOriginal;
      if (activeCat !== allLabel && g !== activeCat) continue;
      if (currentLangFilter !== 'ALL' && (it.lang || 'DUB') !== currentLangFilter) continue;
      if (currentQualityFilter !== 'ALL' && (it.quality || 'FHD') !== currentQualityFilter) continue;
      if (currentLetterFilter !== 'ALL') {
        var firstCh = String(it.cleanTitle || '').trim().charAt(0).toUpperCase();
        if (firstCh !== currentLetterFilter) continue;
      }
      filtered.push(it);
    }
    filtered = sortItems(filtered, currentSort);

    var winStart = posterWindowStart[sectionType] || 0;
    var maxStart = Math.max(0, Math.floor((filtered.length - 1) / POSTER_COLS) * POSTER_COLS - POSTER_COLS);
    if (winStart > maxStart) winStart = maxStart;
    if (winStart < 0) winStart = 0;
    posterWindowStart[sectionType] = winStart;

    var catChips = '';
    var maxCats = Math.min(cats.length, 6);
    for (var c = 0; c < maxCats; c++) {
      var cat = cats[c];
      var sel = (cat.name === activeCat) ? ' is-selected' : '';
      catChips +=
        '<div id="cat-chip-' + c + '" class="chip focusable' + sel + '" data-cat-section="' + escAttr(sectionType) + '" data-cat-val="' + escAttr(cat.name) + '" data-scope="' + escAttr(sectionType) + '">' +
          escHtml(cat.name) + ' (' + Number(cat.count || 0) + ')' +
        '</div>';
    }

    var sortChips =
      '<div class="chip-row">' +
        '<div id="sort-recent" class="chip focusable' + (currentSort === 'recent' ? ' is-selected' : '') + '" data-sort="recent" data-scope="' + escAttr(sectionType) + '">Recentes</div>' +
        '<div id="sort-name" class="chip focusable' + (currentSort === 'name' ? ' is-selected' : '') + '" data-sort="name" data-scope="' + escAttr(sectionType) + '">A–Z</div>' +
        '<div id="sort-rating" class="chip focusable' + (currentSort === 'rating' ? ' is-selected' : '') + '" data-sort="rating" data-scope="' + escAttr(sectionType) + '">Nota ★</div>' +
        '<div id="flt-lang" class="chip focusable' + (currentLangFilter !== 'ALL' ? ' is-selected' : '') + '" data-action="cycle-lang-filter" data-scope="' + escAttr(sectionType) + '">Idioma: ' + escHtml(currentLangFilter) + '</div>' +
      '</div>';

    var azHtml = '<div class="az-bar">';
    for (var lIdx = 0; lIdx < LETTERS_BAR.length; lIdx++) {
      var ltr = LETTERS_BAR[lIdx];
      var lSel = (currentLetterFilter === ltr) ? ' is-selected' : '';
      azHtml +=
        '<div id="az-' + ltr + '" class="az-chip focusable' + lSel + '" data-letter="' + escAttr(ltr) + '" data-scope="' + escAttr(sectionType) + '">' +
          (ltr === 'ALL' ? 'Todos' : ltr) +
        '</div>';
    }
    azHtml += '</div>';

    var cardsHtml = '';
    var winEnd = Math.min(filtered.length, winStart + POSTER_WIN_SIZE);
    for (var j = winStart; j < winEnd; j++) {
      var item = filtered[j];
      var slot = j - winStart;
      cardsHtml +=
        '<div id="poster-' + sectionType + '-slot-' + slot + '" class="poster-card focusable" ' +
             'data-vlist="poster-' + escAttr(sectionType) + '" data-vindex="' + j + '" data-vtotal="' + filtered.length + '" ' +
             'data-detail-id="' + escAttr(item.id) + '" data-scope="' + escAttr(sectionType) + '">' +
          renderPosterVisual(item, themeCls) +
          '<div class="poster-meta">' +
            '<div class="poster-title">' + escHtml(item.cleanTitle) + '</div>' +
            '<div class="poster-sub">' + escHtml(item.groupDisplay || item.groupOriginal) + '</div>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<div class="screen-header-row">' +
          '<div>' +
            '<h1 class="screen-title">' + escHtml(title) + '</h1>' +
            '<p class="screen-subtitle" style="margin-bottom:0;">' + escHtml(subtitle) + '</p>' +
          '</div>' +
          '<div class="pagination-pill">Exibindo ' + (filtered.length ? (winStart + 1) : 0) + '–' + winEnd + ' de ' + filtered.length + '</div>' +
        '</div>' +
        '<div class="filter-bar">' +
          '<div class="chip-row">' + catChips + '</div>' +
          sortChips +
        '</div>' +
        azHtml +
        '<div class="poster-grid">' + (cardsHtml || '<p style="color:var(--text-secondary);font-size:22px;">Nenhum título encontrado para este filtro.</p>') + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault(sectionType, '#poster-' + sectionType + '-slot-0');
  }

  // ── 4. Tela de Detalhe (com Hidratação Sob Demanda de Séries Xtream via get_series_info, B3) ──
  function renderDetail(viewport) {
    var item = global.LuminaStore.get('selectedDetailItem');
    if (!item) {
      global.LuminaRouter.navigate('home');
      return;
    }

    var isShow = (item.kind === 'series-show' || item.kind === 'novela-show');
    var isFav = global.LuminaStore.isFavorite(item.id);
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var mono = escHtml((item.cleanTitle || 'TV').slice(0, 2).toUpperCase());
    var themeCls = item.isNovela ? 'theme-novela' : (isShow ? 'theme-series' : 'theme-movie');
    var posterImgHtml = item.logo
      ? '<img class="poster-img" src="' + escAttr(item.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';

    if (!isShow) {
      var pr = progMap[item.id];
      var resumeLabel = (pr && pr.position > 5 && !pr.completed)
        ? ('▶ Continuar (' + Number(pr.percent || 0) + '%)')
        : (pr && pr.completed ? '↺ Assistir Novamente (✓ Assistido)' : '▶ Assistir Agora');

      viewport.innerHTML =
        '<div>' +
          '<div class="detail-hero">' +
            '<div class="detail-poster-box ' + themeCls + '">' + posterImgHtml + '<span>' + mono + '</span></div>' +
            '<div class="detail-info">' +
              '<div>' +
                '<div style="color:var(--accent-cyan);font-size:20px;font-weight:700;">' + (item.kind === 'live' ? 'CANAL AO VIVO' : 'FILME VOD · CATÁLOGO PESSOAL') + '</div>' +
                '<h1 style="font-size:44px;margin:6px 0;">' + escHtml(item.cleanTitle) + '</h1>' +
                '<div class="detail-meta-row">' +
                  '<span class="detail-meta-tag">' + escHtml(item.year || 2024) + '</span>' +
                  '<span class="detail-meta-tag">' + escHtml(item.quality || 'FHD') + '</span>' +
                  '<span class="detail-meta-tag">' + escHtml(item.lang || 'DUB') + '</span>' +
                  (item.rating ? '<span class="detail-meta-tag" style="color:var(--accent-amber);">★ ' + escHtml(item.rating) + '</span>' : '') +
                '</div>' +
                '<p style="color:var(--text-secondary);font-size:22px;max-width:1100px;">' +
                  escHtml(item.synopsis || ('Grupo: ' + (item.groupDisplay || item.groupOriginal) + '. Reprodução com retomada automática do ponto exato e marcação de concluído aos 95%.')) +
                '</p>' +
              '</div>' +
              '<div style="margin-top:24px;">' +
                '<button id="detail-btn-play" class="btn btn-primary focusable" ' + (item.kind === 'live' ? ('data-play-id="' + escAttr(item.id) + '"') : ('data-play-vod="' + escAttr(item.id) + '"')) + ' data-scope="detail">' + escHtml(resumeLabel) + '</button>' +
                '<button id="detail-btn-fav" class="btn focusable" data-fav-id="' + escAttr(item.id) + '" data-scope="detail">' + (isFav ? '♥ Nos Favoritos' : '♡ Favoritar') + '</button>' +
                '<button id="detail-btn-back" class="btn focusable" data-action="back" data-scope="detail">Voltar</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('detail', '#detail-btn-play');
      return;
    }

    // Se a série veio do Xtream e ainda precisa buscar as temporadas reais via get_series_info (B3)
    if (item.needsSeriesInfo) {
      var detailLoading = global.LuminaStore.get('detailLoading');
      var detailError = global.LuminaStore.get('detailError');

      if (!detailLoading && !detailError) {
        global.LuminaStore.set('detailLoading', true);
        var creds = global.LuminaStore.get('xtreamCreds');
        global.LuminaXtream.fetchSeriesInfo(creds, item, function (err) {
          global.LuminaStore.set('detailLoading', false);
          if (err) {
            global.LuminaStore.set('detailError', err.message || 'Falha ao buscar episódios.');
          } else {
            global.LuminaStore.set('detailError', null);
          }
          if (global.LuminaRouter.getCurrent() === 'detail') {
            renderCurrentRoute();
          }
        });
      }

      viewport.innerHTML =
        '<div>' +
          '<div class="detail-hero">' +
            '<div class="detail-poster-box ' + themeCls + '">' + posterImgHtml + '<span>' + mono + '</span></div>' +
            '<div class="detail-info">' +
              '<div>' +
                '<div style="color:var(--accent-cyan);font-size:19px;font-weight:700;">' + (item.isNovela ? 'NOVELA' : 'SÉRIE') + ' · TEMPORADAS SOB DEMANDA</div>' +
                '<h1 style="font-size:40px;margin:6px 0;">' + escHtml(item.cleanTitle) + '</h1>' +
                (detailError
                  ? '<p style="color:#F87171;font-size:22px;margin-top:12px;">⚠ ' + escHtml(detailError) + '</p>'
                  : '<p style="color:var(--accent-cyan);font-size:23px;margin-top:12px;">⟳ Buscando temporadas e episódios reais no servidor...</p>') +
              '</div>' +
              '<div style="margin-top:20px;">' +
                (detailError ? '<button id="detail-btn-retry-series" class="btn btn-primary focusable" data-action="retry-series-info" data-scope="detail">↻ Tentar Novamente</button>' : '') +
                '<button id="detail-btn-back" class="btn focusable" data-action="back" data-scope="detail">Voltar</button>' +
              '</div>' +
            '</div>' +
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

    var seasonTabs = '';
    for (var st = 0; st < seasons.length; st++) {
      var sn = seasons[st].seasonNumber;
      var sCls = (sn === selSeason) ? ' is-selected' : '';
      seasonTabs +=
        '<div id="season-tab-' + sn + '" class="chip focusable' + sCls + '" data-season-num="' + sn + '" data-scope="detail">' +
          'Temporada ' + sn + ' (' + (seasons[st].episodes || []).length + ' eps)' +
        '</div>';
    }

    var maxEpStart = Math.max(0, activeEpisodes.length - DETAIL_EP_WIN_SIZE);
    if (detailEpWindowStart > maxEpStart) detailEpWindowStart = maxEpStart;
    if (detailEpWindowStart < 0) detailEpWindowStart = 0;

    var epRows = '';
    var epEnd = Math.min(activeEpisodes.length, detailEpWindowStart + DETAIL_EP_WIN_SIZE);
    var resumeEp = activeEpisodes[0] || null;
    for (var rIdx = 0; rIdx < activeEpisodes.length; rIdx++) {
      var candEp = activeEpisodes[rIdx];
      var cPr = progMap[candEp.id];
      if (cPr && cPr.percent > 0 && !cPr.completed) {
        resumeEp = candEp;
        break;
      }
    }

    for (var e = detailEpWindowStart; e < epEnd; e++) {
      var ep = activeEpisodes[e];
      var epSlot = e - detailEpWindowStart;
      var epProg = progMap[ep.id] || { percent: 0, completed: false };
      var statusBadge = epProg.completed
        ? '<span style="color:var(--accent-success);font-weight:700;margin-right:16px;">✓ Assistido</span>'
        : (epProg.percent > 0 ? '<span style="color:var(--accent-cyan);margin-right:16px;">Em andamento (' + Number(epProg.percent) + '%)</span>' : '<span style="color:var(--text-muted);margin-right:16px;">Não iniciado</span>');

      epRows +=
        '<div id="ep-row-slot-' + epSlot + '" class="episode-row focusable" ' +
             'data-vlist="detail-episodes" data-vindex="' + e + '" data-vtotal="' + activeEpisodes.length + '" ' +
             'data-play-ep="' + escAttr(ep.id) + '" data-scope="detail">' +
          '<div style="display:flex;align-items:center;overflow:hidden;">' +
            '<span style="font-family:var(--font-mono);color:var(--accent-cyan);font-weight:700;width:98px;flex-shrink:0;">T' + Number(ep.season || 1) + ':E' + Number(ep.episode || (e + 1)) + '</span>' +
            '<span style="font-weight:600;font-size:23px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(ep.cleanTitle) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;flex-shrink:0;">' +
            statusBadge +
            '<span class="badge-pill">' + escHtml(ep.quality || 'FHD') + '</span>' +
            '<div class="ep-progress-bar"><div class="ep-progress-fill" style="width:' + Number(epProg.percent || 0) + '%;"></div></div>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<div class="detail-hero" style="padding:24px;margin-bottom:14px;">' +
          '<div class="detail-poster-box ' + themeCls + '" style="width:170px;height:240px;font-size:42px;">' + posterImgHtml + '<span>' + mono + '</span></div>' +
          '<div class="detail-info">' +
            '<div>' +
              '<div style="color:var(--accent-cyan);font-size:18px;font-weight:700;">' + (item.isNovela ? 'NOVELA · COLEÇÃO POR CAPÍTULOS' : 'SÉRIE · TEMPORADAS E EPISÓDIOS') + '</div>' +
              '<h1 style="font-size:38px;margin:4px 0;">' + escHtml(item.cleanTitle) + '</h1>' +
              '<div class="detail-meta-row">' +
                '<span class="detail-meta-tag">' + seasons.length + ' Temp.</span>' +
                '<span class="detail-meta-tag">' + Number(item.totalEpisodes || activeEpisodes.length) + ' Episódios</span>' +
                (item.rating ? '<span class="detail-meta-tag" style="color:var(--accent-amber);">★ ' + escHtml(item.rating) + '</span>' : '') +
              '</div>' +
              (item.synopsis ? '<p style="color:var(--text-secondary);font-size:19px;max-width:1100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(item.synopsis) + '</p>' : '') +
            '</div>' +
            '<div style="margin-top:10px;">' +
              (resumeEp ? '<button id="detail-btn-play-ep0" class="btn btn-primary focusable" data-play-ep="' + escAttr(resumeEp.id) + '" data-scope="detail">▶ Assistir T' + Number(resumeEp.season || 1) + ':E' + Number(resumeEp.episode || 1) + '</button>' : '') +
              '<button id="detail-btn-fav" class="btn focusable" data-fav-id="' + escAttr(item.id) + '" data-scope="detail">' + (isFav ? '♥ Nos Favoritos' : '♡ Favoritar') + '</button>' +
              '<button id="detail-btn-back" class="btn focusable" data-action="back" data-scope="detail">Voltar</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
          '<div class="chip-row">' + seasonTabs + '</div>' +
          '<div class="pagination-pill">Episódios ' + (activeEpisodes.length ? (detailEpWindowStart + 1) : 0) + '–' + epEnd + ' de ' + activeEpisodes.length + '</div>' +
        '</div>' +
        '<div class="episode-list">' + (epRows || '<p style="color:var(--text-secondary);">Nenhum episódio disponível nesta temporada.</p>') + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('detail', '#ep-row-slot-0');
  }

  // ── 5. Busca Global (com Relevância + Histórico de Buscas) ──
  function renderSearch(viewport) {
    var q = global.LuminaStore.get('searchQuery') || '';
    var history = global.LuminaStore.get('searchHistory') || [];
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

    var actionsHtml =
      '<div style="display:flex;margin-top:6px;">' +
        '<div id="kb-key-space" class="kb-key kb-wide focusable" data-kb-action="space" data-scope="search">ESPAÇO</div>' +
        '<div id="kb-key-back" class="kb-key kb-wide focusable" data-kb-action="backspace" data-scope="search">⌫ APAGAR</div>' +
        '<div id="kb-key-clear" class="kb-key kb-wide focusable" data-kb-action="clear" data-scope="search" style="margin-right:0;">LIMPAR</div>' +
      '</div>';

    var histHtml = '';
    if (history.length) {
      histHtml = '<div style="margin-top:14px;"><div style="font-size:18px;color:var(--text-secondary);margin-bottom:8px;">Buscas recentes:</div><div class="chip-row">';
      for (var h = 0; h < Math.min(history.length, 5); h++) {
        histHtml += '<div id="sr-hist-' + h + '" class="chip focusable" data-search-term="' + escAttr(history[h]) + '" data-scope="search">' + escHtml(history[h]) + '</div>';
      }
      histHtml += '</div></div>';
    }

    var resHtml = '';
    if (!q) {
      resHtml =
        '<div style="background:var(--bg-surface);border-radius:var(--radius-lg);padding:34px;height:100%;display:flex;flex-direction:column;justify-content:center;">' +
          '<h2 style="font-size:32px;margin-bottom:12px;">Busca Instantânea por Prefixo e Relevância</h2>' +
          '<p style="color:var(--text-secondary);font-size:22px;">Digite no teclado virtual ao lado para buscar simultaneamente em Canais ao Vivo, Filmes, Séries e Novelas, ignorando acentos e maiúsculas/minúsculas.</p>' +
          histHtml +
        '</div>';
    } else if (results.total === 0) {
      resHtml =
        '<div style="background:var(--bg-surface);border-radius:var(--radius-lg);padding:34px;">' +
          '<h2 style="font-size:30px;margin-bottom:10px;">Nenhum resultado para "' + escHtml(q) + '"</h2>' +
          '<p style="color:var(--text-secondary);">Tente outras letras ou selecione um termo recente abaixo.</p>' +
          histHtml +
        '</div>';
    } else {
      function renderSectionBlock(secId, secTitle, arr, isShowOrMovie) {
        if (!arr.length) return '';
        var s = '<div class="search-section-group"><div class="search-section-header">' + escHtml(secTitle) + ' (' + arr.length + ')</div><div class="home-row-strip">';
        var max = Math.min(arr.length, 4);
        for (var idx = 0; idx < max; idx++) {
          var it = arr[idx];
          var attr = isShowOrMovie ? ('data-detail-id="' + escAttr(it.id) + '"') : ('data-play-id="' + escAttr(it.id) + '"');
          s +=
            '<div id="sr-' + secId + '-' + idx + '" class="mini-card focusable" ' + attr + ' data-scope="search">' +
              '<div style="font-size:21px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(it.cleanTitle) + '</div>' +
              '<div style="font-size:18px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(it.groupDisplay || it.groupOriginal) + ' · ' + escHtml(it.quality || 'FHD') + '</div>' +
            '</div>';
        }
        s += '</div></div>';
        return s;
      }

      resHtml =
        renderSectionBlock('ch', 'Canais ao Vivo', results.channels, false) +
        renderSectionBlock('mv', 'Filmes VOD', results.movies, true) +
        renderSectionBlock('sr', 'Séries', results.series, true) +
        renderSectionBlock('nv', 'Novelas', results.novelas, true);
    }

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Busca Global no Catálogo</h1>' +
        '<p class="screen-subtitle">Resultados ordenados por relevância (início do título e palavra)</p>' +
        '<div class="search-layout">' +
          '<div class="keyboard-pane">' +
            '<div>' +
              '<div class="search-query-box">' +
                '<span>' + escHtml(q || 'Digite para buscar...') + '</span>' +
                '<span style="font-size:18px;color:var(--text-secondary);">' + results.total + ' itens</span>' +
              '</div>' +
              '<div class="kb-grid">' + keysHtml + '</div>' +
            '</div>' +
            actionsHtml +
          '</div>' +
          '<div class="search-results-pane">' + resHtml + '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('search', '#kb-key-C');
  }

  // ── 6. Continuar Assistindo (Virtualizado) ──
  function renderContinueWatching(viewport) {
    var list = getContinueWatchingItems();
    if (!list.length) {
      viewport.innerHTML =
        '<div>' +
          '<h1 class="screen-title">Continuar Assistindo</h1>' +
          '<p class="screen-subtitle">Você não possui filmes ou episódios pausados em andamento no momento.</p>' +
          '<button id="cont-go-movies" class="btn btn-primary focusable" data-nav="movies" data-scope="continue">Explorar Filmes e Séries</button>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('continue', '#cont-go-movies');
      return;
    }

    var maxStart = Math.max(0, list.length - CONT_WIN_SIZE);
    if (contWindowStart > maxStart) contWindowStart = maxStart;
    if (contWindowStart < 0) contWindowStart = 0;

    var rowsHtml = '';
    var end = Math.min(list.length, contWindowStart + CONT_WIN_SIZE);
    for (var i = contWindowStart; i < end; i++) {
      var slot = i - contWindowStart;
      var it = list[i].item;
      var pr = list[i].progress;
      var typeBadge = it.isNovela ? 'NOVELA' : (it.kind === 'episode' ? ('SÉRIE T' + Number(it.season || 1) + ':E' + Number(it.episode || 1)) : 'FILME VOD');
      rowsHtml +=
        '<div class="continue-row-card">' +
          '<div style="flex:1;overflow:hidden;margin-right:24px;">' +
            '<div style="font-size:25px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml(it.cleanTitle) + ' <span class="badge-pill" style="font-size:16px;margin-left:10px;">' + escHtml(typeBadge) + '</span></div>' +
            '<div style="font-size:19px;color:var(--text-secondary);margin-top:4px;">Grupo: ' + escHtml(it.groupDisplay || it.groupOriginal) + ' · Posição salva: ' + Number(pr.position || 0) + 's / ' + Number(pr.duration || 0) + 's (' + Number(pr.percent || 0) + '%)</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;">' +
            '<div class="ep-progress-bar" style="margin-right:22px;"><div class="ep-progress-fill" style="width:' + Number(pr.percent || 0) + '%;"></div></div>' +
            '<button id="cont-play-slot-' + slot + '" class="btn btn-sm btn-primary focusable" data-vlist="continue-list" data-vindex="' + i + '" data-vtotal="' + list.length + '" data-play-vod="' + escAttr(it.id) + '" data-scope="continue">▶ Retomar (' + Number(pr.percent || 0) + '%)</button>' +
            '<button id="cont-rm-slot-' + slot + '" class="btn btn-sm focusable" data-remove-continue="' + escAttr(it.id) + '" data-scope="continue">✕ Remover</button>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<div class="screen-header-row">' +
          '<div>' +
            '<h1 class="screen-title">Continuar Assistindo (' + list.length + ')</h1>' +
            '<p class="screen-subtitle" style="margin-bottom:0;">Retome filmes, séries e novelas do ponto exato onde parou</p>' +
          '</div>' +
          '<div class="pagination-pill">' + (contWindowStart + 1) + '–' + end + ' de ' + list.length + '</div>' +
        '</div>' +
        '<div>' + rowsHtml + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('continue', '#cont-play-slot-0');
  }

  // ── 7. Parear / Fontes (com Resumo da Última Atualização, Contagens e Relatório de Etapas) ──
  function describeSource(src) {
    if (!src) return null;
    if (src.type === 'xtream' && src.creds) {
      return 'Xtream Codes · ' + escHtml(String(src.creds.server || '').replace(/^https?:\/\//, '')) + ' · usuário: ' + escHtml(src.creds.username);
    }
    if (src.type === 'm3u' && src.url) {
      var host = String(src.url).replace(/^https?:\/\//, '').split('/')[0];
      return 'Lista M3U · ' + escHtml(host);
    }
    return null;
  }

  function formatDiffSummary(updateRec) {
    if (!updateRec || !updateRec.diff || !updateRec.diff.hasPrev) return '';
    var d = updateRec.diff;
    var parts = [];
    if (d.liveDelta) parts.push((d.liveDelta > 0 ? '+' : '') + d.liveDelta + ' canais');
    if (d.movieDelta) parts.push((d.movieDelta > 0 ? '+' : '') + d.movieDelta + ' filmes');
    if (d.seriesDelta) parts.push((d.seriesDelta > 0 ? '+' : '') + d.seriesDelta + ' séries');
    if (d.novelasDelta) parts.push((d.novelasDelta > 0 ? '+' : '') + d.novelasDelta + ' novelas');
    return parts.length ? ('Diferença na última atualização: ' + parts.join(', ')) : 'Sem alterações de quantidade na última atualização.';
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
      var diffTxt = formatDiffSummary(updateRec);
      toast('✔ Catálogo atualizado: ' + (list ? list.length : 0) + ' itens! ' + diffTxt);
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
    var step = global.LuminaStore.get('pairingStep') || 'cards';
    var baseUrl = global.LuminaStore.get('pairingBaseUrl') || global.LuminaPairing.DEFAULT_PAIRING_BASE_URL;
    var shownUrl = baseUrl.replace(/^https?:\/\//, '');

    if (step === 'phone-qr') {
      var sess = global.LuminaPairing.getCurrentSession();
      var pairErr = global.LuminaStore.get('pairingError');

      if (!sess) {
        viewport.innerHTML =
          '<div>' +
            '<h1 class="screen-title">📱 Receber Lista pelo Celular</h1>' +
            (pairErr
              ? '<p class="screen-subtitle" style="color:#F87171;">' + escHtml(pairErr) + '</p>'
              : '<p class="screen-subtitle">Gerando código seguro de pareamento...</p>') +
            '<div>' +
              '<button id="btn-pair-renew" class="btn btn-primary focusable" data-action="renew-phone-code" data-scope="onboarding">↻ Tentar Novamente</button>' +
              '<button id="btn-pair-back" class="btn focusable" data-action="back-to-sources" data-scope="onboarding">← Voltar às Fontes</button>' +
            '</div>' +
          '</div>';
        global.LuminaFocus.restoreOrDefault('onboarding', '#btn-pair-renew');
        return;
      }

      var code = sess.code;
      var qrSvg = global.LuminaPairing.renderQrSvg(baseUrl + '/#' + code, 6);

      viewport.innerHTML =
        '<div>' +
          '<h1 class="screen-title">📱 Receber Lista pelo Celular</h1>' +
          '<p class="screen-subtitle">Envie seu link M3U ou login Xtream pelo celular sem digitar no controle remoto (criptografia ponta-a-ponta ECDH P-256 + AES-GCM).</p>' +
          '<div class="pairing-hero-box">' +
            '<div style="max-width:860px;">' +
              '<div style="font-size:21px;color:var(--text-secondary);margin-bottom:6px;">1. No celular, escaneie o QR Code ao lado ou acesse no navegador:</div>' +
              '<div style="font-size:32px;font-weight:700;color:var(--accent-cyan);margin-bottom:18px;font-family:var(--font-mono);">' + escHtml(shownUrl) + '</div>' +
              '<div style="font-size:21px;color:var(--text-secondary);">2. Confira ou digite este código de 6 caracteres:</div>' +
              '<div class="pairing-code-pill">' + escHtml(code) + '</div>' +
              '<div style="font-size:19px;color:#22C55E;margin-bottom:22px;">● Aguardando envio pelo celular... O código vale 10 minutos e é de uso único.</div>' +
              '<div>' +
                '<button id="btn-pair-renew" class="btn btn-primary focusable" data-action="renew-phone-code" data-scope="onboarding">↻ Gerar Novo Código</button>' +
                '<button id="btn-pair-back" class="btn focusable" data-action="back-to-sources" data-scope="onboarding">← Voltar às Fontes</button>' +
              '</div>' +
            '</div>' +
            '<div class="pairing-qr-card">' +
              qrSvg +
              '<div style="color:#0F172A;font-size:17px;font-weight:700;margin-top:10px;">Aponte a câmera do celular</div>' +
              '<div style="color:#475569;font-size:14px;">Preenche o código sozinho</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      global.LuminaFocus.restoreOrDefault('onboarding', '#btn-pair-renew');
      return;
    }

    var src = global.LuminaStore.get('source');
    var srcText = describeSource(src);
    var chCount = (global.LuminaStore.get('channels') || []).length;
    var mvCount = (global.LuminaStore.get('movies') || []).length;
    var srCount = (global.LuminaStore.get('seriesList') || []).length;
    var nvCount = (global.LuminaStore.get('novelasList') || []).length;
    var unCount = (global.LuminaStore.get('unclassifiedList') || []).length;
    var lastUpd = global.LuminaStore.get('lastUpdateInfo');
    var pairErr2 = global.LuminaStore.get('pairingError');
    var diffSummary = formatDiffSummary(lastUpd);

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Parear pelo Celular & Fontes de Conteúdo</h1>' +
        '<p class="screen-subtitle">Adicione ou atualize sua lista M3U ou login Xtream Codes de forma atômica (sem perder seus favoritos e progresso).</p>' +
        (pairErr2 ? '<p class="screen-subtitle" style="color:#F87171;">' + escHtml(pairErr2) + '</p>' : '') +
        '<div class="onboarding-grid">' +
          '<div class="onboarding-col" style="border-color:rgba(56,189,248,0.65);background:linear-gradient(160deg, rgba(23,37,84,0.65) 0%, rgba(19,26,39,0.95) 100%);">' +
            '<h2 style="font-size:26px;color:var(--accent-cyan);margin-bottom:12px;">📱 Parear pelo Celular (QR / Código)</h2>' +
            '<p style="color:var(--text-secondary);font-size:20px;margin-bottom:20px;">Gera um código de 6 caracteres e um QR Code na TV. No celular (' + escHtml(shownUrl) + '), você cola o link M3U ou usuário/senha Xtream e a TV sincroniza automaticamente.</p>' +
            '<button id="btn-open-phone-pair" class="btn btn-primary focusable" data-action="open-phone-pairing" data-scope="onboarding">Abrir Código e QR Code na TV</button>' +
          '</div>' +
          '<div class="onboarding-col" style="margin-right:0;">' +
            '<h2 style="font-size:26px;margin-bottom:12px;">Fonte Salva & Estado do Catálogo</h2>' +
            (srcText
              ? '<p style="color:var(--text-primary);font-size:20px;font-weight:600;margin-bottom:6px;">' + srcText + '</p>' +
                '<p style="color:var(--text-secondary);font-size:19px;margin-bottom:8px;">Última atualização: <strong>' + escHtml(fmtDateBr(lastUpd && lastUpd.updatedAt)) + '</strong></p>' +
                '<p style="color:var(--text-secondary);font-size:19px;margin-bottom:10px;">Canais: <strong>' + chCount + '</strong> · Filmes: <strong>' + mvCount + '</strong> · Séries: <strong>' + srCount + '</strong> · Novelas: <strong>' + nvCount + '</strong>' + (unCount ? (' · Não classificados: <strong>' + unCount + '</strong>') : '') + '</p>' +
                (diffSummary ? '<p style="color:var(--accent-cyan);font-size:18px;margin-bottom:14px;">' + escHtml(diffSummary) + '</p>' : '') +
                '<button id="btn-reload-source" class="btn btn-primary focusable" data-action="reload-source" data-scope="onboarding">↻ Atualizar Lista Agora</button>'
              : '<p style="color:var(--text-secondary);font-size:20px;">Nenhuma fonte conectada ainda. Use o pareamento pelo celular ao lado para enviar sua primeira lista.</p>') +
          '</div>' +
        '</div>' +
      '</div>';
    global.LuminaFocus.restoreOrDefault('onboarding', '#btn-open-phone-pair');
  }

  // ── 8. Ajustes Agrupados por Seções Laterais (Conta, Reprodução, Aparência, Parental, Atualizações, Backup, Sobre) ──
  function renderSettings(viewport) {
    var perfMode = global.LuminaStore.get('performanceMode') || 'auto';
    var isLite = global.LuminaStore.get('liteModeActive');
    var ratio = global.LuminaStore.get('defaultAspectRatio') || 'auto';
    var preferFmt = global.LuminaStore.get('preferOutputFormat') || 'auto';
    var autoUpdHours = global.LuminaStore.get('autoUpdateHours');
    if (typeof autoUpdHours !== 'number') autoUpdHours = 12;
    var includeCreds = !!global.LuminaStore.get('includeCredentialsInBackup');
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false, hideAdultInSearchAndHome: true };
    var tmdb = global.LuminaStore.get('tmdb') || { enabled: false, apiKey: '', enrichedCount: 0 };
    var acc = global.LuminaStore.get('accountInfo');
    var src = global.LuminaStore.get('source');
    var lastUpd = global.LuminaStore.get('lastUpdateInfo');
    var appUpd = global.LuminaStore.get('appUpdateInfo');
    var appUpdProg = global.LuminaStore.get('appUpdateProgress');
    var isAndroid = !!(global.LuminaPlatform && global.LuminaPlatform.isAndroid);
    var appVer = global.LuminaPlatform ? global.LuminaPlatform.getAppVersion() : '1.6.0';
    var platLabel = global.LuminaPlatform ? global.LuminaPlatform.getPlatformLabel() : 'Smart TV';

    var tabs = [
      { id: 'account', label: '1. Minha Conta & Fonte' },
      { id: 'playback', label: '2. Reprodução & Player' },
      { id: 'appearance', label: '3. Desempenho & TMDB' },
      { id: 'parental', label: '4. Controle Parental (+18)' },
      { id: 'updates', label: '5. Atualizações (Lista/App)' },
      { id: 'backup', label: '6. Backup JSON & Dados' },
      { id: 'about', label: '7. Sobre & Diagnóstico' }
    ];

    var tabsHtml = '';
    for (var t = 0; t < tabs.length; t++) {
      var tb = tabs[t];
      var sel = (activeSettingsTab === tb.id) ? ' is-selected' : '';
      tabsHtml +=
        '<div id="set-tab-' + tb.id + '" class="settings-tab-btn focusable' + sel + '" data-settings-tab="' + escAttr(tb.id) + '" data-scope="settings">' +
          '<span>' + escHtml(tb.label) + '</span>' +
          '<span>›</span>' +
        '</div>';
    }

    var paneHtml = '';
    if (activeSettingsTab === 'account') {
      var srcDesc = describeSource(src) || 'Nenhuma fonte salva';
      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Minha Conta IPTV & Fonte Conectada</h2>' +
          '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:18px;">Fonte ativa: <strong>' + srcDesc + '</strong></p>' +
          (acc ? (
            '<div style="background:var(--bg-obsidian);padding:20px 24px;border-radius:var(--radius-md);margin-bottom:18px;">' +
              '<div style="font-size:22px;margin-bottom:8px;">Status da Conta Xtream: <strong style="color:' + (acc.auth ? '#22C55E' : '#EF4444') + ';">' + escHtml(acc.status) + '</strong></div>' +
              '<div style="font-size:20px;color:var(--text-secondary);margin-bottom:6px;">Vencimento: <strong>' + escHtml(acc.expDate || 'Ilimitado') + '</strong>' + (acc.daysRemaining != null ? (' (' + Number(acc.daysRemaining) + ' dias restantes)') : '') + '</div>' +
              '<div style="font-size:20px;color:var(--text-secondary);margin-bottom:6px;">Conexões Simultâneas: <strong>' + Number(acc.activeCons || 0) + ' / ' + Number(acc.maxConnections || 1) + '</strong></div>' +
              '<div style="font-size:20px;color:var(--text-secondary);">Formatos Permitidos pelo Servidor: <strong>' + escHtml((acc.allowedOutputFormats || ['m3u8', 'ts']).join(', ').toUpperCase()) + '</strong></div>' +
            '</div>'
          ) : '<p style="color:var(--text-secondary);font-size:20px;margin-bottom:18px;">Conecte uma conta Xtream Codes para visualizar data de vencimento, conexões ativas e formatos permitidos.</p>') +
        '</div>' +
        '<div>' +
          '<button id="set-acc-reload" class="btn btn-primary focusable" data-action="reload-source" data-scope="settings">↻ Atualizar Lista e Validar Conta</button>' +
          '<button id="set-acc-pair" class="btn focusable" data-action="go-phone-pairing" data-scope="settings">📱 Trocar Lista pelo Celular</button>' +
        '</div>';
    } else if (activeSettingsTab === 'playback') {
      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Reprodução, Formato e Proporção de Tela</h2>' +
          '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:18px;">O player possui fallback automático multi-engine (NativeEngine → HlsJsEngine → MpegtsEngine) e watchdog de reconexão em caso de travamento.</p>' +
          '<div style="background:var(--bg-obsidian);padding:20px 24px;border-radius:var(--radius-md);margin-bottom:18px;">' +
            '<div style="font-size:21px;margin-bottom:8px;">Proporção de Vídeo Padrão: <strong style="color:var(--accent-cyan);">' + escHtml(ratio.toUpperCase()) + '</strong></div>' +
            '<div style="font-size:21px;">Formato Preferido no Ao Vivo Xtream: <strong style="color:var(--accent-cyan);">' + escHtml(preferFmt.toUpperCase()) + '</strong> (alterna automaticamente se falhar)</div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<button id="set-ratio-cycle" class="btn btn-primary focusable" data-action="cycle-default-ratio" data-scope="settings">Proporção: ' + escHtml(ratio.toUpperCase()) + '</button>' +
          '<button id="set-fmt-cycle" class="btn focusable" data-action="cycle-prefer-format" data-scope="settings">Formato Ao Vivo: ' + escHtml(preferFmt.toUpperCase()) + '</button>' +
        '</div>';
    } else if (activeSettingsTab === 'appearance') {
      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Modo de Desempenho & Enriquecimento TMDB</h2>' +
          '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:16px;">O Modo Leve desativa sombras e animações pesadas em TVs com menos memória RAM. Estado atual: <strong>' + (isLite ? 'MODO LEVE ATIVO' : 'PADRÃO 60fps') + '</strong></p>' +
          '<div style="margin-bottom:20px;">' +
            '<button id="set-perf-auto" class="btn btn-sm focusable' + (perfMode === 'auto' ? ' btn-primary' : '') + '" data-set-perf="auto" data-scope="settings">Automático</button>' +
            '<button id="set-perf-normal" class="btn btn-sm focusable' + (perfMode === 'normal' ? ' btn-primary' : '') + '" data-set-perf="normal" data-scope="settings">Normal (60fps)</button>' +
            '<button id="set-perf-lite" class="btn btn-sm focusable' + (perfMode === 'lite' ? ' btn-primary' : '') + '" data-set-perf="lite" data-scope="settings">Forçar Modo Leve</button>' +
          '</div>' +
          '<p style="color:var(--text-secondary);font-size:20px;">Enriquecimento TMDB (pt-BR): busca sinopses e notas oficiais. Títulos enriquecidos no cache: <strong>' + Number(tmdb.enrichedCount || 0) + '</strong></p>' +
        '</div>' +
        '<div>' +
          '<button id="set-tmdb-run" class="btn btn-primary focusable" data-action="run-tmdb-enrich" data-scope="settings">✨ Enriquecer Catálogo com TMDB (pt-BR)</button>' +
        '</div>';
    } else if (activeSettingsTab === 'parental') {
      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Controle Parental (+18) & Segurança de PIN</h2>' +
          '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:16px;">O PIN é armazenado com hash criptográfico SHA-256 + salt, bloqueia temporariamente após 5 tentativas incorretas e tranca a sessão automaticamente após 15 minutos de inatividade ou ao sair do vídeo.</p>' +
          '<div style="background:var(--bg-obsidian);padding:18px 24px;border-radius:var(--radius-md);margin-bottom:18px;">' +
            '<div style="font-size:21px;margin-bottom:6px;">Proteção Parental (+18): <strong>' + (par.enabled ? 'ATIVA' : 'DESATIVADA') + '</strong></div>' +
            '<div style="font-size:21px;margin-bottom:6px;">Sessão +18 Atual: <strong>' + (par.unlockedSession ? '🔓 Desbloqueada (expira em 15 min de inatividade)' : '🔒 Bloqueada') + '</strong></div>' +
            '<div style="font-size:20px;color:var(--text-secondary);">Ocultar itens +18 na Home e Busca enquanto bloqueado: <strong>' + (par.hideAdultInSearchAndHome ? 'SIM' : 'NÃO') + '</strong></div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<button id="set-pin-toggle" class="btn btn-primary focusable" data-action="toggle-parental-lock" data-scope="settings">' + (par.unlockedSession ? '🔒 Bloquear Sessão +18' : '🔓 Desbloquear com PIN') + '</button>' +
          '<button id="set-pin-change" class="btn focusable" data-action="change-parental-pin" data-scope="settings">🔑 Alterar PIN</button>' +
          '<button id="set-pin-enable" class="btn focusable" data-action="toggle-parental-enabled" data-scope="settings">' + (par.enabled ? 'Desativar Proteção' : 'Ativar Proteção') + '</button>' +
        '</div>';
    } else if (activeSettingsTab === 'updates') {
      var autoUpdLabel = autoUpdHours === 0 ? 'Só Manual' : ('A cada ' + autoUpdHours + ' horas');
      var apkSection = '';
      if (isAndroid) {
        var updStatus = 'Versão instalada: v' + escHtml(appVer) + '. Clique em "Verificar Atualização do App" para consultar o GitHub Releases.';
        if (appUpd) {
          if (appUpd.hasUpdate) {
            updStatus = '🎉 Nova versão disponível: ' + escHtml(appUpd.latestVersion) + ' — ' + escHtml(appUpd.releaseNotes || 'Correções e melhorias.');
          } else {
            updStatus = '✔ Você já está na versão mais recente (v' + escHtml(appVer) + ').';
          }
        }
        if (appUpdProg) {
          updStatus = '⬇ Baixando atualização do APK: ' + Number(appUpdProg.percent || 0) + '% (' + escHtml(appUpdProg.downloadedMb || '0') + ' MB / ' + escHtml(appUpdProg.totalMb || '?') + ' MB)...';
        }
        apkSection =
          '<div style="background:var(--bg-obsidian);padding:18px 24px;border-radius:var(--radius-md);margin-top:14px;">' +
            '<div style="font-size:21px;font-weight:700;color:var(--accent-cyan);margin-bottom:6px;">Atualização do Aplicativo (APK Fire TV / Android)</div>' +
            '<div style="font-size:19px;color:var(--text-secondary);">' + updStatus + '</div>' +
          '</div>';
      } else {
        apkSection =
          '<div style="background:var(--bg-obsidian);padding:18px 24px;border-radius:var(--radius-md);margin-top:14px;">' +
            '<div style="font-size:20px;color:var(--text-secondary);">Na TV LG webOS, atualizações do pacote .ipk são instaladas via ares-install.</div>' +
          '</div>';
      }

      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Atualizações da Lista & do Aplicativo</h2>' +
          '<p style="color:var(--text-secondary);font-size:20px;margin-bottom:10px;">Atualização Automática da Lista ao Abrir: <strong>' + escHtml(autoUpdLabel) + '</strong> · Última atualização: <strong>' + escHtml(fmtDateBr(lastUpd && lastUpd.updatedAt)) + '</strong></p>' +
          apkSection +
        '</div>' +
        '<div>' +
          '<button id="set-upd-cycle-hours" class="btn focusable" data-action="cycle-auto-update-hours" data-scope="settings">Lista Auto: ' + escHtml(autoUpdLabel) + '</button>' +
          '<button id="set-upd-list-now" class="btn btn-primary focusable" data-action="reload-source" data-scope="settings">↻ Atualizar Lista Agora</button>' +
          (isAndroid ? '<button id="set-upd-apk-check" class="btn focusable" data-action="check-apk-update" data-scope="settings">🔍 Verificar Atualização do App</button>' : '') +
          (isAndroid && appUpd && appUpd.hasUpdate ? '<button id="set-upd-apk-install" class="btn btn-primary focusable" data-action="install-apk-update" data-scope="settings">⬇ Baixar e Instalar ' + escHtml(appUpd.latestVersion) + '</button>' : '') +
        '</div>';
    } else if (activeSettingsTab === 'backup') {
      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Backup JSON & Proteção de Credenciais</h2>' +
          '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:16px;">Exporte ou restaure seus favoritos, progresso de episódios, regras de mapeamento e configurações. Por segurança, sua senha Xtream e seu PIN <strong>não são incluídos em texto puro</strong> no backup a menos que você ative a opção abaixo.</p>' +
          '<div style="background:var(--bg-obsidian);padding:18px 24px;border-radius:var(--radius-md);margin-bottom:18px;">' +
            '<div style="font-size:21px;">Incluir credenciais (senha/URL) no arquivo de Backup JSON: <strong style="color:' + (includeCreds ? 'var(--accent-amber)' : '#22C55E') + ';">' + (includeCreds ? 'SIM (Cuidado ao compartilhar o arquivo)' : 'NÃO (Modo Seguro Padrão)') + '</strong></div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<button id="set-backup-export" class="btn btn-primary focusable" data-action="backup-export" data-scope="settings">⬇ Exportar Backup JSON</button>' +
          '<button id="set-backup-restore" class="btn focusable" data-action="backup-restore" data-scope="settings">⬆ Restaurar Último Backup</button>' +
          '<button id="set-backup-creds" class="btn focusable" data-action="toggle-backup-creds" data-scope="settings">' + (includeCreds ? '🔒 Ocultar Credenciais' : '🔓 Incluir Credenciais') + '</button>' +
        '</div>';
    } else {
      paneHtml =
        '<div>' +
          '<h2 style="font-size:30px;color:var(--accent-cyan);margin-bottom:10px;">Sobre o Lumina TV v' + escHtml(appVer) + ' & Diagnóstico</h2>' +
          '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:14px;">Plataforma detectada: <strong>' + escHtml(platLabel) + '</strong></p>' +
          '<pre style="background:var(--bg-obsidian);padding:18px;border-radius:var(--radius-md);font-family:var(--font-mono);font-size:17px;color:#E2E8F0;white-space:pre-wrap;line-height:1.45;">' + escHtml(buildDiagnosticsReportText()) + '</pre>' +
        '</div>' +
        '<div>' +
          '<button id="set-diag-toggle" class="btn btn-primary focusable" data-action="toggle-diag" data-scope="settings">📊 Alternar Painel Flutuante (R·G·Y·B)</button>' +
          '<button id="set-diag-copy" class="btn focusable" data-action="copy-diag-report" data-scope="settings">📋 Copiar Relatório de Suporte</button>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Ajustes & Configuração do Sistema</h1>' +
        '<p class="screen-subtitle">Todas as alterações são salvas automaticamente no armazenamento persistente v2</p>' +
        '<div class="settings-layout">' +
          '<div class="settings-tabs-col">' + tabsHtml + '</div>' +
          '<div class="settings-content-pane">' + paneHtml + '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('settings', '#set-tab-' + activeSettingsTab);
  }

  // ── 9. Organizar Minha Lista (Virtualizado para 500+ grupos, Contagem de Não Classificados e Desfazer) ──
  function renderOrganizer(viewport) {
    var allGroups = global.LuminaStore.get('originalGroups') || [];
    var profile = global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
    var channels = global.LuminaStore.get('channels') || [];
    var movies = global.LuminaStore.get('movies') || [];
    var series = global.LuminaStore.get('seriesList') || [];
    var novelas = global.LuminaStore.get('novelasList') || [];
    var unclass = global.LuminaStore.get('unclassifiedList') || [];
    var undoStack = global.LuminaStore.get('organizerUndoStack') || [];

    var groups = [];
    var q = organizerSearchQuery.toLowerCase().trim();
    for (var gIdx = 0; gIdx < allGroups.length; gIdx++) {
      var grp = allGroups[gIdx];
      if (!q || grp.originalName.toLowerCase().indexOf(q) !== -1 || grp.displayName.toLowerCase().indexOf(q) !== -1) {
        groups.push(grp);
      }
    }

    var SUGG_LABELS = {
      'live': 'Canais',
      'movie': 'Filmes',
      'series': 'Séries',
      'novela': 'Novelas',
      'unclassified': 'Não classificado'
    };

    var maxStart = Math.max(0, groups.length - ORG_GROUP_WIN_SIZE);
    if (orgGroupWindowStart > maxStart) orgGroupWindowStart = maxStart;
    if (orgGroupWindowStart < 0) orgGroupWindowStart = 0;

    var rowsHtml = '';
    var end = Math.min(groups.length, orgGroupWindowStart + ORG_GROUP_WIN_SIZE);
    for (var i = orgGroupWindowStart; i < end; i++) {
      var slot = i - orgGroupWindowStart;
      var g = groups[i];
      var curRule = (profile.mode === 'all_live')
        ? 'live'
        : ((profile.customGroupRules && profile.customGroupRules[g.originalName]) || g.suggested);

      rowsHtml +=
        '<div class="organizer-row">' +
          '<div class="org-group-info">' +
            '<div class="org-group-name">' + escHtml(g.displayName) + ' <span style="color:var(--accent-cyan);font-size:18px;">(' + Number(g.count || 0) + ')</span></div>' +
            '<div class="org-group-sub">Sugestão automática: <strong>' + escHtml(SUGG_LABELS[g.suggested] || 'Não classificado') + '</strong></div>' +
          '</div>' +
          '<div class="org-actions">' +
            '<button id="org-slot-' + slot + '-live" class="btn btn-sm focusable' + (curRule === 'live' ? ' is-active-target' : '') + '" data-vlist="org-groups" data-vindex="' + i + '" data-vtotal="' + groups.length + '" data-org-group="' + escAttr(g.originalName) + '" data-org-target="live" data-scope="organizer">Canais</button>' +
            '<button id="org-slot-' + slot + '-movie" class="btn btn-sm focusable' + (curRule === 'movie' ? ' is-active-target' : '') + '" data-org-group="' + escAttr(g.originalName) + '" data-org-target="movie" data-scope="organizer">Filmes</button>' +
            '<button id="org-slot-' + slot + '-series" class="btn btn-sm focusable' + (curRule === 'series' ? ' is-active-target' : '') + '" data-org-group="' + escAttr(g.originalName) + '" data-org-target="series" data-scope="organizer">Séries</button>' +
            '<button id="org-slot-' + slot + '-novela" class="btn btn-sm focusable' + (curRule === 'novela' ? ' is-active-target' : '') + '" data-org-group="' + escAttr(g.originalName) + '" data-org-target="novela" data-scope="organizer">Novelas</button>' +
            '<button id="org-slot-' + slot + '-hidden" class="btn btn-sm focusable' + (curRule === 'hidden' ? ' is-active-target' : '') + '" data-org-group="' + escAttr(g.originalName) + '" data-org-target="hidden" data-scope="organizer">Ocultar</button>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<div class="screen-header-row">' +
          '<div>' +
            '<h1 class="screen-title">Organizar Minha Lista</h1>' +
            '<p class="screen-subtitle" style="margin-bottom:0;">Regras manuais vencem qualquer heurística. Itens sem categoria clara ficam em Não Classificados.</p>' +
          '</div>' +
          '<div class="pagination-pill">Grupos ' + (groups.length ? (orgGroupWindowStart + 1) : 0) + '–' + end + ' de ' + groups.length + '</div>' +
        '</div>' +
        '<div class="organizer-header-bar">' +
          '<div class="preview-counts-row">' +
            '<span class="preview-pill">Canais: <strong style="color:var(--accent-cyan);">' + channels.length + '</strong></span>' +
            '<span class="preview-pill">Filmes: <strong style="color:var(--accent-cyan);">' + movies.length + '</strong></span>' +
            '<span class="preview-pill">Séries: <strong style="color:#A855F7;">' + series.length + '</strong></span>' +
            '<span class="preview-pill">Novelas: <strong style="color:var(--accent-amber);">' + novelas.length + '</strong></span>' +
            '<span class="preview-pill">Não classificados: <strong style="color:' + (unclass.length ? '#F87171' : '#22C55E') + ';">' + unclass.length + '</strong></span>' +
          '</div>' +
          '<div>' +
            '<button id="org-prof-auto" class="btn btn-sm focusable' + (profile.mode === 'auto' ? ' is-active-target' : '') + '" data-org-profile="auto" data-scope="organizer">Automático</button>' +
            '<button id="org-prof-alllive" class="btn btn-sm focusable' + (profile.mode === 'all_live' ? ' is-active-target' : '') + '" data-org-profile="all_live" data-scope="organizer">Tudo Canais</button>' +
            (undoStack.length ? '<button id="org-btn-undo" class="btn btn-sm focusable" data-action="org-undo" data-scope="organizer">↶ Desfazer (' + undoStack.length + ')</button>' : '') +
          '</div>' +
        '</div>' +
        '<div>' + (rowsHtml || '<p style="color:var(--text-secondary);">Importe uma lista primeiro para organizar os grupos.</p>') + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('organizer', '#org-prof-auto');
  }

  // ── 10. Favoritos (Virtualizado) ──
  function renderFavorites(viewport) {
    var byId = global.LuminaStore.get('itemByIdMap') || {};
    var favMap = global.LuminaStore.get('favorites') || {};
    var favKeys = Object.keys(favMap);
    var favs = [];
    for (var i = 0; i < favKeys.length; i++) {
      var it = byId[favKeys[i]];
      if (it && !isItemLockedByParental(it)) favs.push(it);
    }

    if (!favs.length) {
      viewport.innerHTML =
        '<div>' +
          '<h1 class="screen-title">Meus Favoritos</h1>' +
          '<p class="screen-subtitle">Use o botão Favoritar ou a tecla AMARELA (ou toque curto no botão Menu na Fire TV) para guardar seus canais e títulos preferidos.</p>' +
          '<div class="empty-state-panel">' +
            '<div class="empty-state-illustration">' +
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 140" style="width:100%;height:100%;">' +
                '<rect x="16" y="18" width="188" height="104" rx="14" fill="#131B2E" stroke="rgba(245,158,11,0.45)" stroke-width="2"/>' +
                '<path d="M110 34l9.5 19.3 21.3 3.1-15.4 15 3.6 21.2-19-10-19 10 3.6-21.2-15.4-15 21.3-3.1L110 34z" fill="rgba(245,158,11,0.22)" stroke="#F59E0B" stroke-width="2.5"/>' +
              '</svg>' +
            '</div>' +
            '<div>' +
              '<h2 style="font-size:32px;margin-bottom:10px;">Sua lista de Favoritos está vazia</h2>' +
              '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:20px;">Seus favoritos são preservados mesmo quando você atualiza a lista ou troca de servidor.</p>' +
              '<button id="fav-go-home" class="btn btn-primary focusable" data-nav="home" data-scope="favorites">Explorar Catálogo</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('favorites', '#fav-go-home');
      return;
    }

    var maxStart = Math.max(0, favs.length - FAV_WIN_SIZE);
    if (favWindowStart > maxStart) favWindowStart = maxStart;
    if (favWindowStart < 0) favWindowStart = 0;

    var end = Math.min(favs.length, favWindowStart + FAV_WIN_SIZE);
    var html =
      '<div class="screen-header-row">' +
        '<h1 class="screen-title">Meus Favoritos (' + favs.length + ')</h1>' +
        '<div class="pagination-pill">' + (favWindowStart + 1) + '–' + end + ' de ' + favs.length + '</div>' +
      '</div>' +
      '<div style="max-width:1120px;">';

    for (var j = favWindowStart; j < end; j++) {
      var slot = j - favWindowStart;
      var item = favs[j];
      var actionAttr = item.kind === 'live' ? ('data-play-id="' + escAttr(item.id) + '"') : ('data-detail-id="' + escAttr(item.id) + '"');
      html +=
        '<div id="fav-slot-' + slot + '" class="channel-row-item focusable" data-vlist="favorites-list" data-vindex="' + j + '" data-vtotal="' + favs.length + '" ' + actionAttr + ' data-scope="favorites">' +
          '<div class="channel-info">' +
            '<div class="channel-name">' + escHtml(item.cleanTitle) + '</div>' +
            '<div class="channel-epg">' + escHtml(item.groupMapped || '') + ' · ' + escHtml(item.groupDisplay || item.groupOriginal) + '</div>' +
          '</div>' +
          '<div class="fav-badge">★</div>' +
        '</div>';
    }
    html += '</div>';
    viewport.innerHTML = html;
    global.LuminaFocus.restoreOrDefault('favorites', '#fav-slot-0');
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
    } else if (vlist.indexOf('poster-') === 0) {
      var sec = vlist.replace('poster-', '');
      var pStart = posterWindowStart[sec] || 0;
      var pSlot = vindex - pStart;
      var col = pSlot % POSTER_COLS;
      var isBottomRow = pSlot >= POSTER_COLS;
      var isTopRow = pSlot < POSTER_COLS;

      if (dir === 'DOWN' && isBottomRow && (pStart + POSTER_WIN_SIZE) < vtotal) {
        posterWindowStart[sec] = pStart + POSTER_COLS;
        renderCurrentRoute();
        var nextSlot = Math.min(POSTER_COLS + col, (vtotal - posterWindowStart[sec]) - 1);
        global.LuminaFocus.setFocus(document.getElementById('poster-' + sec + '-slot-' + nextSlot), sec);
        return true;
      }
      if (dir === 'UP' && isTopRow && pStart >= POSTER_COLS) {
        posterWindowStart[sec] = Math.max(0, pStart - POSTER_COLS);
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('poster-' + sec + '-slot-' + col), sec);
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
        global.LuminaFocus.setFocus(document.getElementById('org-slot-' + (ORG_GROUP_WIN_SIZE - 1) + '-live'), 'organizer');
        return true;
      }
      if (dir === 'UP' && orgSlot === 0 && orgGroupWindowStart > 0) {
        orgGroupWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('org-slot-0-live'), 'organizer');
        return true;
      }
    } else if (vlist === 'favorites-list') {
      var fSlot = vindex - favWindowStart;
      if (dir === 'DOWN' && fSlot === FAV_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        favWindowStart++;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('fav-slot-' + (FAV_WIN_SIZE - 1)), 'favorites');
        return true;
      }
      if (dir === 'UP' && fSlot === 0 && favWindowStart > 0) {
        favWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('fav-slot-0'), 'favorites');
        return true;
      }
    } else if (vlist === 'continue-list') {
      var cSlot = vindex - contWindowStart;
      if (dir === 'DOWN' && cSlot === CONT_WIN_SIZE - 1 && vindex + 1 < vtotal) {
        contWindowStart++;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('cont-play-slot-' + (CONT_WIN_SIZE - 1)), 'continue');
        return true;
      }
      if (dir === 'UP' && cSlot === 0 && contWindowStart > 0) {
        contWindowStart--;
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('cont-play-slot-0'), 'continue');
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
    updateRemoteHints(route);
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
    else if (route === 'continue') renderContinueWatching(viewport);
    else if (route === 'live') renderLive(viewport);
    else if (route === 'movies') renderPosterCatalog(viewport, 'movies');
    else if (route === 'series') renderPosterCatalog(viewport, 'series');
    else if (route === 'novelas') renderPosterCatalog(viewport, 'novelas');
    else if (route === 'detail') renderDetail(viewport);
    else if (route === 'organizer') renderOrganizer(viewport);
    else if (route === 'favorites') renderFavorites(viewport);
    else if (route === 'onboarding') renderOnboarding(viewport);
    else if (route === 'settings') renderSettings(viewport);
    else renderHome(viewport);

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

    // Atalho Tecla Amarela (405 / toque curto no Menu da Fire TV): Favoritar item em foco
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
        toast(nowFav ? '★ Adicionado aos Favoritos!' : 'Removido dos Favoritos');
        renderCurrentRoute();
      }
    });

    // Salto de página com CH+ / CH- nas listas virtualizadas fora do player
    global.LuminaEventBus.on('key:CH_UP', function () {
      var r = global.LuminaRouter.getCurrent();
      if (r === 'live') {
        liveChWindowStart = Math.max(0, liveChWindowStart - LIVE_CH_WIN_SIZE);
        renderCurrentRoute();
      } else if (r === 'movies' || r === 'series' || r === 'novelas') {
        posterWindowStart[r] = Math.max(0, (posterWindowStart[r] || 0) - POSTER_WIN_SIZE);
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
        posterWindowStart[r] = (posterWindowStart[r] || 0) + POSTER_WIN_SIZE;
        renderCurrentRoute();
      }
    });

    global.LuminaEventBus.on('focus:changed', function (el) {
      if (typeof document === 'undefined' || !el) return;
      var nav = document.getElementById('side-nav');
      if (nav) {
        if (nav.contains(el)) nav.classList.add('is-expanded');
        else nav.classList.remove('is-expanded');
      }
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

      // 1. Teclado de PIN Parental (Desbloqueio e Fluxo de Alteração em 3 passos)
      var pinDigit = el.getAttribute('data-pin-digit');
      if (pinDigit !== null && pinDigit !== undefined) {
        pinDraft += String(pinDigit);
        if (pinDraft.length >= 4) {
          if (pinModalMode === 'unlock') {
            var res = global.LuminaStore.verifyParentalPinDetailed(pinDraft);
            if (res.ok) {
              var cb = pendingPinCallback;
              closeParentalPinModal();
              toast('🔓 PIN Parental validado! Sessão +18 desbloqueada.');
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
              toast('🔑 ' + changeRes.message);
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

      var searchTerm = el.getAttribute('data-search-term');
      if (searchTerm) {
        global.LuminaStore.set('searchQuery', searchTerm);
        renderCurrentRoute();
        return;
      }

      var rmContId = el.getAttribute('data-remove-continue');
      if (rmContId) {
        global.LuminaStore.removeWatchProgress(rmContId);
        toast('Item removido de Continuar Assistindo');
        renderCurrentRoute();
        return;
      }

      var sortMode = el.getAttribute('data-sort');
      if (sortMode) {
        currentSort = sortMode;
        renderCurrentRoute();
        return;
      }

      var letter = el.getAttribute('data-letter');
      if (letter) {
        currentLetterFilter = letter;
        var curRoute = global.LuminaRouter.getCurrent();
        if (posterWindowStart[curRoute] != null) posterWindowStart[curRoute] = 0;
        renderCurrentRoute();
        return;
      }

      var catSection = el.getAttribute('data-cat-section');
      if (catSection) {
        var val = el.getAttribute('data-cat-val');
        if (catSection === 'movies') selectedMovieCat = val;
        else if (catSection === 'series') selectedSeriesCat = val;
        else if (catSection === 'novelas') selectedNovelaCat = val;
        posterWindowStart[catSection] = 0;
        renderCurrentRoute();
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

      var seasonNum = el.getAttribute('data-season-num');
      if (seasonNum) {
        detailEpWindowStart = 0;
        global.LuminaStore.set('selectedSeason', parseInt(seasonNum, 10));
        renderCurrentRoute();
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
        toast(nowFav ? '★ Adicionado aos Favoritos' : 'Removido dos Favoritos');
        renderCurrentRoute();
        return;
      }

      var orgGroup = el.getAttribute('data-org-group');
      if (orgGroup) {
        var target = el.getAttribute('data-org-target');
        var prof = JSON.parse(JSON.stringify(global.LuminaStore.get('mappingProfile') || { mode: 'custom', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }));
        prof.mode = 'custom';
        prof.customGroupRules[orgGroup] = target;
        global.LuminaRepository.applyMappingAndPersist(prof, function () {
          toast('Grupo "' + orgGroup + '" mapeado para ' + target.toUpperCase());
          renderCurrentRoute();
        });
        return;
      }

      var orgProfile = el.getAttribute('data-org-profile');
      if (orgProfile) {
        var pr = JSON.parse(JSON.stringify(global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }));
        pr.mode = orgProfile;
        if (orgProfile === 'auto') pr.customGroupRules = {};
        global.LuminaRepository.applyMappingAndPersist(pr, function () {
          toast(orgProfile === 'all_live' ? 'Perfil aplicado: Tudo como Canais' : 'Perfil aplicado: Automático');
          renderCurrentRoute();
        });
        return;
      }

      var setPerf = el.getAttribute('data-set-perf');
      if (setPerf) {
        global.LuminaStore.set('performanceMode', setPerf);
        toast('Modo de desempenho alterado para: ' + setPerf.toUpperCase());
        renderCurrentRoute();
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
      } else if (action === 'back-to-sources') {
        global.LuminaPairing.resetSession();
        pairingStarting = false;
        global.LuminaStore.set('pairingError', null);
        global.LuminaStore.set('pairingStep', 'cards');
        renderCurrentRoute();
      } else if (action === 'reload-source') {
        var curSrc = global.LuminaStore.get('source');
        if (!curSrc) {
          toast('Nenhuma fonte salva. Faça o pareamento pelo celular.');
          return;
        }
        showLoading('Atualizando catálogo');
        global.LuminaPairing.applyMobilePayload(
          curSrc.type === 'xtream'
            ? { type: 'xtream', name: curSrc.name, host: curSrc.creds.server, port: 0, username: curSrc.creds.username, password: curSrc.creds.password }
            : curSrc,
          function (err, list, _pl, updateRec) {
            hideLoading();
            if (err) { toast(err.message); return; }
            if (updateRec && updateRec.unchanged) {
              toast('✔ Sua lista já está atualizada (sem mudanças no servidor).');
            } else {
              toast('✔ Catálogo atualizado: ' + (list ? list.length : 0) + ' itens! ' + formatDiffSummary(updateRec));
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
          if (undone) toast('↶ Última regra desfeita.');
          renderCurrentRoute();
        });
      } else if (action === 'live-page-prev') {
        liveChWindowStart = Math.max(0, liveChWindowStart - LIVE_CH_WIN_SIZE);
        renderCurrentRoute();
      } else if (action === 'live-page-next') {
        var allC = global.LuminaStore.get('channels') || [];
        if (liveChWindowStart + LIVE_CH_WIN_SIZE < allC.length) {
          liveChWindowStart += LIVE_CH_WIN_SIZE;
          renderCurrentRoute();
        }
      } else if (action === 'last-channel') {
        global.LuminaPlayer.zapLastChannel();
        if (global.LuminaPlayer.getCurrentItem()) {
          global.LuminaRouter.navigate('player-fullscreen');
        }
      } else if (action === 'cycle-lang-filter') {
        var langs = ['ALL', 'DUB', 'LEG'];
        currentLangFilter = langs[(langs.indexOf(currentLangFilter) + 1) % langs.length];
        renderCurrentRoute();
      } else if (action === 'toggle-parental-lock') {
        var p = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
        if (p.unlockedSession) {
          global.LuminaSettings.lockParentalSession();
          toast('🔒 Sessão +18 bloqueada novamente.');
          renderCurrentRoute();
        } else {
          openParentalPinModal(function () {
            renderCurrentRoute();
          }, 'unlock');
        }
      } else if (action === 'change-parental-pin') {
        openParentalPinModal(null, 'change-current');
      } else if (action === 'toggle-parental-enabled') {
        var pe = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
        if (pe.enabled && !pe.unlockedSession) {
          openParentalPinModal(function () {
            pe.enabled = false;
            global.LuminaStore.set('parental', pe);
            toast('Controle Parental DESATIVADO');
            renderCurrentRoute();
          }, 'unlock');
        } else {
          pe.enabled = !pe.enabled;
          global.LuminaStore.set('parental', pe);
          toast(pe.enabled ? 'Controle Parental ATIVADO' : 'Controle Parental DESATIVADO');
          renderCurrentRoute();
        }
      } else if (action === 'run-tmdb-enrich') {
        var tmdbCfg = global.LuminaStore.get('tmdb') || { enabled: false, apiKey: '' };
        toast('Buscando sinopses no TMDB...');
        global.LuminaTMDB.enrichCatalogBatch(tmdbCfg, function (err, count) {
          if (err) { toast(err.message); return; }
          tmdbCfg.enrichedCount = (tmdbCfg.enrichedCount || 0) + count;
          global.LuminaStore.set('tmdb', tmdbCfg);
          toast('✨ ' + count + ' títulos enriquecidos (pt-BR).');
          renderCurrentRoute();
        });
      } else if (action === 'cycle-default-ratio') {
        var ratios = ['auto', '16:9', '4:3', 'fill'];
        var curR = global.LuminaStore.get('defaultAspectRatio') || 'auto';
        var nextR = ratios[(ratios.indexOf(curR) + 1) % ratios.length];
        global.LuminaStore.set('defaultAspectRatio', nextR);
        toast('Proporção padrão: ' + nextR.toUpperCase());
        renderCurrentRoute();
      } else if (action === 'cycle-prefer-format') {
        var fmts = ['auto', 'm3u8', 'ts'];
        var curF = global.LuminaStore.get('preferOutputFormat') || 'auto';
        var nextF = fmts[(fmts.indexOf(curF) + 1) % fmts.length];
        global.LuminaStore.set('preferOutputFormat', nextF);
        toast('Formato ao vivo preferido: ' + nextF.toUpperCase());
        renderCurrentRoute();
      } else if (action === 'cycle-auto-update-hours') {
        var opts = [12, 24, 6, 0];
        var curH = global.LuminaStore.get('autoUpdateHours');
        if (typeof curH !== 'number') curH = 12;
        var nextH = opts[(opts.indexOf(curH) + 1) % opts.length];
        global.LuminaStore.set('autoUpdateHours', nextH);
        toast(nextH === 0 ? 'Atualização automática desativada (Só Manual)' : ('Atualização automática: a cada ' + nextH + 'h'));
        renderCurrentRoute();
      } else if (action === 'check-apk-update') {
        toast('Consultando GitHub Releases...');
        global.LuminaPlatform.checkForAppUpdate(function (err, info) {
          if (err) {
            toast(err.message);
            return;
          }
          global.LuminaStore.set('appUpdateInfo', info);
          if (info && info.hasUpdate) {
            toast('🎉 Nova versão encontrada: ' + info.latestVersion);
          } else {
            toast('✔ Nenhuma atualização pendente (v' + (info && info.currentVersion ? info.currentVersion : '1.6.0') + ').');
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
        toast('Iniciando download da versão ' + upd.latestVersion + '...');
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
            if (err) toast('⚠ ' + err.message);
            else toast('✔ Instalador do Android aberto!');
            renderCurrentRoute();
          }
        );
      } else if (action === 'toggle-backup-creds') {
        var curInc = !!global.LuminaStore.get('includeCredentialsInBackup');
        global.LuminaStore.set('includeCredentialsInBackup', !curInc);
        toast(!curInc ? '⚠ Credenciais serão incluídas no próximo Backup JSON.' : '🔒 Credenciais ocultadas do Backup JSON.');
        renderCurrentRoute();
      } else if (action === 'backup-export') {
        var bkp = global.LuminaStore.exportFullBackupJson();
        global.LuminaStorage.saveMeta('lastBackupMeta', bkp);
        if (global.LuminaPlatform && global.LuminaPlatform.saveBackupToDisk) {
          global.LuminaPlatform.saveBackupToDisk('lumina-backup.json', bkp);
        }
        toast('⬇ Backup JSON exportado (' + bkp.length + ' bytes)!');
      } else if (action === 'backup-restore') {
        var diskBkp = (global.LuminaPlatform && global.LuminaPlatform.readBackupFromDisk)
          ? global.LuminaPlatform.readBackupFromDisk('lumina-backup.json')
          : '';
        if (diskBkp) {
          try {
            global.LuminaStore.importFullBackupJson(diskBkp);
            toast('⬆ Backup JSON restaurado do arquivo com sucesso!');
            renderCurrentRoute();
            return;
          } catch (e) {}
        }
        global.LuminaStorage.loadMeta('lastBackupMeta', null, function (savedBkp) {
          if (!savedBkp) {
            toast('Nenhum backup encontrado para restaurar.');
            return;
          }
          try {
            global.LuminaStore.importFullBackupJson(savedBkp);
            toast('⬆ Backup JSON restaurado com sucesso!');
            renderCurrentRoute();
          } catch (ex) {
            toast('Erro ao restaurar backup: ' + ex.message);
          }
        });
      } else if (action === 'copy-diag-report') {
        var rep = buildDiagnosticsReportText();
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(rep);
        }
        if (global.LuminaPlatform && global.LuminaPlatform.saveBackupToDisk) {
          global.LuminaPlatform.saveBackupToDisk('lumina-diagnostico.txt', rep);
        }
        toast('📋 Relatório de diagnóstico copiado/salvo!');
      } else if (action === 'toggle-diag') {
        global.LuminaEventBus.emit('diag:toggle');
      } else if (action === 'next-banner') {
        var curIdx = global.LuminaStore.get('heroBannerIndex') || 0;
        global.LuminaStore.set('heroBannerIndex', curIdx + 1);
        renderCurrentRoute();
        global.LuminaFocus.setFocus(document.getElementById('home-hero-next'), 'home');
      } else if (action === 'go-onboarding') {
        global.LuminaStore.set('pairingStep', 'cards');
        global.LuminaRouter.navigate('onboarding');
      } else if (action === 'back') {
        global.LuminaRouter.back();
      }
    });
  }

  function dismissBootSplash() {
    if (typeof document === 'undefined') return;
    var splash = document.getElementById('boot-splash');
    if (splash && !splash.classList.contains('is-dismissed')) {
      splash.classList.add('is-dismissed');
      setTimeout(function () {
        if (splash.parentNode) splash.style.display = 'none';
      }, 340);
    }
  }

  global.LuminaUI = {
    init: function () {
      bindGlobalActions();
      renderCurrentRoute();
      setTimeout(dismissBootSplash, 550);
    },
    escHtml: escHtml,
    escAttr: escAttr,
    toast: toast,
    showLoading: showLoading,
    setLoading: setLoading,
    hideLoading: hideLoading,
    renderCurrentRoute: renderCurrentRoute,
    openParentalPinModal: openParentalPinModal,
    handleVirtualBoundary: handleVirtualBoundary,
    dismissBootSplash: dismissBootSplash
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaUI;
})(typeof window !== 'undefined' ? window : global);
