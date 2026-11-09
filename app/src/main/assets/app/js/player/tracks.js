(function (global) {
  'use strict';

  var ASPECT_RATIOS = [
    { id: 'auto', label: 'Automático', cssClass: 'ratio-auto' },
    { id: '16:9', label: '16:9', cssClass: 'ratio-16-9' },
    { id: '4:3', label: '4:3', cssClass: 'ratio-4-3' },
    { id: 'fill', label: 'Preencher', cssClass: 'ratio-fill' }
  ];

  var currentAudioIdx = 0;
  var currentSubIdx = 0;

  function applyAspectRatio(videoEl, ratioId) {
    var chosen = ASPECT_RATIOS[0];
    for (var i = 0; i < ASPECT_RATIOS.length; i++) {
      if (ASPECT_RATIOS[i].id === ratioId) {
        chosen = ASPECT_RATIOS[i];
        break;
      }
    }
    if (videoEl && videoEl.classList) {
      for (var j = 0; j < ASPECT_RATIOS.length; j++) {
        videoEl.classList.remove(ASPECT_RATIOS[j].cssClass);
      }
      videoEl.classList.add(chosen.cssClass);
    }
    if (global.LuminaPlayback && typeof global.LuminaPlayback.setResizeMode === 'function') {
      global.LuminaPlayback.setResizeMode(chosen.id);
    }
    return chosen;
  }

  function cycleAspectRatio(videoEl, contentId) {
    var byContent = (global.LuminaStore && global.LuminaStore.get('aspectRatioByContent')) || {};
    var defRatio = (global.LuminaStore && global.LuminaStore.get('defaultAspectRatio')) || 'auto';
    var currentId = (contentId && byContent[contentId]) ? byContent[contentId] : defRatio;
    var nextIdx = 0;
    for (var i = 0; i < ASPECT_RATIOS.length; i++) {
      if (ASPECT_RATIOS[i].id === currentId) {
        nextIdx = (i + 1) % ASPECT_RATIOS.length;
        break;
      }
    }
    var nextRatio = ASPECT_RATIOS[nextIdx];
    applyAspectRatio(videoEl, nextRatio.id);

    if (contentId && global.LuminaStore) {
      byContent[contentId] = nextRatio.id;
      global.LuminaStore.set('aspectRatioByContent', byContent);
      if (global.LuminaStorage) global.LuminaStorage.saveMeta('aspectRatioByContent', byContent);
    }
    return nextRatio;
  }

  function getAudioTracks(videoEl, activeEngine) {
    if (global.LuminaPlayback && global.LuminaPlayback.isNativeActive()) {
      var nt = global.LuminaPlayback.getTracks().audio || [];
      if (nt.length) return nt;
    }
    if (activeEngine && activeEngine.name === 'HlsJsEngine' && activeEngine.getHlsInstance) {
      var hls = activeEngine.getHlsInstance();
      if (hls && hls.audioTracks && hls.audioTracks.length) {
        return hls.audioTracks.map(function (t, idx) {
          return { id: String(idx), index: idx, label: t.name || t.lang || ('Áudio ' + (idx + 1)), selected: hls.audioTrack === idx };
        });
      }
    }
    if (videoEl && videoEl.audioTracks && videoEl.audioTracks.length) {
      var list = [];
      for (var i = 0; i < videoEl.audioTracks.length; i++) {
        var tr = videoEl.audioTracks[i];
        list.push({ id: String(i), index: i, label: tr.label || tr.language || ('Áudio ' + (i + 1)), selected: !!tr.enabled });
      }
      return list;
    }
    return [{ id: '0', index: 0, label: 'Padrão', selected: true }];
  }

  function cycleAudioTrack(videoEl, activeEngine) {
    var tracks = getAudioTracks(videoEl, activeEngine);
    if (tracks.length <= 1) return tracks[0] || { label: 'Padrão (Único)' };

    var selIdx = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].selected) { selIdx = i; break; }
    }
    currentAudioIdx = ((selIdx >= 0 ? selIdx : currentAudioIdx) + 1) % tracks.length;
    var chosen = tracks[currentAudioIdx];

    if (global.LuminaPlayback && global.LuminaPlayback.isNativeActive()) {
      global.LuminaPlayback.setAudioTrack(chosen.id);
      return chosen;
    }

    if (activeEngine && activeEngine.name === 'HlsJsEngine' && activeEngine.getHlsInstance) {
      var hls = activeEngine.getHlsInstance();
      if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
        hls.audioTrack = chosen.index;
        return chosen;
      }
    }
    if (videoEl && videoEl.audioTracks && videoEl.audioTracks.length > 1) {
      for (var j = 0; j < videoEl.audioTracks.length; j++) {
        videoEl.audioTracks[j].enabled = (j === chosen.index);
      }
    }
    return chosen;
  }

  function getSubtitleTracks(videoEl, activeEngine) {
    var out = [{ id: 'off', index: -1, label: 'Desativada', selected: true }];
    if (global.LuminaPlayback && global.LuminaPlayback.isNativeActive()) {
      var nt = global.LuminaPlayback.getTracks().text || [];
      var anySel = false;
      for (var i = 0; i < nt.length; i++) {
        if (nt[i].selected) anySel = true;
        out.push({ id: nt[i].id, index: i, label: nt[i].label || nt[i].language || ('Legenda ' + (i + 1)), selected: !!nt[i].selected });
      }
      out[0].selected = !anySel;
      return out;
    }
    if (activeEngine && activeEngine.name === 'HlsJsEngine' && activeEngine.getHlsInstance) {
      var hls = activeEngine.getHlsInstance();
      if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
        for (var j = 0; j < hls.subtitleTracks.length; j++) {
          var st = hls.subtitleTracks[j];
          var isSel = (hls.subtitleTrack === j);
          if (isSel) out[0].selected = false;
          out.push({ id: String(j), index: j, label: st.name || st.lang || ('Legenda ' + (j + 1)), selected: isSel });
        }
        return out;
      }
    }
    if (videoEl && videoEl.textTracks && videoEl.textTracks.length) {
      for (var k = 0; k < videoEl.textTracks.length; k++) {
        var tt = videoEl.textTracks[k];
        var showing = (tt.mode === 'showing');
        if (showing) out[0].selected = false;
        out.push({ id: String(k), index: k, label: tt.label || tt.language || ('Legenda ' + (k + 1)), selected: showing });
      }
    }
    return out;
  }

  function cycleSubtitleTrack(videoEl, activeEngine) {
    var tracks = getSubtitleTracks(videoEl, activeEngine);
    if (tracks.length <= 1) return tracks[0];

    var selIdx = -1;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].selected) { selIdx = i; break; }
    }
    currentSubIdx = ((selIdx >= 0 ? selIdx : currentSubIdx) + 1) % tracks.length;
    var chosen = tracks[currentSubIdx];

    if (global.LuminaPlayback && global.LuminaPlayback.isNativeActive()) {
      global.LuminaPlayback.setTextTrack(chosen.id === 'off' ? '' : chosen.id);
      return chosen;
    }

    if (activeEngine && activeEngine.name === 'HlsJsEngine' && activeEngine.getHlsInstance) {
      var hls = activeEngine.getHlsInstance();
      if (hls && hls.subtitleTracks && hls.subtitleTracks.length) {
        hls.subtitleTrack = chosen.index;
        return chosen;
      }
    }
    if (videoEl && videoEl.textTracks && videoEl.textTracks.length) {
      for (var j = 0; j < videoEl.textTracks.length; j++) {
        videoEl.textTracks[j].mode = (j === chosen.index) ? 'showing' : 'disabled';
      }
    }
    return chosen;
  }

  var api = {
    ASPECT_RATIOS: ASPECT_RATIOS,
    applyAspectRatio: applyAspectRatio,
    cycleAspectRatio: cycleAspectRatio,
    getAudioTracks: getAudioTracks,
    cycleAudioTrack: cycleAudioTrack,
    getSubtitleTracks: getSubtitleTracks,
    cycleSubtitleTrack: cycleSubtitleTrack
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaTracks = api;
})(typeof window !== 'undefined' ? window : global);
