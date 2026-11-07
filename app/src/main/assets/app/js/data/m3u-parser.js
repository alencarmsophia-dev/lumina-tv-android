(function (global) {
  'use strict';

  var ATTR_REGEX = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

  function parseExtInfLine(line) {
    var meta = {
      tvgId: '',
      tvgName: '',
      tvgLogo: '',
      tvgType: '',
      tvgRating: '',
      groupTitle: 'Sem Grupo',
      title: 'Canal'
    };

    var commaIdx = line.lastIndexOf(',');
    if (commaIdx !== -1) {
      meta.title = line.slice(commaIdx + 1).trim() || 'Sem Título';
    }

    var attrPart = commaIdx !== -1 ? line.slice(0, commaIdx) : line;
    var match;
    ATTR_REGEX.lastIndex = 0;
    while ((match = ATTR_REGEX.exec(attrPart)) !== null) {
      var key = match[1].toLowerCase();
      var val = match[2].trim();
      if (key === 'tvg-id') meta.tvgId = val;
      else if (key === 'tvg-name') meta.tvgName = val;
      else if (key === 'tvg-logo') meta.tvgLogo = val;
      else if (key === 'tvg-type' || key === 'type') meta.tvgType = val;
      else if (key === 'tvg-rating') meta.tvgRating = val;
      else if (key === 'group-title') meta.groupTitle = val || 'Sem Grupo';
    }
    return meta;
  }

  // Varredura Zero-Split: não duplica 50-80MB na RAM da TV LG com .split(/\n/)
  function parseM3UText(text, sourceId, classifierFn) {
    var str = String(text || '');
    var len = str.length;
    var pos = 0;
    var results = [];
    var currentMeta = null;
    var baseNow = Date.now();
    var itemIdx = 0;

    while (pos < len) {
      var nextNl = str.indexOf('\n', pos);
      if (nextNl === -1) nextNl = len;
      var line = str.slice(pos, nextNl).trim();
      pos = nextNl + 1;

      if (!line) continue;
      if (line.charCodeAt(0) === 35) { // '#'
        if (line.indexOf('#EXTINF:') === 0) {
          currentMeta = parseExtInfLine(line);
          currentMeta.addedAt = baseNow - itemIdx;
        }
      } else if (currentMeta) {
        currentMeta.url = line;
        currentMeta.sourceId = sourceId || 'm3u';
        results.push(classifierFn ? classifierFn(currentMeta) : currentMeta);
        currentMeta = null;
        itemIdx++;
      }
    }
    return results;
  }

  // Parser Assíncrono em Fatias de Tempo (Time-Sliced 10ms) para listas de 200.000+ itens sem travar o controle remoto
  function parseChunkedAsync(text, sourceId, classifierFn, onProgress, onDone) {
    var str = String(text || '');
    var totalBytes = str.length;
    var pos = 0;
    var currentMeta = null;
    var results = [];
    var baseNow = Date.now();
    var processedLines = 0;
    var BYTES_PER_SLICE = 512 * 1024; // ~512 KB por fatia (~8-10ms na CPU da TV LG)

    function step() {
      var targetEnd = Math.min(pos + BYTES_PER_SLICE, totalBytes);
      while (pos < targetEnd || (pos < totalBytes && currentMeta !== null)) {
        var nextNl = str.indexOf('\n', pos);
        if (nextNl === -1) nextNl = totalBytes;
        var line = str.slice(pos, nextNl).trim();
        pos = nextNl + 1;
        processedLines++;

        if (!line) continue;
        if (line.charCodeAt(0) === 35) { // '#'
          if (line.indexOf('#EXTINF:') === 0) {
            currentMeta = parseExtInfLine(line);
            currentMeta.addedAt = baseNow - results.length;
          }
        } else if (currentMeta) {
          currentMeta.url = line;
          currentMeta.sourceId = sourceId || 'm3u';
          results.push(classifierFn ? classifierFn(currentMeta) : currentMeta);
          currentMeta = null;
          if (pos >= targetEnd) break;
        }
      }

      if (onProgress) {
        onProgress({
          processedLines: processedLines,
          totalLines: processedLines,
          itemsCount: results.length,
          percent: totalBytes ? Math.min(100, Math.round((pos / totalBytes) * 100)) : 100
        });
      }

      if (pos < totalBytes) {
        setTimeout(step, 4);
      } else {
        onDone(null, results);
      }
    }
    step();
  }

  var api = {
    parseExtInfLine: parseExtInfLine,
    parseM3UText: parseM3UText,
    parseChunkedAsync: parseChunkedAsync
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaM3UParser = api;
})(typeof window !== 'undefined' ? window : global);
