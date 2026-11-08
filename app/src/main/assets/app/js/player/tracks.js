(function (global) {
  'use strict';

  var ASPECT_MODES = ['auto', '16-9', '4-3', 'fill'];
  var ASPECT_LABELS = { 'auto': 'Automática', '16-9': '16:9', '4-3': '4:3', 'fill': 'Preencher' };
  var SPEED_MODES = [1.0, 1.25, 1.5, 2.0, 0.75];

  function srtToVttText(srtContent) {
    var body = String(srtContent || '').replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + body;
  }

  function applyAspectRatio(videoEl, mode) {
    if (videoEl) videoEl.className = 'ratio-' + String(mode || 'auto').replace(':', '-');
  }

  function cycleAspectRatio(videoEl, itemId) {
    var map = (global.LuminaStore && global.LuminaStore.get('aspectRatioByContent')) || {};
    var cur = (itemId && map[itemId]) || (global.LuminaStore && global.LuminaStore.get('defaultAspectRatio')) || 'auto';
    cur = String(cur).replace(':', '-');
    var idx = ASPECT_MODES.indexOf(cur);
    var next = ASPECT_MODES[(idx + 1) % ASPECT_MODES.length];
    applyAspectRatio(videoEl, next);
    if (itemId && global.LuminaStore) {
      map[itemId] = next;
      global.LuminaStore.set('aspectRatioByContent', map);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('aspectRatioByContent', map);
    }
    return { mode: next, label: ASPECT_LABELS[next] || next };
  }

  function cycleAudioTrack(videoEl, activeEngine) {
    // 1. Tenta trilhas reais do hls.js quando HlsJsEngine estiver ativo
    if (activeEngine && typeof activeEngine.getAudioTracks === 'function') {
      var hlsTracks = activeEngine.getAudioTracks();
      if (hlsTracks && hlsTracks.length > 1) {
        var curHlsIdx = activeEngine.getCurrentAudioTrack ? activeEngine.getCurrentAudioTrack() : 0;
        var nextHlsIdx = (curHlsIdx + 1) % hlsTracks.length;
        if (activeEngine.setAudioTrack) activeEngine.setAudioTrack(nextHlsIdx);
        var tr = hlsTracks[nextHlsIdx] || {};
        var lbl = tr.name || tr.lang || ('Faixa ' + (nextHlsIdx + 1));
        return { index: nextHlsIdx, label: lbl + ' (' + (nextHlsIdx + 1) + '/' + hlsTracks.length + ')' };
      }
    }

    // 2. HTML5 videoEl.audioTracks
    var tracks = videoEl && videoEl.audioTracks;
    if (!tracks || tracks.length <= 1) return { index: 0, label: 'Áudio Padrão (1/1)' };
    var idx = 0;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].enabled) { idx = i; tracks[i].enabled = false; }
    }
    var next = (idx + 1) % tracks.length;
    tracks[next].enabled = true;
    var name = tracks[next].label || tracks[next].language || ('Faixa ' + (next + 1));
    return { index: next, label: name + ' (' + (next + 1) + '/' + tracks.length + ')' };
  }

  function cycleSubtitleTrack(videoEl, activeEngine) {
    // 1. Tenta legendas embutidas no manifesto HLS via hls.js
    if (activeEngine && typeof activeEngine.getSubtitleTracks === 'function') {
      var hlsSubs = activeEngine.getSubtitleTracks();
      if (hlsSubs && hlsSubs.length > 0) {
        var curSub = activeEngine.getCurrentSubtitleTrack ? activeEngine.getCurrentSubtitleTrack() : -1;
        var nextSub = curSub + 1;
        if (nextSub >= hlsSubs.length) {
          if (activeEngine.setSubtitleTrack) activeEngine.setSubtitleTrack(-1);
          return { index: -1, label: 'Legendas Desativadas' };
        }
        if (activeEngine.setSubtitleTrack) activeEngine.setSubtitleTrack(nextSub);
        var st = hlsSubs[nextSub] || {};
        return { index: nextSub, label: st.name || st.lang || ('Legenda ' + (nextSub + 1)) };
      }
    }

    // 2. HTML5 videoEl.textTracks
    var tracks = videoEl && videoEl.textTracks;
    if (!tracks || !tracks.length) return { index: -1, label: 'Sem Legendas Disponíveis' };
    var idx = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].mode === 'showing') { idx = i; tracks[i].mode = 'disabled'; }
    }
    var next = idx + 1;
    if (next >= tracks.length) return { index: -1, label: 'Legendas Desativadas' };
    tracks[next].mode = 'showing';
    return { index: next, label: tracks[next].label || tracks[next].language || ('Legenda ' + (next + 1)) };
  }

  function cyclePlaybackSpeed(videoEl) {
    if (!videoEl) return { speed: 1.0, label: '1.0x' };
    var cur = Number(videoEl.playbackRate || 1.0);
    var idx = SPEED_MODES.indexOf(cur);
    var next = SPEED_MODES[(idx + 1) % SPEED_MODES.length];
    try { videoEl.playbackRate = next; } catch (e) { next = 1.0; }
    return { speed: next, label: next + 'x' };
  }

  global.LuminaTracks = {
    srtToVttText: srtToVttText,
    applyAspectRatio: applyAspectRatio,
    cycleAspectRatio: cycleAspectRatio,
    cycleAudioTrack: cycleAudioTrack,
    cycleSubtitleTrack: cycleSubtitleTrack,
    cyclePlaybackSpeed: cyclePlaybackSpeed
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.LuminaTracks;
})(typeof window !== 'undefined' ? window : global);
