(function (global) {
  'use strict';

  function isSupported() {
    return typeof global.mpegts !== 'undefined' &&
           typeof global.mpegts.getFeatureList === 'function' &&
           !!(global.mpegts.getFeatureList() && global.mpegts.getFeatureList().mseLivePlayback);
  }

  function createMpegtsEngine(videoEl, callbacks, isLive) {
    var player = null;
    var active = true;
    var startupTimer = null;

    function onPlaying() { if (active) { clearTimeout(startupTimer); if (callbacks.onPlaying) callbacks.onPlaying(); } }
    function onPause() { if (active && callbacks.onPause) callbacks.onPause(); }
    function onWaiting() { if (active && callbacks.onBuffering) callbacks.onBuffering(); }
    function onEnded() { if (active && callbacks.onEnded) callbacks.onEnded(); }

    if (videoEl && videoEl.addEventListener) {
      videoEl.addEventListener('playing', onPlaying);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('waiting', onWaiting);
      videoEl.addEventListener('ended', onEnded);
    }

    return {
      name: 'MpegtsEngine',
      load: function (url, timeoutMs) {
        if (!isSupported()) {
          if (callbacks.onError) callbacks.onError({ code: 'UNSUPPORTED', message: 'mpegts.js indisponível neste dispositivo' });
          return;
        }
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active && callbacks.onError) callbacks.onError({ code: 'TIMEOUT', message: 'Timeout no MpegtsEngine' });
        }, timeoutMs || 10000);

        try {
          player = global.mpegts.createPlayer({
            type: 'mpegts',
            isLive: typeof isLive === 'boolean' ? isLive : true,
            url: url
          }, {
            enableWorker: true,
            enableStashBuffer: false,
            stashInitialSize: 128
          });
          player.attachMediaElement(videoEl);
          player.on(global.mpegts.Events.ERROR, function (t, d, info) {
            if (!active) return;
            clearTimeout(startupTimer);
            var httpCode = (info && info.code) ? info.code : 0;
            if (callbacks.onError) {
              callbacks.onError({
                code: httpCode || t || 'MPEGTS_ERR',
                httpStatus: httpCode,
                message: 'MPEGTS: ' + t + ' ' + (d || '')
              });
            }
          });
          player.load();
          var p = player.play();
          if (p && p.catch) p.catch(function (e) { if (active && callbacks.onError) callbacks.onError(e); });
          if (callbacks.onReady) callbacks.onReady();
        } catch (err) {
          clearTimeout(startupTimer);
          if (callbacks.onError) callbacks.onError(err);
        }
      },
      destroy: function () {
        active = false;
        clearTimeout(startupTimer);
        if (videoEl && videoEl.removeEventListener) {
          videoEl.removeEventListener('playing', onPlaying);
          videoEl.removeEventListener('pause', onPause);
          videoEl.removeEventListener('waiting', onWaiting);
          videoEl.removeEventListener('ended', onEnded);
        }
        if (player) {
          try {
            player.unload();
            player.detachMediaElement();
            player.destroy();
          } catch (e) {}
          player = null;
        }
      }
    };
  }

  global.LuminaMpegtsEngine = { isSupported: isSupported, create: createMpegtsEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaMpegtsEngine;
})(typeof window !== 'undefined' ? window : global);
