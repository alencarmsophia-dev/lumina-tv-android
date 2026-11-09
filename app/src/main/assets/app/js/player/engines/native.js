(function (global) {
  'use strict';

  var activeInstance = null;

  function clearNativeVideoClass() {
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.remove('native-video-active');
    }
  }

  function createNativeEngine(videoEl, callbacks) {
    var cb = callbacks || {};
    var startupTimer = null;
    var active = true;

    function onLoadedMetadata() {
      if (active && cb.onLoadedMetadata) cb.onLoadedMetadata();
      if (active && cb.onVideoSize && videoEl && videoEl.videoWidth > 0) {
        cb.onVideoSize({ width: videoEl.videoWidth, height: videoEl.videoHeight });
      }
    }
    function onLoadedData() {
      if (active) {
        clearTimeout(startupTimer);
        if (cb.onReady) cb.onReady();
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
    function onError() {
      if (!active) return;
      clearTimeout(startupTimer);
      var err = videoEl ? videoEl.error : null;
      var code = err ? err.code : 0;
      var msg = 'NativeVideoError code=' + (code || 'unknown');
      if (code === 4) msg = 'Formato não suportado pelo NativeEngine (MEDIA_ERR_SRC_NOT_SUPPORTED)';
      else if (code === 2) msg = 'Erro de rede na reprodução nativa (MEDIA_ERR_NETWORK)';
      else if (code === 3) msg = 'Erro de decodificação de mídia (MEDIA_ERR_DECODE)';
      if (cb.onError) cb.onError({ code: code, message: msg });
    }

    if (videoEl && videoEl.addEventListener) {
      videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
      videoEl.addEventListener('loadeddata', onLoadedData);
      videoEl.addEventListener('playing', onPlaying);
      videoEl.addEventListener('waiting', onWaiting);
      videoEl.addEventListener('stalled', onWaiting);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('timeupdate', onTimeUpdate);
      videoEl.addEventListener('ended', onEnded);
      videoEl.addEventListener('error', onError);
    }

    return {
      name: 'NativeEngine',
      isNative: false,
      load: function (url, timeoutMs) {
        clearNativeVideoClass();
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active && cb.onError) {
            cb.onError({ code: 'TIMEOUT', message: 'Timeout na abertura nativa (' + (timeoutMs || 8000) + 'ms)' });
          }
        }, timeoutMs || 8000);
        try {
          if (!videoEl) {
            clearTimeout(startupTimer);
            if (cb.onError) cb.onError({ code: 'NO_VIDEO_ELEMENT', message: 'Elemento de vídeo ausente' });
            return;
          }
          videoEl.src = url;
          videoEl.load();
          var p = videoEl.play();
          if (p && p.catch) {
            p.catch(function (e) {
              if (active && cb.onError) cb.onError(e);
            });
          }
        } catch (err) {
          clearTimeout(startupTimer);
          if (active && cb.onError) cb.onError(err);
        }
      },
      destroy: function () {
        active = false;
        clearTimeout(startupTimer);
        if (videoEl && videoEl.removeEventListener) {
          videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoEl.removeEventListener('loadeddata', onLoadedData);
          videoEl.removeEventListener('playing', onPlaying);
          videoEl.removeEventListener('waiting', onWaiting);
          videoEl.removeEventListener('stalled', onWaiting);
          videoEl.removeEventListener('pause', onPause);
          videoEl.removeEventListener('timeupdate', onTimeUpdate);
          videoEl.removeEventListener('ended', onEnded);
          videoEl.removeEventListener('error', onError);
        }
        if (videoEl) {
          try {
            videoEl.pause();
            videoEl.removeAttribute('src');
            videoEl.load();
          } catch (e) {}
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
    activeInstance = createNativeEngine(v, callbacks || {});
    activeInstance.load(url, opts.timeoutMs || 15000);
    return activeInstance;
  }

  function destroy() {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
  }

  global.LuminaNativeEngine = {
    name: 'NativeEngine',
    isNative: false,
    isSupported: function () { return true; },
    create: createNativeEngine,
    play: play,
    destroy: destroy
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaNativeEngine;
})(typeof window !== 'undefined' ? window : global);
