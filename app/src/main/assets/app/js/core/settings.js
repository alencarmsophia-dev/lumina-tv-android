(function (global) {
  'use strict';

  var SETTINGS_META_KEY = 'settings_v2';
  var PIN_LOCKOUT_THRESHOLD = 5;
  var PIN_BASE_LOCKOUT_MS = 60000; // 60 segundos
  var PARENTAL_SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos
  var ALLOWED_SAFE_MARGINS = [0, 0.02, 0.04, 0.06, 0.08, 0.10];

  function sha256Hex(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j;
    var result = '';
    var words = [];
    var asciiBitLength = ascii[lengthProperty] * 8;
    var hash = [];
    var k = [];
    var primeCounter = 0;
    var isComposite = {};

    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }

    ascii += '\x80';
    while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - (i % 4)) * 8);
    }
    words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
    words[words[lengthProperty]] = asciiBitLength;

    for (j = 0; j < words[lengthProperty]; ) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);

      for (i = 0; i < 64; i++) {
        var i2 = i + j;
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0);
        var temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function hashPinWithSalt(pin, salt) {
    var cleanPin = String(pin || '0000').trim();
    var cleanSalt = String(salt || 'lumina_salt_v16');
    return sha256Hex(cleanSalt + ':' + cleanPin);
  }

  function sanitizeSafeMargin(val) {
    var num = typeof val === 'number' ? val : parseFloat(val);
    if (typeof num !== 'number' || isNaN(num) || !isFinite(num) || num < 0) return 0;
    if (num > 0.10) return 0.10;
    return Math.round(num * 100) / 100;
  }

  function defaultSettings() {
    var salt = 'lumina_v16_default_salt';
    return {
      schemaVersion: 3,
      performanceMode: 'auto',
      motionLevel: 'Completas',
      defaultAspectRatio: 'auto',
      aspectRatioByContent: {},
      screenSafeMargin: 0,
      autoUpdateHours: 12,
      catalogUpdatePolicy: '12h',
      searchHistoryBySection: { live: [], movie: [], series: [] },
      preferOutputFormat: 'auto',
      playerEngine: 'auto',
      playerUserAgent: 'vlc',
      playerUserAgentCustom: '',
      bufferProfile: 'normal',
      includeCredentialsInBackup: false,
      searchHistory: [],
      parental: {
        enabled: true,
        pinSalt: salt,
        pinHash: hashPinWithSalt('0000', salt),
        hideAdultInSearchAndHome: true,
        failedAttempts: 0,
        lockoutUntil: 0,
        lockoutLevel: 0
      },
      tmdb: {
        enabled: false,
        apiKey: '',
        language: 'pt-BR',
        enrichedCount: 0
      }
    };
  }

  function normalizeAndMigrateSettings(raw) {
    var def = defaultSettings();
    if (!raw || typeof raw !== 'object') return def;

    if (raw.performanceMode === 'auto' || raw.performanceMode === 'normal' || raw.performanceMode === 'lite') {
      def.performanceMode = raw.performanceMode;
    }
    if (raw.motionLevel === 'Completas' || raw.motionLevel === 'Reduzidas' || raw.motionLevel === 'Desligadas') {
      def.motionLevel = raw.motionLevel;
    }
    if (raw.defaultAspectRatio) def.defaultAspectRatio = raw.defaultAspectRatio;
    if (raw.aspectRatioByContent && typeof raw.aspectRatioByContent === 'object') {
      def.aspectRatioByContent = raw.aspectRatioByContent;
    }
    if (typeof raw.screenSafeMargin !== 'undefined') {
      def.screenSafeMargin = sanitizeSafeMargin(raw.screenSafeMargin);
    }
    if (typeof raw.autoUpdateHours === 'number') def.autoUpdateHours = raw.autoUpdateHours;
    if (raw.catalogUpdatePolicy === 'on_open_tab' || raw.catalogUpdatePolicy === '6h' || raw.catalogUpdatePolicy === '12h' || raw.catalogUpdatePolicy === '24h' || raw.catalogUpdatePolicy === 'manual') def.catalogUpdatePolicy = raw.catalogUpdatePolicy;
    if (raw.searchHistoryBySection && typeof raw.searchHistoryBySection === 'object') def.searchHistoryBySection = raw.searchHistoryBySection;
    if (raw.preferOutputFormat === 'auto' || raw.preferOutputFormat === 'm3u8' || raw.preferOutputFormat === 'ts') {
      def.preferOutputFormat = raw.preferOutputFormat;
    }
    if (raw.playerEngine === 'auto' || raw.playerEngine === 'exo' || raw.playerEngine === 'web') {
      def.playerEngine = raw.playerEngine;
    }
    if (raw.playerUserAgent === 'vlc' || raw.playerUserAgent === 'lumina' || raw.playerUserAgent === 'iptv' || raw.playerUserAgent === 'chrome' || raw.playerUserAgent === 'custom') {
      def.playerUserAgent = raw.playerUserAgent;
    }
    if (typeof raw.playerUserAgentCustom === 'string') {
      def.playerUserAgentCustom = raw.playerUserAgentCustom.trim();
    }
    if (raw.bufferProfile === 'small' || raw.bufferProfile === 'normal' || raw.bufferProfile === 'large') {
      def.bufferProfile = raw.bufferProfile;
    }
    if (typeof raw.includeCredentialsInBackup === 'boolean') {
      def.includeCredentialsInBackup = raw.includeCredentialsInBackup;
    }
    if (Array.isArray(raw.searchHistory)) {
      def.searchHistory = raw.searchHistory.slice(0, 12);
    }

    if (raw.parental && typeof raw.parental === 'object') {
      def.parental.enabled = typeof raw.parental.enabled === 'boolean' ? raw.parental.enabled : true;
      def.parental.hideAdultInSearchAndHome =
        typeof raw.parental.hideAdultInSearchAndHome === 'boolean'
          ? raw.parental.hideAdultInSearchAndHome
          : true;

      if (raw.parental.pinHash && raw.parental.pinSalt) {
        def.parental.pinSalt = raw.parental.pinSalt;
        def.parental.pinHash = raw.parental.pinHash;
      } else if (raw.parental.pin) {
        var newSalt = 'lumina_migrated_' + Date.now();
        def.parental.pinSalt = newSalt;
        def.parental.pinHash = hashPinWithSalt(String(raw.parental.pin), newSalt);
      }
      def.parental.failedAttempts = Number(raw.parental.failedAttempts || 0);
      def.parental.lockoutUntil = Number(raw.parental.lockoutUntil || 0);
      def.parental.lockoutLevel = Number(raw.parental.lockoutLevel || 0);
    }

    if (raw.tmdb && typeof raw.tmdb === 'object') {
      def.tmdb.enabled = !!raw.tmdb.enabled || !!raw.tmdb.apiKey;
      def.tmdb.apiKey = String(raw.tmdb.apiKey || '');
      def.tmdb.language = String(raw.tmdb.language || 'pt-BR');
      def.tmdb.enrichedCount = Number(raw.tmdb.enrichedCount || 0);
    }

    return def;
  }

  function applySettingsToStore(settings) {
    if (!global.LuminaStore) return;
    var s = normalizeAndMigrateSettings(settings);
    global.LuminaStore.set('performanceMode', s.performanceMode);
    global.LuminaStore.set('motionLevel', s.motionLevel || 'Completas');
    global.LuminaStore.set('defaultAspectRatio', s.defaultAspectRatio);
    global.LuminaStore.set('aspectRatioByContent', s.aspectRatioByContent);
    global.LuminaStore.set('screenSafeMargin', s.screenSafeMargin);
    global.LuminaStore.set('autoUpdateHours', s.autoUpdateHours);
    global.LuminaStore.set('catalogUpdatePolicy', s.catalogUpdatePolicy || '12h');
    global.LuminaStore.set('searchHistoryBySection', s.searchHistoryBySection || { live: [], movie: [], series: [] });
    global.LuminaStore.set('preferOutputFormat', s.preferOutputFormat);
    global.LuminaStore.set('playerEngine', s.playerEngine);
    global.LuminaStore.set('playerUserAgent', s.playerUserAgent);
    global.LuminaStore.set('playerUserAgentCustom', s.playerUserAgentCustom);
    global.LuminaStore.set('bufferProfile', s.bufferProfile);
    global.LuminaStore.set('includeCredentialsInBackup', s.includeCredentialsInBackup);
    global.LuminaStore.set('searchHistory', s.searchHistory);

    var curParental = global.LuminaStore.get('parental') || {};
    global.LuminaStore.set('parental', {
      enabled: s.parental.enabled,
      pinSalt: s.parental.pinSalt,
      pinHash: s.parental.pinHash,
      hideAdultInSearchAndHome: s.parental.hideAdultInSearchAndHome,
      failedAttempts: s.parental.failedAttempts,
      lockoutUntil: s.parental.lockoutUntil,
      lockoutLevel: s.parental.lockoutLevel,
      unlockedSession: !!curParental.unlockedSession,
      lastActivityAt: curParental.lastActivityAt || 0
    });

    var curTmdb = global.LuminaStore.get('tmdb') || {};
    global.LuminaStore.set('tmdb', {
      enabled: s.tmdb.enabled || !!curTmdb.apiKey,
      apiKey: s.tmdb.apiKey || curTmdb.apiKey || '',
      language: s.tmdb.language || 'pt-BR',
      enrichedCount: s.tmdb.enrichedCount || curTmdb.enrichedCount || 0
    });

    if (typeof global.__luminaFitViewport === 'function') {
      global.__luminaFitViewport();
    }
  }

  function extractSettingsFromStore() {
    if (!global.LuminaStore) return defaultSettings();
    var par = global.LuminaStore.get('parental') || {};
    var tmdb = global.LuminaStore.get('tmdb') || {};
    return normalizeAndMigrateSettings({
      performanceMode: global.LuminaStore.get('performanceMode'),
      motionLevel: global.LuminaStore.get('motionLevel'),
      defaultAspectRatio: global.LuminaStore.get('defaultAspectRatio'),
      aspectRatioByContent: global.LuminaStore.get('aspectRatioByContent'),
      screenSafeMargin: global.LuminaStore.get('screenSafeMargin'),
      autoUpdateHours: global.LuminaStore.get('autoUpdateHours'),
      catalogUpdatePolicy: global.LuminaStore.get('catalogUpdatePolicy'),
      searchHistoryBySection: global.LuminaStore.get('searchHistoryBySection'),
      preferOutputFormat: global.LuminaStore.get('preferOutputFormat'),
      playerEngine: global.LuminaStore.get('playerEngine'),
      playerUserAgent: global.LuminaStore.get('playerUserAgent'),
      playerUserAgentCustom: global.LuminaStore.get('playerUserAgentCustom'),
      bufferProfile: global.LuminaStore.get('bufferProfile'),
      includeCredentialsInBackup: global.LuminaStore.get('includeCredentialsInBackup'),
      searchHistory: global.LuminaStore.get('searchHistory'),
      parental: {
        enabled: par.enabled,
        pinSalt: par.pinSalt,
        pinHash: par.pinHash,
        pin: par.pin,
        hideAdultInSearchAndHome: par.hideAdultInSearchAndHome,
        failedAttempts: par.failedAttempts,
        lockoutUntil: par.lockoutUntil,
        lockoutLevel: par.lockoutLevel
      },
      tmdb: tmdb
    });
  }

  function saveCurrentSettings(cb) {
    var current = extractSettingsFromStore();
    if (global.LuminaStorage && global.LuminaStorage.saveMeta) {
      global.LuminaStorage.saveMeta(SETTINGS_META_KEY, current, cb);
    } else if (cb) {
      cb(null);
    }
  }

  function loadAndApplySettings(cb) {
    if (!global.LuminaStorage || !global.LuminaStorage.loadMeta) {
      var d = defaultSettings();
      applySettingsToStore(d);
      return cb && cb(d);
    }
    global.LuminaStorage.loadMeta(SETTINGS_META_KEY, null, function (saved) {
      if (saved) {
        var norm = normalizeAndMigrateSettings(saved);
        applySettingsToStore(norm);
        return cb && cb(norm);
      }
      global.LuminaStorage.loadMeta('aspectRatioByContent', {}, function (legacyRatios) {
        var initial = defaultSettings();
        if (legacyRatios && typeof legacyRatios === 'object') {
          initial.aspectRatioByContent = legacyRatios;
        }
        applySettingsToStore(initial);
        saveCurrentSettings(function () {
          if (cb) cb(initial);
        });
      });
    });
  }

  function stepSafeMargin(deltaSteps) {
    var cur = sanitizeSafeMargin(global.LuminaStore ? global.LuminaStore.get('screenSafeMargin') : 0);
    var idx = 0;
    for (var i = 0; i < ALLOWED_SAFE_MARGINS.length; i++) {
      if (Math.abs(ALLOWED_SAFE_MARGINS[i] - cur) < 0.005) {
        idx = i;
        break;
      }
    }
    var nextIdx = idx + (deltaSteps || 1);
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= ALLOWED_SAFE_MARGINS.length) nextIdx = ALLOWED_SAFE_MARGINS.length - 1;
    var nextVal = ALLOWED_SAFE_MARGINS[nextIdx];
    if (global.LuminaStore) {
      global.LuminaStore.set('screenSafeMargin', nextVal);
    }
    saveCurrentSettings();
    if (typeof global.__luminaFitViewport === 'function') {
      global.__luminaFitViewport();
    }
    return nextVal;
  }

  function verifyPin(inputPin, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var par = (global.LuminaStore && global.LuminaStore.get('parental')) || defaultSettings().parental;
    if (!par.pinSalt || !par.pinHash) {
      var migrated = normalizeAndMigrateSettings({ parental: par }).parental;
      par.pinSalt = migrated.pinSalt;
      par.pinHash = migrated.pinHash;
    }

    if (par.lockoutUntil && now < par.lockoutUntil) {
      var waitSec = Math.ceil((par.lockoutUntil - now) / 1000);
      return {
        ok: false,
        locked: true,
        remainingSeconds: waitSec,
        message: 'Muitas tentativas incorretas. Aguarde ' + waitSec + 's para tentar novamente.'
      };
    }

    var candidateHash = hashPinWithSalt(String(inputPin || ''), par.pinSalt);
    if (candidateHash === par.pinHash) {
      par.failedAttempts = 0;
      par.lockoutUntil = 0;
      par.lockoutLevel = 0;
      par.unlockedSession = true;
      par.lastActivityAt = now;
      if (global.LuminaStore) global.LuminaStore.set('parental', par);
      saveCurrentSettings();
      return { ok: true, locked: false, remainingSeconds: 0, message: 'PIN validado com sucesso.' };
    }

    par.failedAttempts = (par.failedAttempts || 0) + 1;
    if (par.failedAttempts >= PIN_LOCKOUT_THRESHOLD) {
      par.lockoutLevel = (par.lockoutLevel || 0) + 1;
      var durationMs = PIN_BASE_LOCKOUT_MS * Math.pow(2, par.lockoutLevel - 1);
      par.lockoutUntil = now + durationMs;
      par.failedAttempts = 0;
      if (global.LuminaStore) global.LuminaStore.set('parental', par);
      saveCurrentSettings();
      var sec = Math.ceil(durationMs / 1000);
      return {
        ok: false,
        locked: true,
        remainingSeconds: sec,
        message: '5 tentativas incorretas! Digite novamente após ' + sec + ' segundos.'
      };
    }

    if (global.LuminaStore) global.LuminaStore.set('parental', par);
    saveCurrentSettings();
    var left = PIN_LOCKOUT_THRESHOLD - par.failedAttempts;
    return {
      ok: false,
      locked: false,
      remainingSeconds: 0,
      attemptsLeft: left,
      message: 'PIN incorreto! Restam ' + left + ' tentativa(s).'
    };
  }

  function changePin(currentPin, newPin, confirmPin, nowMs) {
    var check = verifyPin(currentPin, nowMs);
    if (!check.ok) return check;
    var cleanNew = String(newPin || '').trim();
    if (!/^\d{4}$/.test(cleanNew)) {
      return { ok: false, message: 'O novo PIN deve conter exatamente 4 dígitos numéricos.' };
    }
    if (typeof confirmPin !== 'undefined' && cleanNew !== String(confirmPin || '').trim()) {
      return { ok: false, message: 'A confirmação do novo PIN não confere.' };
    }
    var par = global.LuminaStore.get('parental') || defaultSettings().parental;
    var newSalt = 'lumina_salt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    par.pinSalt = newSalt;
    par.pinHash = hashPinWithSalt(cleanNew, newSalt);
    delete par.pin;
    par.failedAttempts = 0;
    par.lockoutUntil = 0;
    global.LuminaStore.set('parental', par);
    saveCurrentSettings();
    return { ok: true, message: 'PIN Parental alterado e salvo com sucesso!' };
  }

  function checkAndExpireParentalSession(nowMs) {
    if (!global.LuminaStore) return false;
    var par = global.LuminaStore.get('parental');
    if (!par || !par.unlockedSession) return false;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var last = par.lastActivityAt || now;
    if (now - last >= PARENTAL_SESSION_TIMEOUT_MS) {
      par.unlockedSession = false;
      global.LuminaStore.set('parental', par);
      return true;
    }
    return false;
  }

  function touchParentalActivity(nowMs) {
    if (!global.LuminaStore) return;
    var par = global.LuminaStore.get('parental');
    if (par && par.unlockedSession) {
      par.lastActivityAt = typeof nowMs === 'number' ? nowMs : Date.now();
    }
  }

  function lockParentalSession() {
    if (!global.LuminaStore) return;
    var par = global.LuminaStore.get('parental');
    if (par && par.unlockedSession) {
      par.unlockedSession = false;
      global.LuminaStore.set('parental', par);
    }
  }

  var api = {
    SETTINGS_META_KEY: SETTINGS_META_KEY,
    PIN_LOCKOUT_THRESHOLD: PIN_LOCKOUT_THRESHOLD,
    PIN_BASE_LOCKOUT_MS: PIN_BASE_LOCKOUT_MS,
    PARENTAL_SESSION_TIMEOUT_MS: PARENTAL_SESSION_TIMEOUT_MS,
    ALLOWED_SAFE_MARGINS: ALLOWED_SAFE_MARGINS,
    sha256Hex: sha256Hex,
    hashPinWithSalt: hashPinWithSalt,
    sanitizeSafeMargin: sanitizeSafeMargin,
    defaultSettings: defaultSettings,
    normalizeAndMigrateSettings: normalizeAndMigrateSettings,
    applySettingsToStore: applySettingsToStore,
    extractSettingsFromStore: extractSettingsFromStore,
    saveCurrentSettings: saveCurrentSettings,
    loadAndApplySettings: loadAndApplySettings,
    stepSafeMargin: stepSafeMargin,
    verifyPin: verifyPin,
    changePin: changePin,
    checkAndExpireParentalSession: checkAndExpireParentalSession,
    touchParentalActivity: touchParentalActivity,
    lockParentalSession: lockParentalSession
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaSettings = api;
})(typeof window !== 'undefined' ? window : global);
