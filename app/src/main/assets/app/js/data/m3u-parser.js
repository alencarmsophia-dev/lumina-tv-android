(function (global) {
  'use strict';

  var QUOTED_ATTR_REGEX = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  var UNQUOTED_ATTR_REGEX = /(?:^|\s)([a-zA-Z0-9_-]+)=([^\s",]+)(?=\s|,|$)/g;

  // Encontra a primeira vírgula fora de aspas que separa os atributos #EXTINF do título do canal/filme
  function findTitleCommaIndex(line) {
    var inQuotes = false;
    var startPos = line.indexOf(':');
    if (startPos === -1) startPos = 0;
    for (var i = startPos; i < line.length; i++) {
      var ch = line.charCodeAt(i);
      if (ch === 34) { // '"'
        inQuotes = !inQuotes;
      } else if (ch === 44 && !inQuotes) { // ','
        return i;
      }
    }
    return -1;
  }

  function parseExtInfLine(line) {
    var meta = {
      tvgId: '',
      tvgName: '',
      tvgLogo: '',
      tvgType: '',
      tvgRating: '',
      groupTitle: 'Sem Grupo',
      title: 'Canal',
      httpUserAgent: '',
      httpReferrer: ''
    };

    var commaIdx = findTitleCommaIndex(line);
    if (commaIdx !== -1) {
      meta.title = line.slice(commaIdx + 1).trim() || 'Sem Título';
    }

    var attrPart = commaIdx !== -1 ? line.slice(0, commaIdx) : line;
    var match;

    QUOTED_ATTR_REGEX.lastIndex = 0;
    while ((match = QUOTED_ATTR_REGEX.exec(attrPart)) !== null) {
      applyAttr(meta, match[1].toLowerCase(), match[2].trim());
    }

    // Atributos sem aspas (ex.: tvg-id=ch1 group-title=Abertos)
    var strippedQuoted = attrPart.replace(QUOTED_ATTR_REGEX, ' ');
    UNQUOTED_ATTR_REGEX.lastIndex = 0;
    while ((match = UNQUOTED_ATTR_REGEX.exec(strippedQuoted)) !== null) {
      applyAttr(meta, match[1].toLowerCase(), match[2].trim());
    }

    if ((!meta.title || meta.title === 'Sem Título' || meta.title === 'Canal') && meta.tvgName) {
      meta.title = meta.tvgName;
    }

    return meta;
  }

  function applyAttr(meta, key, val) {
    if (!val) return;
    if (key === 'tvg-id') meta.tvgId = val;
    else if (key === 'tvg-name') meta.tvgName = val;
    else if (key === 'tvg-logo') meta.tvgLogo = val;
    else if (key === 'tvg-type' || key === 'type') meta.tvgType = val.toLowerCase();
    else if (key === 'tvg-rating' || key === 'rating') meta.tvgRating = val;
    else if (key === 'group-title') meta.groupTitle = val || 'Sem Grupo';
    else if (key === 'user-agent' || key === 'http-user-agent') meta.httpUserAgent = val;
    else if (key === 'referer' || key === 'http-referrer' || key === 'http-referer') meta.httpReferrer = val;
  }

  function parseDirectiveLine(line, currentMeta, stickyHeaders) {
    if (line.indexOf('#EXTINF:') === 0) {
      var parsed = parseExtInfLine(line);
      if (stickyHeaders.userAgent && !parsed.httpUserAgent) parsed.httpUserAgent = stickyHeaders.userAgent;
      if (stickyHeaders.referrer && !parsed.httpReferrer) parsed.httpReferrer = stickyHeaders.referrer;
      return parsed;
    }
    if (line.indexOf('#EXTGRP:') === 0) {
      var grp = line.slice(8).trim();
      if (grp && currentMeta && (!currentMeta.groupTitle || currentMeta.groupTitle === 'Sem Grupo')) {
        currentMeta.groupTitle = grp;
      }
      return currentMeta;
    }
    if (line.indexOf('#EXTVLCOPT:') === 0) {
      var opt = line.slice(11).trim();
      var eqIdx = opt.indexOf('=');
      if (eqIdx !== -1) {
        var optKey = opt.slice(0, eqIdx).trim().toLowerCase();
        var optVal = opt.slice(eqIdx + 1).trim();
        if (optKey === 'http-user-agent') {
          if (currentMeta) currentMeta.httpUserAgent = optVal;
          else stickyHeaders.userAgent = optVal;
        } else if (optKey === 'http-referrer' || optKey === 'http-referer') {
          if (currentMeta) currentMeta.httpReferrer = optVal;
          else stickyHeaders.referrer = optVal;
        }
      }
      return currentMeta;
    }
    return currentMeta;
  }

  // Varredura Zero-Split: não duplica 50-80MB na RAM com .split(/\n/)
  function parseM3UText(text, sourceId, classifierFn) {
    var str = String(text || '');
    var len = str.length;
    var pos = 0;
    var results = [];
    var currentMeta = null;
    var stickyHeaders = { userAgent: '', referrer: '' };
    var baseNow = Date.now();
    var itemIdx = 0;

    while (pos < len) {
      var nextNl = str.indexOf('\n', pos);
      if (nextNl === -1) nextNl = len;
      var line = str.slice(pos, nextNl).replace(/\r+$/, '').trim();
      pos = nextNl + 1;

      if (!line) continue;
      if (line.charCodeAt(0) === 35) { // '#'
        currentMeta = parseDirectiveLine(line, currentMeta, stickyHeaders);
        if (currentMeta && !currentMeta.addedAt) {
          currentMeta.addedAt = baseNow - itemIdx;
        }
      } else if (currentMeta) {
        currentMeta.url = line;
        currentMeta.sourceId = sourceId || 'm3u';
        results.push(classifierFn ? classifierFn(currentMeta) : currentMeta);
        currentMeta = null;
        stickyHeaders.userAgent = '';
        stickyHeaders.referrer = '';
        itemIdx++;
      }
    }
    return results;
  }

  // Parser Assíncrono em Fatias de Tempo com suporte a cancelToken
  function parseChunkedAsync(text, sourceId, classifierFn, onProgress, onDone, cancelToken) {
    var str = String(text || '');
    var totalBytes = str.length;
    var pos = 0;
    var currentMeta = null;
    var stickyHeaders = { userAgent: '', referrer: '' };
    var results = [];
    var baseNow = Date.now();
    var processedLines = 0;
    var BYTES_PER_SLICE = 512 * 1024;

    function step() {
      if (cancelToken && cancelToken.cancelled) {
        return onDone(new Error('Importação cancelada pelo usuário.'), []);
      }

      var targetEnd = Math.min(pos + BYTES_PER_SLICE, totalBytes);
      while (pos < targetEnd || (pos < totalBytes && currentMeta !== null)) {
        var nextNl = str.indexOf('\n', pos);
        if (nextNl === -1) nextNl = totalBytes;
        var line = str.slice(pos, nextNl).replace(/\r+$/, '').trim();
        pos = nextNl + 1;
        processedLines++;

        if (!line) continue;
        if (line.charCodeAt(0) === 35) { // '#'
          currentMeta = parseDirectiveLine(line, currentMeta, stickyHeaders);
          if (currentMeta && !currentMeta.addedAt) {
            currentMeta.addedAt = baseNow - results.length;
          }
        } else if (currentMeta) {
          currentMeta.url = line;
          currentMeta.sourceId = sourceId || 'm3u';
          results.push(classifierFn ? classifierFn(currentMeta) : currentMeta);
          currentMeta = null;
          stickyHeaders.userAgent = '';
          stickyHeaders.referrer = '';
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
    findTitleCommaIndex: findTitleCommaIndex,
    parseExtInfLine: parseExtInfLine,
    parseM3UText: parseM3UText,
    parseChunkedAsync: parseChunkedAsync
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaM3UParser = api;
})(typeof window !== 'undefined' ? window : global);
