(function (global) {
  'use strict';

  var DESIGN_W = 1920;
  var DESIGN_H = 1080;

  var lastViewportInfo = {
    viewW: DESIGN_W,
    viewH: DESIGN_H,
    dpr: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    margin: 0
  };

  var resizeTimer = null;

  function sanitizeMargin(safeMargin) {
    var m = typeof safeMargin === 'number' ? safeMargin : parseFloat(safeMargin);
    if (typeof m !== 'number' || isNaN(m) || !isFinite(m) || m < 0) return 0;
    if (m > 0.10) return 0.10;
    return m;
  }

  function resolveDimensions(viewW, viewH) {
    var w = typeof viewW === 'number' ? viewW : parseFloat(viewW);
    var h = typeof viewH === 'number' ? viewH : parseFloat(viewH);

    if (typeof w !== 'number' || isNaN(w) || !isFinite(w) || w <= 0 ||
        typeof h !== 'number' || isNaN(h) || !isFinite(h) || h <= 0) {
      var scrW = (typeof screen !== 'undefined' && screen) ? Number(screen.width) : 0;
      var scrH = (typeof screen !== 'undefined' && screen) ? Number(screen.height) : 0;
      if (scrW > 0 && scrH > 0 && isFinite(scrW) && isFinite(scrH)) {
        w = scrW;
        h = scrH;
      } else {
        w = DESIGN_W;
        h = DESIGN_H;
      }
    }
    return { w: w, h: h };
  }

  /**
   * Função pura que calcula a escala e o deslocamento para caber 1920x1080
   * dentro de viewW x viewH respeitando safeMargin (0 a 0.10 por lado).
   */
  function computeFit(viewW, viewH, safeMargin) {
    var dims = resolveDimensions(viewW, viewH);
    var w = dims.w;
    var h = dims.h;
    var margin = sanitizeMargin(safeMargin);
    var factor = 1 - 2 * margin;

    var rawScale = Math.min(w / DESIGN_W, h / DESIGN_H) * factor;
    var scale = Math.round(rawScale * 10000) / 10000;
    if (isNaN(scale) || !isFinite(scale) || scale <= 0) {
      scale = 1;
    }

    var offsetX = Math.round((w - DESIGN_W * scale) / 2);
    var offsetY = Math.round((h - DESIGN_H * scale) / 2);
    if (offsetX === 0 || isNaN(offsetX)) offsetX = 0;
    if (offsetY === 0 || isNaN(offsetY)) offsetY = 0;

    return {
      scale: scale,
      offsetX: offsetX,
      offsetY: offsetY
    };
  }

  function readSavedSafeMargin() {
    if (global.LuminaStore && typeof global.LuminaStore.get === 'function') {
      var stVal = global.LuminaStore.get('screenSafeMargin');
      if (typeof stVal === 'number' && !isNaN(stVal)) {
        return sanitizeMargin(stVal);
      }
    }
    if (typeof localStorage !== 'undefined' && localStorage) {
      try {
        var raw = localStorage.getItem('lumina_settings_v2');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed.screenSafeMargin === 'number') {
            return sanitizeMargin(parsed.screenSafeMargin);
          }
        }
      } catch (e) {}
    }
    return 0;
  }

  function readCurrentViewportSize() {
    var vw = 0;
    var vh = 0;
    if (typeof window !== 'undefined') {
      vw = Number(window.innerWidth || 0);
      vh = Number(window.innerHeight || 0);
      if ((vw <= 0 || vh <= 0) && typeof document !== 'undefined' && document.documentElement) {
        vw = Number(document.documentElement.clientWidth || 0);
        vh = Number(document.documentElement.clientHeight || 0);
      }
      if ((vw <= 0 || vh <= 0) && window.visualViewport) {
        vw = Number(window.visualViewport.width || 0);
        vh = Number(window.visualViewport.height || 0);
      }
    }
    return resolveDimensions(vw, vh);
  }

  function formatViewportDiagSuffix(info) {
    var pct = (Number(info.scale || 1) * 100).toFixed(1).replace('.', ',');
    return ' \u2022 TELA ' + Math.round(info.viewW) + '\u00D7' + Math.round(info.viewH) + ' \u2022 ESCALA ' + pct + '%';
  }

  function updateHeaderDiagnosticDom(info) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('home-viewport-header');
    if (!el) return;
    var baseText = el.getAttribute('data-base-header') || '';
    if (baseText) {
      el.textContent = baseText + formatViewportDiagSuffix(info);
    }
  }

  function applyFit() {
    var dims = readCurrentViewportSize();
    var margin = readSavedSafeMargin();
    var fit = computeFit(dims.w, dims.h, margin);
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Number(window.devicePixelRatio) : 1;

    lastViewportInfo = {
      viewW: dims.w,
      viewH: dims.h,
      dpr: dpr,
      scale: fit.scale,
      offsetX: fit.offsetX,
      offsetY: fit.offsetY,
      margin: margin
    };

    if (typeof document !== 'undefined') {
      var root = document.getElementById('app-root');
      if (root && root.style) {
        root.style.position = 'absolute';
        root.style.left = '0px';
        root.style.top = '0px';
        root.style.width = DESIGN_W + 'px';
        root.style.height = DESIGN_H + 'px';
        root.style.transformOrigin = '0 0';
        root.style.webkitTransformOrigin = '0 0';
        var transformValue = 'translate(' + fit.offsetX + 'px, ' + fit.offsetY + 'px) scale(' + fit.scale + ')';
        root.style.transform = transformValue;
        root.style.webkitTransform = transformValue;
      }

      // Garante que #video-stage sempre ocupe 100% da área física da tela mesmo quando safeMargin > 0
      var stage = document.getElementById('video-stage');
      if (stage && stage.style) {
        if (margin > 0 && fit.scale > 0) {
          var fullW = Math.round(dims.w / fit.scale);
          var fullH = Math.round(dims.h / fit.scale);
          var stageLeft = -Math.round(fit.offsetX / fit.scale);
          var stageTop = -Math.round(fit.offsetY / fit.scale);
          stage.style.left = stageLeft + 'px';
          stage.style.top = stageTop + 'px';
          stage.style.width = fullW + 'px';
          stage.style.height = fullH + 'px';
        } else {
          stage.style.left = '0px';
          stage.style.top = '0px';
          stage.style.width = DESIGN_W + 'px';
          stage.style.height = DESIGN_H + 'px';
        }
      }

      updateHeaderDiagnosticDom(lastViewportInfo);
    }

    return lastViewportInfo;
  }

  function scheduleDebouncedFit() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeTimer = null;
      applyFit();
    }, 50);
  }

  function getViewportInfo() {
    return {
      viewW: lastViewportInfo.viewW,
      viewH: lastViewportInfo.viewH,
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) ? Number(window.devicePixelRatio) : lastViewportInfo.dpr,
      scale: lastViewportInfo.scale,
      offsetX: lastViewportInfo.offsetX,
      offsetY: lastViewportInfo.offsetY,
      margin: lastViewportInfo.margin
    };
  }

  global.__luminaFitViewport = applyFit;
  global.__luminaViewportInfo = getViewportInfo;

  var api = {
    DESIGN_W: DESIGN_W,
    DESIGN_H: DESIGN_H,
    computeFit: computeFit,
    applyFit: applyFit,
    getInfo: getViewportInfo,
    formatViewportDiagSuffix: formatViewportDiagSuffix
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    applyFit();
    if (document.addEventListener) {
      document.addEventListener('DOMContentLoaded', applyFit, false);
      document.addEventListener('fullscreenchange', applyFit, false);
      document.addEventListener('webkitfullscreenchange', applyFit, false);
    }
    if (window.addEventListener) {
      window.addEventListener('load', function () {
        applyFit();
        setTimeout(applyFit, 300);
        setTimeout(applyFit, 1000);
      }, false);
      window.addEventListener('resize', scheduleDebouncedFit, false);
      window.addEventListener('orientationchange', scheduleDebouncedFit, false);
    }
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', scheduleDebouncedFit, false);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LuminaViewportFit = api;
})(typeof window !== 'undefined' ? window : global);
