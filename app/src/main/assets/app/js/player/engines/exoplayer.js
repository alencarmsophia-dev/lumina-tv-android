(function (global) {
  'use strict';

  var activeCallbacks = null;
  var state = {
    isPlaying: false,
    isLive: false,
    positionMs: 0,
    durationMs: 0,
    bufferedMs: 0,
    videoWidth: 0,
    videoHeight: 0,
    audioTracks: [],
    textTracks: []
  };

  function getBridge() {
    if (typeof window !== 'undefined' && window.LuminaAndroidBridge) {
      return window.LuminaAndroidBridge;
    }
    return null;
  }

  function isSupported() {
    var b = getBridge();
    if (!b || typeof b.nativeIsAvailable !== 'function') return false;
    try {
      return !!b.nativeIsAvailable();
    } catch (e) {
      return false;
    }
  }

  function setHtmlNativeVideoActive(active) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (active) {
      document.documentElement.classList.add('native-video-active');
    } else {
      document.documentElement.classList.remove('native-video-active');
    }
  }

  function handleNativeEvent(eventName, payload) {
    var data = payload || {};
    if (typeof payload === 'string') {
      try { data = JSON.parse(payload); } catch (e) { data = {}; }
    }

    if (eventName === 'ready') {
      if (typeof data.durationMs === 'number') state.durationMs = data.durationMs;
      if (typeof data.isLive === 'boolean') state.isLive = data.isLive;
      if (activeCallbacks && activeCallbacks.onReady) activeCallbacks.onReady(data);
    } else if (eventName === 'playing') {
      state.isPlaying = true;
      if (activeCallbacks && activeCallbacks.onPlaying) activeCallbacks.onPlaying(data);
    } else if (eventName === 'paused') {
      state.isPlaying = false;
      if (activeCallbacks && activeCallbacks.onPaused) activeCallbacks.onPaused(data);
    } else if (eventName === 'buffering') {
      if (activeCallbacks && activeCallbacks.onWaiting) activeCallbacks.onWaiting(data);
    } else if (eventName === 'ended') {
      state.isPlaying = false;
      if (activeCallbacks && activeCallbacks.onEnded) activeCallbacks.onEnded(data);
    } else if (eventName === 'videoSize') {
      state.videoWidth = Number(data.width || 0);
      state.videoHeight = Number(data.height || 0);
      if (activeCallbacks && activeCallbacks.onVideoSize) activeCallbacks.onVideoSize(data);
    } else if (eventName === 'tracks') {
      state.audioTracks = Array.isArray(data.audio) ? data.audio : [];
      state.textTracks = Array.isArray(data.text) ? data.text : [];
      if (activeCallbacks && activeCallbacks.onTracks) activeCallbacks.onTracks(state.audioTracks, state.textTracks);
    } else if (eventName === 'position') {
      state.positionMs = Number(data.positionMs || 0);
      if (typeof data.durationMs === 'number' && data.durationMs > 0) state.durationMs = data.durationMs;
      state.bufferedMs = Number(data.bufferedMs || 0);
      if (typeof data.isLive === 'boolean') state.isLive = data.isLive;
      if (activeCallbacks && activeCallbacks.onPosition) activeCallbacks.onPosition(state);
    } else if (eventName === 'error') {
      state.isPlaying = false;
      if (activeCallbacks && activeCallbacks.onError) {
        activeCallbacks.onError({
          code: data.code || 'ERROR_CODE_UNSPECIFIED',
          httpStatus: Number(data.httpStatus || 0),
          message: data.message || 'Erro no ExoPlayer nativo',
          fatal: data.fatal !== false
        });
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.__luminaNative = {
      emit: function (name, jsonPayload) {
        handleNativeEvent(name, jsonPayload);
      }
    };
  }

  function play(videoEl, url, callbacks, options) {
    var b = getBridge();
    if (!b || typeof b.nativeOpen !== 'function') {
      if (callbacks && callbacks.onError) {
        callbacks.onError({ code: 'NATIVE_UNAVAILABLE', httpStatus: 0, message: 'Ponte ExoPlayer indisponível' });
      }
      return;
    }

    // Garante que o <video> HTML5 está limpo e pausado
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
      } catch (e) {}
    }

    var opts = options || {};
    activeCallbacks = callbacks || {};
    state.isPlaying = false;
    state.isLive = !!opts.isLive;
    state.positionMs = Number(opts.startPositionMs || 0);
    state.durationMs = 0;
    state.bufferedMs = 0;
    state.audioTracks = [];
    state.textTracks = [];

    setHtmlNativeVideoActive(true);

    var openConfig = {
      url: String(url || ''),
      isLive: !!opts.isLive,
      startPositionMs: Number(opts.startPositionMs || 0),
      userAgent: String(opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20'),
      referer: String(opts.referer || ''),
      headers: opts.headers || {},
      preferredAudioLang: String(opts.preferredAudioLang || 'pt'),
      bufferProfile: String(opts.bufferProfile || 'normal')
    };

    try {
      b.nativeOpen(JSON.stringify(openConfig));
    } catch (e) {
      if (callbacks && callbacks.onError) {
        callbacks.onError({ code: 'NATIVE_OPEN_EXCEPTION', httpStatus: 0, message: e.message || 'Falha em nativeOpen' });
      }
    }
  }

  function resume() {
    var b = getBridge();
    if (b && typeof b.nativePlay === 'function') {
      try { b.nativePlay(); } catch (e) {}
    }
  }

  function pause() {
    var b = getBridge();
    if (b && typeof b.nativePause === 'function') {
      try { b.nativePause(); } catch (e) {}
    }
  }

  function seekToMs(ms) {
    var b = getBridge();
    state.positionMs = Math.max(0, Number(ms || 0));
    if (b && typeof b.nativeSeekTo === 'function') {
      try { b.nativeSeekTo(state.positionMs); } catch (e) {}
    }
  }

  function seekByMs(deltaMs) {
    var b = getBridge();
    state.positionMs = Math.max(0, state.positionMs + Number(deltaMs || 0));
    if (b && typeof b.nativeSeekBy === 'function') {
      try { b.nativeSeekBy(Number(deltaMs || 0)); } catch (e) {}
    }
  }

  function setAudioTrack(trackId) {
    var b = getBridge();
    if (b && typeof b.nativeSetAudioTrack === 'function') {
      try { b.nativeSetAudioTrack(String(trackId || '')); } catch (e) {}
    }
    for (var i = 0; i < state.audioTracks.length; i++) {
      state.audioTracks[i].selected = (state.audioTracks[i].id === trackId);
    }
  }

  function setTextTrack(trackId) {
    var b = getBridge();
    if (b && typeof b.nativeSetTextTrack === 'function') {
      try { b.nativeSetTextTrack(String(trackId || '')); } catch (e) {}
    }
    for (var i = 0; i < state.textTracks.length; i++) {
      state.textTracks[i].selected = (state.textTracks[i].id === trackId);
    }
  }

  function setResizeMode(mode) {
    var b = getBridge();
    if (b && typeof b.nativeSetResizeMode === 'function') {
      try { b.nativeSetResizeMode(String(mode || 'auto')); } catch (e) {}
    }
  }

  function destroy() {
    activeCallbacks = null;
    state.isPlaying = false;
    setHtmlNativeVideoActive(false);
    var b = getBridge();
    if (b && typeof b.nativeStop === 'function') {
      try { b.nativeStop(); } catch (e) {}
    }
  }

  var api = {
    name: 'ExoPlayer',
    isNative: true,
    isSupported: isSupported,
    play: play,
    resume: resume,
    pause: pause,
    seekToMs: seekToMs,
    seekByMs: seekByMs,
    setAudioTrack: setAudioTrack,
    setTextTrack: setTextTrack,
    setResizeMode: setResizeMode,
    getState: function () { return state; },
    getTracks: function () {
      return {
        audio: state.audioTracks.slice(),
        text: state.textTracks.slice()
      };
    },
    handleNativeEvent: handleNativeEvent,
    destroy: destroy
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaExoEngine = api;
})(typeof window !== 'undefined' ? window : global);
