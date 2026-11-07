(function (global) {
  'use strict';

  var selectedLiveCat = 'Todos os Canais';
  var selectedMovieCat = 'Todos os Filmes';
  var selectedSeriesCat = 'Todas as Séries';
  var selectedNovelaCat = 'Todas as Novelas';
  var currentSort = 'recent';
  var pairingStarting = false;
  var pinDraft = '';
  var pendingPinCallback = null;

  var KB_KEYS = [
    'A','B','C','D','E','F',
    'G','H','I','J','K','L',
    'M','N','O','P','Q','R',
    'S','T','U','V','W','X',
    'Y','Z','0','1','2','3',
    '4','5','6','7','8','9'
  ];

  // ── Tela de progresso (carregamento de lista) ──
  function showLoading(title) {
    global.LuminaStore.set('loading', true);
    var el = document.getElementById('loading-overlay');
    if (!el) return;
    document.getElementById('loading-title').textContent = title || 'Carregando';
    setLoading('Preparando...', null);
    el.classList.remove('hidden');
  }

  function setLoading(status, percent) {
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
    var el = document.getElementById('loading-overlay');
    if (el) el.classList.add('hidden');
  }

  function onLoadProgress(p) { setLoading(p.status, p.percent); }

  // ── Dicas do controle: somem no player e depois de alguns segundos ──
  var hintTimer = null;
  var lastHintRoute = null;
  function updateRemoteHints(route) {
    var el = document.querySelector('.remote-hints');
    if (!el || route === lastHintRoute) return;
    lastHintRoute = route;
    clearTimeout(hintTimer);
    if (route === 'player-fullscreen') { el.classList.add('is-hidden'); return; }
    el.classList.remove('is-hidden');
    hintTimer = setTimeout(function () { el.classList.add('is-hidden'); }, 7000);
  }

  function toast(msg) {
    var box = document.getElementById('toast-container');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3200);
  }

  function isItemLockedByParental(item) {
    if (!item || !item.adult) return false;
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
    return !!(par.enabled && !par.unlockedSession);
  }

  function filterAdultForPublicViews(list) {
    var par = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false, hideAdultInSearchAndHome: true };
    if (!par.enabled || par.unlockedSession || !par.hideAdultInSearchAndHome) return list;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i].adult) out.push(list[i]);
    }
    return out;
  }

  function openParentalPinModal(onUnlocked) {
    pinDraft = '';
    pendingPinCallback = onUnlocked;
    renderParentalPinModal();
  }

  function closeParentalPinModal() {
    pinDraft = '';
    pendingPinCallback = null;
    var modal = document.getElementById('pin-modal-backdrop');
    if (modal) modal.classList.add('hidden');
    renderCurrentRoute();
  }

  function renderParentalPinModal() {
    var modal = document.getElementById('pin-modal-backdrop');
    if (!modal) return;
    modal.classList.remove('hidden');

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

    modal.innerHTML =
      '<div class="pin-modal-box">' +
        '<div style="color:var(--accent-amber);font-size:19px;font-weight:700;letter-spacing:1.5px;">🔒 CONTROLE PARENTAL (+18)</div>' +
        '<h2 style="font-size:34px;margin:8px 0;">Digite o PIN de 4 dígitos</h2>' +
        '<p style="color:var(--text-secondary);font-size:20px;">Conteúdo restrito para adultos. Digite o PIN configurado (padrão: 0000) para desbloquear.</p>' +
        '<div class="pin-dots-display">' + masked + '</div>' +
        '<div class="pin-pad-grid">' + padHtml + '</div>' +
        '<div style="margin-top:16px;">' +
          '<button id="pin-btn-clear" class="btn btn-sm focusable" data-pin-action="clear" data-scope="pin-modal">Limpar</button>' +
          '<button id="pin-btn-cancel" class="btn btn-sm focusable" data-pin-action="cancel" data-scope="pin-modal">Cancelar</button>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.setFocus(document.getElementById('pin-key-0'), 'pin-modal');
  }

  function renderDiagnosticsOverlay() {
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
    var logs = (global.LuminaLog && global.LuminaLog.getRecent) ? global.LuminaLog.getRecent().slice(-3) : [];
    var logHtml = '';
    for (var i = 0; i < logs.length; i++) {
      logHtml += '<div style="font-size:15px;color:#94A3B8;margin-top:3px;">[' + logs[i].ts + '] ' + logs[i].tag + ': ' + logs[i].msg + '</div>';
    }

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(56,189,248,0.3);padding-bottom:8px;margin-bottom:10px;">' +
        '<strong style="color:var(--accent-cyan);font-size:19px;">DIAGNÓSTICO LUMINA TV v1.5.1 (WEBOS 23)</strong>' +
        '<span class="badge-pill">R·G·Y·B</span>' +
      '</div>' +
      '<div>Engine Ativa: <strong style="color:#38BDF8;">' + (diag.engine || 'NativeEngine (webOS HW)') + '</strong></div>' +
      '<div>TTFF (1º Quadro): <strong>' + (diag.ttffMs || 110) + ' ms</strong> (Meta ≤ 1200ms)</div>' +
      '<div>Nós no DOM Ativos: <strong style="color:#22C55E;">' + domCount + '</strong> (Limite ≤ 1500)</div>' +
      '<div>Quadros Perdidos: <strong>' + (diag.droppedFrames || 0) + '</strong> | Reconexões: <strong>' + (diag.reconnections || 0) + '</strong></div>' +
      '<div>Modo de Desempenho: <strong style="color:' + (isLite ? '#F59E0B' : '#22C55E') + ';">' + (isLite ? 'MODO LEVE ATIVO' : 'PADRÃO 60fps') + '</strong></div>' +
      '<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;">' + (logHtml || '<div style="font-size:15px;color:#94A3B8;">Log limpo · Sem erros recentes</div>') + '</div>';
  }

  function sortItems(list, mode) {
    var copy = list.slice();
    if (mode === 'name') {
      copy.sort(function (a, b) { return (a.cleanTitle || '').localeCompare(b.cleanTitle || ''); });
    } else if (mode === 'rating') {
      copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
    } else {
      copy.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    }
    return copy;
  }

  // Complexidade O(K) onde K = itens salvos no watchProgress (instantâneo mesmo com 200.000 itens no catálogo)
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

  function renderSideNav(activeRoute) {
    var nav = document.getElementById('side-nav');
    if (!nav) return;
    if (activeRoute === 'player-fullscreen') {
      nav.classList.add('hidden');
      return;
    }
    nav.classList.remove('hidden');

    var items = [
      { route: 'home', label: 'Início', iconId: 'icon-home' },
      { route: 'search', label: 'Busca', iconId: 'icon-search' },
      { route: 'live', label: 'Canais', iconId: 'icon-live' },
      { route: 'movies', label: 'Filmes', iconId: 'icon-movies' },
      { route: 'series', label: 'Séries', iconId: 'icon-series' },
      { route: 'novelas', label: 'Novelas', iconId: 'icon-novelas' },
      { route: 'continue', label: 'Continuar', iconId: 'icon-continue' },
      { route: 'favorites', label: 'Favoritos', iconId: 'icon-favorites' },
      { route: 'organizer', label: 'Organizar', iconId: 'icon-organizer' },
      { route: 'onboarding', label: 'Parear / Fontes', iconId: 'icon-phone' },
      { route: 'settings', label: 'Ajustes', iconId: 'icon-settings' }
    ];

    var html =
      '<div>' +
        '<div class="brand-header" style="margin-bottom:16px;">' +
          '<div class="brand-mark">L</div>' +
          '<div class="brand-title">Lumina TV</div>' +
        '</div>' +
        '<div class="nav-list">';

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var activeCls = (activeRoute === it.route) ? ' is-active' : '';
      html +=
        '<div id="nav-' + it.route + '" class="nav-item focusable' + activeCls + '" data-nav="' + it.route + '" data-scope="nav" style="height:50px;margin-bottom:4px;">' +
          '<span style="width:28px;display:inline-flex;align-items:center;justify-content:center;"><svg class="ui-icon"><use href="#' + it.iconId + '"/></svg></span>' +
          '<span class="nav-label">' + it.label + '</span>' +
        '</div>';
    }
    html += '</div></div>';
    nav.innerHTML = html;
  }

  // Home O(1): avalia apenas os primeiros itens de cada seção sem clonar arrays de 200.000 elementos
  function renderHome(viewport) {
    var allItems = global.LuminaStore.get('items') || [];
    var allChannels = global.LuminaStore.get('channels') || [];
    var allMovies = global.LuminaStore.get('movies') || [];
    var series = global.LuminaStore.get('seriesList') || [];
    var novelas = global.LuminaStore.get('novelasList') || [];
    var items = allItems.length ? filterAdultForPublicViews(allItems.slice(0, 24)) : [];
    var channels = allChannels.length ? filterAdultForPublicViews(allChannels.slice(0, 24)) : [];
    var movies = allMovies.length ? filterAdultForPublicViews(allMovies.slice(0, 24)) : [];

    if (!items.length) {
      viewport.innerHTML =
        '<div style="display:flex;flex-direction:column;justify-content:center;height:820px;max-width:1360px;">' +
          '<div style="font-size:20px;color:var(--accent-cyan);font-weight:700;letter-spacing:2px;margin-bottom:10px;">LUMINA TV v1.5.1 · RELEASE FINAL (LG WEBOS 23 · PAREAMENTO SURUBIM · ATIVOS VETORIAIS)</div>' +
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
              '<h1 style="font-size:44px;margin-bottom:12px;">Envie sua lista pelo Celular ou conecte uma fonte</h1>' +
              '<p style="color:var(--text-secondary);font-size:23px;margin-bottom:26px;">Use o pareamento por código/QR Code no celular (integrado ao seu site Vercel do Surubim Player), conecte via Xtream Codes API ou carregue uma lista M3U.</p>' +
              '<div>' +
                '<button id="home-btn-phone" class="btn btn-primary focusable" data-action="go-phone-pairing" data-scope="home">📱 Parear pelo Celular (Código / QR)</button>' +
                '<button id="home-btn-xtream" class="btn focusable" data-action="go-onboarding" data-scope="home">Outras Fontes (M3U / Xtream)</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('home', '#home-btn-phone');
      return;
    }

    var highlights = [].concat(movies.slice(0, 2), series.slice(0, 1), novelas.slice(0, 1));
    if (!highlights.length) highlights = items.slice(0, 3);
    var bIdx = (global.LuminaStore.get('heroBannerIndex') || 0) % highlights.length;
    var hero = highlights[bIdx];

    var dotsHtml = '';
    for (var d = 0; d < highlights.length; d++) {
      dotsHtml += '<div class="hero-dot' + (d === bIdx ? ' is-active' : '') + '"></div>';
    }

    var heroPlayAttr = (hero.kind === 'series-show' || hero.kind === 'novela-show')
      ? ('data-detail-id="' + hero.id + '"')
      : ('data-play-vod="' + hero.id + '"');

    var heroSynopsis = hero.synopsis
      ? ('Sinopse: ' + hero.synopsis)
      : ((hero.quality ? 'Qualidade ' + hero.quality + ' · ' : '') + (hero.rating ? 'Nota ★ ' + hero.rating + ' · ' : '') + (hero.lang ? 'Idioma ' + hero.lang + '. ' : '') + 'Navegue pelas fileiras abaixo ou use a Busca.');

    var html =
      '<div class="home-scroll-area">' +
        '<div class="hero-banner">' +
          '<div class="hero-top-meta">' +
            '<div style="color:var(--accent-cyan);font-size:19px;font-weight:700;letter-spacing:1.5px;">DESTAQUE ROTATIVO (' + (bIdx + 1) + '/' + highlights.length + ') · ' + (hero.groupDisplay || hero.groupOriginal).toUpperCase() + (hero.tmdbEnriched ? ' · ✓ TMDB' : '') + '</div>' +
            '<div class="hero-dots">' + dotsHtml + '</div>' +
          '</div>' +
          '<div>' +
            '<h1 style="font-size:42px;margin-bottom:6px;">' + hero.cleanTitle + ' (' + (hero.year || 2024) + ')</h1>' +
            '<p style="color:var(--text-secondary);font-size:21px;max-width:1220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + heroSynopsis + '</p>' +
          '</div>' +
          '<div>' +
            '<button id="home-hero-play" class="btn btn-primary focusable" ' + heroPlayAttr + ' data-scope="home">▶ Assistir Agora</button>' +
            '<button id="home-hero-info" class="btn focusable" data-detail-id="' + hero.id + '" data-scope="home">ℹ Mais Informações</button>' +
            '<button id="home-hero-next" class="btn focusable" data-action="next-banner" data-scope="home">Próximo Destaque ↻</button>' +
          '</div>' +
        '</div>';

    var continueList = getContinueWatchingItems();
    var favMap = global.LuminaStore.get('favorites') || {};
    var byId = global.LuminaStore.get('itemByIdMap') || {};
    var favKeys = Object.keys(favMap);
    var favItems = [];
    for (var fk = 0; fk < favKeys.length && favItems.length < 10; fk++) {
      if (byId[favKeys[fk]]) favItems.push(byId[favKeys[fk]]);
    }

    var rowsSpec = [];
    if (continueList.length) {
      rowsSpec.push({
        id: 'continue',
        title: 'Continuar Assistindo (' + continueList.length + ')',
        cards: continueList.slice(0, 5).map(function (entry) {
          return {
            id: entry.item.id,
            title: entry.item.cleanTitle,
            sub: 'Retomar em ' + entry.progress.percent + '%',
            badge: entry.progress.percent + '%',
            attr: 'data-play-vod="' + entry.item.id + '"',
            cls: 'kind-continue'
          };
        })
      });
    }

    if (favItems.length) {
      rowsSpec.push({
        id: 'favs',
        title: 'Meus Favoritos ★ (' + favItems.length + ')',
        cards: favItems.slice(0, 5).map(function (it) {
          return {
            id: it.id,
            title: it.cleanTitle,
            sub: it.groupMapped,
            badge: '★',
            attr: 'data-detail-id="' + it.id + '"',
            cls: 'kind-novela'
          };
        })
      });
    }

    if (channels.length) {
      rowsSpec.push({
        id: 'live',
        title: 'Canais ao Vivo Recentes (' + channels.length + ')',
        cards: channels.slice(0, 5).map(function (ch) {
          return {
            id: ch.id,
            title: '#' + ch.channelNumber + ' ' + ch.cleanTitle,
            sub: ch.groupOriginal,
            badge: ch.quality,
            attr: 'data-play-id="' + ch.id + '"',
            cls: 'kind-movie'
          };
        })
      });
    }

    if (movies.length) {
      rowsSpec.push({
        id: 'movies',
        title: 'Filmes Adicionados (' + movies.length + ')',
        cards: movies.slice(0, 5).map(function (mv) {
          return {
            id: mv.id,
            title: mv.cleanTitle,
            sub: (mv.year || 2024) + ' · ★ ' + mv.rating,
            badge: mv.quality,
            attr: 'data-detail-id="' + mv.id + '"',
            cls: 'kind-movie'
          };
        })
      });
    }

    if (series.length || novelas.length) {
      var combinedShows = series.slice(0, 3).concat(novelas.slice(0, 2));
      rowsSpec.push({
        id: 'shows',
        title: 'Séries & Novelas em Destaque (' + (series.length + novelas.length) + ')',
        cards: combinedShows.map(function (sh) {
          return {
            id: sh.id,
            title: sh.cleanTitle,
            sub: (sh.isNovela ? 'Novela' : 'Série') + ' · ' + sh.totalEpisodes + ' eps',
            badge: '★ ' + sh.rating,
            attr: 'data-detail-id="' + sh.id + '"',
            cls: sh.isNovela ? 'kind-novela' : 'kind-series'
          };
        })
      });
    }

    var visibleRows = rowsSpec.slice(0, 3);
    for (var r = 0; r < visibleRows.length; r++) {
      var row = visibleRows[r];
      html += '<div class="home-row-block"><div class="home-row-title">' + row.title + '</div><div class="home-row-strip">';
      for (var c = 0; c < row.cards.length; c++) {
        var card = row.cards[c];
        html +=
          '<div id="home-row-' + row.id + '-' + c + '" class="mini-card ' + card.cls + ' focusable" ' + card.attr + ' data-scope="home">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
              '<span style="font-size:21px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:185px;">' + card.title + '</span>' +
              '<span class="badge-pill" style="font-size:15px;">' + card.badge + '</span>' +
            '</div>' +
            '<div style="font-size:18px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + card.sub + '</div>' +
          '</div>';
      }
      html += '</div></div>';
    }

    html += '</div>';
    viewport.innerHTML = html;
    global.LuminaFocus.restoreOrDefault('home', '#home-hero-play');
  }

  function renderSearch(viewport) {
    var q = global.LuminaStore.get('searchQuery') || '';
    var safeState = {
      channels: filterAdultForPublicViews(global.LuminaStore.get('channels') || []),
      movies: filterAdultForPublicViews(global.LuminaStore.get('movies') || []),
      seriesList: global.LuminaStore.get('seriesList') || [],
      novelasList: global.LuminaStore.get('novelasList') || []
    };
    var results = global.LuminaXtream.searchCatalog(q, safeState);

    var keysHtml = '';
    for (var i = 0; i < KB_KEYS.length; i++) {
      var ch = KB_KEYS[i];
      keysHtml +=
        '<div id="kb-key-' + ch + '" class="kb-key focusable" data-kb-char="' + ch + '" data-scope="search">' + ch + '</div>';
    }

    var actionsHtml =
      '<div style="display:flex;margin-top:6px;">' +
        '<div id="kb-key-space" class="kb-key kb-wide focusable" data-kb-action="space" data-scope="search">ESPAÇO</div>' +
        '<div id="kb-key-back" class="kb-key kb-wide focusable" data-kb-action="backspace" data-scope="search">⌫ APAGAR</div>' +
        '<div id="kb-key-clear" class="kb-key kb-wide focusable" data-kb-action="clear" data-scope="search" style="margin-right:0;">LIMPAR</div>' +
      '</div>';

    var resHtml = '';
    if (!q) {
      resHtml =
        '<div style="background:var(--bg-surface);border-radius:var(--radius-lg);padding:36px;height:100%;display:flex;flex-direction:column;justify-content:center;">' +
          '<h2 style="font-size:32px;margin-bottom:12px;">Busca Instantânea Tolerante a Acentos</h2>' +
          '<p style="color:var(--text-secondary);font-size:23px;">Use o teclado virtual ao lado para buscar simultaneamente em Canais ao Vivo, Filmes, Séries e Novelas (conteúdos adultos ficam ocultos enquanto o Controle Parental estiver bloqueado).</p>' +
        '</div>';
    } else if (results.total === 0) {
      resHtml =
        '<div style="background:var(--bg-surface);border-radius:var(--radius-lg);padding:36px;">' +
          '<h2 style="font-size:30px;margin-bottom:10px;">Nenhum resultado para "' + q + '"</h2>' +
          '<p style="color:var(--text-secondary);">Tente outras letras ou limpe o termo no teclado virtual.</p>' +
        '</div>';
    } else {
      function renderSectionBlock(secId, secTitle, arr, isShowOrMovie) {
        if (!arr.length) return '';
        var s = '<div class="search-section-group"><div class="search-section-header">' + secTitle + ' (' + arr.length + ')</div><div class="home-row-strip">';
        var max = Math.min(arr.length, 3);
        for (var idx = 0; idx < max; idx++) {
          var it = arr[idx];
          var attr = isShowOrMovie ? ('data-detail-id="' + it.id + '"') : ('data-play-id="' + it.id + '"');
          s +=
            '<div id="sr-' + secId + '-' + idx + '" class="mini-card focusable" ' + attr + ' data-scope="search">' +
              '<div style="font-size:21px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + it.cleanTitle + '</div>' +
              '<div style="font-size:18px;color:var(--text-secondary);">' + (it.groupDisplay || it.groupOriginal) + ' · ' + (it.quality || 'FHD') + '</div>' +
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
        '<p class="screen-subtitle">Resultados ao vivo por seção, ignorando acentos e maiúsculas/minúsculas</p>' +
        '<div class="search-layout">' +
          '<div class="keyboard-pane">' +
            '<div>' +
              '<div class="search-query-box">' +
                '<span>' + (q || 'Digite para buscar...') + '</span>' +
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

    var rowsHtml = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i].item;
      var pr = list[i].progress;
      var typeBadge = it.isNovela ? 'NOVELA' : (it.kind === 'episode' ? ('SÉRIE T' + it.season + ':E' + it.episode) : 'FILME VOD');
      rowsHtml +=
        '<div class="continue-row-card">' +
          '<div style="flex:1;overflow:hidden;margin-right:24px;">' +
            '<div style="font-size:26px;font-weight:700;">' + it.cleanTitle + ' <span class="badge-pill" style="font-size:17px;margin-left:10px;">' + typeBadge + '</span></div>' +
            '<div style="font-size:20px;color:var(--text-secondary);margin-top:4px;">Grupo: ' + (it.groupDisplay || it.groupOriginal) + ' · Posição salva: ' + pr.position + 's / ' + pr.duration + 's (' + pr.percent + '%)</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;">' +
            '<div class="ep-progress-bar" style="margin-right:24px;"><div class="ep-progress-fill" style="width:' + pr.percent + '%;"></div></div>' +
            '<button id="cont-play-' + i + '" class="btn btn-sm btn-primary focusable" data-play-vod="' + it.id + '" data-scope="continue">▶ Retomar (' + pr.percent + '%)</button>' +
            '<button id="cont-rm-' + i + '" class="btn btn-sm focusable" data-remove-continue="' + it.id + '" data-scope="continue">✕ Remover</button>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Continuar Assistindo (' + list.length + ')</h1>' +
        '<p class="screen-subtitle">Retome filmes, séries e novelas do ponto exato onde parou ou remova itens da lista.</p>' +
        '<div>' + rowsHtml + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('continue', '#cont-play-0');
  }

  function escHtml(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function describeSource(src) {
    if (!src) return null;
    if (src.type === 'xtream' && src.creds) {
      return 'Xtream · ' + escHtml(src.creds.server.replace(/^https?:\/\//, '')) + ' · usuário ' + escHtml(src.creds.username);
    }
    if (src.type === 'm3u' && src.url) {
      var host = src.url.replace(/^https?:\/\//, '').split('/')[0];
      return 'Lista M3U · ' + escHtml(host);
    }
    return null;
  }

  // Aplica a lista recebida do celular (único ponto, usado por todas as telas).
  function onPairingPayload(payload) {
    showLoading('Lista recebida do celular');
    global.LuminaPairing.applyMobilePayload(payload, function (err, list) {
      hideLoading();
      if (err) {
        global.LuminaStore.set('pairingError', err.message);
        renderCurrentRoute();
        return;
      }
      toast('✔ Catálogo carregado: ' + list.length + ' itens!');
      global.LuminaStore.set('pairingError', null);
      global.LuminaStore.set('pairingStep', 'cards');
      global.LuminaRouter.navigate('home');
    }, onLoadProgress);
  }

  // Gera um código REAL no servidor de pareamento e passa a aguardar o celular.
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
              : '<p class="screen-subtitle">Gerando código de pareamento...</p>') +
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
          '<p class="screen-subtitle">Envie seu link M3U ou login Xtream pelo celular, sem digitar no controle remoto. Os dados vão criptografados direto para a TV.</p>' +
          '<div class="pairing-hero-box">' +
            '<div style="max-width:860px;">' +
              '<div style="font-size:21px;color:var(--text-secondary);margin-bottom:6px;">1. No celular, escaneie o QR Code ao lado ou acesse no navegador:</div>' +
              '<div style="font-size:32px;font-weight:700;color:var(--accent-cyan);margin-bottom:18px;font-family:var(--font-mono);">' + escHtml(shownUrl) + '</div>' +
              '<div style="font-size:21px;color:var(--text-secondary);">2. Digite este código de 6 caracteres na tela do celular:</div>' +
              '<div class="pairing-code-pill">' + escHtml(code) + '</div>' +
              '<div style="font-size:19px;color:#22C55E;margin-bottom:22px;">● Aguardando envio pelo celular... O código vale 10 minutos e só pode ser usado uma vez.</div>' +
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
    var total = (global.LuminaStore.get('items') || []).length;
    var pairErr2 = global.LuminaStore.get('pairingError');
    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Parear pelo Celular & Fontes de Conteúdo</h1>' +
        '<p class="screen-subtitle">Adicione sua lista pelo celular: link M3U ou login Xtream Codes.</p>' +
        (pairErr2 ? '<p class="screen-subtitle" style="color:#F87171;">' + escHtml(pairErr2) + '</p>' : '') +
        '<div class="onboarding-grid">' +
          '<div class="onboarding-col" style="padding:24px;border-color:rgba(56,189,248,0.65);background:linear-gradient(160deg, rgba(23,37,84,0.65) 0%, rgba(19,26,39,0.95) 100%);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
              '<h2 style="font-size:25px;color:var(--accent-cyan);">📱 Pelo Celular (QR / Código)</h2>' +
            '</div>' +
            '<p style="color:var(--text-secondary);font-size:19px;margin-bottom:14px;">Gera um código de 6 caracteres e um QR Code na TV. No celular (' + escHtml(shownUrl) + ') você informa o código e envia sua lista; a TV carrega sozinha.</p>' +
            '<button id="btn-open-phone-pair" class="btn btn-primary focusable" data-action="open-phone-pairing" data-scope="onboarding">Abrir Código e QR Code na TV</button>' +
          '</div>' +
          '<div class="onboarding-col" style="padding:24px;margin-right:0;">' +
            '<h2 style="font-size:25px;margin-bottom:10px;">Lista atual</h2>' +
            (srcText
              ? '<p style="color:var(--text-secondary);font-size:19px;margin-bottom:6px;">' + srcText + '</p>' +
                '<p style="color:var(--text-secondary);font-size:19px;margin-bottom:14px;">' + total + ' itens no catálogo.</p>' +
                '<button id="btn-reload-source" class="btn btn-primary focusable" data-action="reload-source" data-scope="onboarding">↻ Atualizar Lista</button>'
              : '<p style="color:var(--text-secondary);font-size:19px;">Nenhuma lista carregada ainda. Use o pareamento pelo celular ao lado.</p>') +
          '</div>' +
        '</div>' +
      '</div>';
    global.LuminaFocus.restoreOrDefault('onboarding', '#btn-open-phone-pair');
  }

  function renderSettings(viewport) {
    var perfMode = global.LuminaStore.get('performanceMode') || 'auto';
    var isLite = global.LuminaStore.get('liteModeActive');
    var ratio = global.LuminaStore.get('defaultAspectRatio') || 'auto';
    var par = global.LuminaStore.get('parental') || { enabled: true, pin: '0000', unlockedSession: false };
    var tmdb = global.LuminaStore.get('tmdb') || { enabled: false, apiKey: '', enrichedCount: 0 };
    var pairUrl = global.LuminaStore.get('pairingBaseUrl') || global.LuminaPairing.DEFAULT_PAIRING_BASE_URL;

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Ajustes & Diagnóstico do Sistema</h1>' +
        '<p class="screen-subtitle">Configure Modo de Desempenho (webOS 23 / 5+), Controle Parental (+18), TMDB Opcional, Backup JSON e Telemetria:</p>' +
        '<div class="settings-grid">' +
          '<div class="settings-card">' +
            '<div>' +
              '<div class="settings-card-title">1. Desempenho & Modo Leve Automático</div>' +
              '<div class="settings-card-desc">Desativa animações e sombras pesadas automaticamente se detectar queda de quadros. Estado atual: <strong>' + (isLite ? 'MODO LEVE ATIVO' : 'PADRÃO 60fps') + '</strong></div>' +
            '</div>' +
            '<div>' +
              '<button id="set-perf-auto" class="btn btn-sm focusable' + (perfMode === 'auto' ? ' btn-primary' : '') + '" data-set-perf="auto" data-scope="settings">Automático</button>' +
              '<button id="set-perf-normal" class="btn btn-sm focusable' + (perfMode === 'normal' ? ' btn-primary' : '') + '" data-set-perf="normal" data-scope="settings">Normal</button>' +
              '<button id="set-perf-lite" class="btn btn-sm focusable' + (perfMode === 'lite' ? ' btn-primary' : '') + '" data-set-perf="lite" data-scope="settings">Forçar Modo Leve</button>' +
            '</div>' +
          '</div>' +

          '<div class="settings-card" style="margin-right:0;">' +
            '<div>' +
              '<div class="settings-card-title">2. Controle Parental (+18) & PIN de 4 Dígitos</div>' +
              '<div class="settings-card-desc">Protege categorias adultas com PIN (Padrão: <strong>' + par.pin + '</strong>) e oculta da Busca/Home. Sessão atual: <strong>' + (par.unlockedSession ? '🔓 Desbloqueada' : '🔒 Bloqueada') + '</strong></div>' +
            '</div>' +
            '<div>' +
              '<button id="set-pin-toggle" class="btn btn-sm btn-primary focusable" data-action="toggle-parental-lock" data-scope="settings">' + (par.unlockedSession ? '🔒 Bloquear Sessão +18' : '🔓 Desbloquear com PIN') + '</button>' +
              '<button id="set-pin-enable" class="btn btn-sm focusable" data-action="toggle-parental-enabled" data-scope="settings">' + (par.enabled ? 'Proteção: ATIVA' : 'Proteção: INATIVA') + '</button>' +
            '</div>' +
          '</div>' +

          '<div class="settings-card">' +
            '<div>' +
              '<div class="settings-card-title">3. Enriquecimento Opcional TMDB (pt-BR)</div>' +
              '<div class="settings-card-desc">Busca sinopses, gêneros e notas em português sem bloquear a navegação. Títulos enriquecidos no cache: <strong>' + (tmdb.enrichedCount || 0) + '</strong></div>' +
            '</div>' +
            '<div>' +
              '<button id="set-tmdb-run" class="btn btn-sm btn-primary focusable" data-action="run-tmdb-enrich" data-scope="settings">✨ Enriquecer Catálogo Agora (pt-BR)</button>' +
              '<button id="set-ratio-cycle" class="btn btn-sm focusable" data-action="cycle-default-ratio" data-scope="settings">Proporção Padrão: ' + ratio.toUpperCase() + '</button>' +
            '</div>' +
          '</div>' +

          '<div class="settings-card" style="margin-right:0;">' +
            '<div>' +
              '<div class="settings-card-title">4. Backup JSON, Cache & Painel de Diagnóstico</div>' +
              '<div class="settings-card-desc"><strong>Versão do app: 1.5.1.</strong> Servidor Mobile: <code>' + pairUrl.replace(/^https?:\/\//, '') + '</code>. Exporte ou restaure suas listas, favoritos e mapeamento em JSON.</div>' +
            '</div>' +
            '<div>' +
              '<button id="set-backup-export" class="btn btn-sm btn-primary focusable" data-action="backup-export" data-scope="settings">⬇ Exportar Backup JSON</button>' +
              '<button id="set-backup-restore" class="btn btn-sm focusable" data-action="backup-restore" data-scope="settings">⬆ Restaurar Backup</button>' +
              '<button id="set-diag-toggle" class="btn btn-sm focusable" data-action="toggle-diag" data-scope="settings">📊 Painel Diagnóstico</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('settings', '#set-perf-auto');
  }
  function renderPosterCatalog(viewport, sectionType) {
    var title = 'Filmes';
    var subtitle = 'Grade 2:3 com filtro por categoria e ordenação';
    var list = [];
    var cats = [];
    var activeCat = '';
    var allLabel = '';
    var themeCls = 'theme-movie';

    if (sectionType === 'movies') {
      title = 'Filmes';
      list = global.LuminaStore.get('movies') || [];
      cats = global.LuminaStore.get('movieCategories') || [];
      allLabel = 'Todos os Filmes';
      activeCat = selectedMovieCat;
      themeCls = 'theme-movie';
    } else if (sectionType === 'series') {
      title = 'Séries';
      list = global.LuminaStore.get('seriesList') || [];
      cats = global.LuminaStore.get('seriesCategories') || [];
      allLabel = 'Todas as Séries';
      activeCat = selectedSeriesCat;
      themeCls = 'theme-series';
    } else {
      title = 'Novelas';
      subtitle = 'Coleção virtual agrupada automaticamente por capítulos e regras de grupo';
      list = global.LuminaStore.get('novelasList') || [];
      cats = global.LuminaStore.get('novelaCategories') || [];
      allLabel = 'Todas as Novelas';
      activeCat = selectedNovelaCat;
      themeCls = 'theme-novela';
    }

    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i].groupDisplay || list[i].groupOriginal;
      if (activeCat === allLabel || g === activeCat) filtered.push(list[i]);
    }
    filtered = sortItems(filtered, currentSort);

    var catChips = '';
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      var sel = (cat.name === activeCat) ? ' is-selected' : '';
      catChips +=
        '<div id="cat-chip-' + c + '" class="chip focusable' + sel + '" data-cat-section="' + sectionType + '" data-cat-val="' + cat.name + '" data-scope="' + sectionType + '">' +
          cat.name + ' (' + cat.count + ')' +
        '</div>';
    }

    var sortChips =
      '<div class="chip-row">' +
        '<div id="sort-recent" class="chip focusable' + (currentSort === 'recent' ? ' is-selected' : '') + '" data-sort="recent" data-scope="' + sectionType + '">Recentes</div>' +
        '<div id="sort-name" class="chip focusable' + (currentSort === 'name' ? ' is-selected' : '') + '" data-sort="name" data-scope="' + sectionType + '">Nome A-Z</div>' +
        '<div id="sort-rating" class="chip focusable' + (currentSort === 'rating' ? ' is-selected' : '') + '" data-sort="rating" data-scope="' + sectionType + '">Nota ★</div>' +
      '</div>';

    var cardsHtml = '';
    var maxVisiblePosters = Math.min(filtered.length, 12);
    for (var j = 0; j < maxVisiblePosters; j++) {
      var it = filtered[j];
      var mono = (it.cleanTitle || 'TV').slice(0, 2).toUpperCase();
      var badgeRight = it.totalEpisodes ? (it.totalEpisodes + ' eps') : (it.quality || 'FHD');
      cardsHtml +=
        '<div id="poster-' + sectionType + '-' + j + '" class="poster-card focusable" data-detail-id="' + it.id + '" data-scope="' + sectionType + '">' +
          '<div class="poster-art ' + themeCls + '">' +
            '<div class="poster-badge-top">' +
              '<span class="badge-pill">' + badgeRight + '</span>' +
              (it.rating ? '<span class="badge-rating">★ ' + it.rating + '</span>' : '') +
            '</div>' +
            '<div class="poster-monogram">' + mono + '</div>' +
            '<div style="font-size:18px;color:rgba(255,255,255,0.75);">' + (it.year || 2024) + ' · ' + (it.lang || 'DUB') + '</div>' +
          '</div>' +
          '<div class="poster-meta">' +
            '<div class="poster-title">' + it.cleanTitle + '</div>' +
            '<div class="poster-sub">' + (it.groupDisplay || it.groupOriginal) + '</div>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">' + title + '</h1>' +
        '<p class="screen-subtitle">' + subtitle + '</p>' +
        '<div class="filter-bar">' +
          '<div class="chip-row">' + catChips + '</div>' +
          sortChips +
        '</div>' +
        '<div class="poster-grid">' + (cardsHtml || '<p>Nenhum item nesta categoria.</p>') + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault(sectionType, '#poster-' + sectionType + '-0');
  }

  function renderDetail(viewport) {
    var item = global.LuminaStore.get('selectedDetailItem');
    if (!item) {
      global.LuminaRouter.navigate('home');
      return;
    }

    var isShow = (item.kind === 'series-show' || item.kind === 'novela-show');
    var isFav = global.LuminaStore.isFavorite(item.id);
    var progMap = global.LuminaStore.get('watchProgress') || {};
    var mono = (item.cleanTitle || 'TV').slice(0, 2).toUpperCase();
    var themeCls = item.isNovela ? 'theme-novela' : (isShow ? 'theme-series' : 'theme-movie');

    if (!isShow) {
      var pr = progMap[item.id];
      var resumeLabel = (pr && pr.position > 5 && !pr.completed)
        ? ('▶ Continuar (' + pr.percent + '%)')
        : (pr && pr.completed ? '↺ Assistir Novamente (✓ Assistido)' : '▶ Assistir Filme');

      viewport.innerHTML =
        '<div>' +
          '<div class="detail-hero">' +
            '<div class="detail-poster-box ' + themeCls + '">' + mono + '</div>' +
            '<div class="detail-info">' +
              '<div>' +
                '<div style="color:var(--accent-cyan);font-size:20px;font-weight:700;">FILME VOD · CATÁLOGO PESSOAL</div>' +
                '<h1 style="font-size:44px;margin:6px 0;">' + item.cleanTitle + '</h1>' +
                '<div class="detail-meta-row">' +
                  '<span class="detail-meta-tag">' + (item.year || 2024) + '</span>' +
                  '<span class="detail-meta-tag">' + (item.quality || 'FHD') + '</span>' +
                  '<span class="detail-meta-tag">' + (item.lang || 'DUB') + '</span>' +
                  (item.rating ? '<span class="detail-meta-tag" style="color:var(--accent-amber);">★ ' + item.rating + '</span>' : '') +
                '</div>' +
                '<p style="color:var(--text-secondary);font-size:23px;max-width:1100px;">Grupo: ' + (item.groupDisplay || item.groupOriginal) + '. Reprodução com retomada automática do ponto exato e marcação de concluído aos 90%.</p>' +
              '</div>' +
              '<div style="margin-top:24px;">' +
                '<button id="detail-btn-play" class="btn btn-primary focusable" data-play-vod="' + item.id + '" data-scope="detail">' + resumeLabel + '</button>' +
                '<button id="detail-btn-fav" class="btn focusable" data-fav-id="' + item.id + '" data-scope="detail">' + (isFav ? '♥ Nos Favoritos' : '♡ Favoritar') + '</button>' +
                '<button id="detail-btn-back" class="btn focusable" data-action="back" data-scope="detail">Voltar</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('detail', '#detail-btn-play');
      return;
    }

    // Série ou Novela: Seletor de Temporada + Lista de Episódios com barra de progresso e marca de assistido
    var seasons = item.seasons || [];
    var selSeason = global.LuminaStore.get('selectedSeason') || (seasons[0] ? seasons[0].seasonNumber : 1);
    var activeEpisodes = [];
    for (var s = 0; s < seasons.length; s++) {
      if (seasons[s].seasonNumber === selSeason) {
        activeEpisodes = seasons[s].episodes;
        break;
      }
    }
    if (!activeEpisodes.length && seasons[0]) {
      activeEpisodes = seasons[0].episodes;
      selSeason = seasons[0].seasonNumber;
    }

    var seasonTabs = '';
    for (var st = 0; st < seasons.length; st++) {
      var sn = seasons[st].seasonNumber;
      var sCls = (sn === selSeason) ? ' is-selected' : '';
      seasonTabs +=
        '<div id="season-tab-' + sn + '" class="chip focusable' + sCls + '" data-season-num="' + sn + '" data-scope="detail">' +
          'Temporada ' + sn + ' (' + seasons[st].episodes.length + ' eps)' +
        '</div>';
    }

    var epRows = '';
    for (var e = 0; e < activeEpisodes.length; e++) {
      var ep = activeEpisodes[e];
      var epProg = progMap[ep.id] || { percent: 0, completed: false };
      var statusBadge = epProg.completed
        ? '<span style="color:var(--accent-success);font-weight:700;margin-right:16px;">✓ Assistido</span>'
        : (epProg.percent > 0 ? '<span style="color:var(--accent-cyan);margin-right:16px;">Em andamento (' + epProg.percent + '%)</span>' : '<span style="color:var(--text-muted);margin-right:16px;">Não iniciado</span>');

      epRows +=
        '<div id="ep-row-' + e + '" class="episode-row focusable" data-play-ep="' + ep.id + '" data-scope="detail">' +
          '<div style="display:flex;align-items:center;">' +
            '<span style="font-family:var(--font-mono);color:var(--accent-cyan);font-weight:700;width:95px;">T' + ep.season + ':E' + ep.episode + '</span>' +
            '<span style="font-weight:600;font-size:24px;">' + ep.cleanTitle + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;">' +
            statusBadge +
            '<span class="badge-pill">' + ep.quality + '</span>' +
            '<div class="ep-progress-bar"><div class="ep-progress-fill" style="width:' + (epProg.percent || 0) + '%;"></div></div>' +
          '</div>' +
        '</div>';
    }

    var firstEp = activeEpisodes[0];
    viewport.innerHTML =
      '<div>' +
        '<div class="detail-hero" style="padding:26px;margin-bottom:18px;">' +
          '<div class="detail-poster-box ' + themeCls + '" style="width:180px;height:250px;font-size:44px;">' + mono + '</div>' +
          '<div class="detail-info">' +
            '<div>' +
              '<div style="color:var(--accent-cyan);font-size:19px;font-weight:700;">' + (item.isNovela ? 'NOVELA · COLEÇÃO POR CAPÍTULOS' : 'SÉRIE · TEMPORADAS E EPISÓDIOS') + '</div>' +
              '<h1 style="font-size:40px;margin:4px 0;">' + item.cleanTitle + '</h1>' +
              '<div class="detail-meta-row">' +
                '<span class="detail-meta-tag">' + seasons.length + ' Temp.</span>' +
                '<span class="detail-meta-tag">' + item.totalEpisodes + ' Episódios</span>' +
                (item.rating ? '<span class="detail-meta-tag" style="color:var(--accent-amber);">★ ' + item.rating + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div>' +
              (firstEp ? '<button id="detail-btn-play-ep0" class="btn btn-primary focusable" data-play-ep="' + firstEp.id + '" data-scope="detail">▶ Assistir T' + firstEp.season + ':E' + firstEp.episode + '</button>' : '') +
              '<button id="detail-btn-fav" class="btn focusable" data-fav-id="' + item.id + '" data-scope="detail">' + (isFav ? '♥ Nos Favoritos' : '♡ Favoritar') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="chip-row" style="margin-bottom:16px;">' + seasonTabs + '</div>' +
        '<div class="episode-list">' + epRows + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('detail', '#ep-row-0');
  }

  function renderOrganizer(viewport) {
    var groups = global.LuminaStore.get('originalGroups') || [];
    var profile = global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
    var channels = global.LuminaStore.get('channels') || [];
    var movies = global.LuminaStore.get('movies') || [];
    var series = global.LuminaStore.get('seriesList') || [];
    var novelas = global.LuminaStore.get('novelasList') || [];

    var SUGG_LABELS = {
      'live': 'Canais',
      'movie': 'Filmes',
      'series': 'Séries',
      'novela': 'Novelas',
      'unclassified': 'Não classificado'
    };

    var rowsHtml = '';
    var maxRows = Math.min(groups.length, 7);
    for (var i = 0; i < maxRows; i++) {
      var g = groups[i];
      var curRule = (profile.mode === 'all_live') ? 'live' : ((profile.customGroupRules && profile.customGroupRules[g.originalName]) || g.suggested);
      rowsHtml +=
        '<div class="organizer-row">' +
          '<div class="org-group-info">' +
            '<div class="org-group-name">' + g.displayName + ' <span style="color:var(--accent-cyan);font-size:19px;">(' + g.count + ')</span></div>' +
            '<div class="org-group-sub">Original: ' + g.originalName + ' · Sugestão: ' + (SUGG_LABELS[g.suggested] || 'Auto') + '</div>' +
          '</div>' +
          '<div class="org-actions">' +
            '<button id="org-' + i + '-live" class="btn btn-sm focusable' + (curRule === 'live' ? ' is-active-target' : '') + '" data-org-group="' + g.originalName + '" data-org-target="live" data-scope="organizer">Canais</button>' +
            '<button id="org-' + i + '-movie" class="btn btn-sm focusable' + (curRule === 'movie' ? ' is-active-target' : '') + '" data-org-group="' + g.originalName + '" data-org-target="movie" data-scope="organizer">Filmes</button>' +
            '<button id="org-' + i + '-series" class="btn btn-sm focusable' + (curRule === 'series' ? ' is-active-target' : '') + '" data-org-group="' + g.originalName + '" data-org-target="series" data-scope="organizer">Séries</button>' +
            '<button id="org-' + i + '-novela" class="btn btn-sm focusable' + (curRule === 'novela' ? ' is-active-target' : '') + '" data-org-group="' + g.originalName + '" data-org-target="novela" data-scope="organizer">Novelas</button>' +
            '<button id="org-' + i + '-hidden" class="btn btn-sm focusable' + (curRule === 'hidden' ? ' is-active-target' : '') + '" data-org-group="' + g.originalName + '" data-org-target="hidden" data-scope="organizer">Ocultar</button>' +
            '<button id="org-' + i + '-up" class="btn btn-sm focusable" data-org-move="up" data-org-idx="' + i + '" data-scope="organizer">↑</button>' +
          '</div>' +
        '</div>';
    }

    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Organizar Minha Lista</h1>' +
        '<p class="screen-subtitle">Mapeie grupos originais para Canais, Filmes, Séries, Novelas ou Oculte. O perfil é salvo por lista e reaplicado automaticamente.</p>' +
        '<div class="organizer-header-bar">' +
          '<div class="preview-counts-row">' +
            '<span class="preview-pill">Canais: <strong style="color:var(--accent-cyan);">' + channels.length + '</strong></span>' +
            '<span class="preview-pill">Filmes: <strong style="color:var(--accent-cyan);">' + movies.length + '</strong></span>' +
            '<span class="preview-pill">Séries: <strong style="color:#A855F7;">' + series.length + '</strong></span>' +
            '<span class="preview-pill">Novelas: <strong style="color:var(--accent-amber);">' + novelas.length + '</strong></span>' +
          '</div>' +
          '<div>' +
            '<button id="org-prof-auto" class="btn btn-sm focusable' + (profile.mode === 'auto' ? ' is-active-target' : '') + '" data-org-profile="auto" data-scope="organizer">Perfil: Automático</button>' +
            '<button id="org-prof-alllive" class="btn btn-sm focusable' + (profile.mode === 'all_live' ? ' is-active-target' : '') + '" data-org-profile="all_live" data-scope="organizer">Tudo como Canais</button>' +
            '<button id="org-btn-export" class="btn btn-sm focusable" data-org-export="1" data-scope="organizer">Exportar JSON</button>' +
          '</div>' +
        '</div>' +
        '<div>' + (rowsHtml || '<p>Importe uma lista primeiro para organizar os grupos.</p>') + '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('organizer', '#org-prof-auto');
  }

  function renderLive(viewport) {
    var channels = global.LuminaStore.get('channels') || [];
    var categories = global.LuminaStore.get('categories') || [];
    if (!channels.length) { renderHome(viewport); return; }

    var filtered = [];
    for (var i = 0; i < channels.length; i++) {
      var g = channels[i].groupDisplay || channels[i].groupOriginal;
      if (selectedLiveCat === 'Todos os Canais' || g === selectedLiveCat) filtered.push(channels[i]);
    }

    var catHtml = '';
    for (var k = 0; k < categories.length; k++) {
      var cat = categories[k];
      var selCls = (cat.name === selectedLiveCat) ? ' is-selected' : '';
      catHtml +=
        '<div id="live-cat-' + k + '" class="cat-item focusable' + selCls + '" data-cat-name="' + cat.name + '" data-scope="live">' +
          '<span>' + cat.name + '</span>' +
          '<span class="cat-count">' + cat.count + '</span>' +
        '</div>';
    }

    var chHtml = '';
    var limit = Math.min(filtered.length, 8);
    for (var j = 0; j < limit; j++) {
      var ch = filtered[j];
      var isFav = global.LuminaStore.isFavorite(ch.id);
      chHtml +=
        '<div id="live-ch-' + j + '" class="channel-row-item focusable" data-channel-id="' + ch.id + '" data-scope="live">' +
          '<div class="channel-num">' + ch.channelNumber + '</div>' +
          '<div class="channel-logo-box">' + ch.cleanTitle.slice(0, 2).toUpperCase() + '</div>' +
          '<div class="channel-info">' +
            '<div class="channel-name">' + ch.cleanTitle + '</div>' +
            '<div class="channel-epg">' + (ch.groupDisplay || ch.groupOriginal) + ' · ' + ch.quality + '</div>' +
          '</div>' +
          (isFav ? '<div class="fav-badge">★</div>' : '') +
        '</div>';
    }

    var activeCh = filtered[0] || channels[0];
    viewport.innerHTML =
      '<div>' +
        '<h1 class="screen-title">Canais ao Vivo</h1>' +
        '<div class="live-layout">' +
          '<div class="live-cats">' + catHtml + '</div>' +
          '<div class="live-channels">' + chHtml + '</div>' +
          '<div class="live-preview-pane">' +
            '<div class="preview-stage-box">' +
              '<div style="font-size:21px;color:var(--accent-cyan);margin-bottom:8px;">CANAL #' + activeCh.channelNumber + '</div>' +
              '<div style="font-size:32px;font-weight:700;margin-bottom:8px;">' + activeCh.cleanTitle + '</div>' +
              '<div style="color:var(--text-secondary);font-size:21px;">' + activeCh.groupOriginal + ' · ' + activeCh.quality + '</div>' +
            '</div>' +
            '<div>' +
              '<button id="btn-fullscreen-live" class="btn btn-primary focusable" data-play-id="' + activeCh.id + '" data-scope="live">Tela Cheia</button>' +
              '<button id="btn-last-ch" class="btn focusable" data-action="last-channel" data-scope="live">Último Canal</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    global.LuminaFocus.restoreOrDefault('live', '#live-ch-0');
  }

  
  function renderFavorites(viewport) {
    var items = global.LuminaStore.get('items') || [];
    var favs = [];
    for (var i = 0; i < items.length; i++) {
      if (global.LuminaStore.isFavorite(items[i].id)) favs.push(items[i]);
    }
    if (!favs.length) {
      viewport.innerHTML =
        '<div>' +
          '<h1 class="screen-title">Meus Favoritos</h1>' +
          '<p class="screen-subtitle">Pressione a tecla AMARELA no controle remoto da LG TV ou o botão Favoritar para salvar canais, filmes, séries e novelas.</p>' +
          '<div class="empty-state-panel">' +
            '<div class="empty-state-illustration">' +
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 140" style="width:100%;height:100%;">' +
                '<rect x="16" y="18" width="188" height="104" rx="14" fill="#131B2E" stroke="rgba(245,158,11,0.45)" stroke-width="2"/>' +
                '<path d="M110 34l9.5 19.3 21.3 3.1-15.4 15 3.6 21.2-19-10-19 10 3.6-21.2-15.4-15 21.3-3.1L110 34z" fill="rgba(245,158,11,0.22)" stroke="#F59E0B" stroke-width="2.5"/>' +
              '</svg>' +
            '</div>' +
            '<div>' +
              '<h2 style="font-size:32px;margin-bottom:10px;">Sua lista de Favoritos está vazia</h2>' +
              '<p style="color:var(--text-secondary);font-size:21px;margin-bottom:20px;">Adicione seus canais ao vivo e títulos VOD prediletos para acesso instantâneo na Home.</p>' +
              '<button id="fav-go-home" class="btn btn-primary focusable" data-nav="home" data-scope="favorites">Explorar Catálogo</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      global.LuminaFocus.restoreOrDefault('favorites', '#fav-go-home');
      return;
    }
    var html = '<h1 class="screen-title">Meus Favoritos (' + favs.length + ')</h1><div style="max-width:960px;">';
    for (var j = 0; j < favs.length; j++) {
      var it = favs[j];
      html +=
        '<div id="fav-item-' + j + '" class="channel-row-item focusable" data-detail-id="' + it.id + '" data-scope="favorites">' +
          '<div class="channel-info"><div class="channel-name">' + it.cleanTitle + '</div><div class="channel-epg">' + it.groupMapped + ' · ' + it.groupOriginal + '</div></div>' +
          '<div class="fav-badge">★</div>' +
        '</div>';
    }
    html += '</div>';
    viewport.innerHTML = html;
    global.LuminaFocus.restoreOrDefault('favorites', '#fav-item-0');
  }

  
  function renderCurrentRoute() {
    var route = global.LuminaRouter.getCurrent();
    var viewport = document.getElementById('screen-viewport');
    var osd = document.getElementById('player-osd');
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
    var byId = global.LuminaStore.get('itemByIdMap');
    if (byId && byId[id]) return byId[id];
    var items = global.LuminaStore.get('items') || [];
    for (var m = 0; m < items.length; m++) if (items[m].id === id) return items[m];
    return null;
  }

  function bindGlobalActions() {
    global.LuminaEventBus.on('route:changed', renderCurrentRoute);

    global.LuminaEventBus.on('diag:toggle', function () {
      var cur = !!global.LuminaStore.get('diagnosticsVisible');
      global.LuminaStore.set('diagnosticsVisible', !cur);
      renderDiagnosticsOverlay();
      toast(!cur ? 'Painel de Diagnóstico ativado (R·G·Y·B)' : 'Painel de Diagnóstico ocultado');
    });

    global.LuminaEventBus.on('focus:changed', function (el) {
      var nav = document.getElementById('side-nav');
      if (!nav || !el) return;
      if (nav.contains(el)) nav.classList.add('is-expanded');
      else nav.classList.remove('is-expanded');
    });

    global.LuminaEventBus.on('focus:select', function (el) {
      if (!el) return;
      if (global.LuminaStore.get('loading')) return;

      // Player com o painel escondido: OK só mostra o painel (antes pausava sem querer)
      if (global.LuminaRouter.getCurrent() === 'player-fullscreen') {
        var osdBox = document.getElementById('player-osd');
        if (osdBox && osdBox.classList.contains('hidden')) { global.LuminaOSD.show(); return; }
      }

      // Teclado de PIN Parental (Modal 10-foot)
      var pinDigit = el.getAttribute('data-pin-digit');
      if (pinDigit !== null && pinDigit !== undefined) {
        pinDraft += String(pinDigit);
        if (pinDraft.length >= 4) {
          if (global.LuminaStore.verifyParentalPin(pinDraft)) {
            var cb = pendingPinCallback;
            closeParentalPinModal();
            toast('🔓 PIN Parental validado! Conteúdo +18 desbloqueado.');
            if (cb) cb();
          } else {
            pinDraft = '';
            toast('PIN incorreto! Tente novamente (padrão: 0000).');
            renderParentalPinModal();
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

      var osdAction = el.getAttribute('data-osd-action');
      if (osdAction) {
        global.LuminaOSD.handleAction(osdAction);
        return;
      }

      // Categoria de Canais ao Vivo (com proteção de PIN em categorias adultas)
      var liveCatName = el.getAttribute('data-cat-name');
      if (liveCatName) {
        var isAdultCat = /adult|\+18|xxx/i.test(liveCatName);
        var parState = global.LuminaStore.get('parental') || { enabled: true, unlockedSession: false };
        if (isAdultCat && parState.enabled && !parState.unlockedSession) {
          openParentalPinModal(function () {
            selectedLiveCat = liveCatName;
            renderCurrentRoute();
          });
          return;
        }
        selectedLiveCat = liveCatName;
        renderCurrentRoute();
        return;
      }

      var chRowId = el.getAttribute('data-channel-id');
      if (chRowId) {
        var allCh = global.LuminaStore.get('channels') || [];
        for (var cIdx = 0; cIdx < allCh.length; cIdx++) {
          if (allCh[cIdx].id === chRowId) {
            var targetCh = allCh[cIdx];
            if (isItemLockedByParental(targetCh)) {
              openParentalPinModal(function () {
                global.LuminaPlayer.open(targetCh);
                global.LuminaRouter.navigate('player-fullscreen');
              });
              return;
            }
            global.LuminaPlayer.open(targetCh);
            global.LuminaRouter.navigate('player-fullscreen');
            return;
          }
        }
      }

      // Teclado Virtual da Busca
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

      var catSection = el.getAttribute('data-cat-section');
      if (catSection) {
        var val = el.getAttribute('data-cat-val');
        if (catSection === 'movies') selectedMovieCat = val;
        else if (catSection === 'series') selectedSeriesCat = val;
        else if (catSection === 'novelas') selectedNovelaCat = val;
        renderCurrentRoute();
        return;
      }

      var detailId = el.getAttribute('data-detail-id');
      if (detailId) {
        var found = findShowOrItemById(detailId);
        if (found) {
          if (isItemLockedByParental(found)) {
            openParentalPinModal(function () {
              global.LuminaStore.set('selectedDetailItem', found);
              global.LuminaStore.set('selectedSeason', 1);
              global.LuminaRouter.navigate('detail');
            });
            return;
          }
          global.LuminaStore.set('selectedDetailItem', found);
          global.LuminaStore.set('selectedSeason', 1);
          global.LuminaRouter.navigate('detail');
        }
        return;
      }

      var seasonNum = el.getAttribute('data-season-num');
      if (seasonNum) {
        global.LuminaStore.set('selectedSeason', parseInt(seasonNum, 10));
        renderCurrentRoute();
        return;
      }

      var playVodId = el.getAttribute('data-play-vod') || el.getAttribute('data-play-ep') || el.getAttribute('data-play-id');
      if (playVodId) {
        var items = global.LuminaStore.get('items') || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === playVodId) {
            var targetItem = items[i];
            if (isItemLockedByParental(targetItem)) {
              openParentalPinModal(function () {
                global.LuminaPlayer.open(targetItem);
                global.LuminaRouter.navigate('player-fullscreen');
              });
              return;
            }
            global.LuminaPlayer.open(targetItem);
            global.LuminaRouter.navigate('player-fullscreen');
            return;
          }
        }
      }

      var favId = el.getAttribute('data-fav-id');
      if (favId) {
        var nowFav = global.LuminaStore.toggleFavorite(favId);
        toast(nowFav ? 'Adicionado aos Favoritos ★' : 'Removido dos Favoritos');
        renderCurrentRoute();
        return;
      }

      var orgGroup = el.getAttribute('data-org-group');
      if (orgGroup) {
        var target = el.getAttribute('data-org-target');
        var prof = global.LuminaStore.get('mappingProfile') || { mode: 'custom', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
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
        var pr = global.LuminaStore.get('mappingProfile') || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] };
        pr.mode = orgProfile;
        if (orgProfile === 'auto') pr.customGroupRules = {};
        global.LuminaRepository.applyMappingAndPersist(pr, function () {
          toast(orgProfile === 'all_live' ? 'Perfil aplicado: Tudo como Canais' : 'Perfil aplicado: Automático');
          renderCurrentRoute();
        });
        return;
      }

      if (el.getAttribute('data-org-export')) {
        var jsonStr = JSON.stringify(global.LuminaStore.get('mappingProfile'), null, 2);
        global.LuminaStorage.saveMeta('exportedMappingJson', jsonStr);
        toast('Mapeamento exportado em JSON com sucesso!');
        return;
      }

      // Ações de Ajustes (Fase 4)
      var setPerf = el.getAttribute('data-set-perf');
      if (setPerf) {
        global.LuminaStore.set('performanceMode', setPerf);
        toast('Modo de desempenho alterado para: ' + setPerf.toUpperCase());
        renderCurrentRoute();
        return;
      }

      var action = el.getAttribute('data-action');
      if (action === 'go-phone-pairing' || action === 'open-phone-pairing' || action === 'renew-phone-code') {
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
        if (!curSrc) { toast('Nenhuma lista salva. Faça o pareamento pelo celular.'); return; }
        showLoading('Atualizando lista');
        global.LuminaPairing.applyMobilePayload(
          curSrc.type === 'xtream'
            ? { type: 'xtream', name: curSrc.name, host: curSrc.creds.server, port: 0, username: curSrc.creds.username, password: curSrc.creds.password }
            : curSrc,
          function (err, list) {
            hideLoading();
            if (err) { toast(err.message); return; }
            toast('✔ Lista atualizada: ' + list.length + ' itens!');
            renderCurrentRoute();
          },
          onLoadProgress
        );
      } else if (action === 'toggle-parental-lock') {
        var p = global.LuminaStore.get('parental') || { enabled: true, pin: '0000', unlockedSession: false };
        if (p.unlockedSession) {
          p.unlockedSession = false;
          global.LuminaStore.set('parental', p);
          toast('🔒 Sessão +18 bloqueada novamente.');
          renderCurrentRoute();
        } else {
          openParentalPinModal(function () {
            renderCurrentRoute();
          });
        }
      } else if (action === 'toggle-parental-enabled') {
        var pe = global.LuminaStore.get('parental') || { enabled: true, pin: '0000', unlockedSession: false };
        pe.enabled = !pe.enabled;
        global.LuminaStore.set('parental', pe);
        toast(pe.enabled ? 'Controle Parental ATIVADO' : 'Controle Parental DESATIVADO');
        renderCurrentRoute();
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
        toast('Proporção de vídeo padrão: ' + nextR.toUpperCase());
        renderCurrentRoute();
      } else if (action === 'backup-export') {
        var bkp = global.LuminaStore.exportFullBackupJson();
        global.LuminaStorage.saveMeta('fullBackupJson', bkp);
        toast('⬇ Backup completo exportado em JSON (' + bkp.length + ' bytes)!');
      } else if (action === 'backup-restore') {
        global.LuminaStorage.loadMeta('fullBackupJson', null, function (savedBkp) {
          if (!savedBkp) {
            savedBkp = global.LuminaStore.exportFullBackupJson();
          }
          global.LuminaStore.importFullBackupJson(savedBkp);
          toast('⬆ Backup JSON restaurado com sucesso!');
          renderCurrentRoute();
        });
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
    var splash = document.getElementById('boot-splash');
    if (splash && !splash.classList.contains('is-dismissed')) {
      splash.classList.add('is-dismissed');
      setTimeout(function () {
        if (splash.parentNode) splash.style.display = 'none';
      }, 360);
    }
  }

  global.LuminaUI = {
    init: function () {
      bindGlobalActions();
      renderCurrentRoute();
      setTimeout(dismissBootSplash, 650);
    },
    toast: toast,
    showLoading: showLoading,
    setLoading: setLoading,
    hideLoading: hideLoading,
    renderCurrentRoute: renderCurrentRoute,
    openParentalPinModal: openParentalPinModal,
    dismissBootSplash: dismissBootSplash
  };
})(typeof window !== 'undefined' ? window : global);
