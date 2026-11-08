(function (global) {
  'use strict';
  var stack = ['home'];

  function navigate(route) {
    var current = stack[stack.length - 1];
    if (current === 'onboarding' && route !== 'onboarding' && global.LuminaPairing) {
      global.LuminaPairing.stopPolling();
    }
    if (current !== route) stack.push(route);
    global.LuminaStore.set('currentRoute', route);
    global.LuminaEventBus.emit('route:changed', route);
  }

  function back() {
    if (typeof document !== 'undefined') {
      var pinModal = document.getElementById('pin-modal-backdrop');
      if (pinModal && !pinModal.classList.contains('hidden')) {
        global.LuminaEventBus.emit('pin-modal:close');
        return;
      }
      var modal = document.getElementById('modal-backdrop');
      if (modal && !modal.classList.contains('hidden')) {
        global.LuminaEventBus.emit('modal:close');
        return;
      }
    }

    var current = stack[stack.length - 1];
    if (current === 'player-fullscreen') {
      // Se a gaveta rápida de canais ou OSD estiverem abertos, fecha primeiro se desejado, ou sai do player
      stack.pop();
      var prev = stack[stack.length - 1] || 'home';
      var curItem = global.LuminaPlayer && global.LuminaPlayer.getCurrentItem ? global.LuminaPlayer.getCurrentItem() : null;
      if (curItem && curItem.adult && global.LuminaSettings && global.LuminaSettings.lockParentalSession) {
        global.LuminaSettings.lockParentalSession();
      }
      if (prev !== 'live' || (curItem && curItem.kind !== 'live')) {
        if (global.LuminaPlayer && global.LuminaPlayer.stop) global.LuminaPlayer.stop();
      }
      global.LuminaStore.set('currentRoute', prev);
      global.LuminaEventBus.emit('route:changed', prev);
      return;
    }

    if (current === 'onboarding' && global.LuminaStore.get('pairingStep') === 'phone-qr') {
      if (global.LuminaPairing) global.LuminaPairing.resetSession();
      global.LuminaStore.set('pairingStep', 'cards');
      global.LuminaEventBus.emit('route:changed', 'onboarding');
      return;
    }

    if (stack.length > 1) {
      stack.pop();
      var target = stack[stack.length - 1];
      global.LuminaStore.set('currentRoute', target);
      global.LuminaEventBus.emit('route:changed', target);
    } else if (current !== 'home') {
      stack = ['home'];
      global.LuminaStore.set('currentRoute', 'home');
      global.LuminaEventBus.emit('route:changed', 'home');
    } else {
      global.LuminaEventBus.emit('app:confirm-exit');
    }
  }

  global.LuminaRouter = {
    init: function () { global.LuminaEventBus.on('key:BACK', back); },
    navigate: navigate,
    back: back,
    getCurrent: function () { return stack[stack.length - 1]; },
    getStack: function () { return stack.slice(); }
  };
})(typeof window !== 'undefined' ? window : global);
