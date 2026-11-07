(function (global) {
  'use strict';
  function createEventBus() {
    var listeners = {};
    return {
      on: function (event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
        return function () {
          var arr = listeners[event];
          if (!arr) return;
          var idx = arr.indexOf(fn);
          if (idx !== -1) arr.splice(idx, 1);
        };
      },
      emit: function (event, payload) {
        var arr = listeners[event];
        if (!arr || !arr.length) return;
        var copy = arr.slice();
        for (var i = 0; i < copy.length; i++) {
          try { copy[i](payload); } catch (err) {
            if (global.LuminaLog) global.LuminaLog.error('EventBus:' + event, err);
          }
        }
      }
    };
  }
  global.LuminaEventBus = createEventBus();
})(typeof window !== 'undefined' ? window : global);
