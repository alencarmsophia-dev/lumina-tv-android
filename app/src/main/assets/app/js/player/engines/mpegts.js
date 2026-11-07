(function (global) {
  'use strict';
  function isSupported() {
    return typeof global.mpegts !== 'undefined' && global.mpegts.getFeatureList && global.mpegts.getFeatureList().mseLivePlayback;
  }
  function createMpegtsEngine(videoEl, callbacks) {
    var player = null;
    var active = true;
    return {
      name: 'MpegtsEngine',
      load: function (url) {
        if (!isSupported()) return callbacks.onError(new Error('mpegts.js indisponível'));
        player = global.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url });
        player.attachMediaElement(videoEl);
        player.on(global.mpegts.Events.ERROR, function (t, d) {
          if (active) callbacks.onError(new Error('MPEGTS: ' + t + ' ' + d));
        });
        player.load();
        var p = player.play();
        if (p && p.catch) p.catch(function (e) { callbacks.onError(e); });
        callbacks.onReady();
      },
      destroy: function () {
        active = false;
        if (player) { try { player.unload(); player.detachMediaElement(); player.destroy(); } catch (e) {} player = null; }
      }
    };
  }
  global.LuminaMpegtsEngine = { isSupported: isSupported, create: createMpegtsEngine };
})(typeof window !== 'undefined' ? window : global);
