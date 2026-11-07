(function (global) {
  'use strict';
  var stack = ['home'];

  function navigate(route) {
    var current = stack[stack.length - 1];
    if (current !== route) stack.push(route);
    global.LuminaStore.set('currentRoute', route);
    global.LuminaEventBus.emit('route:changed', route);
  }

  function back() {
    var modal = document.getElementById('modal-backdrop');
    if (modal && !modal.classList.contains('hidden')) {
      global.LuminaEventBus.emit('modal:close');
      return;
    }
    var current = stack[stack.length - 1];
    if (current === 'player-fullscreen') {
      stack.pop();
      var prev = stack[stack.length - 1] || 'home';
      var curItem = global.LuminaPlayer && global.LuminaPlayer.getCurrentItem ? global.LuminaPlayer.getCurrentItem() : null;
      if (prev !== 'live' || (curItem && curItem.kind !== 'live')) {
        if (global.LuminaPlayer && global.LuminaPlayer.stop) global.LuminaPlayer.stop();
      }
      global.LuminaStore.set('currentRoute', prev);
      global.LuminaEventBus.emit('route:changed', prev);
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
    getCurrent: function () { return stack[stack.length - 1]; }
  };
})(typeof window !== 'undefined' ? window : global);
