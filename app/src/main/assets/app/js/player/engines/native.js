(function (global) {
  'use strict';
  function createNativeEngine(videoEl, callbacks) {
    var startupTimer = null;
    var active = true;
    function onLoadedData() { if (active) { clearTimeout(startupTimer); callbacks.onReady(); } }
    function onPlaying() { if (active) { clearTimeout(startupTimer); callbacks.onPlaying(); } }
    function onPause() { if (active && callbacks.onPause) callbacks.onPause(); }
    function onWaiting() { if (active) callbacks.onBuffering(); }
    function onEnded() { if (active && callbacks.onEnded) callbacks.onEnded(); }
    function onError() {
      if (!active) return;
      clearTimeout(startupTimer);
      var err = videoEl.error;
      callbacks.onError(new Error('NativeVideoError code=' + (err ? err.code : 'unknown')));
    }
    videoEl.addEventListener('loadeddata', onLoadedData);
    videoEl.addEventListener('playing', onPlaying);
    videoEl.addEventListener('waiting', onWaiting);
    videoEl.addEventListener('pause', onPause);
    videoEl.addEventListener('ended', onEnded);
    videoEl.addEventListener('error', onError);

    return {
      name: 'NativeEngine',
      load: function (url, timeoutMs) {
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active) callbacks.onError(new Error('Timeout na abertura nativa'));
        }, timeoutMs || 6000);
        try {
          videoEl.src = url;
          videoEl.load();
          var p = videoEl.play();
          if (p && p.catch) p.catch(function (e) { if (active) callbacks.onError(e); });
        } catch (err) { callbacks.onError(err); }
      },
      destroy: function () {
        active = false;
        clearTimeout(startupTimer);
        videoEl.removeEventListener('loadeddata', onLoadedData);
        videoEl.removeEventListener('playing', onPlaying);
        videoEl.removeEventListener('waiting', onWaiting);
        videoEl.removeEventListener('pause', onPause);
        videoEl.removeEventListener('ended', onEnded);
        videoEl.removeEventListener('error', onError);
      }
    };
  }
  global.LuminaNativeEngine = { create: createNativeEngine };
})(typeof window !== 'undefined' ? window : global);
