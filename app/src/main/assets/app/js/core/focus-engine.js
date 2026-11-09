(function (global) {
  'use strict';
  var currentEl = null;
  var trapContainer = null;
  var memoryByScope = {};

  function getInverseScale() {
    if (typeof global.__luminaViewportInfo === 'function') {
      var info = global.__luminaViewportInfo();
      if (info && typeof info.scale === 'number' && info.scale > 0) {
        return 1 / info.scale;
      }
    }
    return 1;
  }

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

    var invScale = getInverseScale();
    var curRect = currentEl.getBoundingClientRect();
    var cx = (curRect.left + curRect.width / 2) * invScale;
    var cy = (curRect.top + curRect.height / 2) * invScale;
    var horizontal = (dir === 'LEFT' || dir === 'RIGHT');
    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < nodes.length; i++) {
      var cand = nodes[i];
      if (cand === currentEl || cand.disabled || cand.classList.contains('hidden')) continue;
      // Quando o menu lateral sobreposto não está aberto, ignora itens dentro de #side-nav-drawer
      if (!trapContainer && cand.getAttribute('data-scope') === 'nav') continue;
      var r = cand.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      var dx = (r.left + r.width / 2) * invScale - cx;
      var dy = (r.top + r.height / 2) * invScale - cy;

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
    if (global.LuminaUI && typeof global.LuminaUI.isBootSplashVisible === 'function' && global.LuminaUI.isBootSplashVisible()) {
      return false;
    }
    if (currentEl) {
      // 1. Se o elemento tiver seletor ESQUERDA/DIREITA (Tipo, Ordenar, Idioma, Letra, ajustes)
      var lrControl = currentEl.getAttribute('data-lr-control');
      if (lrControl && (dir === 'LEFT' || dir === 'RIGHT') && global.LuminaUI && typeof global.LuminaUI.handleLeftRightControl === 'function') {
        var lrHandled = global.LuminaUI.handleLeftRightControl(currentEl, dir);
        if (lrHandled) return true;
      }

      // 2. Navegação direcional entre colunas e menu lateral sobreposto (Seções 5, 7, 8 e 9)
      if ((dir === 'LEFT' || dir === 'RIGHT') && global.LuminaUI && typeof global.LuminaUI.handleColumnNavigation === 'function') {
        var colHandled = global.LuminaUI.handleColumnNavigation(currentEl, dir);
        if (colHandled) return true;
      }

      // 3. Rolagem de janela virtualizada em listas/grades
      var vListId = currentEl.getAttribute('data-vlist');
      if (vListId && global.LuminaUI && typeof global.LuminaUI.handleVirtualBoundary === 'function') {
        var handled = global.LuminaUI.handleVirtualBoundary(currentEl, dir);
        if (handled) return true;
      }
    }

    var next = findNextSpatial(dir);
    if (next) return setFocus(next);

    // Se apertar ESQUERDA e não houver elemento mais à esquerda na tela, abre o menu lateral sobreposto
    if (dir === 'LEFT' && !trapContainer && global.LuminaUI && typeof global.LuminaUI.openSideMenu === 'function') {
      return global.LuminaUI.openSideMenu();
    }
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
    if (global.LuminaUI && typeof global.LuminaUI.isBootSplashVisible === 'function' && global.LuminaUI.isBootSplashVisible()) {
      global.LuminaUI.dismissBootSplash(true);
      return;
    }
    if (!currentEl) return;
    if (global.LuminaSettings && global.LuminaSettings.touchParentalActivity) {
      global.LuminaSettings.touchParentalActivity();
    }
    currentEl.classList.add('is-pressed');
    setTimeout(function () { if (currentEl) currentEl.classList.remove('is-pressed'); }, 80);
    global.LuminaEventBus.emit('focus:select', currentEl);
  }

  var focusApi = {
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
    focusElement: function (el) { return setFocus(el); },
    setZone: function (zone) {
      if (typeof document === 'undefined') return;
      if (zone === 'content') {
        trapContainer = null;
        var list = getFocusableList();
        if (list.length) setFocus(list[0]);
      } else if (zone === 'modal') {
        var m = document.getElementById('modal-backdrop') || document.getElementById('modal-root');
        if (m) trapContainer = m;
        var ml = getFocusableList();
        if (ml.length) setFocus(ml[0]);
      } else if (zone === 'sidebar') {
        var s = document.getElementById('side-nav') || document.getElementById('sidebar-nav');
        if (s) trapContainer = s;
        var sl = getFocusableList();
        if (sl.length) setFocus(sl[0]);
      }
    },
    restoreOrDefault: restoreOrDefault,
    setTrap: function (el) { trapContainer = el; },
    getCurrent: function () { return currentEl; },
    saveScopeFocus: function (scopeKey, elId) {
      if (scopeKey && elId) memoryByScope[scopeKey] = elId;
    }
  };

  global.LuminaFocus = focusApi;
  global.FocusEngine = focusApi;
  if (typeof window !== 'undefined') {
    window.LuminaFocus = focusApi;
    window.FocusEngine = focusApi;
  }
})(typeof window !== 'undefined' ? window : global);
