(function (global) {
  'use strict';

  var activeEngine = null;
  var videoEl = null;
  var listeners = {};

  function on(evt, fn) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(fn);
  }

  function off(evt, fn) {
    var arr = listeners[evt];
    if (!arr) return;
    if (!fn) {
      delete listeners[evt];
      return;
    }
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === fn) arr.splice(i, 1);
    }
  }

  function emit(evt, payload) {
    var arr = listeners[evt];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](payload); } catch (e) {}
    }
  }

  function setVideoElement(el) {
    videoEl = el;
  }

  function getVideoElement() {
    if (!videoEl && typeof document !== 'undefined') {
      videoEl = document.getElementById('main-video');
    }
    return videoEl;
  }

  function isNativeActive() {
    return !!(activeEngine && activeEngine.isNative);
  }

  function setActiveEngine(eng) {
    activeEngine = eng;
  }

  function getActiveEngine() {
    return activeEngine;
  }

  function play() {
    if (isNativeActive() && global.LuminaExoEngine) {
      global.LuminaExoEngine.resume();
      return;
    }
    var v = getVideoElement();
    if (v && typeof v.play === 'function') {
      try {
        var p = v.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {}
    }
  }

  function pause() {
    if (isNativeActive() && global.LuminaExoEngine) {
      global.LuminaExoEngine.pause();
      return;
    }
    var v = getVideoElement();
    if (v && typeof v.pause === 'function') {
      try { v.pause(); } catch (e) {}
    }
  }

  function stop() {
    if (activeEngine && typeof activeEngine.destroy === 'function') {
      var v = getVideoElement();
      activeEngine.destroy(v);
    }
    if (global.LuminaExoEngine && typeof global.LuminaExoEngine.destroy === 'function') {
      global.LuminaExoEngine.destroy();
    }
    activeEngine = null;
  }

  function seekTo(seconds) {
    var sec = Math.max(0, Number(seconds || 0));
    if (isNativeActive() && global.LuminaExoEngine) {
      global.LuminaExoEngine.seekToMs(Math.round(sec * 1000));
      return;
    }
    var v = getVideoElement();
    if (v) {
      try { v.currentTime = sec; } catch (e) {}
    }
  }

  function seekBy(deltaSeconds) {
    var dSec = Number(deltaSeconds || 0);
    if (isNativeActive() && global.LuminaExoEngine) {
      global.LuminaExoEngine.seekByMs(Math.round(dSec * 1000));
      return;
    }
    var v = getVideoElement();
    if (v) {
      try {
        var dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : 999999;
        v.currentTime = Math.max(0, Math.min(dur, (v.currentTime || 0) + dSec));
      } catch (e) {}
    }
  }

  function getState() {
    if (isNativeActive() && global.LuminaExoEngine) {
      var st = global.LuminaExoEngine.getState();
      return {
        currentTime: Math.floor((st.positionMs || 0) / 1000),
        duration: Math.floor((st.durationMs || 0) / 1000),
        buffered: Math.floor((st.bufferedMs || 0) / 1000),
        isPlaying: !!st.isPlaying,
        isLive: !!st.isLive,
        videoWidth: st.videoWidth || 0,
        videoHeight: st.videoHeight || 0,
        engineName: 'ExoPlayer',
        isNative: true
      };
    }
    var v = getVideoElement();
    var dur = (v && isFinite(v.duration) && v.duration > 0) ? Math.floor(v.duration) : 0;
    var pos = (v && v.currentTime > 0) ? Math.floor(v.currentTime) : 0;
    return {
      currentTime: pos,
      duration: dur,
      buffered: pos,
      isPlaying: !!(v && !v.paused),
      isLive: false,
      videoWidth: (v && v.videoWidth) || 0,
      videoHeight: (v && v.videoHeight) || 0,
      engineName: activeEngine ? activeEngine.name : 'NativeEngine',
      isNative: false
    };
  }

  function getTracks() {
    if (isNativeActive() && global.LuminaExoEngine) {
      return global.LuminaExoEngine.getTracks();
    }
    return { audio: [], text: [] };
  }

  function setAudioTrack(trackId) {
    if (isNativeActive() && global.LuminaExoEngine) {
      global.LuminaExoEngine.setAudioTrack(trackId);
    }
  }

  function setTextTrack(trackId) {
    if (isNativeActive() && global.LuminaExoEngine) {
      global.LuminaExoEngine.setTextTrack(trackId);
    }
  }

  function setResizeMode(mode) {
    if (global.LuminaExoEngine) {
      global.LuminaExoEngine.setResizeMode(mode);
    }
  }

  var api = {
    on: on,
    off: off,
    emit: emit,
    setVideoElement: setVideoElement,
    getVideoElement: getVideoElement,
    isNativeActive: isNativeActive,
    setActiveEngine: setActiveEngine,
    getActiveEngine: getActiveEngine,
    play: play,
    pause: pause,
    stop: stop,
    seekTo: seekTo,
    seekBy: seekBy,
    getState: getState,
    getTracks: getTracks,
    setAudioTrack: setAudioTrack,
    setTextTrack: setTextTrack,
    setResizeMode: setResizeMode
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaPlayback = api;
})(typeof window !== 'undefined' ? window : global);
