(function (global) {
  'use strict';
  function isSupported() { return typeof global.Hls !== 'undefined' && global.Hls.isSupported && global.Hls.isSupported(); }
  function createHlsEngine(videoEl, callbacks, isLive, perfMode) {
    var hls = null;
    var active = true;
    return {
      name: 'HlsJsEngine',
      load: function (url) {
        if (!isSupported()) return callbacks.onError(new Error('hls.js indisponível'));
        hls = new global.Hls({ enableWorker: true, maxBufferLength: perfMode === 'lite' ? 15 : (isLive ? 25 : 40) });
        hls.on(global.Hls.Events.MANIFEST_PARSED, function () {
          if (!active) return;
          callbacks.onReady();
          var p = videoEl.play();
          if (p && p.catch) p.catch(function (e) { callbacks.onError(e); });
        });
        hls.on(global.Hls.Events.ERROR, function (ev, data) {
          if (active && data && data.fatal) callbacks.onError(new Error('HLS fatal: ' + data.details));
        });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
      },
      destroy: function () {
        active = false;
        if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
      }
    };
  }
  global.LuminaHlsEngine = { isSupported: isSupported, create: createHlsEngine };
})(typeof window !== 'undefined' ? window : global);
