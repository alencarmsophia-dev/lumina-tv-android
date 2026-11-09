(function (global) {
  'use strict';

  // Se estiver rodando dentro de um Web Worker real no navegador/WebView, carrega dependências caso ainda não estejam no escopo
  if (typeof importScripts === 'function' && !global.LuminaClassifier) {
    try {
      importScripts('../data/classifier.js');
    } catch (e) {}
  }

  var PAGE_SIZE = 200;
  var MAX_LINE_BYTES = 8192; // 8 KB (Parte 4.5)
  var MAX_POSTINGS_PER_RUN = 200000; // Parte 4.2
  var CHECKPOINT_BYTES_INTERVAL = 2 * 1024 * 1024; // 2 MB (Parte 4.3)
  var CHECKPOINT_TIME_INTERVAL_MS = 5000; // 5 s
  var MAX_RECENT_PER_SECTION = 40; // Parte 4.2

  var QUOTED_ATTR_REGEX = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  var UNQUOTED_ATTR_REGEX = /(?:^|\s)([a-zA-Z0-9_-]+)=([^\s",]+)(?=\s|,|$)/g;
  var CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
  var XTREAM_URL_CRED_REGEX = /^(https?:\/\/[^\/?#]+)\/(live|movie|series)\/([^\/]+)\/([^\/]+)\/(.+)$/i;
  var XTREAM_SHORT_CRED_REGEX = /^(https?:\/\/[^\/?#]+)\/(?!live\/|movie\/|series\/|api\/|assets\/)([^\/?#]+)\/([^\/?#]+)\/(\d+(?:\.[a-z0-9]+)?(?:\?.*)?)$/i;

  function createUtf8ChunkDecoder() {
    var pending = [];

    return {
      decodeChunk: function (u8Chunk, isFinal) {
        if (typeof u8Chunk === 'string') return u8Chunk;
        if (!u8Chunk || !u8Chunk.length) {
          if (isFinal && pending.length) {
            pending = [];
            return '\uFFFD';
          }
          return '';
        }

        var len = u8Chunk.length;
        var totalLen = pending.length + len;
        var buf = new Uint8Array(totalLen);
        for (var p = 0; p < pending.length; p++) buf[p] = pending[p];
        buf.set(u8Chunk, pending.length);
        pending = [];

        // Verifica quantos bytes no fim formam sequência UTF-8 incompleta
        var validEnd = totalLen;
        if (!isFinal && totalLen > 0) {
          var lookback = Math.min(4, totalLen);
          for (var k = 1; k <= lookback; k++) {
            var idx = totalLen - k;
            var b = buf[idx];
            if ((b & 0x80) === 0x00) {
              break; // ASCII completo
            }
            if ((b & 0xC0) === 0xC0) {
              // Byte inicial de sequência multibyte
              var expectedLen = (b & 0xE0) === 0xC0 ? 2 : ((b & 0xF0) === 0xE0 ? 3 : ((b & 0xF8) === 0xF0 ? 4 : 1));
              if (k < expectedLen) {
                validEnd = idx;
                for (var r = idx; r < totalLen; r++) pending.push(buf[r]);
              }
              break;
            }
          }
        }

        var slice = validEnd === totalLen ? buf : buf.subarray(0, validEnd);
        if (typeof TextDecoder !== 'undefined') {
          return new TextDecoder('utf-8').decode(slice);
        }
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength).toString('utf8');
        }
        var out = '';
        for (var i = 0; i < slice.length; i++) out += String.fromCharCode(slice[i]);
        return out;
      },
      getPendingBytes: function () {
        return pending.slice();
      },
      setPendingBytes: function (arr) {
        pending = Array.isArray(arr) ? arr.slice() : [];
      }
    };
  }

  // Converte URL bruta em referência de reprodução sem senha (Parte 6.3)
  function buildSafePlaybackRef(rawUrl, sourceId, xtreamId, kind) {
    var u = String(rawUrl || '').trim();
    if (sourceId === 'xtream' && xtreamId) {
      var extMatch = u.match(/\.([a-z0-9]{2,4})(?:$|\?)/i);
      var ext = extMatch ? extMatch[1].toLowerCase() : (kind === 'live' ? 'm3u8' : 'mp4');
      return 'xt:' + kind + ':' + xtreamId + ':' + ext;
    }
    var mTyped = u.match(XTREAM_URL_CRED_REGEX);
    if (mTyped) {
      return 'xtpath:/' + mTyped[2].toLowerCase() + '/{u}/{p}/' + mTyped[5];
    }
    var mShort = u.match(XTREAM_SHORT_CRED_REGEX);
    if (mShort) {
      return 'xtshort:/{u}/{p}/' + mShort[4];
    }
    // Mascara password= ou pass= ou token= em query string se houver
    var sanitized = u.replace(/([?&](?:password|pass)=)([^&\s#]+)/gi, '$1{p}');
    return 'url:' + sanitized;
  }

  function extractOriginFromUrl(rawUrl) {
    var m = String(rawUrl || '').match(/^(https?:\/\/[^\/?#]+)/i);
    return m ? m[1] : '';
  }

  function findTitleCommaIndex(line) {
    var inQuotes = false;
    var startPos = line.indexOf(':');
    if (startPos === -1) startPos = 0;
    var len = line.length;
    for (var i = startPos; i < len; i++) {
      var ch = line.charCodeAt(i);
      if (ch === 34) inQuotes = !inQuotes;
      else if (ch === 44 && !inQuotes) return i;
    }
    return -1;
  }

  function hasUnbalancedQuotes(line) {
    var count = 0;
    for (var i = 0; i < line.length; i++) {
      if (line.charCodeAt(i) === 34) count++;
    }
    return (count % 2) !== 0;
  }

  function parseExtInfLineFast(line) {
    var meta = {
      tvgId: '',
      tvgName: '',
      tvgLogo: '',
      tvgType: '',
      tvgRating: '',
      groupTitle: 'Sem Grupo',
      title: 'Canal',
      httpUserAgent: '',
      httpReferrer: '',
      unbalancedQuotes: hasUnbalancedQuotes(line)
    };

    var commaIdx = findTitleCommaIndex(line);
    if (commaIdx === -1 && meta.unbalancedQuotes) {
      // Se aspas estavam desbalanceadas, usa a última vírgula como separador seguro do título
      commaIdx = line.lastIndexOf(',');
    }
    if (commaIdx !== -1) {
      meta.title = line.slice(commaIdx + 1).replace(CONTROL_CHARS_REGEX, '').trim();
    }

    var attrPart = commaIdx !== -1 ? line.slice(0, commaIdx) : line;
    var match;

    QUOTED_ATTR_REGEX.lastIndex = 0;
    while ((match = QUOTED_ATTR_REGEX.exec(attrPart)) !== null) {
      applyAttr(meta, match[1].toLowerCase(), match[2].trim());
    }

    var strippedQuoted = attrPart.replace(QUOTED_ATTR_REGEX, ' ');
    UNQUOTED_ATTR_REGEX.lastIndex = 0;
    while ((match = UNQUOTED_ATTR_REGEX.exec(strippedQuoted)) !== null) {
      applyAttr(meta, match[1].toLowerCase(), match[2].trim());
    }

    if (!meta.title && meta.tvgName) {
      meta.title = meta.tvgName.replace(CONTROL_CHARS_REGEX, '').trim();
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
    else if (key === 'group-title') meta.groupTitle = val.replace(CONTROL_CHARS_REGEX, '').trim() || 'Sem Grupo';
    else if (key === 'user-agent' || key === 'http-user-agent') meta.httpUserAgent = val;
    else if (key === 'referer' || key === 'http-referrer' || key === 'http-referer') meta.httpReferrer = val;
  }

  // Codifica um item em uma linha compacta separada por TAB (zero chaves JSON repetidas em disco)
  function packTupleLine(tuple) {
    var out = '';
    for (var i = 0; i < tuple.length; i++) {
      if (i > 0) out += '\t';
      var v = tuple[i];
      if (v === null || v === undefined) continue;
      out += String(v).replace(/[\t\r\n]/g, ' ');
    }
    return out;
  }

  function unpackTupleLine(line) {
    var p = String(line || '').split('\t');
    return {
      id: p[0] || '',
      section: p[1] || 'live',
      kind: p[1] === 'series' ? (p[16] === '1' ? 'novela-show' : 'series-show') : (p[1] || 'live'),
      title: p[2] || '',
      cleanTitle: p[3] || p[2] || '',
      year: parseInt(p[4] || '2024', 10) || 2024,
      rating: parseFloat(p[5] || '8.0') || 8.0,
      groupId: p[6] || 'g_0',
      groupOriginal: p[7] || 'Sem Grupo',
      groupDisplay: p[7] || 'Sem Grupo',
      logo: p[8] || '',
      ref: p[9] || '',
      quality: p[10] || 'HD',
      lang: p[11] || 'DUB',
      adult: p[12] === '1',
      season: p[13] ? parseInt(p[13], 10) : null,
      episode: p[14] ? parseInt(p[14], 10) : null,
      channelNumber: p[15] ? parseInt(p[15], 10) : 0,
      isNovela: p[16] === '1',
      httpUserAgent: p[17] || '',
      httpReferrer: p[18] || '',
      xtreamSeriesId: p[19] || ''
    };
  }

  // Calcula chave numérica Float64 lexicográfica dos primeiros 9 caracteres para ordenação ultrarrápida sem estourar RAM
  function computeLexFloat64Key(normStr) {
    var s = String(normStr || '');
    var val = 0;
    var base = 38;
    var len = Math.min(9, s.length);
    for (var i = 0; i < 9; i++) {
      var code = 0;
      if (i < len) {
        var c = s.charCodeAt(i);
        if (c >= 48 && c <= 57) code = 2 + (c - 48); // '0'..'9' -> 2..11
        else if (c >= 97 && c <= 122) code = 12 + (c - 97); // 'a'..'z' -> 12..37
        else code = 1;
      }
      val = val * base + code;
    }
    return val;
  }

  function normalizeSearchKey(str) {
    if (global.LuminaClassifier && global.LuminaClassifier.normalizeSortAndSearchText) {
      return global.LuminaClassifier.normalizeSortAndSearchText(str);
    }
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function createStreamingImportSession(options) {
    var opts = options || {};
    var listId = String(opts.listId || 'default_list');
    var generationId = String(opts.generationId || ('gen_' + Date.now()));
    var storage = opts.storage || global.LuminaStorage;
    var classifier = opts.classifier || global.LuminaClassifier;
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var simulateCrashAtByteOffset = typeof opts.simulateCrashAtByteOffset === 'number' ? opts.simulateCrashAtByteOffset : -1;

    var utf8Decoder = createUtf8ChunkDecoder();
    var carryLine = '';
    var pendingCr = false;
    var byteOffset = 0;
    var isFirstChunk = true;
    var currentMeta = null;
    var stickyHeaders = { userAgent: '', referrer: '' };
    var detectedOrigin = '';

    var stats = {
      totalEntries: 0,
      live: 0,
      movie: 0,
      series: 0,
      episodes: 0,
      ignoredLines: 0,
      duplicateUrls: 0,
      duplicateTvgIds: 0,
      unbalancedQuotesFixed: 0
    };

    // Mapas compactos por seção ('live', 'movie', 'series')
    var sections = {
      live: createSectionAccumulator('live'),
      movie: createSectionAccumulator('movie'),
      series: createSectionAccumulator('series')
    };

    // Mapa compacto de séries em fluxo: seriesKey -> { groupIdx, pageIdx, slotIdx, showTuple, episodesLines: [] }
    var seriesShowMap = {};
    var episodeBuffersBySeriesKey = {};
    var seriesHasPriorFlush = {};
    var pendingEpisodeFlushCount = 0;

    // Conjunto leve de hashes de URL e tvg-id para contar duplicadas sem guardar strings gigantes
    var seenUrlHashes = {};
    var seenTvgIds = {};

    // Fila de páginas prontas aguardando flush em lotes de 8 (Parte 6.4)
    var pendingPageRecords = [];
    var searchRunPostings = { live: {}, movie: {}, series: {} };
    var searchRunCount = { live: 0, movie: 0, series: 0 };
    var currentPostingsCount = 0;
    var lastCheckpointBytes = 0;
    var lastCheckpointTime = Date.now();

    function createSectionAccumulator(secName) {
      return {
        name: secName,
        groupsByName: {},
        groupsList: [],
        pageBuffersByGroupIdx: {},
        pageCountsByGroupIdx: {},
        recentTuples: [],
        sortCount: 0,
        sortKeys: new Float64Array(4096),
        sortNorms: [],
        sortLocators: new Uint32Array(4096)
      };
    }

    function pushSortEntry(secAcc, floatKey, locator, norm) {
      var idx = secAcc.sortCount;
      if (idx >= secAcc.sortKeys.length) {
        var nextCap = secAcc.sortKeys.length * 2;
        var nextKeys = new Float64Array(nextCap);
        nextKeys.set(secAcc.sortKeys);
        secAcc.sortKeys = nextKeys;
        var nextLocs = new Uint32Array(nextCap);
        nextLocs.set(secAcc.sortLocators);
        secAcc.sortLocators = nextLocs;
      }
      secAcc.sortKeys[idx] = floatKey;
      secAcc.sortLocators[idx] = locator;
      secAcc.sortCount = idx + 1;
      if (idx < 35000 && norm !== null) {
        secAcc.sortNorms.push(norm);
      } else if (idx === 35000) {
        secAcc.sortNorms = [];
      }
    }

    function getOrCreateGroup(secAcc, groupOriginal, isAdult, suggested) {
      var gMap = secAcc.groupsByName;
      var existing = gMap[groupOriginal];
      if (existing) {
        if (isAdult) existing.adult = true;
        return existing;
      }
      var gIdx = secAcc.groupsList.length;
      var gId = 'g_' + secAcc.name + '_' + gIdx;
      var grp = {
        id: gId,
        index: gIdx,
        originalName: groupOriginal,
        displayName: groupOriginal,
        count: 0,
        order: gIdx,
        adult: !!isAdult,
        suggestedSection: suggested || secAcc.name
      };
      gMap[groupOriginal] = grp;
      secAcc.groupsList.push(grp);
      secAcc.pageBuffersByGroupIdx[gIdx] = [];
      secAcc.pageCountsByGroupIdx[gIdx] = 0;
      return grp;
    }

    function indexItemForSearchAndSort(secAcc, cleanTitle, locator) {
      var norm = normalizeSearchKey(cleanTitle);
      var floatKey = computeLexFloat64Key(norm);
      pushSortEntry(secAcc, floatKey, locator, norm);

      if (!norm) return;
      var secBuckets = searchRunPostings[secAcc.name];
      var firstCh = norm.charAt(0);
      var oneCharKey = '^' + firstCh;
      if (!secBuckets[oneCharKey]) secBuckets[oneCharKey] = [];
      secBuckets[oneCharKey].push(locator);
      currentPostingsCount++;

      var words = norm.split(' ');
      var seenPrefixes = {};
      for (var w = 0; w < words.length && w < 6; w++) {
        var word = words[w];
        if (word.length >= 2) {
          var pref2 = word.slice(0, 2);
          if (!seenPrefixes[pref2]) {
            seenPrefixes[pref2] = true;
            if (!secBuckets[pref2]) secBuckets[pref2] = [];
            secBuckets[pref2].push(locator);
            currentPostingsCount++;
          }
        }
      }
    }

    function enqueueCompletedPage(secName, gIdx, pageIdx, linesArr) {
      var payloadStr = linesArr.join('\n');
      var key = listId + ':' + generationId + ':' + secName + ':g_' + secName + '_' + gIdx + ':' + pageIdx;
      pendingPageRecords.push({
        key: key,
        listId: listId,
        generationId: generationId,
        section: secName,
        groupId: 'g_' + secName + '_' + gIdx,
        pageIndex: pageIdx,
        count: linesArr.length,
        checksum: storage.computeStringChecksum(payloadStr),
        payloadStr: payloadStr
      });
    }

    function addClassifiedItem(classified) {
      if (!classified || classified.kind === 'hidden') return;
      if (!detectedOrigin && classified.url) {
        detectedOrigin = extractOriginFromUrl(classified.url);
      }

      // Contabiliza URLs e tvg-ids duplicados sem descartar (Parte 4.5)
      if (classified.url) {
        var uHash = classifier.stableHash(classified.url);
        if (seenUrlHashes[uHash]) stats.duplicateUrls++;
        else if (stats.totalEntries < 150000) seenUrlHashes[uHash] = 1;
      }
      if (classified.tvgId) {
        if (seenTvgIds[classified.tvgId]) stats.duplicateTvgIds++;
        else if (stats.totalEntries < 150000) seenTvgIds[classified.tvgId] = 1;
      }

      var rawKind = classified.kind;
      if (rawKind === 'unclassified') {
        // Em listas M3U, itens sem grupo claro caem em Canais por padrão se forem .ts/.m3u8 ou Filmes se forem .mp4/.mkv
        rawKind = /\.(mp4|mkv|avi)($|\?)/i.test(classified.url || '') ? 'movie' : 'live';
      }

      // Caso Episódio de Série / Novela: agrupa em fluxo por seriesKey! (Parte 4.2)
      if (rawKind === 'episode' || rawKind === 'series' || rawKind === 'series-show' || rawKind === 'novela-show') {
        var secSer = sections.series;
        var grpSer = getOrCreateGroup(secSer, classified.groupOriginal || 'Séries', classified.adult, 'series');
        var serKey = classified.seriesKey || classified.id;
        var epRef = buildSafePlaybackRef(classified.url, classified.sourceId, classified.xtreamId, 'series');

        if (rawKind === 'episode' || rawKind === 'series') {
          stats.episodes++;
          var epLine = packTupleLine([
            classified.id,
            'episode',
            classified.title,
            classified.cleanTitle,
            classified.year || 2024,
            classified.rating || 8.0,
            grpSer.id,
            grpSer.originalName,
            classified.logo || '',
            epRef,
            classified.quality || 'HD',
            classified.lang || 'DUB',
            classified.adult ? 1 : 0,
            classified.season || 1,
            classified.episode || 1,
            0,
            classified.isNovela ? 1 : 0,
            classified.httpUserAgent || '',
            classified.httpReferrer || '',
            classified.xtreamSeriesId || ''
          ]);
          if (!episodeBuffersBySeriesKey[serKey]) episodeBuffersBySeriesKey[serKey] = [];
          episodeBuffersBySeriesKey[serKey].push(epLine);
          pendingEpisodeFlushCount++;
        }

        if (!seriesShowMap[serKey]) {
          stats.series++;
          stats.totalEntries++;
          grpSer.count++;
          var gIdxS = grpSer.index;
          var pBufS = secSer.pageBuffersByGroupIdx[gIdxS];
          var pIdxS = secSer.pageCountsByGroupIdx[gIdxS];
          var slotIdxS = pBufS.length;
          var showTitle = classified.seriesTitle || classified.cleanTitle;

          var showTuple = [
            serKey,
            'series',
            showTitle,
            showTitle,
            classified.year || 2024,
            classified.rating || 8.5,
            grpSer.id,
            grpSer.originalName,
            classified.logo || '',
            epRef,
            classified.quality || 'FHD',
            classified.lang || 'DUB',
            classified.adult ? 1 : 0,
            1,
            1,
            0,
            classified.isNovela ? 1 : 0,
            classified.httpUserAgent || '',
            classified.httpReferrer || '',
            classified.xtreamSeriesId || ''
          ];

          var showLine = packTupleLine(showTuple);
          pBufS.push(showLine);
          var locatorS = ((gIdxS & 0xFFF) << 20) | ((pIdxS & 0xFFF) << 8) | (slotIdxS & 0xFF);
          indexItemForSearchAndSort(secSer, showTitle, locatorS);

          if (secSer.recentTuples.length >= MAX_RECENT_PER_SECTION) secSer.recentTuples.shift();
          secSer.recentTuples.push(showLine);

          seriesShowMap[serKey] = 1;

          if (pBufS.length >= PAGE_SIZE) {
            enqueueCompletedPage('series', gIdxS, pIdxS, pBufS);
            secSer.pageBuffersByGroupIdx[gIdxS] = [];
            secSer.pageCountsByGroupIdx[gIdxS] = pIdxS + 1;
          }
        }
        return;
      }

      // Caso Canal Ao Vivo ('live') ou Filme ('movie')
      var targetSecName = rawKind === 'movie' ? 'movie' : 'live';
      var sec = sections[targetSecName];
      var grp = getOrCreateGroup(sec, classified.groupOriginal || (targetSecName === 'live' ? 'Canais' : 'Filmes'), classified.adult, targetSecName);
      grp.count++;
      stats[targetSecName]++;
      stats.totalEntries++;

      var gIdx = grp.index;
      var pBuf = sec.pageBuffersByGroupIdx[gIdx];
      var pIdx = sec.pageCountsByGroupIdx[gIdx];
      var slotIdx = pBuf.length;
      var chNum = targetSecName === 'live' ? grp.count : 0;
      var ref = buildSafePlaybackRef(classified.url, classified.sourceId, classified.xtreamId, targetSecName);

      var tuple = [
        classified.id,
        targetSecName,
        classified.title,
        classified.cleanTitle,
        classified.year || 2024,
        classified.rating || 8.0,
        grp.id,
        grp.originalName,
        classified.logo || '',
        ref,
        classified.quality || 'HD',
        classified.lang || 'DUB',
        classified.adult ? 1 : 0,
        null,
        null,
        chNum,
        0,
        classified.httpUserAgent || '',
        classified.httpReferrer || '',
        ''
      ];

      var packedLine = packTupleLine(tuple);
      pBuf.push(packedLine);

      var locator = ((gIdx & 0xFFF) << 20) | ((pIdx & 0xFFF) << 8) | (slotIdx & 0xFF);
      indexItemForSearchAndSort(sec, classified.cleanTitle, locator);

      if (sec.recentTuples.length >= MAX_RECENT_PER_SECTION) sec.recentTuples.shift();
      sec.recentTuples.push(packedLine);

      if (pBuf.length >= PAGE_SIZE) {
        enqueueCompletedPage(targetSecName, gIdx, pIdx, pBuf);
        sec.pageBuffersByGroupIdx[gIdx] = [];
        sec.pageCountsByGroupIdx[gIdx] = pIdx + 1;
      }
    }

    function processSingleLine(rawLine) {
      if (!rawLine) return;
      if (rawLine.length > MAX_LINE_BYTES) {
        stats.ignoredLines++;
        currentMeta = null;
        return;
      }
      var line = rawLine.trim();
      if (!line) return;

      if (line.charCodeAt(0) === 35) { // '#'
        if (line.indexOf('#EXTINF:') === 0) {
          // Se havia um #EXTINF anterior sem URL antes deste, conta como linha ignorada (Parte 4.5)
          if (currentMeta !== null) {
            stats.ignoredLines++;
          }
          var parsed = parseExtInfLineFast(line);
          if (parsed.unbalancedQuotes) stats.unbalancedQuotesFixed++;
          if (stickyHeaders.userAgent && !parsed.httpUserAgent) parsed.httpUserAgent = stickyHeaders.userAgent;
          if (stickyHeaders.referrer && !parsed.httpReferrer) parsed.httpReferrer = stickyHeaders.referrer;
          currentMeta = parsed;
        } else if (line.indexOf('#EXTGRP:') === 0) {
          var grp = line.slice(8).replace(CONTROL_CHARS_REGEX, '').trim();
          if (grp && currentMeta && (!currentMeta.groupTitle || currentMeta.groupTitle === 'Sem Grupo')) {
            currentMeta.groupTitle = grp;
          }
        } else if (line.indexOf('#EXTVLCOPT:') === 0) {
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
        }
        return;
      }

      // Linha de URL
      if (!currentMeta) {
        // URL órfã sem #EXTINF anterior (Parte 4.5)
        stats.ignoredLines++;
        return;
      }

      if (!/^https?:\/\/|^[a-z0-9]+:\/\//i.test(line) && line.indexOf('/') === -1) {
        stats.ignoredLines++;
        currentMeta = null;
        return;
      }

      currentMeta.url = line;
      currentMeta.sourceId = 'm3u';
      if (!currentMeta.title || !currentMeta.title.trim()) {
        currentMeta.title = 'Item ' + (stats.totalEntries + 1);
      }

      var classified = classifier.classifyEntry(currentMeta);
      currentMeta = null;
      stickyHeaders.userAgent = '';
      stickyHeaders.referrer = '';
      addClassifiedItem(classified);
    }

    function processByteOrTextSlice(chunk, chunkByteLen, isLastChunk, cb) {
      var text = utf8Decoder.decodeChunk(chunk, isLastChunk);
      if (isFirstChunk) {
        isFirstChunk = false;
        if (text.charCodeAt(0) === 0xFEFF) {
          text = text.slice(1);
        }
      }

      if (pendingCr) {
        pendingCr = false;
        if (text.length > 0 && text.charCodeAt(0) === 10) {
          text = text.slice(1);
        }
        processSingleLine(carryLine);
        carryLine = '';
      }

      var combined = carryLine ? (carryLine + text) : text;
      carryLine = '';

      var len = combined.length;
      var pos = 0;
      while (pos < len) {
        var nlIdx = combined.indexOf('\n', pos);
        var crIdx = combined.indexOf('\r', pos);

        if (nlIdx === -1 && crIdx === -1) {
          carryLine = combined.slice(pos);
          if (carryLine.length > MAX_LINE_BYTES) {
            stats.ignoredLines++;
            carryLine = '';
          }
          break;
        }

        // Trata tanto \r\n quanto \n quanto \r isolado mesmo cortado exatamente na fronteira de chunk!
        if (crIdx !== -1 && (nlIdx === -1 || crIdx < nlIdx)) {
          var linePart = combined.slice(pos, crIdx);
          if (crIdx + 1 === len && !isLastChunk) {
            carryLine = linePart;
            pendingCr = true;
            break;
          }
          processSingleLine(linePart);
          if (crIdx + 1 < len && combined.charCodeAt(crIdx + 1) === 10) {
            pos = crIdx + 2;
          } else {
            pos = crIdx + 1;
          }
        } else {
          var linePart2 = combined.slice(pos, nlIdx);
          if (linePart2.length > 0 && linePart2.charCodeAt(linePart2.length - 1) === 13) {
            linePart2 = linePart2.slice(0, -1);
          }
          processSingleLine(linePart2);
          pos = nlIdx + 1;
        }
      }

      if (isLastChunk) {
        if (carryLine) {
          processSingleLine(carryLine);
          carryLine = '';
        }
        if (currentMeta !== null) {
          // #EXTINF pendente no fim do arquivo sem URL
          stats.ignoredLines++;
          currentMeta = null;
        }
      }

      byteOffset += chunkByteLen;

      if (simulateCrashAtByteOffset > 0 && byteOffset >= simulateCrashAtByteOffset) {
        var crashErr = new Error('SIMULATED_WORKER_CRASH');
        crashErr.code = 'SIMULATED_WORKER_CRASH';
        return cb(crashErr);
      }

      flushPendingBatchesAndCheckpointIfNeeded(isLastChunk, cb);
    }

    function flushPageRecordsInBatchesOf8(doneCb) {
      if (!pendingPageRecords.length) return doneCb(null);
      var batch = pendingPageRecords.splice(0, 8);
      storage.putRecordsBatch('pages', batch, function (err) {
        if (err) return doneCb(err);
        if (pendingPageRecords.length > 0) {
          setTimeout(function () { flushPageRecordsInBatchesOf8(doneCb); }, 0);
        } else {
          doneCb(null);
        }
      });
    }

    function flushSearchRunsIfNeeded(forceFlush, doneCb) {
      if (!forceFlush && currentPostingsCount < MAX_POSTINGS_PER_RUN) {
        return doneCb(null);
      }
      var records = [];
      var secNames = ['live', 'movie', 'series'];
      for (var s = 0; s < secNames.length; s++) {
        var secName = secNames[s];
        var buckets = searchRunPostings[secName];
        var bKeys = Object.keys(buckets);
        if (!bKeys.length) continue;
        var runIdx = searchRunCount[secName]++;
        for (var k = 0; k < bKeys.length; k++) {
          var bk = bKeys[k];
          var arr = buckets[bk];
          if (!arr || !arr.length) continue;
          records.push({
            key: listId + ':' + generationId + ':' + secName + ':run:' + runIdx + ':' + bk,
            listId: listId,
            generationId: generationId,
            section: secName,
            bucket: bk,
            postings: new Uint32Array(arr)
          });
        }
        searchRunPostings[secName] = {};
      }
      currentPostingsCount = 0;
      if (!records.length) return doneCb(null);
      storage.putRecordsBatch('searchIndex', records, doneCb);
    }

    function flushEpisodesIfNeeded(forceFlush, doneCb) {
      if (!forceFlush && pendingEpisodeFlushCount < 25000) {
        return doneCb(null);
      }
      var sKeys = Object.keys(episodeBuffersBySeriesKey);
      if (!sKeys.length) return doneCb(null);
      var idx = 0;

      function nextSeriesBatch() {
        if (idx >= sKeys.length) {
          episodeBuffersBySeriesKey = {};
          pendingEpisodeFlushCount = 0;
          return doneCb(null);
        }
        var end = Math.min(idx + 250, sKeys.length);
        var batchRecords = [];
        var pos = idx;
        idx = end;

        function collectNext() {
          while (pos < end) {
            var sk = sKeys[pos++];
            var newLines = episodeBuffersBySeriesKey[sk] || [];
            var recKey = listId + ':' + generationId + ':series:' + sk;
            var newChunkStr = newLines.join('\n');
            if (!seriesHasPriorFlush[sk]) {
              seriesHasPriorFlush[sk] = 1;
              batchRecords.push({
                key: recKey,
                listId: listId,
                generationId: generationId,
                seriesId: sk,
                payloadStr: newChunkStr
              });
            } else {
              // Se esta série já teve flush anterior em lista gigante, concatena com o registro salvo
              return storage.getRecord('episodes', recKey, function (_, existing) {
                var combinedStr = (existing && existing.payloadStr)
                  ? (existing.payloadStr + '\n' + newChunkStr)
                  : newChunkStr;
                batchRecords.push({
                  key: recKey,
                  listId: listId,
                  generationId: generationId,
                  seriesId: sk,
                  payloadStr: combinedStr
                });
                collectNext();
              });
            }
          }
          storage.putRecordsBatch('episodes', batchRecords, function (putErr) {
            if (putErr) return doneCb(putErr);
            setTimeout(nextSeriesBatch, 0);
          });
        }
        collectNext();
      }
      nextSeriesBatch();
    }

    function saveCheckpointSnapshot(doneCb, lightweight) {
      var cpGroups = {};
      var secNames = ['live', 'movie', 'series'];
      for (var s = 0; s < secNames.length; s++) {
        var sn = secNames[s];
        var acc = sections[sn];
        cpGroups[sn] = {
          groupsList: acc.groupsList,
          pageBuffersByGroupIdx: acc.pageBuffersByGroupIdx,
          pageCountsByGroupIdx: acc.pageCountsByGroupIdx,
          recentTuples: acc.recentTuples,
          sortCount: acc.sortCount,
          sortKeys: lightweight ? null : new Float64Array(acc.sortKeys.subarray(0, acc.sortCount)),
          sortNorms: lightweight ? [] : acc.sortNorms.slice(),
          sortLocators: lightweight ? null : new Uint32Array(acc.sortLocators.subarray(0, acc.sortCount))
        };
      }

      var cpRecord = {
        key: listId,
        listId: listId,
        generationId: generationId,
        byteOffset: byteOffset,
        carryLine: carryLine,
        pendingCr: pendingCr,
        utf8Pending: utf8Decoder.getPendingBytes(),
        isFirstChunk: isFirstChunk,
        currentMeta: currentMeta,
        stickyHeaders: stickyHeaders,
        detectedOrigin: detectedOrigin,
        stats: {
          totalEntries: stats.totalEntries,
          live: stats.live,
          movie: stats.movie,
          series: stats.series,
          episodes: stats.episodes,
          ignoredLines: stats.ignoredLines,
          duplicateUrls: stats.duplicateUrls,
          duplicateTvgIds: stats.duplicateTvgIds,
          unbalancedQuotesFixed: stats.unbalancedQuotesFixed
        },
        sectionsState: cpGroups,
        seriesShowMap: lightweight ? null : (Object.assign ? Object.assign({}, seriesShowMap) : seriesShowMap),
        searchRunCount: { live: searchRunCount.live, movie: searchRunCount.movie, series: searchRunCount.series },
        updatedAt: Date.now()
      };

      storage.putRecord('checkpoints', cpRecord, doneCb);
    }

    function restoreFromCheckpoint(cpRecord) {
      if (!cpRecord) return false;
      generationId = cpRecord.generationId || generationId;
      byteOffset = Number(cpRecord.byteOffset || 0);
      carryLine = String(cpRecord.carryLine || '');
      pendingCr = !!cpRecord.pendingCr;
      utf8Decoder.setPendingBytes(cpRecord.utf8Pending || []);
      isFirstChunk = !!cpRecord.isFirstChunk;
      currentMeta = cpRecord.currentMeta || null;
      stickyHeaders = cpRecord.stickyHeaders || { userAgent: '', referrer: '' };
      detectedOrigin = cpRecord.detectedOrigin || '';
      stats = JSON.parse(JSON.stringify(cpRecord.stats || stats));
      seriesShowMap = Object.assign ? Object.assign({}, cpRecord.seriesShowMap || {}) : (cpRecord.seriesShowMap || {});
      searchRunCount = JSON.parse(JSON.stringify(cpRecord.searchRunCount || { live: 0, movie: 0, series: 0 }));

      var secNames = ['live', 'movie', 'series'];
      for (var s = 0; s < secNames.length; s++) {
        var sn = secNames[s];
        var savedSec = cpRecord.sectionsState && cpRecord.sectionsState[sn];
        if (!savedSec) continue;
        var acc = sections[sn];
        acc.groupsList = JSON.parse(JSON.stringify(savedSec.groupsList || []));
        acc.groupsByName = {};
        for (var g = 0; g < acc.groupsList.length; g++) {
          acc.groupsByName[acc.groupsList[g].originalName] = acc.groupsList[g];
        }
        acc.pageBuffersByGroupIdx = JSON.parse(JSON.stringify(savedSec.pageBuffersByGroupIdx || {}));
        acc.pageCountsByGroupIdx = JSON.parse(JSON.stringify(savedSec.pageCountsByGroupIdx || {}));
        acc.recentTuples = (savedSec.recentTuples || []).slice();
        var sc = typeof savedSec.sortCount === "number" ? savedSec.sortCount : (savedSec.sortLocators ? savedSec.sortLocators.length : 0);
        acc.sortCount = sc;
        var cap = Math.max(4096, sc);
        acc.sortKeys = new Float64Array(cap);
        if (savedSec.sortKeys) acc.sortKeys.set(savedSec.sortKeys.subarray ? savedSec.sortKeys.subarray(0, sc) : savedSec.sortKeys);
        acc.sortLocators = new Uint32Array(cap);
        if (savedSec.sortLocators) acc.sortLocators.set(savedSec.sortLocators.subarray ? savedSec.sortLocators.subarray(0, sc) : savedSec.sortLocators);
        acc.sortNorms = (savedSec.sortNorms || []).slice();
      }
      lastCheckpointBytes = byteOffset;
      lastCheckpointTime = Date.now();
      return true;
    }

    function flushPendingBatchesAndCheckpointIfNeeded(isLastChunk, cb) {
      var now = Date.now();
      var needCheckpoint = !isLastChunk &&
        ((byteOffset - lastCheckpointBytes) >= CHECKPOINT_BYTES_INTERVAL ||
         (now - lastCheckpointTime) >= CHECKPOINT_TIME_INTERVAL_MS);

      flushPageRecordsInBatchesOf8(function (pageErr) {
        if (pageErr) return cb(pageErr);
        flushEpisodesIfNeeded(needCheckpoint || isLastChunk, function (epErr) {
          if (epErr) return cb(epErr);
          flushSearchRunsIfNeeded(needCheckpoint || isLastChunk, function (srErr) {
            if (srErr) return cb(srErr);
            if (needCheckpoint) {
              lastCheckpointBytes = byteOffset;
              lastCheckpointTime = Date.now();
              saveCheckpointSnapshot(cb, true);
            } else {
              cb(null);
            }
          });
        });
      });
    }

    function buildAzOrdersForSection(secAcc, doneCb) {
      var total = secAcc.sortCount;
      if (total === 0) return doneCb(null);

      var indices = new Uint32Array(total);
      for (var i = 0; i < total; i++) indices[i] = i;

      var keys = secAcc.sortKeys;
      var norms = secAcc.sortNorms;
      var locs = secAcc.sortLocators;
      var hasFullNorms = (norms.length === total);

      Array.prototype.sort.call(indices, function (a, b) {
        var ka = keys[a];
        var kb = keys[b];
        if (ka < kb) return -1;
        if (ka > kb) return 1;
        if (hasFullNorms) {
          var na = norms[a];
          var nb = norms[b];
          if (na < nb) return -1;
          if (na > nb) return 1;
        }
        return locs[a] - locs[b];
      });

      var globalAzLocators = new Uint32Array(total);
      var letterJumpGlobal = {};
      var byGroupAz = {};
      var byGroupLetterJump = {};

      var BASE9_POW8 = Math.pow(38, 8);

      for (var j = 0; j < total; j++) {
        var origIdx = indices[j];
        var loc = locs[origIdx];
        globalAzLocators[j] = loc;

        var gIdx = (loc >>> 20) & 0xFFF;
        if (!byGroupAz[gIdx]) {
          byGroupAz[gIdx] = [];
          byGroupLetterJump[gIdx] = {};
        }
        var gPos = byGroupAz[gIdx].length;
        byGroupAz[gIdx].push(loc);

        // Determina a letra inicial ('A'..'Z' ou '#') a partir do primeiro dígito base-38 de ka
        var topDigit = Math.floor(keys[origIdx] / BASE9_POW8) % 38;
        var letter = '#';
        if (topDigit >= 12 && topDigit <= 37) {
          letter = String.fromCharCode(65 + (topDigit - 12));
        }
        if (letterJumpGlobal[letter] === undefined) {
          letterJumpGlobal[letter] = j;
        }
        if (byGroupLetterJump[gIdx][letter] === undefined) {
          byGroupLetterJump[gIdx][letter] = gPos;
        }
      }

      // Libera arrays temporários de ordenação da memória
      secAcc.sortCount = 0;
      secAcc.sortKeys = new Float64Array(0);
      secAcc.sortNorms = [];
      secAcc.sortLocators = new Uint32Array(0);

      var orderRecords = [
        {
          key: listId + ':' + generationId + ':' + secAcc.name + ':all:az',
          listId: listId,
          generationId: generationId,
          section: secAcc.name,
          groupId: 'all',
          locators: globalAzLocators,
          letterJump: letterJumpGlobal
        }
      ];

      var gIndices = Object.keys(byGroupAz);
      for (var k = 0; k < gIndices.length; k++) {
        var gi = gIndices[k];
        var gId = 'g_' + secAcc.name + '_' + gi;
        orderRecords.push({
          key: listId + ':' + generationId + ':' + secAcc.name + ':' + gId + ':az',
          listId: listId,
          generationId: generationId,
          section: secAcc.name,
          groupId: gId,
          locators: new Uint32Array(byGroupAz[gi]),
          letterJump: byGroupLetterJump[gi]
        });
      }

      storage.putRecordsBatch('orders', orderRecords, doneCb);
    }

    function finalizeImport(cb) {
      // 1. Enfileira páginas finais incompletas (< 200 itens) de cada grupo
      var secNames = ['live', 'movie', 'series'];
      for (var s = 0; s < secNames.length; s++) {
        var sn = secNames[s];
        var acc = sections[sn];
        for (var g = 0; g < acc.groupsList.length; g++) {
          var remBuf = acc.pageBuffersByGroupIdx[g];
          if (remBuf && remBuf.length > 0) {
            var pIdx = acc.pageCountsByGroupIdx[g];
            enqueueCompletedPage(sn, g, pIdx, remBuf);
            acc.pageBuffersByGroupIdx[g] = [];
            acc.pageCountsByGroupIdx[g] = pIdx + 1;
          }
          acc.groupsList[g].totalPages = acc.pageCountsByGroupIdx[g];
        }
      }

      flushPageRecordsInBatchesOf8(function (pErr) {
        if (pErr) return cb(pErr);
        flushEpisodesIfNeeded(true, function (eErr) {
          if (eErr) return cb(eErr);
          flushSearchRunsIfNeeded(true, function (sErr) {
            if (sErr) return cb(sErr);

            // 2. Grava índice de grupos e recentes de cada seção
            var groupRecords = [];
            for (var i = 0; i < secNames.length; i++) {
              var secN = secNames[i];
              var secA = sections[secN];
              groupRecords.push({
                key: listId + ':' + generationId + ':' + secN,
                listId: listId,
                generationId: generationId,
                section: secN,
                totalItems: stats[secN],
                groups: secA.groupsList,
                recentPayloadStr: secA.recentTuples.slice().reverse().join('\n'),
                searchRunsCount: searchRunCount[secN],
                updatedAt: Date.now()
              });
            }

            storage.putRecordsBatch('groups', groupRecords, function (gErr) {
              if (gErr) return cb(gErr);

              // 3. Constrói e grava ordenação A–Z + tabela de salto por letra para cada seção
              buildAzOrdersForSection(sections.live, function (oErr1) {
                if (oErr1) return cb(oErr1);
                buildAzOrdersForSection(sections.movie, function (oErr2) {
                  if (oErr2) return cb(oErr2);
                  buildAzOrdersForSection(sections.series, function (oErr3) {
                    if (oErr3) return cb(oErr3);

                    var hugeWarning = stats.totalEntries > 1000000
                      ? ('Lista enorme: ' + stats.totalEntries + ' itens. Pode ficar mais lenta.')
                      : '';

                    var listMeta = {
                      listId: listId,
                      generationId: generationId,
                      origin: detectedOrigin,
                      stats: stats,
                      hugeListWarning: hugeWarning,
                      sections: {
                        live: { status: 'ready', count: stats.live, groupsCount: sections.live.groupsList.length, searchRuns: searchRunCount.live, updatedAt: Date.now() },
                        movie: { status: 'ready', count: stats.movie, groupsCount: sections.movie.groupsList.length, searchRuns: searchRunCount.movie, updatedAt: Date.now() },
                        series: { status: 'ready', count: stats.series, groupsCount: sections.series.groupsList.length, searchRuns: searchRunCount.series, updatedAt: Date.now() }
                      },
                      updatedAt: Date.now()
                    };

                    // 4. Comita atomicamente a nova geração da lista e apaga o checkpoint
                    storage.saveMeta('catalogState_' + listId, listMeta, function (mErr) {
                      if (mErr) return cb(mErr);
                      storage.deleteRecord('checkpoints', listId, function () {
                        if (global.LuminaDiagLog && stats.ignoredLines > 0) {
                          global.LuminaDiagLog.record('list-load', {
                            engine: 'ImportWorker',
                            code: 'IGNORED_LINES',
                            message: stats.ignoredLines + ' linhas ignoradas durante importação (' + stats.duplicateUrls + ' URLs duplicadas mantidas).'
                          });
                        }
                        cb(null, listMeta);
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    }

    return {
      processByteOrTextSlice: processByteOrTextSlice,
      finalizeImport: finalizeImport,
      restoreFromCheckpoint: restoreFromCheckpoint,
      saveCheckpointSnapshot: saveCheckpointSnapshot,
      getByteOffset: function () { return byteOffset; },
      getStats: function () { return stats; },
      getGenerationId: function () { return generationId; }
    };
  }

  var api = {
    PAGE_SIZE: PAGE_SIZE,
    MAX_LINE_BYTES: MAX_LINE_BYTES,
    MAX_POSTINGS_PER_RUN: MAX_POSTINGS_PER_RUN,
    CHECKPOINT_BYTES_INTERVAL: CHECKPOINT_BYTES_INTERVAL,
    createUtf8ChunkDecoder: createUtf8ChunkDecoder,
    buildSafePlaybackRef: buildSafePlaybackRef,
    packTupleLine: packTupleLine,
    unpackTupleLine: unpackTupleLine,
    computeLexFloat64Key: computeLexFloat64Key,
    normalizeSearchKey: normalizeSearchKey,
    createStreamingImportSession: createStreamingImportSession
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaImportWorker = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : global));
