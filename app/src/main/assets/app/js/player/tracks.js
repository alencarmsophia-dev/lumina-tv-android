(function (global) {
  'use strict';
  var ASPECT_MODES = ['auto', '16-9', '4-3', 'fill'];
  var ASPECT_LABELS = { 'auto': 'Automática', '16-9': '16:9', '4-3': '4:3', 'fill': 'Preencher' };

  function srtToVttText(srtContent) {
    var body = String(srtContent || '').replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return 'WEBVTT\n\n' + body;
  }

  function applyAspectRatio(videoEl, mode) {
    if (videoEl) videoEl.className = 'ratio-' + (mode || 'auto');
  }

  function cycleAspectRatio(videoEl, itemId) {
    var map = global.LuminaStore.get('aspectRatioByContent') || {};
    var cur = (itemId && map[itemId]) || global.LuminaStore.get('defaultAspectRatio') || 'auto';
    var next = ASPECT_MODES[(ASPECT_MODES.indexOf(cur) + 1) % ASPECT_MODES.length];
    applyAspectRatio(videoEl, next);
    if (itemId) {
      map[itemId] = next;
      global.LuminaStore.set('aspectRatioByContent', map);
      global.LuminaStorage.saveMeta('aspectRatioByContent', map);
    }
    return { mode: next, label: ASPECT_LABELS[next] };
  }

  function cycleAudioTrack(videoEl) {
    var tracks = videoEl && videoEl.audioTracks;
    if (!tracks || tracks.length <= 1) return { index: 0, label: 'Áudio Padrão (1/1)' };
    var idx = 0;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].enabled) { idx = i; tracks[i].enabled = false; }
    }
    var next = (idx + 1) % tracks.length;
    tracks[next].enabled = true;
    return { index: next, label: (tracks[next].label || 'Faixa ' + (next + 1)) };
  }

  function cycleSubtitleTrack(videoEl) {
    var tracks = videoEl && videoEl.textTracks;
    if (!tracks || !tracks.length) return { index: -1, label: 'Sem Legendas' };
    var idx = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].mode === 'showing') { idx = i; tracks[i].mode = 'disabled'; }
    }
    var next = idx + 1;
    if (next >= tracks.length) return { index: -1, label: 'Legendas Desativadas' };
    tracks[next].mode = 'showing';
    return { index: next, label: tracks[next].label || ('Legenda ' + (next + 1)) };
  }

  global.LuminaTracks = {
    srtToVttText: srtToVttText,
    applyAspectRatio: applyAspectRatio,
    cycleAspectRatio: cycleAspectRatio,
    cycleAudioTrack: cycleAudioTrack,
    cycleSubtitleTrack: cycleSubtitleTrack
  };
})(typeof window !== 'undefined' ? window : global);
