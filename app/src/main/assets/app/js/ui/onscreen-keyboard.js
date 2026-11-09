(function (global) {
  'use strict';

  var LAYERS = {
    lower: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '-'],
      ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', ':', '/']
    ],
    upper: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '_'],
      ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '.', ':', '/']
    ],
    symbols: [
      ['!', '@', '#', '$', '%', '&', '*', '(', ')', '+'],
      ['=', '?', '_', '-', '.', ':', '/', '~', '^', '|'],
      ['[', ']', '{', '}', '<', '>', ',', ';', '"', "'"],
      ['\\', '&', '=', '?', '#', '%', '+', '@', '$', '!']
    ]
  };

  var URL_SHORTCUTS = [
    ['http://', 'https://'],
    ['.com', '.com.br'],
    ['.tv', ':8080'],
    ['/get.php', 'www.']
  ];

  var activeSession = null;
  var currentLayer = 'lower';
  var backspaceHoldTimer = null;

  function escHtml(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureOverlayContainer() {
    if (typeof document === 'undefined') return null;
    var el = document.getElementById('lumina-osk-backdrop');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lumina-osk-backdrop';
      el.className = 'osk-backdrop hidden';
      var root = document.getElementById('app-root') || document.body;
      root.appendChild(el);
    }
    return el;
  }

  function isOpen() {
    return !!activeSession;
  }

  function stopBackspaceHold() {
    if (backspaceHoldTimer) {
      clearInterval(backspaceHoldTimer);
      backspaceHoldTimer = null;
    }
  }

  function open(options) {
    var opts = options || {};
    stopBackspaceHold();
    currentLayer = opts.initialLayer || 'lower';
    activeSession = {
      fieldId: opts.fieldId || '',
      label: opts.label || 'Editar campo',
      placeholder: opts.placeholder || '',
      value: String(opts.value == null ? '' : opts.value),
      isPassword: !!opts.isPassword,
      revealPassword: !!opts.revealPassword,
      returnFocusSelector: opts.returnFocusSelector || '',
      returnScope: opts.returnScope || (global.LuminaRouter ? global.LuminaRouter.getCurrent() : 'home'),
      onChange: typeof opts.onChange === 'function' ? opts.onChange : null,
      onDone: typeof opts.onDone === 'function' ? opts.onDone : null,
      onCancel: typeof opts.onCancel === 'function' ? opts.onCancel : null
    };

    render();
    var firstKey = (typeof document !== 'undefined') ? document.getElementById('osk-key-1-0') : null;
    var container = ensureOverlayContainer();
    if (global.LuminaFocus && container) {
      global.LuminaFocus.setTrap(container);
      if (firstKey) global.LuminaFocus.setFocus(firstKey, 'osk');
    }
  }

  function close(triggerDone) {
    stopBackspaceHold();
    if (!activeSession) return;
    var sess = activeSession;
    activeSession = null;

    var container = ensureOverlayContainer();
    if (container) {
      container.classList.add('hidden');
      container.innerHTML = '';
    }
    if (global.LuminaFocus) {
      global.LuminaFocus.setTrap(null);
      if (sess.returnFocusSelector && typeof document !== 'undefined') {
        var target = document.querySelector(sess.returnFocusSelector);
        if (target) global.LuminaFocus.setFocus(target, sess.returnScope);
      }
    }
    if (triggerDone && sess.onDone) {
      sess.onDone(sess.value);
    } else if (!triggerDone && sess.onCancel) {
      sess.onCancel(sess.value);
    }
  }

  function notifyValueChange() {
    if (!activeSession) return;
    if (activeSession.onChange) {
      activeSession.onChange(activeSession.value);
    }
    var previewEl = (typeof document !== 'undefined') ? document.getElementById('osk-preview-text') : null;
    if (previewEl) {
      var val = activeSession.value;
      var shown = (activeSession.isPassword && !activeSession.revealPassword)
        ? new Array(val.length + 1).join('\u2022')
        : val;
      if (val.length > 0) {
        previewEl.innerHTML = escHtml(shown) + '<span class="osk-cursor">|</span>';
        previewEl.classList.remove('is-placeholder');
      } else {
        previewEl.innerHTML = '<span class="osk-cursor">|</span>' + escHtml(activeSession.placeholder || 'Digite com o controle remoto...');
        previewEl.classList.add('is-placeholder');
      }
    }
  }

  function appendText(str) {
    if (!activeSession) return;
    activeSession.value += String(str || '');
    notifyValueChange();
  }

  function backspaceOnce() {
    if (!activeSession || !activeSession.value.length) return;
    activeSession.value = activeSession.value.slice(0, -1);
    notifyValueChange();
  }

  function clearAll() {
    if (!activeSession) return;
    activeSession.value = '';
    notifyValueChange();
  }

  function pasteFromClipboard() {
    if (!activeSession) return;
    var clip = (global.LuminaPlatform && global.LuminaPlatform.getClipboardText)
      ? global.LuminaPlatform.getClipboardText()
      : '';
    if (clip) {
      activeSession.value += String(clip).trim();
      notifyValueChange();
      if (global.LuminaUI && global.LuminaUI.toast) {
        global.LuminaUI.toast('Texto colado da área de transferência.');
      }
    } else if (global.LuminaUI && global.LuminaUI.toast) {
      global.LuminaUI.toast('Área de transferência vazia.');
    }
  }

  function openSystemIme() {
    if (typeof document === 'undefined' || !activeSession) return;
    var nativeInput = document.getElementById('osk-native-ime-input');
    if (nativeInput) {
      nativeInput.value = activeSession.value;
      nativeInput.focus();
      try { nativeInput.click(); } catch (e) {}
      if (global.LuminaUI && global.LuminaUI.toast) {
        global.LuminaUI.toast('Campo pronto para teclado do sistema ou controle por voz.');
      }
    }
  }

  function render() {
    var container = ensureOverlayContainer();
    if (!container || !activeSession) return;

    var rows = LAYERS[currentLayer] || LAYERS.lower;
    var gridHtml = '';
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var ch = rows[r][c];
        gridHtml +=
          '<button id="osk-key-' + r + '-' + c + '" class="osk-key focusable" data-osk-char="' + escHtml(ch) + '" data-scope="osk">' +
            escHtml(ch) +
          '</button>';
      }
    }

    var shortcutsHtml = '';
    for (var sr = 0; sr < URL_SHORTCUTS.length; sr++) {
      for (var sc = 0; sc < URL_SHORTCUTS[sr].length; sc++) {
        var token = URL_SHORTCUTS[sr][sc];
        shortcutsHtml +=
          '<button id="osk-short-' + sr + '-' + sc + '" class="osk-shortcut-key focusable" data-osk-char="' + escHtml(token) + '" data-scope="osk">' +
            escHtml(token) +
          '</button>';
      }
    }

    var val = activeSession.value;
    var shownVal = (activeSession.isPassword && !activeSession.revealPassword)
      ? new Array(val.length + 1).join('\u2022')
      : val;
    var previewContent = val.length > 0
      ? (escHtml(shownVal) + '<span class="osk-cursor">|</span>')
      : ('<span class="osk-cursor">|</span>' + escHtml(activeSession.placeholder || 'Digite com o controle remoto...'));

    var caseLabel = (currentLayer === 'upper') ? 'abc' : 'ABC';
    var symLabel = (currentLayer === 'symbols') ? 'abc' : '#+=';

    container.classList.remove('hidden');
    container.innerHTML =
      '<div class="osk-upper-stage">' +
        '<div class="osk-field-card">' +
          '<div class="osk-field-header">' +
            '<span class="osk-field-label">' + escHtml(activeSession.label) + '</span>' +
            (activeSession.isPassword
              ? '<button id="osk-btn-toggle-eye" class="btn btn-secondary btn-modal focusable" data-osk-action="toggle-eye" data-scope="osk" style="height:48px;font-size:20px;">' + (activeSession.revealPassword ? 'Ocultar senha' : 'Mostrar senha') + '</button>'
              : '<span class="osk-field-hint">Use as setas e OK ou teclado físico · Voltar fecha</span>') +
          '</div>' +
          '<div id="osk-preview-text" class="osk-preview-box' + (val.length ? '' : ' is-placeholder') + '">' +
            previewContent +
          '</div>' +
          '<input id="osk-native-ime-input" type="text" value="' + escHtml(val) + '" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;" tabindex="-1" />' +
        '</div>' +
      '</div>' +
      '<div class="osk-panel">' +
        '<div class="osk-main-row">' +
          '<div class="osk-char-grid">' + gridHtml + '</div>' +
          '<div class="osk-shortcut-grid">' + shortcutsHtml + '</div>' +
        '</div>' +
        '<div class="osk-action-bar">' +
          '<button id="osk-act-case" class="osk-action-btn focusable" style="width:140px;" data-osk-action="toggle-case" data-scope="osk">' + escHtml(caseLabel) + '</button>' +
          '<button id="osk-act-sym" class="osk-action-btn focusable" style="width:140px;" data-osk-action="toggle-symbols" data-scope="osk">' + escHtml(symLabel) + '</button>' +
          '<button id="osk-act-space" class="osk-action-btn focusable" style="width:220px;" data-osk-action="space" data-scope="osk">Espaço</button>' +
          '<button id="osk-act-back" class="osk-action-btn focusable" style="width:180px;" data-osk-action="backspace" data-scope="osk">\u232B Apagar</button>' +
          '<button id="osk-act-clear" class="osk-action-btn focusable" style="width:160px;" data-osk-action="clear" data-scope="osk">Limpar</button>' +
          '<button id="osk-act-paste" class="osk-action-btn focusable" style="width:160px;" data-osk-action="paste" data-scope="osk">Colar</button>' +
          '<button id="osk-act-ime" class="osk-action-btn focusable" style="width:230px;" data-osk-action="system-ime" data-scope="osk">Teclado do sistema</button>' +
          '<button id="osk-act-done" class="osk-action-btn is-primary focusable" style="width:220px;" data-osk-action="done" data-scope="osk">Concluir</button>' +
        '</div>' +
      '</div>';

    var nativeInp = document.getElementById('osk-native-ime-input');
    if (nativeInp) {
      nativeInp.addEventListener('input', function () {
        if (activeSession) {
          activeSession.value = nativeInp.value;
          notifyValueChange();
        }
      });
    }
  }

  function handleElementSelect(el) {
    if (!el || !activeSession) return false;
    var ch = el.getAttribute('data-osk-char');
    if (ch !== null && ch !== undefined) {
      appendText(ch);
      return true;
    }
    var act = el.getAttribute('data-osk-action');
    if (!act) return false;

    if (act === 'space') {
      appendText(' ');
    } else if (act === 'backspace') {
      backspaceOnce();
    } else if (act === 'clear') {
      clearAll();
    } else if (act === 'paste') {
      pasteFromClipboard();
    } else if (act === 'system-ime') {
      openSystemIme();
    } else if (act === 'toggle-eye') {
      activeSession.revealPassword = !activeSession.revealPassword;
      render();
      if (global.LuminaFocus && typeof document !== 'undefined') {
        global.LuminaFocus.setFocus(document.getElementById('osk-btn-toggle-eye'), 'osk');
      }
    } else if (act === 'toggle-case') {
      currentLayer = (currentLayer === 'upper') ? 'lower' : 'upper';
      render();
      if (global.LuminaFocus && typeof document !== 'undefined') {
        global.LuminaFocus.setFocus(document.getElementById('osk-act-case'), 'osk');
      }
    } else if (act === 'toggle-symbols') {
      currentLayer = (currentLayer === 'symbols') ? 'lower' : 'symbols';
      render();
      if (global.LuminaFocus && typeof document !== 'undefined') {
        global.LuminaFocus.setFocus(document.getElementById('osk-act-sym'), 'osk');
      }
    } else if (act === 'done') {
      close(true);
    }
    return true;
  }

  function handlePhysicalKeyEvent(e) {
    if (!activeSession || !e) return false;
    var code = e.keyCode || e.which;
    if (code === 8) { // Backspace físico
      backspaceOnce();
      return true;
    }
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      appendText(e.key);
      return true;
    }
    return false;
  }

  // Suporte a segurar OK no botão "Apagar" para apagar continuamente a cada 60ms (Seção B3)
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', function (e) {
      if (!activeSession) return;
      var code = e.keyCode || e.which;
      if (code === 13 && e.repeat) {
        var cur = global.LuminaFocus && global.LuminaFocus.getCurrent ? global.LuminaFocus.getCurrent() : null;
        if (cur && cur.getAttribute('data-osk-action') === 'backspace' && !backspaceHoldTimer) {
          backspaceHoldTimer = setInterval(backspaceOnce, 60);
        }
      }
    }, true);
    window.addEventListener('keyup', function (e) {
      var code = e.keyCode || e.which;
      if (code === 13) {
        stopBackspaceHold();
      }
    }, true);
  }


  var SEARCH_GRID_9COL = [
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    ['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
    ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0'],
    ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  ];

  function renderInlineSearchKeyboard9Col(scopeName) {
    var sc = scopeName || 'tab-search';
    var html = '<div class="search-kb-9col">';
    for (var r = 0; r < SEARCH_GRID_9COL.length; r++) {
      for (var c = 0; c < SEARCH_GRID_9COL[r].length; c++) {
        var ch = SEARCH_GRID_9COL[r][c];
        html +=
          '<button id="skb-key-' + ch + '" class="search-kb-key focusable" data-col="search-left" data-skb-char="' + ch + '" data-scope="' + escHtml(sc) + '">' +
            escHtml(ch) +
          '</button>';
      }
    }
    html +=
      '<button id="skb-act-space" class="search-kb-key is-span-3 focusable" data-col="search-left" data-skb-action="space" data-scope="' + escHtml(sc) + '">Espaço</button>' +
      '<button id="skb-act-back" class="search-kb-key is-span-3 focusable" data-col="search-left" data-skb-action="backspace" data-scope="' + escHtml(sc) + '">Apagar</button>' +
      '<button id="skb-act-clear" class="search-kb-key is-span-3 focusable" data-col="search-left" data-skb-action="clear" data-scope="' + escHtml(sc) + '">Limpar</button>' +
      '</div>';
    return html;
  }

  var api = {
    SEARCH_GRID_9COL: SEARCH_GRID_9COL,
    renderInlineSearchKeyboard9Col: renderInlineSearchKeyboard9Col,
    LAYERS: LAYERS,
    URL_SHORTCUTS: URL_SHORTCUTS,
    open: open,
    close: close,
    isOpen: isOpen,
    appendText: appendText,
    backspaceOnce: backspaceOnce,
    clearAll: clearAll,
    handleElementSelect: handleElementSelect,
    handlePhysicalKeyEvent: handlePhysicalKeyEvent,
    getCurrentValue: function () { return activeSession ? activeSession.value : ''; },
    getCurrentLayer: function () { return currentLayer; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaKeyboard = api;
})(typeof window !== 'undefined' ? window : global);
