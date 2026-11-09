/**
 * Lumina TV - Interface de Usuario Principal (v2.2.1)
 * Arquitetura 10-foot por demanda:
 * - Zero catalogo completo na RAM; consome apenas LuminaCatalog (getGroups, getPage, getItem, search, getRecent).
 * - Estado isolado por aba ('live' | 'vod' | 'series') com maquina de estados:
 *   idle -> loading_groups -> loading_page -> ready | empty | error | syncing
 * - Pool de slots reciclados (24 cards para grade 6x4, 10 linhas para lista de canais) sem destruir nos no scroll.
 * - Fila dedicada de 6 imagens simultaneas com IntersectionObserver / visibilidade de viewport + monograma tipografico deterministico.
 * - Busca por aba (Canais, Filmes, Series) com teclado 9 colunas e filtros locais (categoria, ano, audio).
 * - Compativel com ES5 (LG webOS + Android Fire TV WebView).
 */
var LuminaUI = (function () {
    'use strict';

    var MENU_ITEMS = [
        { route: 'home', label: 'Início', icon: 'home' },
        { route: 'live', label: 'Canais', icon: 'tv' },
        { route: 'vod', label: 'Filmes', icon: 'film' },
        { route: 'series', label: 'Séries', icon: 'layers' },
        { route: 'favorites', label: 'Favoritos', icon: 'star' },
        { route: 'settings', label: 'Ajustes', icon: 'settings' }
    ];

    var SVG_ICONS = {
        home: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/></svg>',
        tv: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="13" rx="2.2"/><path d="M8 21h8"/><path d="M12 18v3"/></svg>',
        film: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="2.2"/><path d="M7 4v16M17 4v16M2.5 9h4.5M17 9h4.5M2.5 15h4.5M17 15h4.5"/></svg>',
        layers: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 3 2 8 12 13 22 8 12 3"/><path d="M2 12.5l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>',
        star: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2.5 14.9 8.4 21.5 9.3 16.7 14 17.8 20.5 12 17.4 6.2 20.5 7.3 14 2.5 9.3 9.1 8.4 12 2.5"/></svg>',
        search: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>',
        settings: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        lock: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
        play: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg>',
        smartphone: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.2"/><path d="M11 18h2"/></svg>',
        link: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.8"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.2"/></svg>',
        key: '<svg class="ui-svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4"/><path d="M18 5l2 2"/><path d="M15 8l2 2"/></svg>'
    };

    var BRAND_SYMBOL_SVG = '<svg class="brand-mark-svg" viewBox="0 0 100 100" aria-hidden="true">' +
        '<defs>' +
        '<linearGradient id="luminaGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#F6D889"/>' +
        '<stop offset="52%" stop-color="#E8B954"/>' +
        '<stop offset="100%" stop-color="#B88728"/>' +
        '</linearGradient>' +
        '<linearGradient id="luminaBeamGrad" x1="0%" y1="50%" x2="100%" y2="25%">' +
        '<stop offset="0%" stop-color="#F6D889" stop-opacity="0.92"/>' +
        '<stop offset="45%" stop-color="#E8B954" stop-opacity="0.40"/>' +
        '<stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>' +
        '</linearGradient>' +
        '</defs>' +
        '<rect x="6" y="6" width="88" height="88" rx="22" fill="#0B0F17" stroke="#232B3A" stroke-width="2"/>' +
        '<polygon points="34,26 86,18 86,82 34,70" fill="url(#luminaBeamGrad)"/>' +
        '<path d="M26 24C26 21.8 27.8 20 30 20H37C39.2 20 41 21.8 41 24V63H66C68.2 63 70 64.8 70 67V74C70 76.2 68.2 78 66 78H30C27.8 78 26 76.2 26 74V24Z" fill="url(#luminaGoldGrad)"/>' +
        '<circle cx="33.5" cy="27.5" r="2.5" fill="#FFF8E7" opacity="0.85"/>' +
        '</svg>';

    var LETTERS = ['ALL', '#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

    var elSidebar = null;
    var elMain = null;
    var elModalRoot = null;
    var elToastRoot = null;
    var toastTimer = null;

    var PAGE_SIZE = 200;
    var GRID_COLUMNS = 6;
    var GRID_SLOT_COUNT = 24; // 4 linhas visiveis x 6 colunas
    var LIVE_SLOT_COUNT = 10; // 10 canais visiveis simultaneamente
    var MAX_CONCURRENT_IMAGES = 6;

    // Maquina de estados isolada por aba ('live' | 'vod' | 'series')
    function createInitialTabState(section) {
        return {
            section: section,
            status: 'idle', // 'idle' | 'loading_groups' | 'loading_page' | 'ready' | 'empty' | 'error' | 'syncing'
            errorMessage: '',
            groups: [],
            selectedGroup: 'ALL',
            groupItemOffset: 0,
            sortOrder: 'default', // 'default' | 'az'
            activeLetter: 'ALL',
            letterJumpTable: null,
            totalInFilter: 0,
            loadedPages: {}, // pageIndex -> Array<Item>
            loadingPages: {},
            slotOffset: 0, // Indice inicial da janela de slots reciclados
            focusedIndex: 0,
            focusAnchorId: null,
            focusedGroupIndex: 0,
            previewChannelId: null,
            searchOpen: false,
            searchQuery: '',
            searchYearFilter: 'ALL',
            searchAudioFilter: 'ALL',
            searchGroupFilter: 'ALL',
            searchResults: [],
            searchTotalMatches: 0,
            searchNextCursor: null,
            searchMessage: '',
            searchLoading: false,
            searchSlotOffset: 0,
            requestToken: 0
        };
    }

    var tabStates = {
        live: createInitialTabState('live'),
        vod: createInitialTabState('vod'),
        series: createInitialTabState('series')
    };

    var uiState = {
        favoritesTab: 'all',
        detailItem: null,
        detailSeries: null,
        detailSeason: null,
        detailEpisodeOffset: 0,
        settingsModal: null,
        pairingSession: null,
        homeData: {
            listState: null,
            continueWatching: [],
            recentLive: [],
            recentVod: [],
            recentSeries: [],
            favorites: [],
            loading: false
        },
        syncBanner: null
    };

    // Fila de carregamento de imagens limitada a 6 simultaneas (Parte 7.4)
    var imageQueue = [];
    var activeImageLoads = 0;
    var failedImageUrls = {};
    var loadedImageUrls = {};


    var POSTER_PALETTES = [
        ["#131B2E", "#0B0F17"], ["#1F1A2C", "#0D0F18"], ["#112229", "#0A1017"], ["#251C15", "#0E0C0A"],
        ["#17231E", "#0B110E"], ["#231621", "#0D0A0E"], ["#142030", "#090E16"], ["#201E17", "#0C0B09"],
        ["#162426", "#0A1112"], ["#1C182B", "#0B0912"], ["#261919", "#0E0A0A"], ["#182218", "#0A0E0A"]
    ];
    var POSTER_MOTIFS = ["beam", "rings", "grid", "waves", "prism", "horizon"];

    function generateDeterministicArtSvg(title) {
        var mono = computeMonogramData(title);
        var clean = String(title || "Lumina");
        var hash = 0;
        for (var i = 0; i < clean.length; i++) {
            hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
        }
        var pal = POSTER_PALETTES[Math.abs(hash) % POSTER_PALETTES.length];
        var motif = POSTER_MOTIFS[Math.abs(hash >> 3) % POSTER_MOTIFS.length];
        return "<svg class=\"poster-motif-svg\" viewBox=\"0 0 200 300\" data-motif=\"" + motif + "\">" +
            "<rect width=\"200\" height=\"300\" fill=\"" + pal[0] + "\"/>" +
            "<circle cx=\"160\" cy=\"60\" r=\"80\" fill=\"" + pal[1] + "\" opacity=\"0.45\"/>" +
            "<text x=\"100\" y=\"162\" text-anchor=\"middle\" fill=\"#F6D889\" font-size=\"48\" font-weight=\"700\">" + escapeHtml(mono.initials) + "</text>" +
            "</svg>";
    }

    function getGreetingByHour(h) {
        var hour = typeof h === "number" ? h : (new Date()).getHours();
        if (hour >= 5 && hour < 12) return "Bom dia";
        if (hour >= 12 && hour < 18) return "Boa tarde";
        return "Boa noite";
    }

    function computeIntroTimeline(totalMs, mode) {
        var dur = Number(totalMs) || 3500;
        return {
            mode: mode || "COMPLETA",
            totalMs: dur,
            beamStartMs: 250,
            logoStartMs: 700,
            flipStartMs: Math.max(0, dur - 500)
        };
    }

    function getIconSvg(name) {
        return SVG_ICONS[name] || SVG_ICONS.tv;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatNumber(n) {
        var num = Number(n) || 0;
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    /**
     * Gera monograma tipografico deterministico (2 iniciais + gradiente escuro elegante)
     * quando nao ha poster/logo ou quando a imagem falha (Parte 7.4).
     */
    function computeMonogramData(title) {
        var clean = String(title || 'Lumina').replace(/[^\w\sÀ-ÿ]/g, ' ').replace(/\s+/g, ' ').trim();
        var words = clean ? clean.split(' ') : ['L', 'T'];
        var initials = '';
        if (words.length >= 2) {
            initials = (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
        } else if (words[0]) {
            initials = words[0].substring(0, 2).toUpperCase();
        } else {
            initials = 'TV';
        }
        var hash = 2166136261;
        for (var i = 0; i < clean.length; i++) {
            hash ^= clean.charCodeAt(i);
            hash = Math.imul ? Math.imul(hash, 16777619) : (hash * 16777619) | 0;
        }
        var palettes = [
            'linear-gradient(145deg, #131B2E 0%, #0B0F17 100%)',
            'linear-gradient(145deg, #1F1A2C 0%, #0D0F18 100%)',
            'linear-gradient(145deg, #112229 0%, #0A1017 100%)',
            'linear-gradient(145deg, #251C15 0%, #0E0C0A 100%)',
            'linear-gradient(145deg, #17231E 0%, #0B110E 100%)'
        ];
        var idx = Math.abs(hash) % palettes.length;
        return {
            initials: initials,
            gradient: palettes[idx]
        };
    }

    /**
     * Enfileira carregamento de imagem com limite maximo de 6 simultaneas.
     */
    function enqueuePosterLoad(imgEl, url, fallbackEl) {
        if (!imgEl) return;
        if (!url || failedImageUrls[url]) {
            imgEl.style.display = 'none';
            if (fallbackEl) fallbackEl.style.display = 'flex';
            return;
        }
        if (loadedImageUrls[url]) {
            imgEl.src = url;
            imgEl.style.display = 'block';
            if (fallbackEl) fallbackEl.style.display = 'none';
            return;
        }
        imgEl.setAttribute('data-pending-src', url);
        imageQueue.push({
            imgEl: imgEl,
            url: url,
            fallbackEl: fallbackEl
        });
        pumpImageQueue();
    }

    function cancelOffscreenImageLoads() {
        var remaining = [];
        for (var i = 0; i < imageQueue.length; i++) {
            var task = imageQueue[i];
            if (task.imgEl && document.body && document.body.contains(task.imgEl) &&
                task.imgEl.getAttribute('data-pending-src') === task.url) {
                remaining.push(task);
            }
        }
        imageQueue = remaining;
    }

    function pumpImageQueue() {
        cancelOffscreenImageLoads();
        while (activeImageLoads < MAX_CONCURRENT_IMAGES && imageQueue.length > 0) {
            var task = imageQueue.shift();
            if (!task || !task.imgEl) continue;
            if (task.imgEl.getAttribute('data-pending-src') !== task.url) continue;
            activeImageLoads++;
            loadSingleImageTask(task);
        }
    }

    function loadSingleImageTask(task) {
        var probe = new Image();
        var done = false;
        function finish(ok) {
            if (done) return;
            done = true;
            activeImageLoads = Math.max(0, activeImageLoads - 1);
            if (ok) {
                loadedImageUrls[task.url] = true;
                if (task.imgEl && task.imgEl.getAttribute('data-pending-src') === task.url) {
                    task.imgEl.src = task.url;
                    task.imgEl.style.display = 'block';
                    if (task.fallbackEl) task.fallbackEl.style.display = 'none';
                }
            } else {
                failedImageUrls[task.url] = true;
                if (task.imgEl && task.imgEl.getAttribute('data-pending-src') === task.url) {
                    task.imgEl.style.display = 'none';
                    if (task.fallbackEl) task.fallbackEl.style.display = 'flex';
                }
            }
            pumpImageQueue();
        }
        probe.onload = function () { finish(true); };
        probe.onerror = function () { finish(false); };
        probe.src = task.url;
    }

    function dismissBootSplash() {
        if (typeof document === 'undefined') return;
        var splash = document.getElementById('boot-splash');
        if (splash && !splash.classList.contains('is-dismissed')) {
            splash.classList.remove('is-animating');
            splash.classList.add('is-dismissed');
            setTimeout(function () {
                if (splash && splash.parentNode) splash.style.display = 'none';
            }, 250);
        }
    }

    function isBootSplashVisible() {
        if (typeof document === 'undefined') return false;
        var splash = document.getElementById('boot-splash');
        return !!(splash && !splash.classList.contains('is-dismissed') && splash.style.display !== 'none');
    }

    function init() {
        elSidebar = document.getElementById('side-nav') || document.getElementById('sidebar-nav');
        elMain = document.getElementById('screen-viewport') || document.getElementById('screen-container');
        elModalRoot = document.getElementById('modal-backdrop') || document.getElementById('modal-root');
        elToastRoot = document.getElementById('toast-container') || document.getElementById('toast-root');

        dismissBootSplash();

        renderSidebar();

        LuminaRouter.onChange(function (routeInfo) {
            updateSidebarActive(routeInfo.route);
            renderRoute(routeInfo.route, routeInfo.params);
        });

        if (typeof LuminaCatalog !== 'undefined' && LuminaCatalog.subscribe) {
            LuminaCatalog.subscribe(function (evt) {
                handleCatalogEvent(evt);
            });
        }

        window.addEventListener('lumina:key', function (e) {
            var detail = e.detail || {};
            var route = LuminaRouter.getCurrentRoute();

            if (detail.action === 'BACK') {
                // Se modal de busca da aba estiver aberto, fecha apenas a busca da aba
                if ((route === 'live' || route === 'vod' || route === 'series') && tabStates[route] && tabStates[route].searchOpen) {
                    closeTabSearch(route);
                    return;
                }
                if (elModalRoot && !elModalRoot.classList.contains('hidden')) {
                    closeModal();
                    return;
                }
                if (route === 'player') {
                    LuminaPlayer.stop();
                    var prev = LuminaRouter.back();
                    if (!prev) LuminaRouter.navigate('home');
                    return;
                }
                if (route === 'detail') {
                    var backTarget = LuminaRouter.back();
                    if (!backTarget) LuminaRouter.navigate('vod');
                    return;
                }
                if (route !== 'home') {
                    LuminaRouter.navigate('home');
                    return;
                }
            }

            if (route === 'player') {
                LuminaOSD.handlePlayerKey(detail.action, detail.keyCode);
            }
        });
    }

    function handleCatalogEvent(evt) {
        if (!evt || !evt.type) return;
        if (evt.type === 'progress') {
            uiState.syncBanner = {
                active: true,
                stage: evt.stage || 'importing',
                message: evt.message || 'Sincronizando catálogo em segundo plano...',
                itemsProcessed: evt.itemsProcessed || 0
            };
            updateSyncBannerDOM();
        } else if (evt.type === 'SyncCompleted' || evt.type === 'CatalogCleared') {
            uiState.syncBanner = null;
            updateSyncBannerDOM();
            resetAllTabCaches();
            var current = LuminaRouter.getCurrentRoute();
            if (current === 'home' || current === 'live' || current === 'vod' || current === 'series' || current === 'settings') {
                renderRoute(current, LuminaRouter.getParams());
            }
        } else if (evt.type === 'SyncFailed') {
            uiState.syncBanner = null;
            updateSyncBannerDOM();
            showToast(evt.message || 'Falha ao sincronizar lista. Catálogo anterior preservado.', 'error');
        }
    }

    function resetAllTabCaches() {
        tabStates.live = createInitialTabState('live');
        tabStates.vod = createInitialTabState('vod');
        tabStates.series = createInitialTabState('series');
    }

    function updateSyncBannerDOM() {
        var existing = document.getElementById('lumina-bg-sync-banner');
        if (!uiState.syncBanner || !uiState.syncBanner.active) {
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            return;
        }
        if (!existing && elMain) {
            existing = document.createElement('div');
            existing.id = 'lumina-bg-sync-banner';
            existing.className = 'bg-sync-banner';
            elMain.appendChild(existing);
        }
        if (existing) {
            existing.textContent = uiState.syncBanner.message +
                (uiState.syncBanner.itemsProcessed ? ' (' + formatNumber(uiState.syncBanner.itemsProcessed) + ' itens)' : '');
        }
    }

    function renderSidebar() {
        if (!elSidebar) return;
        var html = '<div class="sidebar-brand">' +
            '<div class="brand-logo">' + BRAND_SYMBOL_SVG + '</div>' +
            '<div class="brand-text">' +
            '<div class="brand-title">LUMINA</div>' +
            '<div class="brand-subtitle">SMART TV</div>' +
            '</div>' +
            '</div>' +
            '<div class="sidebar-menu">';

        for (var i = 0; i < MENU_ITEMS.length; i++) {
            var item = MENU_ITEMS[i];
            html += '<button type="button" class="sidebar-btn focusable" ' +
                'data-zone="sidebar" data-route="' + item.route + '" tabindex="-1">' +
                '<span class="sidebar-icon">' + getIconSvg(item.icon) + '</span>' +
                '<span class="sidebar-label">' + escapeHtml(item.label) + '</span>' +
                '</button>';
        }
        html += '</div>';
        elSidebar.innerHTML = html;

        var buttons = elSidebar.querySelectorAll('.sidebar-btn');
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].addEventListener('click', function () {
                var targetRoute = this.getAttribute('data-route');
                LuminaRouter.navigate(targetRoute);
            });
        }
    }

    function updateSidebarActive(route) {
        if (!elSidebar) return;
        var buttons = elSidebar.querySelectorAll('.sidebar-btn');
        for (var i = 0; i < buttons.length; i++) {
            var r = buttons[i].getAttribute('data-route');
            if (r === route) {
                buttons[i].classList.add('active');
            } else {
                buttons[i].classList.remove('active');
            }
        }
        if (route === 'player') {
            elSidebar.classList.add('hidden');
        } else {
            elSidebar.classList.remove('hidden');
        }
    }

    function renderRoute(route, params) {
        dismissBootSplash();
        if (!elMain) return;
        cancelOffscreenImageLoads();

        if (route !== 'player' && LuminaPlayer.getState().playing) {
            LuminaPlayer.stop();
        }

        if (route === 'player') {
            elMain.classList.add('player-mode');
        } else {
            elMain.classList.remove('player-mode');
        }

        switch (route) {
            case 'home':
                renderHome();
                break;
            case 'live':
                renderCatalogTab('live');
                break;
            case 'vod':
                renderCatalogTab('vod');
                break;
            case 'series':
                renderCatalogTab('series');
                break;
            case 'favorites':
                renderFavorites();
                break;
            case 'settings':
                renderSettings(params);
                break;
            case 'detail':
                renderDetail(params);
                break;
            case 'player':
                renderPlayerScreen(params);
                break;
            default:
                renderHome();
                break;
        }
    }

    // =========================================================================
    // TELA INICIAL (HOME) - Leituras leves via LuminaCatalog (Parte 7.2)
    // =========================================================================
    function renderHome() {
        var activeSource = LuminaSettings.getActivePlaylist();
        var listState = LuminaCatalog.getListStateSync();
        var hasCatalog = listState && listState.totalCount > 0;

        if (!activeSource && !hasCatalog) {
            renderHomeOnboarding();
            return;
        }

        // Busca assincrona leve apenas dos trilhos de recentes (max 12 itens cada)
        LuminaCatalog.getListState().then(function (freshState) {
            uiState.homeData.listState = freshState;
            return Promise.all([
                LuminaCatalog.getRecent('live', 12),
                LuminaCatalog.getRecent('vod', 12),
                LuminaCatalog.getRecent('series', 12)
            ]);
        }).then(function (results) {
            uiState.homeData.recentLive = results[0] || [];
            uiState.homeData.recentVod = results[1] || [];
            uiState.homeData.recentSeries = results[2] || [];
            if (LuminaRouter.getCurrentRoute() === 'home') {
                paintHomeWithCatalog();
            }
        }).catch(function () {
            if (LuminaRouter.getCurrentRoute() === 'home') {
                paintHomeWithCatalog();
            }
        });

        paintHomeWithCatalog();
    }

    function renderHomeOnboarding() {
        var html = '<div class="screen screen-home screen-home-onboarding">' +
            '<div class="onboarding-hero">' +
            '<div class="onboarding-eyebrow"><span class="hero-dot"></span>LUMINA TV v2.2.1 • CATÁLOGO SOB DEMANDA</div>' +
            '<h1 class="onboarding-title">Sua central de TV ao vivo, filmes e séries na tela grande.</h1>' +
            '<p class="onboarding-subtitle">Para começar, escolha abaixo como deseja adicionar sua lista M3U ou conta Xtream Codes.</p>' +
            '<div class="onboarding-cards">' +
            '<button type="button" class="onboarding-card focusable" data-zone="content" data-onboard="pairing" tabindex="-1">' +
            '<span class="onboarding-card-step">OPÇÃO 1 • MAIS RÁPIDA</span>' +
            '<span class="onboarding-card-icon">' + getIconSvg('smartphone') + '</span>' +
            '<span class="onboarding-card-title">Enviar pelo celular</span>' +
            '<span class="onboarding-card-desc">Escaneie o QR Code ou digite o código de 6 caracteres no celular sem usar o controle remoto.</span>' +
            '<span class="onboarding-card-cta">Abrir QR Code →</span>' +
            '</button>' +
            '<button type="button" class="onboarding-card focusable" data-zone="content" data-onboard="m3u" tabindex="-1">' +
            '<span class="onboarding-card-step">OPÇÃO 2 • LINK DIRETO</span>' +
            '<span class="onboarding-card-icon">' + getIconSvg('link') + '</span>' +
            '<span class="onboarding-card-title">Informar URL M3U</span>' +
            '<span class="onboarding-card-desc">Cole ou digite o endereço HTTP/HTTPS da sua lista M3U ou M3U8 diretamente na TV.</span>' +
            '<span class="onboarding-card-cta">Digitar URL M3U →</span>' +
            '</button>' +
            '<button type="button" class="onboarding-card focusable" data-zone="content" data-onboard="xtream" tabindex="-1">' +
            '<span class="onboarding-card-step">OPÇÃO 3 • SERVIDOR XTREAM</span>' +
            '<span class="onboarding-card-icon">' + getIconSvg('key') + '</span>' +
            '<span class="onboarding-card-title">Conectar Xtream Codes</span>' +
            '<span class="onboarding-card-desc">Entre com servidor, usuário e senha para carregar canais, filmes e séries organizados.</span>' +
            '<span class="onboarding-card-cta">Conectar Xtream →</span>' +
            '</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        elMain.innerHTML = html;

        var cards = elMain.querySelectorAll('[data-onboard]');
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('click', function () {
                var mode = this.getAttribute('data-onboard');
                LuminaRouter.navigate('settings', { openModal: mode });
            });
        }

        FocusEngine.setZone('content');
    }

    function paintHomeWithCatalog() {
        var listState = uiState.homeData.listState || LuminaCatalog.getListStateSync() || {};
        var counts = listState.counts || { live: 0, vod: 0, series: 0 };
        var watchHistory = LuminaSettings.getContinueWatchingList(12);
        var favPortraits = LuminaSettings.getFavoritePortraits(12);

        var heroItem = (watchHistory && watchHistory[0]) ||
            (uiState.homeData.recentVod && uiState.homeData.recentVod[0]) ||
            (uiState.homeData.recentSeries && uiState.homeData.recentSeries[0]) ||
            (uiState.homeData.recentLive && uiState.homeData.recentLive[0]) || null;

        var html = '<div class="screen screen-home">';

        if (heroItem) {
            var badgeLabel = heroItem.type === 'live' ? 'CANAL AO VIVO' : (heroItem.type === 'series' ? 'SÉRIE EM DESTAQUE' : 'FILME EM DESTAQUE');
            html += '<div class="home-hero-spotlight">' +
                '<div class="home-hero-copy">' +
                '<div class="hero-eyebrow"><span class="hero-dot"></span>' + badgeLabel + '</div>' +
                '<h1 class="hero-title">' + escapeHtml(heroItem.title || heroItem.name) + '</h1>' +
                '<div class="hero-meta-line">' +
                '<span>' + escapeHtml(heroItem.group || 'Catálogo') + '</span>' +
                (heroItem.year ? '<span>• ' + escapeHtml(heroItem.year) + '</span>' : '') +
                '</div>' +
                '<div class="hero-actions">' +
                '<button type="button" class="btn btn-primary focusable" data-zone="content" data-hero-play="' + escapeHtml(heroItem.id) + '" data-hero-type="' + escapeHtml(heroItem.type || 'vod') + '" tabindex="-1">' +
                getIconSvg('play') + ' <span>Assistir Agora</span></button>' +
                '<button type="button" class="btn btn-secondary focusable" data-zone="content" data-go-route="live" tabindex="-1">Canais (' + formatNumber(counts.live) + ')</button>' +
                '<button type="button" class="btn btn-secondary focusable" data-zone="content" data-go-route="vod" tabindex="-1">Filmes (' + formatNumber(counts.vod) + ')</button>' +
                '<button type="button" class="btn btn-secondary focusable" data-zone="content" data-go-route="series" tabindex="-1">Séries (' + formatNumber(counts.series) + ')</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        } else {
            html += '<div class="home-hero-spotlight">' +
                '<div class="home-hero-copy">' +
                '<div class="hero-eyebrow"><span class="hero-dot"></span>CATÁLOGO PRONTO</div>' +
                '<h1 class="hero-title">Bem-vindo ao Lumina TV</h1>' +
                '<p class="hero-subtitle">' + formatNumber(counts.live) + ' canais • ' + formatNumber(counts.vod) + ' filmes • ' + formatNumber(counts.series) + ' séries prontas para abrir sob demanda.</p>' +
                '<div class="hero-actions">' +
                '<button type="button" class="btn btn-primary focusable" data-zone="content" data-go-route="live" tabindex="-1">Abrir Canais</button>' +
                '<button type="button" class="btn btn-secondary focusable" data-zone="content" data-go-route="vod" tabindex="-1">Abrir Filmes</button>' +
                '<button type="button" class="btn btn-secondary focusable" data-zone="content" data-go-route="series" tabindex="-1">Abrir Séries</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        }

        if (watchHistory && watchHistory.length > 0) {
            html += buildHomeRailHtml('Continuar Assistindo', watchHistory, 'continue');
        }
        if (favPortraits && favPortraits.length > 0) {
            html += buildHomeRailHtml('Meus Favoritos', favPortraits, 'favorites');
        }
        if (uiState.homeData.recentLive && uiState.homeData.recentLive.length > 0) {
            html += buildHomeRailHtml('Canais Recentes', uiState.homeData.recentLive, 'live');
        }
        if (uiState.homeData.recentVod && uiState.homeData.recentVod.length > 0) {
            html += buildHomeRailHtml('Filmes Adicionados', uiState.homeData.recentVod, 'vod');
        }
        if (uiState.homeData.recentSeries && uiState.homeData.recentSeries.length > 0) {
            html += buildHomeRailHtml('Séries Populares', uiState.homeData.recentSeries, 'series');
        }

        html += '</div>';
        elMain.innerHTML = html;
        updateSyncBannerDOM();
        bindHomeEvents();
    }

    function buildHomeRailHtml(title, items, railKey) {
        var html = '<section class="home-rail" data-rail="' + escapeHtml(railKey) + '">' +
            '<div class="rail-header"><h2 class="rail-title">' + escapeHtml(title) + '</h2></div>' +
            '<div class="rail-track">';
        var limit = Math.min(items.length, 12);
        for (var i = 0; i < limit; i++) {
            var item = items[i];
            if (LuminaSettings.isAdultLocked() && item.isAdult) continue;
            var mono = computeMonogramData(item.title || item.name);
            var poster = item.poster || item.logo || '';
            html += '<button type="button" class="media-card focusable" data-zone="content" ' +
                'data-item-id="' + escapeHtml(item.id) + '" data-item-type="' + escapeHtml(item.type || 'vod') + '" tabindex="-1">' +
                '<div class="card-poster-wrap" style="background:' + mono.gradient + '">' +
                '<div class="card-monogram">' + escapeHtml(mono.initials) + '</div>' +
                (poster ? '<img class="card-poster-img" data-src="' + escapeHtml(poster) + '" alt="" style="display:none"/>' : '') +
                '</div>' +
                '<div class="card-info">' +
                '<div class="card-title">' + escapeHtml(item.title || item.name) + '</div>' +
                '<div class="card-sub">' + escapeHtml(item.group || '') + '</div>' +
                '</div>' +
                '</button>';
        }
        html += '</div></section>';
        return html;
    }

    function bindHomeEvents() {
        var routeBtns = elMain.querySelectorAll('[data-go-route]');
        for (var i = 0; i < routeBtns.length; i++) {
            routeBtns[i].addEventListener('click', function () {
                LuminaRouter.navigate(this.getAttribute('data-go-route'));
            });
        }

        var heroPlay = elMain.querySelector('[data-hero-play]');
        if (heroPlay) {
            heroPlay.addEventListener('click', function () {
                var id = this.getAttribute('data-hero-play');
                var type = this.getAttribute('data-hero-type');
                openOrPlayItemById(id, type);
            });
        }

        var cards = elMain.querySelectorAll('.media-card[data-item-id]');
        for (var j = 0; j < cards.length; j++) {
            var card = cards[j];
            var img = card.querySelector('.card-poster-img');
            var mono = card.querySelector('.card-monogram');
            if (img && img.getAttribute('data-src')) {
                enqueuePosterLoad(img, img.getAttribute('data-src'), mono);
            }
            card.addEventListener('click', function () {
                openOrPlayItemById(this.getAttribute('data-item-id'), this.getAttribute('data-item-type'));
            });
        }
    }

    function openOrPlayItemById(itemId, itemType) {
        if (!itemId) return;
        LuminaCatalog.getItem(itemId).then(function (item) {
            var resolved = item || LuminaSettings.getPortraitById(itemId);
            if (!resolved) {
                showToast('Item não encontrado no catálogo atual.', 'warn');
                return;
            }
            if (resolved.type === 'live' || itemType === 'live') {
                LuminaRouter.navigate('player', { item: resolved });
            } else {
                LuminaRouter.navigate('detail', { item: resolved, type: resolved.type || itemType });
            }
        });
    }

    // =========================================================================
    // ABAS DO CATALOGO SOB DEMANDA ('live' | 'vod' | 'series') - Partes 7 e 8
    // =========================================================================
    function renderCatalogTab(section) {
        var state = tabStates[section];
        if (!state) return;

        // Monta esqueleto da aba imediatamente (< 80ms) e dispara carregamento de grupos se necessario
        buildCatalogTabShell(section);

        if (state.status === 'idle' || state.groups.length === 0) {
            loadSectionGroupsAndFirstPage(section);
        } else {
            populateGroupsSidebar(section);
            renderViewportSlots(section);
        }
    }

    function loadSectionGroupsAndFirstPage(section) {
        var state = tabStates[section];
        var token = ++state.requestToken;
        state.status = 'loading_groups';
        updateTabStatusIndicator(section);

        LuminaCatalog.getGroups(section, { includeAdult: !LuminaSettings.isAdultLocked() }).then(function (groups) {
            if (state.requestToken !== token) return;
            state.groups = groups || [];
            if (state.groups.length === 0) {
                state.status = 'empty';
                state.totalInFilter = 0;
                populateGroupsSidebar(section);
                updateTabStatusIndicator(section);
                return;
            }
            var selectedObj = findGroupObject(state.groups, state.selectedGroup);
            if (!selectedObj) {
                selectedObj = state.groups[0];
                state.selectedGroup = selectedObj.name;
            }
            state.totalInFilter = selectedObj.count || 0;
            populateGroupsSidebar(section);

            return Promise.all([
                LuminaCatalog.getLetterJumpIndex(section),
                ensurePageLoaded(section, 0, token)
            ]);
        }).then(function (res) {
            if (state.requestToken !== token) return;
            if (res && res[0]) {
                state.letterJumpTable = res[0];
            }
            if (state.status !== 'empty') {
                state.status = 'ready';
                updateTabStatusIndicator(section);
                renderViewportSlots(section);
            }
        }).catch(function (err) {
            if (state.requestToken !== token) return;
            state.status = 'error';
            state.errorMessage = (err && err.message) ? err.message : 'Erro ao carregar seção do catálogo.';
            updateTabStatusIndicator(section);
        });
    }

    function findGroupObject(groups, name) {
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].name === name) return groups[i];
        }
        return null;
    }

    function ensurePageLoaded(section, pageIndex, token) {
        var state = tabStates[section];
        if (state.loadedPages[pageIndex]) {
            return Promise.resolve(state.loadedPages[pageIndex]);
        }
        if (state.loadingPages[pageIndex]) {
            return state.loadingPages[pageIndex];
        }

        var promise = LuminaCatalog.getPage(section, {
            group: state.selectedGroup,
            order: state.sortOrder,
            page: pageIndex,
            includeAdult: !LuminaSettings.isAdultLocked()
        }).then(function (pageData) {
            delete state.loadingPages[pageIndex];
            if (token && state.requestToken !== token) return [];
            var items = (pageData && pageData.items) ? pageData.items : [];
            state.loadedPages[pageIndex] = items;
            if (pageData && typeof pageData.total === 'number') {
                state.totalInFilter = pageData.total;
            }
            // Mantem no maximo 12 paginas no cache local da aba
            var keys = Object.keys(state.loadedPages);
            if (keys.length > 12) {
                var oldestKey = keys[0];
                var maxDist = -1;
                for (var k = 0; k < keys.length; k++) {
                    var pNum = parseInt(keys[k], 10);
                    var dist = Math.abs(pNum - pageIndex);
                    if (dist > maxDist) {
                        maxDist = dist;
                        oldestKey = keys[k];
                    }
                }
                delete state.loadedPages[oldestKey];
            }
            return items;
        }).catch(function (err) {
            delete state.loadingPages[pageIndex];
            throw err;
        });

        state.loadingPages[pageIndex] = promise;
        return promise;
    }

    function buildCatalogTabShell(section) {
        var state = tabStates[section];
        var sectionLabel = section === 'live' ? 'Canais ao Vivo' : (section === 'vod' ? 'Filmes' : 'Séries');
        var searchBtnLabel = section === 'live' ? 'Buscar em Canais' : (section === 'vod' ? 'Buscar em Filmes' : 'Buscar em Séries');

        var html = '<div class="screen screen-catalog screen-' + section + '" data-section="' + section + '">' +
            '<header class="catalog-top-bar">' +
            '<div class="catalog-title-group">' +
            '<h1 class="catalog-heading">' + sectionLabel + '</h1>' +
            '<span id="catalog-count-badge" class="catalog-count-badge">' + formatNumber(state.totalInFilter) + ' itens</span>' +
            '</div>' +
            '<div class="catalog-actions-bar">' +
            '<button type="button" id="btn-tab-search" class="btn btn-secondary catalog-search-trigger focusable" data-zone="content" tabindex="-1">' +
            getIconSvg('search') + ' <span>' + searchBtnLabel + '</span>' +
            '</button>' +
            '<button type="button" id="btn-tab-sort" class="btn btn-ghost focusable" data-zone="content" tabindex="-1">' +
            'Ordem: ' + (state.sortOrder === 'az' ? 'A–Z' : 'Padrão') +
            '</button>' +
            '<button type="button" id="btn-tab-az-popover" class="btn btn-ghost focusable" data-zone="content" tabindex="-1">' +
            'Letra: ' + escapeHtml(state.activeLetter) +
            '</button>' +
            '</div>' +
            '</header>' +
            '<div class="catalog-body-split">' +
            '<aside class="catalog-groups-rail" id="catalog-groups-rail" aria-label="Categorias"></aside>' +
            '<main class="catalog-viewport-panel" id="catalog-viewport-panel">' +
            '<div id="catalog-status-overlay" class="catalog-status-overlay hidden"></div>' +
            '<div id="catalog-slots-stage" class="catalog-slots-stage ' + (section === 'live' ? 'stage-live-split' : 'stage-poster-grid') + '"></div>' +
            '</main>' +
            '</div>' +
            '<div id="tab-search-drawer" class="tab-search-drawer ' + (state.searchOpen ? '' : 'hidden') + '"></div>' +
            '</div>';

        elMain.innerHTML = html;
        updateSyncBannerDOM();
        createRecycledSlotPool(section);
        bindCatalogHeaderEvents(section);
        updateTabStatusIndicator(section);

        if (state.searchOpen) {
            renderTabSearchDrawer(section);
        }
    }

    /**
     * Cria o pool fixo de nos DOM que sera reciclado durante toda a navegacao na aba (Parte 7.3).
     * Nenhum card e criado ou destruido durante o scroll!
     */
    function createRecycledSlotPool(section) {
        var stage = document.getElementById('catalog-slots-stage');
        if (!stage) return;

        if (section === 'live') {
            var liveHtml = '<div class="live-list-column" id="live-list-column">';
            for (var i = 0; i < LIVE_SLOT_COUNT; i++) {
                liveHtml += '<button type="button" class="live-channel-slot focusable" data-zone="content" data-slot-index="' + i + '" tabindex="-1">' +
                    '<span class="live-slot-num"></span>' +
                    '<div class="live-slot-logo-wrap"><span class="live-slot-monogram"></span><img class="live-slot-logo" alt="" style="display:none"/></div>' +
                    '<div class="live-slot-meta">' +
                    '<div class="live-slot-title"></div>' +
                    '<div class="live-slot-group"></div>' +
                    '</div>' +
                    '<span class="live-slot-fav"></span>' +
                    '</button>';
            }
            liveHtml += '</div>' +
                '<div class="live-preview-pane" id="live-preview-pane">' +
                '<div class="live-preview-card">' +
                '<div class="live-preview-badge">PRÉVIA DO CANAL</div>' +
                '<h2 class="live-preview-title" id="live-preview-title">Selecione um canal</h2>' +
                '<p class="live-preview-group" id="live-preview-group">Use as setas para navegar e OK para assistir em tela cheia.</p>' +
                '<div class="live-preview-actions">' +
                '<button type="button" id="btn-live-fullscreen" class="btn btn-primary focusable" data-zone="content" tabindex="-1">' +
                getIconSvg('play') + ' <span>Tela Cheia</span></button>' +
                '<button type="button" id="btn-live-fav" class="btn btn-secondary focusable" data-zone="content" tabindex="-1">' +
                getIconSvg('star') + ' <span>Favoritar</span></button>' +
                '</div>' +
                '</div>' +
                '</div>';
            stage.innerHTML = liveHtml;

            var liveSlots = stage.querySelectorAll('.live-channel-slot');
            for (var l = 0; l < liveSlots.length; l++) {
                bindSlotEvents(section, liveSlots[l], l);
            }
            var btnFull = document.getElementById('btn-live-fullscreen');
            if (btnFull) {
                btnFull.addEventListener('click', function () {
                    var st = tabStates.live;
                    if (st.previewChannelId) openOrPlayItemById(st.previewChannelId, 'live');
                });
            }
            var btnFav = document.getElementById('btn-live-fav');
            if (btnFav) {
                btnFav.addEventListener('click', function () {
                    var st = tabStates.live;
                    if (!st.previewChannelId) return;
                    LuminaCatalog.getItem(st.previewChannelId).then(function (item) {
                        if (item) {
                            LuminaSettings.toggleFavorite(item.id, item);
                            renderViewportSlots('live');
                        }
                    });
                });
            }
        } else {
            var gridHtml = '';
            for (var g = 0; g < GRID_SLOT_COUNT; g++) {
                gridHtml += '<button type="button" class="catalog-grid-slot media-card focusable" data-zone="content" data-slot-index="' + g + '" tabindex="-1">' +
                    '<div class="card-poster-wrap">' +
                    '<div class="card-monogram"></div>' +
                    '<img class="card-poster-img" alt="" style="display:none"/>' +
                    '<span class="card-badge-top"></span>' +
                    '</div>' +
                    '<div class="card-info">' +
                    '<div class="card-title"></div>' +
                    '<div class="card-sub"></div>' +
                    '</div>' +
                    '</button>';
            }
            stage.innerHTML = gridHtml;

            var gridSlots = stage.querySelectorAll('.catalog-grid-slot');
            for (var k = 0; k < gridSlots.length; k++) {
                bindSlotEvents(section, gridSlots[k], k);
            }
        }
    }

    function bindSlotEvents(section, slotEl, slotIdx) {
        slotEl.addEventListener('focus', function () {
            var st = tabStates[section];
            var absIndex = st.slotOffset + slotIdx;
            st.focusedIndex = absIndex;
            var itemId = slotEl.getAttribute('data-item-id');
            if (itemId) st.focusAnchorId = itemId;

            if (section === 'live' && itemId) {
                st.previewChannelId = itemId;
                updateLivePreviewPane(slotEl);
            }

            // Se chegou nas ultimas 2 linhas da janela de slots, avanca a janela de slots reciclados
            var slotCount = section === 'live' ? LIVE_SLOT_COUNT : GRID_SLOT_COUNT;
            var step = section === 'live' ? 1 : GRID_COLUMNS;
            if (slotIdx >= slotCount - step && (st.slotOffset + slotCount) < st.totalInFilter) {
                st.slotOffset = Math.min(
                    Math.max(0, st.totalInFilter - slotCount),
                    st.slotOffset + step
                );
                renderViewportSlots(section);
                var newSlotIdx = absIndex - st.slotOffset;
                focusSlotByIndex(section, newSlotIdx);
            } else if (slotIdx < step && st.slotOffset > 0) {
                st.slotOffset = Math.max(0, st.slotOffset - step);
                renderViewportSlots(section);
                var prevSlotIdx = absIndex - st.slotOffset;
                focusSlotByIndex(section, prevSlotIdx);
            }
        });

        slotEl.addEventListener('click', function () {
            var itemId = this.getAttribute('data-item-id');
            if (!itemId) return;
            openOrPlayItemById(itemId, section);
        });
    }

    function focusSlotByIndex(section, slotIdx) {
        var stage = document.getElementById('catalog-slots-stage');
        if (!stage) return;
        var sel = stage.querySelector('[data-slot-index="' + slotIdx + '"]');
        if (sel) FocusEngine.focusElement(sel);
    }

    function updateLivePreviewPane(slotEl) {
        var titleEl = document.getElementById('live-preview-title');
        var groupEl = document.getElementById('live-preview-group');
        if (titleEl) titleEl.textContent = slotEl.getAttribute('data-item-title') || 'Canal';
        if (groupEl) groupEl.textContent = slotEl.getAttribute('data-item-group') || 'Ao Vivo';
    }

    function populateGroupsSidebar(section) {
        var rail = document.getElementById('catalog-groups-rail');
        if (!rail) return;
        var state = tabStates[section];
        var groups = state.groups || [];
        var maxVisibleGroups = Math.min(groups.length, 40);
        var html = '';
        for (var i = 0; i < maxVisibleGroups; i++) {
            var g = groups[i];
            var isSelected = g.name === state.selectedGroup;
            var label = g.name === 'ALL' ? 'Todos' : g.name;
            html += '<button type="button" class="catalog-group-btn focusable ' + (isSelected ? 'active' : '') + '" ' +
                'data-zone="content" data-group-name="' + escapeHtml(g.name) + '" tabindex="-1">' +
                '<span class="group-btn-name">' + escapeHtml(label) + '</span>' +
                '<span class="group-btn-count">' + formatNumber(g.count) + '</span>' +
                '</button>';
        }
        rail.innerHTML = html;

        var btns = rail.querySelectorAll('.catalog-group-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
                var newGroup = this.getAttribute('data-group-name');
                selectCatalogGroup(section, newGroup);
            });
        }
    }

    function selectCatalogGroup(section, groupName) {
        var state = tabStates[section];
        if (!state || state.selectedGroup === groupName) return;
        state.selectedGroup = groupName;
        state.slotOffset = 0;
        state.focusedIndex = 0;
        state.loadedPages = {};
        state.loadingPages = {};
        var gObj = findGroupObject(state.groups, groupName);
        state.totalInFilter = gObj ? gObj.count : 0;

        var badge = document.getElementById('catalog-count-badge');
        if (badge) badge.textContent = formatNumber(state.totalInFilter) + ' itens';

        populateGroupsSidebar(section);
        var token = ++state.requestToken;
        state.status = 'loading_page';
        updateTabStatusIndicator(section);

        ensurePageLoaded(section, 0, token).then(function () {
            if (state.requestToken !== token) return;
            state.status = state.totalInFilter > 0 ? 'ready' : 'empty';
            updateTabStatusIndicator(section);
            renderViewportSlots(section);
        });
    }

    /**
     * Recicla o pool de slots DOM para exibir os itens em [slotOffset .. slotOffset + slotCount - 1].
     * Faz prefetch silencioso da proxima pagina quando faltam <= 40 itens para o fim da pagina atual.
     */
    function renderViewportSlots(section) {
        var state = tabStates[section];
        var stage = document.getElementById('catalog-slots-stage');
        if (!state || !stage) return;

        var badge = document.getElementById('catalog-count-badge');
        if (badge) badge.textContent = formatNumber(state.totalInFilter) + ' itens';

        var slotCount = section === 'live' ? LIVE_SLOT_COUNT : GRID_SLOT_COUNT;
        var slots = stage.querySelectorAll('[data-slot-index]');

        var startPage = Math.floor(state.slotOffset / PAGE_SIZE);
        var endPage = Math.floor((state.slotOffset + slotCount - 1) / PAGE_SIZE);

        if (!state.loadedPages[startPage] && state.totalInFilter > 0) {
            var token = state.requestToken;
            ensurePageLoaded(section, startPage, token).then(function () {
                if (LuminaRouter.getCurrentRoute() === section) {
                    renderViewportSlots(section);
                }
            });
        }
        if (endPage !== startPage && !state.loadedPages[endPage] && (endPage * PAGE_SIZE) < state.totalInFilter) {
            ensurePageLoaded(section, endPage, state.requestToken).then(function () {
                if (LuminaRouter.getCurrentRoute() === section) {
                    renderViewportSlots(section);
                }
            });
        }

        // Prefetch de 1 pagina a frente quando faltam <= 40 itens para o fim da pagina atual (Parte 7.3)
        var lastVisibleIndex = state.slotOffset + slotCount - 1;
        var posInPage = lastVisibleIndex % PAGE_SIZE;
        var nextPage = startPage + 1;
        if (posInPage >= (PAGE_SIZE - 40) && (nextPage * PAGE_SIZE) < state.totalInFilter) {
            ensurePageLoaded(section, nextPage, state.requestToken);
        }

        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            var absIdx = state.slotOffset + i;
            if (absIdx >= state.totalInFilter) {
                slot.style.visibility = 'hidden';
                slot.removeAttribute('data-item-id');
                continue;
            }
            slot.style.visibility = 'visible';
            var pIdx = Math.floor(absIdx / PAGE_SIZE);
            var idxInPage = absIdx % PAGE_SIZE;
            var pageArr = state.loadedPages[pIdx];
            var item = pageArr ? pageArr[idxInPage] : null;

            if (!item) {
                // Placeholder skeleton enquanto a pagina esta chegando do IndexedDB
                slot.setAttribute('data-item-id', '');
                if (section === 'live') {
                    slot.querySelector('.live-slot-num').textContent = String(absIdx + 1);
                    slot.querySelector('.live-slot-title').textContent = 'Carregando...';
                    slot.querySelector('.live-slot-group').textContent = '';
                } else {
                    slot.querySelector('.card-title').textContent = 'Carregando...';
                    slot.querySelector('.card-sub').textContent = '';
                }
                continue;
            }

            bindItemToSlotDOM(section, slot, item, absIdx);
        }
    }

    function bindItemToSlotDOM(section, slot, item, absIdx) {
        var prevId = slot.getAttribute('data-item-id');
        var itemTitle = item.title || item.name || 'Sem título';
        var itemGroup = item.group || '';
        var posterUrl = item.poster || item.logo || '';
        var mono = computeMonogramData(itemTitle);
        var isFav = LuminaSettings.isFavorite(item.id);

        slot.setAttribute('data-item-id', item.id);
        slot.setAttribute('data-item-title', itemTitle);
        slot.setAttribute('data-item-group', itemGroup);

        if (section === 'live') {
            var numEl = slot.querySelector('.live-slot-num');
            var titleEl = slot.querySelector('.live-slot-title');
            var groupEl = slot.querySelector('.live-slot-group');
            var favEl = slot.querySelector('.live-slot-fav');
            var monoEl = slot.querySelector('.live-slot-monogram');
            var imgEl = slot.querySelector('.live-slot-logo');

            if (numEl) numEl.textContent = String(item.channelNumber || (absIdx + 1));
            if (titleEl) titleEl.textContent = itemTitle;
            if (groupEl) groupEl.textContent = itemGroup;
            if (favEl) favEl.textContent = isFav ? '★' : '';
            if (monoEl) monoEl.textContent = mono.initials;

            if (prevId !== item.id && imgEl) {
                enqueuePosterLoad(imgEl, posterUrl, monoEl);
            }
            if (!tabStates.live.previewChannelId && absIdx === 0) {
                tabStates.live.previewChannelId = item.id;
                updateLivePreviewPane(slot);
            }
        } else {
            var wrapEl = slot.querySelector('.card-poster-wrap');
            var cardMonoEl = slot.querySelector('.card-monogram');
            var cardImgEl = slot.querySelector('.card-poster-img');
            var badgeEl = slot.querySelector('.card-badge-top');
            var cTitleEl = slot.querySelector('.card-title');
            var cSubEl = slot.querySelector('.card-sub');

            if (wrapEl) wrapEl.style.background = mono.gradient;
            if (cardMonoEl) cardMonoEl.textContent = mono.initials;
            if (cTitleEl) cTitleEl.textContent = itemTitle;

            if (section === 'series') {
                var epCount = item.episodeCount || item.totalEpisodes || 0;
                var seasonCount = item.seasonCount || 1;
                if (cSubEl) cSubEl.textContent = seasonCount + ' temp • ' + epCount + ' ep';
                if (badgeEl) badgeEl.textContent = item.year ? String(item.year) : 'SÉRIE';
            } else {
                if (cSubEl) cSubEl.textContent = item.year ? (itemGroup + ' • ' + item.year) : itemGroup;
                if (badgeEl) badgeEl.textContent = isFav ? '★' : (item.year ? String(item.year) : '');
            }

            if (prevId !== item.id && cardImgEl) {
                enqueuePosterLoad(cardImgEl, posterUrl, cardMonoEl);
            }
        }
    }

    function updateTabStatusIndicator(section) {
        var overlay = document.getElementById('catalog-status-overlay');
        if (!overlay) return;
        var state = tabStates[section];
        if (state.status === 'loading_groups' || state.status === 'loading_page') {
            overlay.className = 'catalog-status-overlay';
            overlay.innerHTML = '<div class="status-box"><div class="spinner"></div><p>Carregando ' +
                (section === 'live' ? 'canais' : (section === 'vod' ? 'filmes' : 'séries')) + '...</p></div>';
        } else if (state.status === 'empty') {
            overlay.className = 'catalog-status-overlay';
            overlay.innerHTML = '<div class="status-box">' +
                '<h3>Nenhum item nesta seção</h3>' +
                '<p>Adicione ou sincronize sua lista nas configurações para visualizar o catálogo.</p>' +
                '<button type="button" class="btn btn-primary focusable" data-zone="content" id="btn-empty-go-settings" tabindex="-1">Ir para Ajustes</button>' +
                '</div>';
            var btn = document.getElementById('btn-empty-go-settings');
            if (btn) {
                btn.addEventListener('click', function () {
                    LuminaRouter.navigate('settings');
                });
            }
        } else if (state.status === 'error') {
            overlay.className = 'catalog-status-overlay';
            overlay.innerHTML = '<div class="status-box status-error">' +
                '<h3>Falha ao abrir seção</h3>' +
                '<p>' + escapeHtml(state.errorMessage) + '</p>' +
                '<button type="button" class="btn btn-primary focusable" data-zone="content" id="btn-retry-tab" tabindex="-1">Tentar Novamente</button>' +
                '</div>';
            var retryBtn = document.getElementById('btn-retry-tab');
            if (retryBtn) {
                retryBtn.addEventListener('click', function () {
                    state.status = 'idle';
                    loadSectionGroupsAndFirstPage(section);
                });
            }
        } else {
            overlay.className = 'catalog-status-overlay hidden';
            overlay.innerHTML = '';
        }
    }

    function bindCatalogHeaderEvents(section) {
        var state = tabStates[section];
        var btnSearch = document.getElementById('btn-tab-search');
        if (btnSearch) {
            btnSearch.addEventListener('click', function () {
                openTabSearch(section);
            });
        }

        var btnSort = document.getElementById('btn-tab-sort');
        if (btnSort) {
            btnSort.addEventListener('click', function () {
                state.sortOrder = state.sortOrder === 'default' ? 'az' : 'default';
                this.textContent = 'Ordem: ' + (state.sortOrder === 'az' ? 'A–Z' : 'Padrão');
                state.slotOffset = 0;
                state.loadedPages = {};
                var token = ++state.requestToken;
                ensurePageLoaded(section, 0, token).then(function () {
                    renderViewportSlots(section);
                });
            });
        }

        var btnAz = document.getElementById('btn-tab-az-popover');
        if (btnAz) {
            btnAz.addEventListener('click', function () {
                openLetterJumpModal(section);
            });
        }
    }

    /**
     * Salto instantaneo para uma letra A-Z usando a tabela de offsets pre-calculada no Worker (Parte 7.3).
     */
    function openLetterJumpModal(section) {
        var state = tabStates[section];
        var html = '<div class="modal-backdrop">' +
            '<div class="modal-dialog modal-az-picker">' +
            '<h2 class="modal-title">Saltar para a letra</h2>' +
            '<div class="az-picker-grid">';
        for (var i = 0; i < LETTERS.length; i++) {
            var lt = LETTERS[i];
            var active = state.activeLetter === lt ? 'active' : '';
            html += '<button type="button" class="az-letter-btn focusable ' + active + '" data-zone="modal" data-letter="' + lt + '" tabindex="-1">' +
                (lt === 'ALL' ? 'Tudo' : lt) + '</button>';
        }
        html += '</div></div></div>';

        elModalRoot.innerHTML = html;
        elModalRoot.classList.remove('hidden');
        FocusEngine.setZone('modal');

        var btns = elModalRoot.querySelectorAll('.az-letter-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', function () {
                var letter = this.getAttribute('data-letter');
                closeModal();
                jumpToSectionLetter(section, letter);
            });
        }
    }

    function jumpToSectionLetter(section, letter) {
        var state = tabStates[section];
        state.activeLetter = letter;
        var btnAz = document.getElementById('btn-tab-az-popover');
        if (btnAz) btnAz.textContent = 'Letra: ' + letter;

        if (letter === 'ALL') {
            state.slotOffset = 0;
            renderViewportSlots(section);
            return;
        }

        state.sortOrder = 'az';
        var btnSort = document.getElementById('btn-tab-sort');
        if (btnSort) btnSort.textContent = 'Ordem: A–Z';

        var jumpTable = state.letterJumpTable || {};
        var targetIndex = typeof jumpTable[letter] === 'number' ? jumpTable[letter] : 0;
        var targetPage = Math.floor(targetIndex / PAGE_SIZE);
        state.slotOffset = Math.max(0, Math.min(targetIndex, Math.max(0, state.totalInFilter - (section === 'live' ? LIVE_SLOT_COUNT : GRID_SLOT_COUNT))));
        state.loadedPages = {};

        var token = ++state.requestToken;
        ensurePageLoaded(section, targetPage, token).then(function () {
            renderViewportSlots(section);
        });
    }

    // =========================================================================
    // BUSCA POR ABA (Canais, Filmes, Series) - Parte 8
    // =========================================================================
    function openTabSearch(section) {
        var state = tabStates[section];
        state.searchOpen = true;
        var drawer = document.getElementById('tab-search-drawer');
        if (drawer) {
            drawer.classList.remove('hidden');
            renderTabSearchDrawer(section);
        }
    }

    function closeTabSearch(section) {
        var state = tabStates[section];
        if (!state) return;
        state.searchOpen = false;
        var drawer = document.getElementById('tab-search-drawer');
        if (drawer) {
            drawer.classList.add('hidden');
            drawer.innerHTML = '';
        }
        FocusEngine.setZone('content');
    }

    function renderTabSearchDrawer(section) {
        var drawer = document.getElementById('tab-search-drawer');
        if (!drawer) return;
        var state = tabStates[section];
        var sectionName = section === 'live' ? 'Canais' : (section === 'vod' ? 'Filmes' : 'Séries');

        var html = '<div class="tab-search-panel">' +
            '<div class="tab-search-header">' +
            '<div class="tab-search-title-wrap">' +
            '<h2 class="tab-search-heading">Buscar em ' + sectionName + '</h2>' +
            '<span class="tab-search-sub" id="tab-search-counter">' +
            (state.searchQuery.length >= 2 ? (formatNumber(state.searchTotalMatches) + ' resultados') : 'Digite ao menos 2 letras') +
            '</span>' +
            '</div>' +
            '<button type="button" id="btn-close-tab-search" class="btn btn-secondary focusable" data-zone="content" tabindex="-1">Fechar Busca (Voltar)</button>' +
            '</div>' +
            '<div class="tab-search-layout">' +
            '<div class="tab-search-left">' +
            '<div class="tab-search-input-display" id="tab-search-query-box">' +
            (state.searchQuery ? escapeHtml(state.searchQuery) : '<span class="placeholder">Digite o nome em ' + sectionName + '...</span>') +
            '</div>' +
            '<div id="tab-search-keyboard-mount" class="tab-search-keyboard-mount"></div>' +
            '<div class="tab-search-filters">' +
            '<button type="button" id="btn-search-filter-group" class="btn btn-ghost focusable" data-zone="content" tabindex="-1">Categoria: ' + escapeHtml(state.searchGroupFilter === 'ALL' ? 'Todas' : state.searchGroupFilter) + '</button>' +
            (section !== 'live' ? '<button type="button" id="btn-search-filter-year" class="btn btn-ghost focusable" data-zone="content" tabindex="-1">Ano: ' + escapeHtml(state.searchYearFilter) + '</button>' : '') +
            '<button type="button" id="btn-search-filter-audio" class="btn btn-ghost focusable" data-zone="content" tabindex="-1">Áudio: ' + escapeHtml(state.searchAudioFilter) + '</button>' +
            '</div>' +
            '</div>' +
            '<div class="tab-search-right">' +
            '<div id="tab-search-results-grid" class="tab-search-results-grid"></div>' +
            '</div>' +
            '</div>' +
            '</div>';

        drawer.innerHTML = html;

        var kbMount = document.getElementById('tab-search-keyboard-mount');
        if (kbMount && typeof OnScreenKeyboard !== 'undefined') {
            OnScreenKeyboard.render(kbMount, {
                value: state.searchQuery,
                zone: 'content',
                layout: 'compact9',
                onChange: function (val) {
                    state.searchQuery = val;
                    var qBox = document.getElementById('tab-search-query-box');
                    if (qBox) {
                        qBox.innerHTML = val ? escapeHtml(val) : '<span class="placeholder">Digite o nome em ' + sectionName + '...</span>';
                    }
                    triggerTabSearchExecution(section);
                }
            });
        }

        var btnClose = document.getElementById('btn-close-tab-search');
        if (btnClose) {
            btnClose.addEventListener('click', function () {
                closeTabSearch(section);
            });
        }

        var btnYear = document.getElementById('btn-search-filter-year');
        if (btnYear) {
            btnYear.addEventListener('click', function () {
                var years = ['ALL', '2025', '2024', '2023', '2022', '2021', '2020'];
                var idx = (years.indexOf(state.searchYearFilter) + 1) % years.length;
                state.searchYearFilter = years[idx];
                this.textContent = 'Ano: ' + state.searchYearFilter;
                triggerTabSearchExecution(section);
            });
        }

        var btnAudio = document.getElementById('btn-search-filter-audio');
        if (btnAudio) {
            btnAudio.addEventListener('click', function () {
                var modes = ['ALL', 'DUB', 'LEG'];
                var idx = (modes.indexOf(state.searchAudioFilter) + 1) % modes.length;
                state.searchAudioFilter = modes[idx];
                this.textContent = 'Áudio: ' + state.searchAudioFilter;
                triggerTabSearchExecution(section);
            });
        }

        paintTabSearchResults(section);
    }

    var searchDebounceTimer = null;
    function triggerTabSearchExecution(section) {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        var state = tabStates[section];
        if (!state.searchQuery || state.searchQuery.trim().length < 2) {
            state.searchResults = [];
            state.searchTotalMatches = 0;
            state.searchNextCursor = null;
            paintTabSearchResults(section);
            return;
        }
        searchDebounceTimer = setTimeout(function () {
            executeTabSearchPage(section, 0, false);
        }, 140);
    }

    function executeTabSearchPage(section, cursor, append) {
        var state = tabStates[section];
        state.searchLoading = true;
        LuminaCatalog.search(section, state.searchQuery, {
            cursor: cursor || 0,
            limit: 60,
            group: state.searchGroupFilter,
            year: state.searchYearFilter,
            audio: state.searchAudioFilter,
            includeAdult: !LuminaSettings.isAdultLocked()
        }).then(function (res) {
            state.searchLoading = false;
            var items = (res && res.items) ? res.items : [];
            state.searchResults = append ? state.searchResults.concat(items) : items;
            state.searchTotalMatches = (res && typeof res.totalMatches === 'number') ? res.totalMatches : state.searchResults.length;
            state.searchNextCursor = res ? res.nextCursor : null;
            state.searchMessage = (res && res.message) ? res.message : '';
            paintTabSearchResults(section);
        }).catch(function () {
            state.searchLoading = false;
            paintTabSearchResults(section);
        });
    }

    function paintTabSearchResults(section) {
        var state = tabStates[section];
        var container = document.getElementById('tab-search-results-grid');
        var counter = document.getElementById('tab-search-counter');
        if (!container) return;

        if (counter) {
            if (state.searchQuery.trim().length < 2) {
                counter.textContent = 'Digite ao menos 2 letras para buscar';
            } else {
                counter.textContent = formatNumber(state.searchTotalMatches) + ' encontrados' +
                    (state.searchMessage ? ' • ' + state.searchMessage : '');
            }
        }

        if (state.searchResults.length === 0) {
            container.innerHTML = '<div class="search-empty-hint">' +
                (state.searchQuery.trim().length < 2
                    ? 'Use o teclado ao lado para buscar apenas dentro desta aba.'
                    : 'Nenhum resultado encontrado para "' + escapeHtml(state.searchQuery) + '".') +
                '</div>';
            return;
        }

        // Virtualiza no maximo 24 cards visiveis na grade de resultados da busca
        var visible = state.searchResults.slice(0, 24);
        var html = '';
        for (var i = 0; i < visible.length; i++) {
            var it = visible[i];
            var mono = computeMonogramData(it.title || it.name);
            html += '<button type="button" class="media-card search-result-card focusable" data-zone="content" data-item-id="' + escapeHtml(it.id) + '" tabindex="-1">' +
                '<div class="card-poster-wrap" style="background:' + mono.gradient + '">' +
                '<div class="card-monogram">' + escapeHtml(mono.initials) + '</div>' +
                '</div>' +
                '<div class="card-info">' +
                '<div class="card-title">' + escapeHtml(it.title || it.name) + '</div>' +
                '<div class="card-sub">' + escapeHtml(it.group || '') + '</div>' +
                '</div>' +
                '</button>';
        }
        if (state.searchNextCursor !== null) {
            html += '<button type="button" id="btn-search-load-more" class="btn btn-secondary focusable" data-zone="content" tabindex="-1">Carregar mais resultados (+60)</button>';
        }
        container.innerHTML = html;

        var cards = container.querySelectorAll('.search-result-card');
        for (var j = 0; j < cards.length; j++) {
            cards[j].addEventListener('click', function () {
                openOrPlayItemById(this.getAttribute('data-item-id'), section);
            });
        }
        var btnMore = document.getElementById('btn-search-load-more');
        if (btnMore) {
            btnMore.addEventListener('click', function () {
                executeTabSearchPage(section, state.searchNextCursor, true);
            });
        }
    }

    // =========================================================================
    // DETALHE DO FILME OU SERIE (TMDB sob demanda + Episodios paginados) - Parte 7.2
    // =========================================================================
    function renderDetail(params) {
        var rawItem = params && params.item;
        if (!rawItem) {
            LuminaRouter.navigate('home');
            return;
        }

        uiState.detailItem = rawItem;
        uiState.detailEpisodeOffset = 0;

        if (rawItem.type === 'series' || (params && params.type === 'series')) {
            LuminaCatalog.getSeriesDetail(rawItem.id).then(function (seriesDetail) {
                uiState.detailSeries = seriesDetail || rawItem;
                var seasons = (seriesDetail && seriesDetail.seasons) ? Object.keys(seriesDetail.seasons) : ['1'];
                uiState.detailSeason = seasons[0] || '1';
                paintDetailScreen(uiState.detailSeries, true);
                triggerOnDemandTmdbEnrich(uiState.detailSeries);
            });
        } else {
            paintDetailScreen(rawItem, false);
            triggerOnDemandTmdbEnrich(rawItem);
        }
    }

    function triggerOnDemandTmdbEnrich(item) {
        if (!item || typeof TmdbEnricher === 'undefined' || !TmdbEnricher.enrichItem) return;
        TmdbEnricher.enrichItem(item).then(function (enriched) {
            if (!enriched || LuminaRouter.getCurrentRoute() !== 'detail') return;
            var plotEl = document.getElementById('detail-plot-text');
            if (plotEl && enriched.overview) {
                plotEl.textContent = enriched.overview;
            }
        }).catch(function () {});
    }

    function paintDetailScreen(item, isSeries) {
        var isFav = LuminaSettings.isFavorite(item.id);
        var mono = computeMonogramData(item.title || item.name);
        var html = '<div class="screen screen-detail">' +
            '<div class="detail-hero">' +
            '<div class="detail-poster-box" style="background:' + mono.gradient + '">' +
            '<div class="detail-monogram">' + escapeHtml(mono.initials) + '</div>' +
            '</div>' +
            '<div class="detail-info-box">' +
            '<div class="detail-badge">' + (isSeries ? 'SÉRIE' : 'FILME') + ' • ' + escapeHtml(item.group || 'Catálogo') + '</div>' +
            '<h1 class="detail-title">' + escapeHtml(item.title || item.name) + '</h1>' +
            '<p class="detail-plot" id="detail-plot-text">' + escapeHtml(item.plot || item.overview || 'Selecione Assistir para iniciar a reprodução.') + '</p>' +
            '<div class="detail-actions">' +
            '<button type="button" id="btn-detail-play" class="btn btn-primary focusable" data-zone="content" tabindex="-1">' +
            getIconSvg('play') + ' <span>Assistir</span></button>' +
            '<button type="button" id="btn-detail-fav" class="btn btn-secondary focusable" data-zone="content" tabindex="-1">' +
            getIconSvg('star') + ' <span>' + (isFav ? 'Remover Favorito' : 'Favoritar') + '</span></button>' +
            '</div>' +
            '</div>' +
            '</div>';

        if (isSeries && item.seasons) {
            var seasonKeys = Object.keys(item.seasons);
            html += '<div class="detail-seasons-bar">';
            for (var s = 0; s < seasonKeys.length; s++) {
                var sKey = seasonKeys[s];
                var active = String(uiState.detailSeason) === String(sKey) ? 'active' : '';
                html += '<button type="button" class="btn btn-ghost season-chip focusable ' + active + '" data-zone="content" data-season="' + escapeHtml(sKey) + '" tabindex="-1">Temporada ' + escapeHtml(sKey) + '</button>';
            }
            html += '</div>';

            var eps = item.seasons[uiState.detailSeason] || [];
            var pageEps = eps.slice(uiState.detailEpisodeOffset, uiState.detailEpisodeOffset + 30);
            html += '<div class="detail-episodes-list">';
            for (var e = 0; e < pageEps.length; e++) {
                var ep = pageEps[e];
                html += '<button type="button" class="episode-row focusable" data-zone="content" data-ep-index="' + (uiState.detailEpisodeOffset + e) + '" tabindex="-1">' +
                    '<span class="ep-num">E' + escapeHtml(ep.episode || (e + 1)) + '</span>' +
                    '<span class="ep-title">' + escapeHtml(ep.title || ep.name || ('Episódio ' + (e + 1))) + '</span>' +
                    '</button>';
            }
            html += '</div>';
        }

        html += '</div>';
        elMain.innerHTML = html;

        var btnPlay = document.getElementById('btn-detail-play');
        if (btnPlay) {
            btnPlay.addEventListener('click', function () {
                if (isSeries && item.seasons) {
                    var list = item.seasons[uiState.detailSeason] || [];
                    var firstEp = list[0] || item;
                    LuminaRouter.navigate('player', { item: firstEp });
                } else {
                    LuminaRouter.navigate('player', { item: item });
                }
            });
        }

        var btnFav = document.getElementById('btn-detail-fav');
        if (btnFav) {
            btnFav.addEventListener('click', function () {
                var nowFav = LuminaSettings.toggleFavorite(item.id, item);
                this.querySelector('span').textContent = nowFav ? 'Remover Favorito' : 'Favoritar';
            });
        }

        var seasonBtns = elMain.querySelectorAll('.season-chip');
        for (var i = 0; i < seasonBtns.length; i++) {
            seasonBtns[i].addEventListener('click', function () {
                uiState.detailSeason = this.getAttribute('data-season');
                uiState.detailEpisodeOffset = 0;
                paintDetailScreen(item, true);
            });
        }

        var epRows = elMain.querySelectorAll('.episode-row');
        for (var j = 0; j < epRows.length; j++) {
            epRows[j].addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-ep-index'), 10);
                var list = (item.seasons && item.seasons[uiState.detailSeason]) || [];
                if (list[idx]) {
                    LuminaRouter.navigate('player', { item: list[idx] });
                }
            });
        }

        FocusEngine.setZone('content');
    }

    // =========================================================================
    // FAVORITOS (usando retratos persistidos + LuminaCatalog.getItems)
    // =========================================================================
    function renderFavorites() {
        var portraits = LuminaSettings.getFavoritePortraits(200);
        var html = '<div class="screen screen-favorites">' +
            '<h1 class="catalog-heading">Meus Favoritos (' + formatNumber(portraits.length) + ')</h1>';

        if (portraits.length === 0) {
            html += '<div class="status-box"><p>Você ainda não adicionou canais, filmes ou séries aos favoritos.</p></div></div>';
            elMain.innerHTML = html;
            return;
        }

        html += '<div class="favorites-grid">';
        for (var i = 0; i < portraits.length; i++) {
            var item = portraits[i];
            var mono = computeMonogramData(item.title || item.name);
            html += '<button type="button" class="media-card focusable" data-zone="content" data-item-id="' + escapeHtml(item.id) + '" data-item-type="' + escapeHtml(item.type || 'vod') + '" tabindex="-1">' +
                '<div class="card-poster-wrap" style="background:' + mono.gradient + '">' +
                '<div class="card-monogram">' + escapeHtml(mono.initials) + '</div>' +
                '</div>' +
                '<div class="card-info">' +
                '<div class="card-title">' + escapeHtml(item.title || item.name) + '</div>' +
                '<div class="card-sub">' + escapeHtml(item.group || '') + '</div>' +
                '</div>' +
                '</button>';
        }
        html += '</div></div>';
        elMain.innerHTML = html;

        var cards = elMain.querySelectorAll('.media-card[data-item-id]');
        for (var j = 0; j < cards.length; j++) {
            cards[j].addEventListener('click', function () {
                openOrPlayItemById(this.getAttribute('data-item-id'), this.getAttribute('data-item-type'));
            });
        }
    }

    // =========================================================================
    // AJUSTES E GESTAO DE ARMAZENAMENTO / DIAGNOSTICO (Partes 9.4 e 11)
    // =========================================================================
    function renderSettings(params) {
        LuminaCatalog.getStorageUsage().then(function (usage) {
            paintSettingsScreen(usage, params);
        }).catch(function () {
            paintSettingsScreen(null, params);
        });
    }

    function paintSettingsScreen(usage, params) {
        var listState = LuminaCatalog.getListStateSync() || {};
        var counts = listState.counts || { live: 0, vod: 0, series: 0 };
        var idbMb = usage && usage.indexedDbBytes ? (usage.indexedDbBytes / (1024 * 1024)).toFixed(1) : '0.0';
        var freeMb = usage && usage.freeDiskBytes ? (usage.freeDiskBytes / (1024 * 1024)).toFixed(0) : 'N/D';

        var html = '<div class="screen screen-settings">' +
            '<h1 class="catalog-heading">Ajustes e Listas</h1>' +
            '<div class="settings-sections-grid">' +
            '<section class="settings-card">' +
            '<h2>Fontes de Catálogo</h2>' +
            '<p>Adicione ou sincronize sua lista M3U ou servidor Xtream Codes.</p>' +
            '<div class="settings-btn-stack">' +
            '<button type="button" class="btn btn-primary focusable" data-zone="content" id="btn-set-pairing" tabindex="-1">Parear pelo Celular (QR Code)</button>' +
            '<button type="button" class="btn btn-secondary focusable" data-zone="content" id="btn-set-m3u" tabindex="-1">Adicionar / Editar URL M3U</button>' +
            '<button type="button" class="btn btn-secondary focusable" data-zone="content" id="btn-set-xtream" tabindex="-1">Conectar Xtream Codes</button>' +
            '<button type="button" class="btn btn-ghost focusable" data-zone="content" id="btn-set-resync" tabindex="-1">Atualizar Lista Agora</button>' +
            '</div>' +
            '</section>' +
            '<section class="settings-card">' +
            '<h2>Armazenamento e Catálogo (v2.2.1)</h2>' +
            '<ul class="settings-stats-list">' +
            '<li><span>Canais indexados:</span> <strong>' + formatNumber(counts.live) + '</strong></li>' +
            '<li><span>Filmes indexados:</span> <strong>' + formatNumber(counts.vod) + '</strong></li>' +
            '<li><span>Séries indexadas:</span> <strong>' + formatNumber(counts.series) + '</strong></li>' +
            '<li><span>Espaço do banco IndexedDB:</span> <strong>' + idbMb + ' MB</strong></li>' +
            '<li><span>Espaço livre no dispositivo:</span> <strong>' + freeMb + ' MB</strong></li>' +
            '<li><span>Linhas malformadas ignoradas:</span> <strong>' + formatNumber(listState.malformedLinesSkipped || 0) + '</strong></li>' +
            '</ul>' +
            '<div class="settings-btn-stack">' +
            '<button type="button" class="btn btn-ghost focusable" data-zone="content" id="btn-clear-img-cache" tabindex="-1">Limpar Cache de Imagens</button>' +
            '<button type="button" class="btn btn-ghost focusable" data-zone="content" id="btn-clear-catalog" tabindex="-1">Apagar Catálogo Local (Preservar Favoritos)</button>' +
            '</div>' +
            '</section>' +
            '</div>' +
            '</div>';

        elMain.innerHTML = html;

        var btnClearImg = document.getElementById('btn-clear-img-cache');
        if (btnClearImg) {
            btnClearImg.addEventListener('click', function () {
                loadedImageUrls = {};
                failedImageUrls = {};
                showToast('Cache de imagens limpo com sucesso.', 'info');
            });
        }

        var btnClearCat = document.getElementById('btn-clear-catalog');
        if (btnClearCat) {
            btnClearCat.addEventListener('click', function () {
                LuminaCatalog.clearList({ keepUserData: true }).then(function () {
                    resetAllTabCaches();
                    showToast('Catálogo local apagado. Favoritos e histórico preservados.', 'info');
                    renderSettings();
                });
            });
        }

        var btnResync = document.getElementById('btn-set-resync');
        if (btnResync) {
            btnResync.addEventListener('click', function () {
                if (typeof Repository !== 'undefined' && Repository.syncActivePlaylist) {
                    Repository.syncActivePlaylist({ force: true });
                }
            });
        }

        if (params && params.openModal) {
            showToast('Use os botões acima para configurar ' + params.openModal.toUpperCase(), 'info');
        }
    }

    function renderPlayerScreen(params) {
        var item = params && params.item;
        if (!item) {
            LuminaRouter.navigate('home');
            return;
        }
        elMain.innerHTML = '';
        var resolvedUrl = LuminaCatalog.resolvePlaybackUrl(item);
        var playItem = {};
        for (var k in item) {
            if (Object.prototype.hasOwnProperty.call(item, k)) playItem[k] = item[k];
        }
        if (resolvedUrl) playItem.url = resolvedUrl;
        LuminaPlayer.play(playItem);
        LuminaOSD.show(playItem);
    }

    function closeModal() {
        if (!elModalRoot) return;
        elModalRoot.classList.add('hidden');
        elModalRoot.innerHTML = '';
        FocusEngine.setZone('content');
    }

    function showToast(message, type) {
        if (!elToastRoot) return;
        if (toastTimer) clearTimeout(toastTimer);
        elToastRoot.innerHTML = '<div class="toast toast-' + (type || 'info') + '">' + escapeHtml(message) + '</div>';
        elToastRoot.classList.remove('hidden');
        toastTimer = setTimeout(function () {
            elToastRoot.classList.add('hidden');
            elToastRoot.innerHTML = '';
        }, 4000);
    }

    return {
        init: init,
        renderRoute: renderRoute,
        showToast: showToast,
        closeModal: closeModal,
        escHtml: escapeHtml,
        escapeHtml: escapeHtml,
        POSTER_PALETTES: POSTER_PALETTES,
        POSTER_MOTIFS: POSTER_MOTIFS,
        generateDeterministicArtSvg: generateDeterministicArtSvg,
        getGreetingByHour: getGreetingByHour,
        computeIntroTimeline: computeIntroTimeline,
        computeMonogramData: computeMonogramData,
        dismissBootSplash: dismissBootSplash,
        isBootSplashVisible: isBootSplashVisible,
        getTabState: function (section) { return tabStates[section] || null; },
        resetAllTabCaches: resetAllTabCaches
    };
})();

if (typeof global !== 'undefined') {
    global.LuminaUI = LuminaUI;
}
if (typeof window !== 'undefined') {
    window.LuminaUI = LuminaUI;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LuminaUI;
}
