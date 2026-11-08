(function (global) {
  'use strict';
  var currentEl = null;
  var trapContainer = null;
  var memoryByScope = {};

  function isVisible(el) {
    if (!el || el.disabled || el.classList.contains('hidden')) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getFocusableList() {
    var root = trapContainer || document.getElementById('app-root') || document.body;
    if (!root || !root.querySelectorAll) return [];
    var nodes = root.querySelectorAll('.focusable');
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) list.push(nodes[i]);
    }
    return list;
  }

  function setFocus(el, scopeKey) {
    if (!el || !isVisible(el)) return false;
    if (currentEl && currentEl !== el) currentEl.classList.remove('is-focused');
    currentEl = el;
    currentEl.classList.add('is-focused');
    var sc = scopeKey || currentEl.getAttribute('data-scope');
    if (sc && currentEl.id) memoryByScope[sc] = currentEl.id;
    if (global.LuminaSettings && global.LuminaSettings.touchParentalActivity) {
      global.LuminaSettings.touchParentalActivity();
    }
    global.LuminaEventBus.emit('focus:changed', currentEl);
    return true;
  }

  function findNextSpatial(dir) {
    var root = trapContainer || document.getElementById('app-root') || document.body;
    if (!root || !root.querySelectorAll) return null;
    var nodes = root.querySelectorAll('.focusable');
    if (!nodes.length) return null;
    if (!currentEl || !isVisible(currentEl)) {
      for (var f = 0; f < nodes.length; f++) {
        if (isVisible(nodes[f])) return nodes[f];
      }
      return null;
    }

    var curRect = currentEl.getBoundingClientRect();
    var cx = curRect.left + curRect.width / 2;
    var cy = curRect.top + curRect.height / 2;
    var horizontal = (dir === 'LEFT' || dir === 'RIGHT');
    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < nodes.length; i++) {
      var cand = nodes[i];
      if (cand === currentEl || cand.disabled || cand.classList.contains('hidden')) continue;
      var r = cand.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      var dx = r.left + r.width / 2 - cx;
      var dy = r.top + r.height / 2 - cy;

      if (dir === 'RIGHT' && dx <= 6) continue;
      if (dir === 'LEFT' && dx >= -6) continue;
      if (dir === 'DOWN' && dy <= 6) continue;
      if (dir === 'UP' && dy >= -6) continue;

      var primary = horizontal ? Math.abs(dx) : Math.abs(dy);
      var ortho = horizontal ? Math.abs(dy) : Math.abs(dx);
      var score = primary + ortho * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    return best;
  }

  function move(dir) {
    // Permite que listas e grades virtualizadas rolem a janela antes do cálculo espacial
    if (currentEl) {
      var vListId = currentEl.getAttribute('data-vlist');
      if (vListId && global.LuminaUI && typeof global.LuminaUI.handleVirtualBoundary === 'function') {
        var handled = global.LuminaUI.handleVirtualBoundary(currentEl, dir);
        if (handled) return true;
      }
    }
    var next = findNextSpatial(dir);
    if (next) return setFocus(next);
    return false;
  }

  function restoreOrDefault(scopeKey, fallbackSelector) {
    var savedId = memoryByScope[scopeKey];
    if (savedId && typeof document !== 'undefined') {
      var savedEl = document.getElementById(savedId);
      if (savedEl && setFocus(savedEl, scopeKey)) return;
    }
    if (fallbackSelector && typeof document !== 'undefined') {
      var fb = document.querySelector(fallbackSelector);
      if (fb && setFocus(fb, scopeKey)) return;
    }
    var list = getFocusableList();
    if (list.length) setFocus(list[0], scopeKey);
  }

  function triggerOk() {
    if (!currentEl) return;
    if (global.LuminaSettings && global.LuminaSettings.touchParentalActivity) {
      global.LuminaSettings.touchParentalActivity();
    }
    currentEl.classList.add('is-pressed');
    setTimeout(function () { if (currentEl) currentEl.classList.remove('is-pressed'); }, 120);
    global.LuminaEventBus.emit('focus:select', currentEl);
  }

  global.LuminaFocus = {
    init: function () {
      if (typeof document !== 'undefined') {
        document.addEventListener('mouseover', function (e) {
          var t = e.target && e.target.closest ? e.target.closest('.focusable') : null;
          if (t && t !== currentEl && isVisible(t)) setFocus(t);
        });
        document.addEventListener('click', function (e) {
          var t = e.target && e.target.closest ? e.target.closest('.focusable') : null;
          if (t && isVisible(t)) { setFocus(t); triggerOk(); }
        });
      }
      global.LuminaEventBus.on('key:LEFT', function () { move('LEFT'); });
      global.LuminaEventBus.on('key:RIGHT', function () { move('RIGHT'); });
      global.LuminaEventBus.on('key:UP', function () { move('UP'); });
      global.LuminaEventBus.on('key:DOWN', function () { move('DOWN'); });
      global.LuminaEventBus.on('key:OK', triggerOk);
    },
    setFocus: setFocus,
    restoreOrDefault: restoreOrDefault,
    setTrap: function (el) { trapContainer = el; },
    getCurrent: function () { return currentEl; },
    saveScopeFocus: function (scopeKey, elId) {
      if (scopeKey && elId) memoryByScope[scopeKey] = elId;
    }
  };
})(typeof window !== 'undefined' ? window : global);
