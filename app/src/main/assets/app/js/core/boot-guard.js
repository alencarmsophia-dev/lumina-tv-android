(function (global) {
  'use strict';

  var BOOT_WINDOW_MS = 3 * 60 * 1000; // 3 minutos
  var BOOT_STABLE_DELAY_MS = 5000;    // 5 segundos estável no Início
  var AUTO_UPDATE_MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
  var AUTO_UPDATE_BACKOFFS_MS = [
    30 * 60 * 1000,      // 30 min
    60 * 60 * 1000,      // 1 h
    2 * 60 * 60 * 1000,  // 2 h
    4 * 60 * 60 * 1000   // 4 h
  ];

  var memoryBootState = {
    bootInProgress: false,
    failCount: 0,
    safeMode: false,
    lastBootAt: 0,
    lastAutoUpdateAttemptAt: 0,
    autoUpdateFailures: 0,
    nextAutoUpdateAllowedAt: 0
  };

  var stableTimer = null;

  function getBridge() {
    if (typeof window !== 'undefined' && window.LuminaAndroidBridge) {
      return window.LuminaAndroidBridge;
    }
    return null;
  }

  function loadPersistedState() {
    var b = getBridge();
    if (b && typeof b.getBootGuardState === 'function') {
      try {
        var raw = b.getBootGuardState();
        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          memoryBootState.bootInProgress = !!parsed.bootInProgress;
          memoryBootState.failCount = Number(parsed.failCount || 0);
          memoryBootState.safeMode = !!parsed.safeMode;
          memoryBootState.lastBootAt = Number(parsed.lastBootAt || 0);
        }
      } catch (e) {}
    } else if (typeof localStorage !== 'undefined' && localStorage) {
      try {
        var s = localStorage.getItem('lumina_boot_guard_v22');
        if (s) {
          var p = JSON.parse(s);
          memoryBootState.bootInProgress = !!p.bootInProgress;
          memoryBootState.failCount = Number(p.failCount || 0);
          memoryBootState.safeMode = !!p.safeMode;
          memoryBootState.lastBootAt = Number(p.lastBootAt || 0);
          memoryBootState.lastAutoUpdateAttemptAt = Number(p.lastAutoUpdateAttemptAt || 0);
          memoryBootState.autoUpdateFailures = Number(p.autoUpdateFailures || 0);
          memoryBootState.nextAutoUpdateAllowedAt = Number(p.nextAutoUpdateAllowedAt || 0);
        }
      } catch (e) {}
    }
    return memoryBootState;
  }

  function savePersistedState() {
    if (typeof localStorage !== 'undefined' && localStorage) {
      try {
        localStorage.setItem('lumina_boot_guard_v22', JSON.stringify(memoryBootState));
      } catch (e) {}
    }
  }

  // Parte 9.2: Registra início de abertura; se abrir com bootInProgress=true 2 vezes em 3 min, entra em Modo Seguro
  function recordBootStart(nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var b = getBridge();
    if (b && typeof b.getBootGuardState === 'function') {
      // MainActivity.onCreate já atualizou o SharedPreferences nativo; sincroniza com JS
      loadPersistedState();
    } else {
      if (memoryBootState.bootInProgress && (now - memoryBootState.lastBootAt) <= BOOT_WINDOW_MS) {
        memoryBootState.failCount += 1;
        if (memoryBootState.failCount >= 2) {
          memoryBootState.safeMode = true;
        }
      } else if (!memoryBootState.bootInProgress && (now - memoryBootState.lastBootAt) > BOOT_WINDOW_MS) {
        memoryBootState.failCount = 0;
      }
      memoryBootState.bootInProgress = true;
      memoryBootState.lastBootAt = now;
      savePersistedState();
    }

    if (global.LuminaStore) {
      global.LuminaStore.set('safeMode', !!memoryBootState.safeMode);
    }
    if (memoryBootState.safeMode && global.LuminaDiagLog) {
      global.LuminaDiagLog.record('error', {
        engine: 'BootGuard',
        code: 'SAFE_MODE_ENTERED',
        message: 'Modo seguro ativado após ' + memoryBootState.failCount + ' aberturas incompletas em 3 minutos.'
      });
    }
    return {
      bootInProgress: memoryBootState.bootInProgress,
      failCount: memoryBootState.failCount,
      safeMode: memoryBootState.safeMode,
      lastBootAt: memoryBootState.lastBootAt
    };
  }

  function markBootStable() {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
    memoryBootState.bootInProgress = false;
    memoryBootState.failCount = 0;
    savePersistedState();
    var b = getBridge();
    if (b && typeof b.markBootStable === 'function') {
      try { b.markBootStable(); } catch (e) {}
    }
  }

  function scheduleBootStableTimer(delayMs) {
    if (stableTimer) clearTimeout(stableTimer);
    var wait = typeof delayMs === 'number' ? delayMs : BOOT_STABLE_DELAY_MS;
    stableTimer = setTimeout(function () {
      stableTimer = null;
      markBootStable();
    }, wait);
  }

  function setSafeMode(enabled) {
    memoryBootState.safeMode = !!enabled;
    if (!enabled) {
      memoryBootState.bootInProgress = false;
      memoryBootState.failCount = 0;
    }
    savePersistedState();
    var b = getBridge();
    if (b && typeof b.setSafeMode === 'function') {
      try { b.setSafeMode(!!enabled); } catch (e) {}
    }
    if (global.LuminaStore) {
      global.LuminaStore.set('safeMode', !!enabled);
    }
  }

  function isSafeMode() {
    return !!memoryBootState.safeMode;
  }

  // Parte 9.3: Controle de taxa e backoff exponencial para atualização automática (30m, 1h, 2h, 4h)
  function canRunAutoUpdate(nowMs, autoUpdateHours, lastUpdatedAt) {
    if (memoryBootState.safeMode) return false;
    if (!autoUpdateHours || autoUpdateHours <= 0) return false;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    if (now < memoryBootState.nextAutoUpdateAllowedAt) return false;
    if (memoryBootState.lastAutoUpdateAttemptAt > 0 && (now - memoryBootState.lastAutoUpdateAttemptAt) < AUTO_UPDATE_MIN_INTERVAL_MS) {
      return false;
    }
    var lastUpd = Number(lastUpdatedAt || 0);
    if (lastUpd > 0 && (now - lastUpd) < autoUpdateHours * 3600 * 1000) {
      return false;
    }
    return true;
  }

  function recordAutoUpdateAttempt(success, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    memoryBootState.lastAutoUpdateAttemptAt = now;
    if (success) {
      memoryBootState.autoUpdateFailures = 0;
      memoryBootState.nextAutoUpdateAllowedAt = now + AUTO_UPDATE_MIN_INTERVAL_MS;
    } else {
      var idx = Math.min(memoryBootState.autoUpdateFailures, AUTO_UPDATE_BACKOFFS_MS.length - 1);
      var backoff = AUTO_UPDATE_BACKOFFS_MS[idx];
      memoryBootState.autoUpdateFailures += 1;
      memoryBootState.nextAutoUpdateAllowedAt = now + backoff;
    }
    savePersistedState();
    return {
      failures: memoryBootState.autoUpdateFailures,
      nextAllowedAt: memoryBootState.nextAutoUpdateAllowedAt
    };
  }

  function resetForTests() {
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
    memoryBootState = {
      bootInProgress: false,
      failCount: 0,
      safeMode: false,
      lastBootAt: 0,
      lastAutoUpdateAttemptAt: 0,
      autoUpdateFailures: 0,
      nextAutoUpdateAllowedAt: 0
    };
    savePersistedState();
  }

  var api = {
    BOOT_WINDOW_MS: BOOT_WINDOW_MS,
    BOOT_STABLE_DELAY_MS: BOOT_STABLE_DELAY_MS,
    AUTO_UPDATE_MIN_INTERVAL_MS: AUTO_UPDATE_MIN_INTERVAL_MS,
    AUTO_UPDATE_BACKOFFS_MS: AUTO_UPDATE_BACKOFFS_MS,
    recordBootStart: recordBootStart,
    markBootStable: markBootStable,
    scheduleBootStableTimer: scheduleBootStableTimer,
    setSafeMode: setSafeMode,
    isSafeMode: isSafeMode,
    canRunAutoUpdate: canRunAutoUpdate,
    recordAutoUpdateAttempt: recordAutoUpdateAttempt,
    getState: function () { return JSON.parse(JSON.stringify(memoryBootState)); },
    resetForTests: resetForTests
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaBootGuard = api;
})(typeof window !== 'undefined' ? window : global);
