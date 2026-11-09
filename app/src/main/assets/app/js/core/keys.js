(function (global) {
  'use strict';
  var KEY_MAP = {
    37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN',
    13: 'OK', 461: 'BACK', 27: 'BACK', 8: 'BACK',
    427: 'CH_UP', 33: 'CH_UP', 428: 'CH_DOWN', 34: 'CH_DOWN',
    415: 'PLAY', 19: 'PAUSE', 413: 'STOP', 412: 'REWIND', 417: 'FAST_FORWARD',
    403: 'RED', 404: 'GREEN', 405: 'YELLOW', 406: 'BLUE'
  };
  var colorSequence = [];
  var REPEAT_MIN_MS = 90;
  var lastArrowAt = 0;
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function initKeys() {
    window.addEventListener('keydown', function (e) {
      var code = e.keyCode || e.which;

      // Se o teclado na tela (LuminaKeyboard) estiver aberto e o usuário digitar em teclado físico USB/Bluetooth:
      if (global.LuminaKeyboard && typeof global.LuminaKeyboard.isOpen === 'function' && global.LuminaKeyboard.isOpen()) {
        // Backspace físico (8) apaga caractere no campo em vez de voltar de tela
        if (code === 8) {
          e.preventDefault();
          e.stopPropagation();
          global.LuminaKeyboard.handlePhysicalKeyEvent(e);
          return;
        }
        if (!KEY_MAP[code] && e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          global.LuminaKeyboard.handlePhysicalKeyEvent(e);
          return;
        }
      }

      var action = KEY_MAP[code];
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();

      if (action === 'LEFT' || action === 'RIGHT' || action === 'UP' || action === 'DOWN') {
        var t = nowMs();
        if (e.repeat && t - lastArrowAt < REPEAT_MIN_MS) return;
        lastArrowAt = t;
      }

      if (e.repeat && (action === 'OK' || action === 'BACK' || action === 'PLAY' || action === 'PAUSE' ||
                       action === 'STOP' || action === 'RED' || action === 'GREEN' || action === 'YELLOW' || action === 'BLUE')) return;

      if (action === 'RED' || action === 'GREEN' || action === 'YELLOW' || action === 'BLUE') {
        colorSequence.push(action);
        if (colorSequence.length > 4) colorSequence.shift();
        if (colorSequence.join(',') === 'RED,GREEN,YELLOW,BLUE') {
          colorSequence = [];
          global.LuminaEventBus.emit('diag:toggle');
          return;
        }
      }
      global.LuminaEventBus.emit('key:' + action, { code: code, originalEvent: e });
      global.LuminaEventBus.emit('key:any', { action: action, code: code });
    }, true);
  }
  global.LuminaKeys = { init: initKeys, KEY_MAP: KEY_MAP };
})(typeof window !== 'undefined' ? window : global);
