(function (global) {
  'use strict';

  var defaultSalt = 'lumina_v16_default_salt';
  var defaultPinHash = (global.LuminaSettings && global.LuminaSettings.hashPinWithSalt)
    ? global.LuminaSettings.hashPinWithSalt('0000', defaultSalt)
    : '';

  var state = {
    appVersion: '2.0.0',
    currentRoute: 'home',
    searchQuery: '',
    searchHistory: [],
    heroBannerIndex: 0,
    pairingBaseUrl: 'https://surubim-player-pairing.vercel.app',
    pairingStep: 'cards', // 'cards' | 'phone-qr'
    xtreamCreds: null,
    accountInfo: null,
    source: null,
    lastUpdateInfo: null,
    recentAddedIds: {},
    pairingError: null,
    parental: {
      enabled: true,
      pinSalt: defaultSalt,
      pinHash: defaultPinHash,
      unlockedSession: false,
      lastActivityAt: 0,
      failedAttempts: 0,
      lockoutUntil: 0,
      lockoutLevel: 0,
      hideAdultInSearchAndHome: true
    },
    tmdb: {
      enabled: false,
      apiKey: '',
      language: 'pt-BR',
      enrichedCount: 0
    },
    rawItems: [],
    items: [],
    channels: [],
    movies: [],
    seriesList: [],
    novelasList: [],
    unclassifiedList: [],
    categories: [],
    movieCategories: [],
    seriesCategories: [],
    novelaCategories: [],
    originalGroups: [],
    itemByIdMap: {},
    mappingProfile: {
      mode: 'auto',
      customGroupRules: {},
      renamedGroups: {},
      groupOrder: []
    },
    organizerUndoStack: [],
    selectedDetailItem: null,
    selectedSeason: 1,
    detailLoading: false,
    detailError: null,
    favorites: {},
    watchProgress: {},
    aspectRatioByContent: {},
    defaultAspectRatio: 'auto',
    screenSafeMargin: 0,
    performanceMode: 'auto', // 'auto' | 'normal' | 'lite'
    motionLevel: 'Completas', // 'Completas' | 'Reduzidas' | 'Desligadas'
    navDirection: 'forward', // 'forward' | 'back'
    sleepTimerMinutes: 0,
    autoUpdateHours: 12,
    preferOutputFormat: 'auto',
    includeCredentialsInBackup: false,
    liteModeActive: false,
    lastChannelId: null,
    currentChannelId: null,
    playerState: 'IDLE',
    nextEpisodePrompt: null,
    appUpdateInfo: null,
    appUpdateProgress: null,
    diagnosticsVisible: false,
    diagnostics: {
      engine: 'none',
      attemptedChain: '-',
      ttffMs: 0,
      reconnections: 0,
      droppedFrames: 0,
      domNodes: 0,
      catalogGeneration: '-',
      lastError: '-'
    }
  };

  function applyMotionClasses() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('motion-reduced', 'motion-off');
    var m = state.motionLevel || 'Completas';
    var perfDowngraded = !!(global.__luminaPerf && global.__luminaPerf.downgraded);
    if (m === 'Desligadas') {
      document.body.classList.add('motion-off');
    } else if (m === 'Reduzidas' || state.liteModeActive || perfDowngraded) {
      document.body.classList.add('motion-reduced');
    }
  }

  function applyLiteModeClass(isLite) {
    state.liteModeActive = !!isLite;
    if (typeof document !== 'undefined' && document.body) {
      if (state.liteModeActive) document.body.classList.add('lite-mode');
      else document.body.classList.remove('lite-mode');
      applyMotionClasses();
    }
  }

  function persistSettingKeysIfNeeded(key) {
    if (!global.LuminaSettings || !global.LuminaSettings.saveCurrentSettings) return;
    if (
      key === 'performanceMode' ||
      key === 'motionLevel' ||
      key === 'defaultAspectRatio' ||
      key === 'aspectRatioByContent' ||
      key === 'screenSafeMargin' ||
      key === 'parental' ||
      key === 'tmdb' ||
      key === 'autoUpdateHours' ||
      key === 'preferOutputFormat' ||
      key === 'includeCredentialsInBackup' ||
      key === 'searchHistory'
    ) {
      global.LuminaSettings.saveCurrentSettings();
    }
  }

  global.LuminaStore = {
    get: function (key) { return state[key]; },
    getState: function () { return state; },
    set: function (key, val) {
      state[key] = val;
      if (key === 'motionLevel') {
        applyMotionClasses();
      }
      if (key === 'performanceMode') {
        if (val === 'lite') applyLiteModeClass(true);
        else if (val === 'normal') applyLiteModeClass(false);
      }
      persistSettingKeysIfNeeded(key);
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
    verifyParentalPin: function (inputPin, nowMs) {
      if (global.LuminaSettings && global.LuminaSettings.verifyPin) {
        var res = global.LuminaSettings.verifyPin(inputPin, nowMs);
        return !!res.ok;
      }
      var expected = (state.parental && state.parental.pin) ? state.parental.pin : '0000';
      if (String(inputPin) === String(expected)) {
        state.parental.unlockedSession = true;
        return true;
      }
      return false;
    },
    verifyParentalPinDetailed: function (inputPin, nowMs) {
      if (global.LuminaSettings && global.LuminaSettings.verifyPin) {
        return global.LuminaSettings.verifyPin(inputPin, nowMs);
      }
      var ok = this.verifyParentalPin(inputPin, nowMs);
      return { ok: ok, locked: false, message: ok ? 'PIN válido' : 'PIN incorreto' };
    },
    exportFullBackupJson: function (includeSecrets) {
      var withSecrets = typeof includeSecrets === 'boolean' ? includeSecrets : !!state.includeCredentialsInBackup;
      var safeSource = null;
      if (state.source) {
        if (state.source.type === 'xtream' && state.source.creds) {
          safeSource = {
            type: 'xtream',
            name: state.source.name || '',
            creds: {
              server: state.source.creds.server,
              username: state.source.creds.username,
              password: withSecrets ? state.source.creds.password : ''
            }
          };
        } else if (state.source.type === 'm3u') {
          safeSource = {
            type: 'm3u',
            name: state.source.name || '',
            url: withSecrets ? state.source.url : ''
          };
        }
      }
      var backup = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        includesCredentials: withSecrets,
        pairingBaseUrl: state.pairingBaseUrl,
        source: safeSource,
        xtreamCreds: (withSecrets && state.xtreamCreds) ? state.xtreamCreds : null,
        mappingProfile: state.mappingProfile,
        favorites: state.favorites,
        watchProgress: state.watchProgress,
        defaultAspectRatio: state.defaultAspectRatio,
        aspectRatioByContent: state.aspectRatioByContent,
        screenSafeMargin: state.screenSafeMargin,
        performanceMode: state.performanceMode,
        autoUpdateHours: state.autoUpdateHours,
        parental: {
          enabled: state.parental.enabled,
          hideAdultInSearchAndHome: state.parental.hideAdultInSearchAndHome,
          pinSalt: withSecrets ? state.parental.pinSalt : undefined,
          pinHash: withSecrets ? state.parental.pinHash : undefined
        },
        tmdb: {
          enabled: state.tmdb.enabled,
          language: state.tmdb.language || 'pt-BR',
          apiKey: withSecrets ? state.tmdb.apiKey : ''
        }
      };
      return JSON.stringify(backup, null, 2);
    },
    importFullBackupJson: function (jsonStr) {
      var data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      if (!data || typeof data !== 'object') throw new Error('JSON de backup inválido');
      if (data.pairingBaseUrl) state.pairingBaseUrl = data.pairingBaseUrl;
      if (data.xtreamCreds && data.xtreamCreds.password) state.xtreamCreds = data.xtreamCreds;
      if (data.source && ((data.source.creds && data.source.creds.password) || data.source.url)) {
        state.source = data.source;
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('source', data.source);
      }
      if (data.mappingProfile) {
        state.mappingProfile = data.mappingProfile;
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('mappingProfile', data.mappingProfile);
      }
      if (data.favorites) {
        state.favorites = data.favorites;
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('favorites', data.favorites);
      }
      if (data.watchProgress) {
        state.watchProgress = data.watchProgress;
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', data.watchProgress);
      }
      if (data.defaultAspectRatio) state.defaultAspectRatio = data.defaultAspectRatio;
      if (data.aspectRatioByContent) state.aspectRatioByContent = data.aspectRatioByContent;
      if (typeof data.screenSafeMargin === 'number') {
        state.screenSafeMargin = global.LuminaSettings
          ? global.LuminaSettings.sanitizeSafeMargin(data.screenSafeMargin)
          : data.screenSafeMargin;
        if (typeof global.__luminaFitViewport === 'function') global.__luminaFitViewport();
      }
      if (data.performanceMode) {
        state.performanceMode = data.performanceMode;
        applyLiteModeClass(data.performanceMode === 'lite');
      }
      if (typeof data.autoUpdateHours === 'number') state.autoUpdateHours = data.autoUpdateHours;
      if (data.parental) {
        state.parental.enabled = !!data.parental.enabled;
        if (typeof data.parental.hideAdultInSearchAndHome === 'boolean') {
          state.parental.hideAdultInSearchAndHome = data.parental.hideAdultInSearchAndHome;
        }
        if (data.parental.pinHash && data.parental.pinSalt) {
          state.parental.pinSalt = data.parental.pinSalt;
          state.parental.pinHash = data.parental.pinHash;
        } else if (data.parental.pin && global.LuminaSettings) {
          var s = 'lumina_bkp_' + Date.now();
          state.parental.pinSalt = s;
          state.parental.pinHash = global.LuminaSettings.hashPinWithSalt(String(data.parental.pin), s);
        }
      }
      if (data.tmdb) {
        state.tmdb.enabled = !!data.tmdb.enabled;
        if (data.tmdb.apiKey) state.tmdb.apiKey = data.tmdb.apiKey;
      }
      if (global.LuminaSettings && global.LuminaSettings.saveCurrentSettings) {
        global.LuminaSettings.saveCurrentSettings();
      }
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
    isFavorite: function (itemId) {
      if (!itemId) return false;
      if (state.favorites[itemId]) return true;
      var rawKey = String(itemId).replace(/^[isn]:/, '');
      return !!state.favorites[rawKey];
    },
    removeWatchProgress: function (itemId) {
      if (state.watchProgress && state.watchProgress[itemId]) {
        delete state.watchProgress[itemId];
        if (global.LuminaStorage) global.LuminaStorage.saveMeta('watchProgress', state.watchProgress);
        if (global.LuminaEventBus) global.LuminaEventBus.emit('progress:changed', state.watchProgress);
      }
    },
    addSearchHistory: function (term) {
      var clean = String(term || '').trim();
      if (clean.length < 2) return;
      var hist = (state.searchHistory || []).slice();
      var existingIdx = hist.indexOf(clean);
      if (existingIdx !== -1) hist.splice(existingIdx, 1);
      hist.unshift(clean);
      if (hist.length > 10) hist = hist.slice(0, 10);
      this.set('searchHistory', hist);
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.LuminaStore;
  }
})(typeof window !== 'undefined' ? window : global);
