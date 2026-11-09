(function (global) {
  'use strict';

  var activeInstance = null;

  function isSupported() {
    return typeof global.mpegts !== 'undefined' &&
           typeof global.mpegts.getFeatureList === 'function' &&
           !!(global.mpegts.getFeatureList() && global.mpegts.getFeatureList().mseLivePlayback);
  }

  function clearNativeVideoClass() {
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.remove('native-video-active');
    }
  }

  function createMpegtsEngine(videoEl, callbacks, isLive) {
    var cb = callbacks || {};
    var player = null;
    var active = true;
    var startupTimer = null;

    function onLoadedMetadata() {
      if (active && cb.onLoadedMetadata) cb.onLoadedMetadata();
      if (active && cb.onVideoSize && videoEl && videoEl.videoWidth > 0) {
        cb.onVideoSize({ width: videoEl.videoWidth, height: videoEl.videoHeight });
      }
    }
    function onPlaying() {
      if (active) {
        clearTimeout(startupTimer);
        if (cb.onPlaying) cb.onPlaying();
      }
    }
    function onPause() {
      if (!active) return;
      if (cb.onPaused) cb.onPaused();
      else if (cb.onPause) cb.onPause();
    }
    function onWaiting() {
      if (!active) return;
      if (cb.onWaiting) cb.onWaiting();
      else if (cb.onBuffering) cb.onBuffering();
    }
    function onTimeUpdate() {
      if (active && cb.onPosition && videoEl) {
        cb.onPosition({
          positionMs: Math.round((videoEl.currentTime || 0) * 1000),
          durationMs: (isFinite(videoEl.duration) && videoEl.duration > 0) ? Math.round(videoEl.duration * 1000) : 0
        });
      }
    }
    function onEnded() {
      if (active && cb.onEnded) cb.onEnded();
    }

    if (videoEl && videoEl.addEventListener) {
      videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
      videoEl.addEventListener('playing', onPlaying);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('waiting', onWaiting);
      videoEl.addEventListener('timeupdate', onTimeUpdate);
      videoEl.addEventListener('ended', onEnded);
    }

    return {
      name: 'MpegtsEngine',
      isNative: false,
      load: function (url, timeoutMs) {
        if (!isSupported()) {
          if (cb.onError) cb.onError({ code: 'UNSUPPORTED', message: 'mpegts.js indisponível neste dispositivo' });
          return;
        }
        clearNativeVideoClass();
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active && cb.onError) cb.onError({ code: 'TIMEOUT', message: 'Timeout no MpegtsEngine' });
        }, timeoutMs || 12000);

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
            if (cb.onError) {
              cb.onError({
                code: httpCode || t || 'MPEGTS_ERR',
                httpStatus: httpCode,
                message: 'MPEGTS: ' + t + ' ' + (d || '')
              });
            }
          });
          player.load();
          var p = player.play();
          if (p && p.catch) p.catch(function (e) { if (active && cb.onError) cb.onError(e); });
          if (cb.onReady) cb.onReady();
        } catch (err) {
          clearTimeout(startupTimer);
          if (cb.onError) cb.onError(err);
        }
      },
      destroy: function () {
        active = false;
        clearTimeout(startupTimer);
        if (videoEl && videoEl.removeEventListener) {
          videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoEl.removeEventListener('playing', onPlaying);
          videoEl.removeEventListener('pause', onPause);
          videoEl.removeEventListener('waiting', onWaiting);
          videoEl.removeEventListener('timeupdate', onTimeUpdate);
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

  function play(videoEl, url, callbacks, options) {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
    var opts = options || {};
    var v = videoEl || (typeof document !== 'undefined' ? document.getElementById('main-video') : null);
    activeInstance = createMpegtsEngine(v, callbacks || {}, typeof opts.isLive === 'boolean' ? opts.isLive : true);
    activeInstance.load(url, opts.timeoutMs || 15000);
    return activeInstance;
  }

  function destroy() {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
  }

  global.LuminaMpegtsEngine = {
    name: 'MpegtsEngine',
    isNative: false,
    isSupported: isSupported,
    create: createMpegtsEngine,
    play: play,
    destroy: destroy
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaMpegtsEngine;
})(typeof window !== 'undefined' ? window : global);
