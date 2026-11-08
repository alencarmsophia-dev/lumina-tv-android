(function (global) {
  'use strict';

  function isSupported() {
    return typeof global.Hls !== 'undefined' && typeof global.Hls.isSupported === 'function' && !!global.Hls.isSupported();
  }

  function createHlsEngine(videoEl, callbacks, isLive, perfMode) {
    var hls = null;
    var active = true;
    var startupTimer = null;

    function onLoadedMetadata() { if (active && callbacks.onLoadedMetadata) callbacks.onLoadedMetadata(); }
    function onPlaying() { if (active) { clearTimeout(startupTimer); if (callbacks.onPlaying) callbacks.onPlaying(); } }
    function onPause() { if (active && callbacks.onPause) callbacks.onPause(); }
    function onWaiting() { if (active && callbacks.onBuffering) callbacks.onBuffering(); }
    function onEnded() { if (active && callbacks.onEnded) callbacks.onEnded(); }

    if (videoEl && videoEl.addEventListener) {
      videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
      videoEl.addEventListener('playing', onPlaying);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('waiting', onWaiting);
      videoEl.addEventListener('ended', onEnded);
    }

    return {
      name: 'HlsJsEngine',
      load: function (url, timeoutMs) {
        if (!isSupported()) {
          if (callbacks.onError) callbacks.onError({ code: 'UNSUPPORTED', message: 'hls.js indisponível neste dispositivo' });
          return;
        }
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active && callbacks.onError) callbacks.onError({ code: 'TIMEOUT', message: 'Timeout no HlsJsEngine' });
        }, timeoutMs || 10000);

        try {
          hls = new global.Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: perfMode === 'lite' ? 15 : (isLive ? 25 : 40),
            maxMaxBufferLength: perfMode === 'lite' ? 30 : 60
          });
          hls.on(global.Hls.Events.MANIFEST_PARSED, function () {
            if (!active) return;
            if (callbacks.onReady) callbacks.onReady();
            var p = videoEl.play();
            if (p && p.catch) p.catch(function (e) { if (active && callbacks.onError) callbacks.onError(e); });
          });
          hls.on(global.Hls.Events.ERROR, function (_ev, data) {
            if (!active || !data) return;
            var status = data.response && data.response.code ? data.response.code : 0;
            if (data.fatal) {
              clearTimeout(startupTimer);
              if (callbacks.onError) {
                callbacks.onError({
                  code: status || data.details || 'HLS_FATAL',
                  httpStatus: status,
                  message: 'HLS fatal: ' + (data.details || data.type || 'erro')
                });
              }
            }
          });
          hls.loadSource(url);
          hls.attachMedia(videoEl);
        } catch (err) {
          clearTimeout(startupTimer);
          if (callbacks.onError) callbacks.onError(err);
        }
      },
      getAudioTracks: function () { return (hls && hls.audioTracks) ? hls.audioTracks : []; },
      getCurrentAudioTrack: function () { return hls ? hls.audioTrack : 0; },
      setAudioTrack: function (idx) { if (hls) hls.audioTrack = idx; },
      getSubtitleTracks: function () { return (hls && hls.subtitleTracks) ? hls.subtitleTracks : []; },
      getCurrentSubtitleTrack: function () { return hls ? hls.subtitleTrack : -1; },
      setSubtitleTrack: function (idx) { if (hls) hls.subtitleTrack = idx; },
      destroy: function () {
        active = false;
        clearTimeout(startupTimer);
        if (videoEl && videoEl.removeEventListener) {
          videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
          videoEl.removeEventListener('playing', onPlaying);
          videoEl.removeEventListener('pause', onPause);
          videoEl.removeEventListener('waiting', onWaiting);
          videoEl.removeEventListener('ended', onEnded);
        }
        if (hls) {
          try { hls.destroy(); } catch (e) {}
          hls = null;
        }
      }
    };
  }

  global.LuminaHlsEngine = { isSupported: isSupported, create: createHlsEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaHlsEngine;
})(typeof window !== 'undefined' ? window : global);
