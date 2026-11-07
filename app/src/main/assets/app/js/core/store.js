(function (global) {
  'use strict';
  var state = {
    currentRoute: 'home',
    searchQuery: '',
    heroBannerIndex: 0,
    pairingBaseUrl: 'https://surubim-player-pairing.vercel.app',
    pairingStep: 'cards', // 'cards' | 'phone-qr'
    xtreamCreds: null,
    source: null, // última lista recebida: { type: 'm3u'|'xtream', name, url | creds }
    pairingError: null,
    parental: {
      enabled: true,
      pin: '0000',
      unlockedSession: false,
      hideAdultInSearchAndHome: true
    },
    tmdb: {
      enabled: false,
      apiKey: '',
      enrichedCount: 0
    },
    rawItems: [],
    items: [],
    channels: [],
    movies: [],
    seriesList: [],
    novelasList: [],
    categories: [],
    movieCategories: [],
    seriesCategories: [],
    novelaCategories: [],
    originalGroups: [],
    mappingProfile: {
      mode: 'auto',
      customGroupRules: {},
      renamedGroups: {},
      groupOrder: []
    },
    selectedDetailItem: null,
    selectedSeason: 1,
    favorites: {},
    watchProgress: {},
    aspectRatioByContent: {},
    defaultAspectRatio: 'auto',
    performanceMode: 'auto', // 'auto' | 'normal' | 'lite'
    liteModeActive: false,
    lastChannelId: null,
    currentChannelId: null,
    playerState: 'IDLE',
    nextEpisodePrompt: null,
    diagnosticsVisible: false,
    diagnostics: {
      engine: 'none',
      ttffMs: 0,
      reconnections: 0,
      droppedFrames: 0,
      domNodes: 0,
      lastError: '-'
    }
  };

  function applyLiteModeClass(isLite) {
    state.liteModeActive = !!isLite;
    if (typeof document !== 'undefined' && document.body) {
      if (state.liteModeActive) document.body.classList.add('lite-mode');
      else document.body.classList.remove('lite-mode');
    }
  }

  global.LuminaStore = {
    get: function (key) { return state[key]; },
    getState: function () { return state; },
    set: function (key, val) {
      state[key] = val;
      if (key === 'performanceMode') {
        if (val === 'lite') applyLiteModeClass(true);
        else if (val === 'normal') applyLiteModeClass(false);
      }
      if (global.LuminaEventBus) global.LuminaEventBus.emit('store:' + key, val);
    },
    reportDroppedFrames: function (count) {
      state.diagnostics.droppedFrames = count;
      if (state.performanceMode === 'auto' && count >= 25 && !state.liteModeActive) {
        applyLiteModeClass(true);
        if (global.LuminaLog) global.LuminaLog.warn('PERF', 'Modo Leve ativado automaticamente por queda de quadros (' + count + ')');
        if (global.LuminaEventBus) global.LuminaEventBus.emit('perf:litemode', true);
      }
    },
    verifyParentalPin: function (inputPin) {
      var expected = (state.parental && state.parental.pin) ? state.parental.pin : '0000';
      if (String(inputPin) === String(expected)) {
        state.parental.unlockedSession = true;
        return true;
      }
      return false;
    },
    exportFullBackupJson: function () {
      var backup = {
        version: '1.4.0',
        exportedAt: new Date().toISOString(),
        pairingBaseUrl: state.pairingBaseUrl,
        xtreamCreds: state.xtreamCreds,
        mappingProfile: state.mappingProfile,
        favorites: state.favorites,
        watchProgress: state.watchProgress,
        defaultAspectRatio: state.defaultAspectRatio,
        performanceMode: state.performanceMode,
        parental: {
          enabled: state.parental.enabled,
          pin: state.parental.pin,
          hideAdultInSearchAndHome: state.parental.hideAdultInSearchAndHome
        },
        tmdb: state.tmdb
      };
      return JSON.stringify(backup, null, 2);
    },
    importFullBackupJson: function (jsonStr) {
      var data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (!data || typeof data !== 'object') throw new Error('JSON de backup inválido');
      if (data.pairingBaseUrl) state.pairingBaseUrl = data.pairingBaseUrl;
      if (data.xtreamCreds) state.xtreamCreds = data.xtreamCreds;
      if (data.mappingProfile) state.mappingProfile = data.mappingProfile;
      if (data.favorites) state.favorites = data.favorites;
      if (data.watchProgress) state.watchProgress = data.watchProgress;
      if (data.defaultAspectRatio) state.defaultAspectRatio = data.defaultAspectRatio;
      if (data.performanceMode) {
        state.performanceMode = data.performanceMode;
        applyLiteModeClass(data.performanceMode === 'lite');
      }
      if (data.parental) {
        state.parental.enabled = !!data.parental.enabled;
        state.parental.pin = String(data.parental.pin || '0000');
      }
      if (data.tmdb) state.tmdb = data.tmdb;
      return true;
    },
    toggleFavorite: function (itemId) {
      var favs = state.favorites;
      if (favs[itemId]) delete favs[itemId];
      else favs[itemId] = Date.now();
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('favorites', favs);
      if (global.LuminaEventBus) global.LuminaEventBus.emit('favorites:changed', favs);
      return !!favs[itemId];
    },
    isFavorite: function (itemId) { return !!state.favorites[itemId]; },
    removeWatchProgress: function (itemId) {
      if (state.watchProgress && state.watchProgress[itemId]) {
        delete state.watchProgress[itemId];
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', state.watchProgress);
        if (global.LuminaEventBus) global.LuminaEventBus.emit('progress:changed', state.watchProgress);
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LuminaStore;
  }
})(typeof window !== 'undefined' ? window : global);
