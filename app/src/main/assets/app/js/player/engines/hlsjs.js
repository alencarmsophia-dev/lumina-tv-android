(function (global) {
  'use strict';

  var activeInstance = null;

  function isSupported() {
    return typeof global.Hls !== 'undefined' && typeof global.Hls.isSupported === 'function' && !!global.Hls.isSupported();
  }

  function clearNativeVideoClass() {
    if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
      document.documentElement.classList.remove('native-video-active');
    }
  }

  function createHlsEngine(videoEl, callbacks, isLive, perfMode) {
    var cb = callbacks || {};
    var hls = null;
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
      name: 'HlsJsEngine',
      isNative: false,
      load: function (url, timeoutMs) {
        if (!isSupported()) {
          if (cb.onError) cb.onError({ code: 'UNSUPPORTED', message: 'hls.js indisponível neste dispositivo' });
          return;
        }
        clearNativeVideoClass();
        clearTimeout(startupTimer);
        startupTimer = setTimeout(function () {
          if (active && cb.onError) cb.onError({ code: 'TIMEOUT', message: 'Timeout no HlsJsEngine' });
        }, timeoutMs || 12000);

        try {
          hls = new global.Hls({
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: perfMode === 'lite' ? 15 : (isLive ? 25 : 40),
            maxMaxBufferLength: perfMode === 'lite' ? 30 : 60
          });
          hls.on(global.Hls.Events.MANIFEST_PARSED, function () {
            if (!active) return;
            if (cb.onReady) cb.onReady();
            if (videoEl && typeof videoEl.play === 'function') {
              var p = videoEl.play();
              if (p && p.catch) p.catch(function (e) { if (active && cb.onError) cb.onError(e); });
            }
          });
          hls.on(global.Hls.Events.ERROR, function (_ev, data) {
            if (!active || !data) return;
            var status = data.response && data.response.code ? data.response.code : 0;
            if (data.fatal) {
              clearTimeout(startupTimer);
              if (cb.onError) {
                cb.onError({
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
          if (cb.onError) cb.onError(err);
        }
      },
      getHlsInstance: function () { return hls; },
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
          videoEl.removeEventListener('timeupdate', onTimeUpdate);
          videoEl.removeEventListener('ended', onEnded);
        }
        if (hls) {
          try { hls.destroy(); } catch (e) {}
          hls = null;
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
    var perfMode = opts.bufferProfile === 'small' ? 'lite' : 'normal';
    activeInstance = createHlsEngine(v, callbacks || {}, !!opts.isLive, perfMode);
    activeInstance.load(url, opts.timeoutMs || 15000);
    return activeInstance;
  }

  function destroy() {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
  }

  global.LuminaHlsEngine = {
    name: 'HlsJsEngine',
    isNative: false,
    isSupported: isSupported,
    create: createHlsEngine,
    play: play,
    destroy: destroy,
    getHlsInstance: function () {
      return activeInstance ? activeInstance.getHlsInstance() : null;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaHlsEngine;
})(typeof window !== 'undefined' ? window : global);
