(function (global) {
  'use strict';

  var MAX_SAVED_LISTS = 5;
  var defaultSalt = 'lumina_v16_default_salt';
  var defaultPinHash = (global.LuminaSettings && global.LuminaSettings.hashPinWithSalt)
    ? global.LuminaSettings.hashPinWithSalt('0000', defaultSalt)
    : '';

  var state = {
    appVersion: '2.1.0',
    currentRoute: 'home',
    searchQuery: '',
    searchHistory: [],
    heroBannerIndex: 0,
    pairingBaseUrl: 'https://surubim-player-pairing.vercel.app',
    pairingStep: 'cards',
    xtreamCreds: null,
    accountInfo: null,
    source: null,
    savedLists: [],
    activeListId: '',
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
    performanceMode: 'auto',
    motionLevel: 'Completas',
    navDirection: 'forward',
    sleepTimerMinutes: 0,
    autoUpdateHours: 12,
    preferOutputFormat: 'auto',
    playerEngine: 'auto',
    playerUserAgent: 'vlc',
    playerUserAgentCustom: '',
    bufferProfile: 'normal',
    includeCredentialsInBackup: false,
    liteModeActive: false,
    lastChannelId: null,
    currentChannelId: null,
    playerState: 'IDLE',
    nextEpisodePrompt: null,
    appUpdateInfo: null,
    appUpdateProgress: null,
    streamTestResults: null,
    streamTestRunning: false,
    diagnosticsVisible: false,
    diagnostics: {
      engine: 'ExoPlayer',
      userAgent: 'VLC/3.0.20 LibVLC/3.0.20',
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
      key === 'playerEngine' ||
      key === 'playerUserAgent' ||
      key === 'playerUserAgentCustom' ||
      key === 'bufferProfile' ||
      key === 'includeCredentialsInBackup' ||
      key === 'searchHistory'
    ) {
      global.LuminaSettings.saveCurrentSettings();
    }
  }

  function buildListId(entry) {
    if (entry && entry.id) return entry.id;
    if (entry && entry.type === 'xtream' && entry.creds) {
      return 'xt_' + String(entry.creds.server || '').replace(/[^a-z0-9]/gi, '_') + '_' + String(entry.creds.username || '');
    }
    if (entry && entry.type === 'm3u' && entry.url) {
      return 'm3u_' + String(entry.url || '').slice(0, 64).replace(/[^a-z0-9]/gi, '_');
    }
    return 'list_' + Date.now();
  }

  function upsertSavedList(sourceObj, countsObj, accountInfoObj) {
    if (!sourceObj) return null;
    var listId = buildListId(sourceObj);
    sourceObj.id = listId;
    var listArr = Array.isArray(state.savedLists) ? state.savedLists.slice() : [];
    var existingIdx = -1;
    for (var i = 0; i < listArr.length; i++) {
      if (listArr[i].id === listId) {
        existingIdx = i;
        break;
      }
    }

    var counts = countsObj || {
      channels: (state.channels || []).length,
      movies: (state.movies || []).length,
      series: (state.seriesList || []).length + (state.novelasList || []).length
    };
    var acc = accountInfoObj || state.accountInfo || null;

    var record = {
      id: listId,
      name: sourceObj.name || 'Minha Lista',
      type: sourceObj.type,
      creds: sourceObj.type === 'xtream' ? sourceObj.creds : null,
      url: sourceObj.type === 'm3u' ? sourceObj.url : '',
      counts: counts,
      expDate: acc && acc.expDate ? acc.expDate : null,
      updatedAt: Date.now()
    };

    if (existingIdx !== -1) {
      listArr.splice(existingIdx, 1);
    }
    listArr.unshift(record);
    if (listArr.length > MAX_SAVED_LISTS) {
      listArr = listArr.slice(0, MAX_SAVED_LISTS);
    }

    state.savedLists = listArr;
    state.activeListId = listId;
    if (global.LuminaStorage) {
      global.LuminaStorage.saveMeta('savedLists', listArr);
      global.LuminaStorage.saveMeta('activeListId', listId);
    }
    return record;
  }

  function removeSavedList(listId) {
    var listArr = Array.isArray(state.savedLists) ? state.savedLists.slice() : [];
    var nextArr = [];
    for (var i = 0; i < listArr.length; i++) {
      if (listArr[i].id !== listId) nextArr.push(listArr[i]);
    }
    state.savedLists = nextArr;
    if (global.LuminaStorage) {
      global.LuminaStorage.saveMeta('savedLists', nextArr);
    }
    return nextArr;
  }

  global.LuminaStore = {
    MAX_SAVED_LISTS: MAX_SAVED_LISTS,
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
    buildListId: buildListId,
    upsertSavedList: upsertSavedList,
    removeSavedList: removeSavedList,
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
      var safeSavedLists = (state.savedLists || []).map(function (item) {
        return {
          id: item.id,
          name: item.name,
          type: item.type,
          creds: item.creds ? {
            server: item.creds.server,
            username: item.creds.username,
            password: withSecrets ? item.creds.password : ''
          } : null,
          url: withSecrets ? (item.url || '') : '',
          counts: item.counts || { channels: 0, movies: 0, series: 0 },
          expDate: item.expDate || null,
          updatedAt: item.updatedAt || 0
        };
      });
      var backup = {
        version: '2.1.0',
        exportedAt: new Date().toISOString(),
        includesCredentials: withSecrets,
        pairingBaseUrl: state.pairingBaseUrl,
        source: safeSource,
        savedLists: safeSavedLists,
        xtreamCreds: (withSecrets && state.xtreamCreds) ? state.xtreamCreds : null,
        mappingProfile: state.mappingProfile,
        favorites: state.favorites,
        watchProgress: state.watchProgress,
        defaultAspectRatio: state.defaultAspectRatio,
        aspectRatioByContent: state.aspectRatioByContent,
        screenSafeMargin: state.screenSafeMargin,
        performanceMode: state.performanceMode,
        autoUpdateHours: state.autoUpdateHours,
        preferOutputFormat: state.preferOutputFormat,
        playerEngine: state.playerEngine,
        playerUserAgent: state.playerUserAgent,
        bufferProfile: state.bufferProfile,
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
      if (Array.isArray(data.savedLists) && data.savedLists.length) {
        var validSaved = data.savedLists.filter(function (it) {
          return (it.type === 'xtream' && it.creds && it.creds.password) || (it.type === 'm3u' && it.url);
        });
        if (validSaved.length) {
          state.savedLists = validSaved.slice(0, MAX_SAVED_LISTS);
          if (global.LuminaStorage) global.LuminaStorage.saveMeta('savedLists', state.savedLists);
        }
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
      if (data.preferOutputFormat) state.preferOutputFormat = data.preferOutputFormat;
      if (data.playerEngine) state.playerEngine = data.playerEngine;
      if (data.playerUserAgent) state.playerUserAgent = data.playerUserAgent;
      if (data.bufferProfile) state.bufferProfile = data.bufferProfile;
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
      if (global.LuminaStorage) {
        global.LuminaStorage.saveMeta('favorites', favs);
        if (state.activeListId) {
          global.LuminaStorage.saveMeta('favorites_' + state.activeListId, favs);
        }
      }
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
        if (global.LuminaStorage) {
          global.LuminaStorage.saveMeta('watchProgress', state.watchProgress);
          if (state.activeListId) {
            global.LuminaStorage.saveMeta('watchProgress_' + state.activeListId, state.watchProgress);
          }
        }
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
