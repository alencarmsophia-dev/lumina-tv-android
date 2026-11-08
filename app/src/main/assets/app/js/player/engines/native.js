(function (global) {
  'use strict';

  function createNativeEngine(videoEl, callbacks) {
    var startupTimer = null;
    var active = true;

    function onLoadedMetadata() {
      if (active && callbacks.onLoadedMetadata) callbacks.onLoadedMetadata();
    }
    function onLoadedData() {
      if (active) {
        clearTimeout(startupTimer);
        if (callbacks.onReady) callbacks.onReady();
      }
    }
    function onPlaying() {
      if (active) {
        clearTimeout(startupTimer);
        if (callbacks.onPlaying) callbacks.onPlaying();
      }
    }
    function onPause() {
      if (active && callbacks.onPause) callbacks.onPause();
    }
    function onWaiting() {
      if (active && callbacks.onBuffering) callbacks.onBuffering();
    }
    function onEnded() {
      if (active && callbacks.onEnded) callbacks.onEnded();
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
      if (callbacks.onError) callbacks.onError({ code: code, message: msg });
    }

    if (videoEl && videoEl.addEventListener) {
      videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
      videoEl.addEventListener('loadeddata', onLoadedData);
      videoEl.addEventListener('playing', onPlaying);
      videoEl.addEventListener('waiting', onWaiting);
      videoEl.addEventListener('stalled', onWaiting);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('ended', onEnded);
      videoEl.addEventListener('error', onError);
    }

    return {
      name: 'NativeEngine',
      load: function (url, timeoutMs) {
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active && callbacks.onError) {
            callbacks.onError({ code: 'TIMEOUT', message: 'Timeout na abertura nativa (' + (timeoutMs || 8000) + 'ms)' });
          }
        }, timeoutMs || 8000);
        try {
          videoEl.src = url;
          videoEl.load();
          var p = videoEl.play();
          if (p && p.catch) {
            p.catch(function (e) {
              if (active && callbacks.onError) callbacks.onError(e);
            });
          }
        } catch (err) {
          if (active && callbacks.onError) callbacks.onError(err);
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
          videoEl.removeEventListener('ended', onEnded);
          videoEl.removeEventListener('error', onError);
        }
      }
    };
  }

  global.LuminaNativeEngine = { create: createNativeEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaNativeEngine;
})(typeof window !== 'undefined' ? window : global);
