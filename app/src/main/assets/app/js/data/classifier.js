(function (global) {
  'use strict';

  var CLASSIFIER_VERSION = '2.2.0';

  var COMBINED_NOISE_REGEX = /(?:\[(?:4K|UHD|FHD|HD|SD|HEVC|H265|H\.265|HDR|10BIT|LEG|DUB|DUBLADO|LEGENDADO|DUAL)\]|\((?:Dublado|Legendado|Dual|4K|FHD|HD)\)|^(?:\|?[A-Z]{2}\|?\s*[-:|]\s*)|\b(?:FHD|UHD|4K|HEVC|H\.265|1080p|720p)\b)/gi;
  var STRONG_EPISODE_REGEX = /(?:^|[\s\-_|(\[])(?:S(\d{1,2})\s*E(\d{1,4})|(\d{1,2})x(\d{2,4})|T(\d{1,2})\s*E(\d{1,4})|Temporada\s*(\d{1,2})\s*Epis[oó]dio\s*(\d{1,4}))(?=$|[\s\-_|)\].])/i;
  var CAP_EP_REGEX = /(?:^|[\s\-–:|])(?:(Cap(?:[ií]tulo|\.)?)|(Ep(?:is[oó]dio|\.)?))\s*(\d{1,4})(?=$|[\s\-–:|)\]])/i;
  var PLAUSIBLE_EP_HINT = /(?:[sStT]\d{1,2}\s*[eE]\d|\d{1,2}x\d{2}|temporada\s*\d|cap(?:[ií]tulo|\.)?\s*\d|ep(?:is[oó]dio|\.)?\s*\d)/i;
  var YEAR_REGEX = /\((19\d{2}|20\d{2})\)/;
  var LIVE_24H_REGEX = /(?:\b24\s*h(?:oras|rs)?\b|\bmaratona\s*24h\b|\bao\s*vivo\b|\blive\s*tv\b)/i;
  var ADULT_GROUP_REGEX = /(?:adulto|\+18|18\+|xxx|er[oó]tico|priv[eé]|sexo|hot\b)/;
  var ADULT_TITLE_REGEX = /(?:adulto|\+18|18\+|\bxxx\b)/i;
  var LIVE_GROUP_WORDS_REGEX = /\b(?:canais|canal|abertos?|fechados?|esportes?|premiere|combate|dazn|paramount|not[ií]cias?|jornalismo|telejornal|pay-per-view|ppv|uhd\s*tv|fhd\s*tv|tv\s*ao\s*vivo|variedades|religiosos?)\b/;
  var NOVELA_GROUP_WORDS_REGEX = /\b(?:novelas?|vale a pena|folhetins?|teledramaturgia)\b/;
  var SERIES_GROUP_WORDS_REGEX = /\b(?:s[eé]ries?|temporadas?|animes?|doramas?|sitcoms?|miniss[eé]ries?|sezon|seasons?|tv\s*shows?)\b/;
  var MOVIE_GROUP_WORDS_REGEX = /\b(?:filmes?|cinema|vod|lan[cç]amentos?|colet[aâ]neas?|marvel|dc\s*comics|oscar|movies?|cine\b|terror|com[eé]dia|a[cç][aã]o|suspense|drama|fic[cç][aã]o|anima[cç][aã]o)\b/;
  var VOD_EXT_REGEX = /\.(mp4|mkv|avi)(\?|$)/i;
  var LEG_REGEX = /legendado|\bleg\b/i;
  var MULTISPACE_REGEX = /\s{2,}/g;
  var TRIM_PUNCT_REGEX = /^[-:|\s]+|[-:|\s]+$/g;
  var TRAIL_EP_PUNCT_REGEX = /[-–:|\s]+$/g;
  var TYPED_XTREAM_PATH_REGEX = /^\/(live|movie|series)\/[^\/]+\/[^\/]+\/(.+)$/i;
  var SHORT_XTREAM_PATH_REGEX = /^\/[^\/]+\/[^\/]+\/(\d+(?:\.[a-z0-9]+)?)$/i;

  var groupDecisionCache = {};

  function stableHash(str) {
    var h = 2166136261;
    var s = String(str || '');
    var len = s.length;
    for (var i = 0; i < len; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return 'itm_' + (h >>> 0).toString(16);
  }

  function stableHash53(str) {
    var s = String(str || '');
    var len = s.length;
    var h1 = 0x811c9dc5;
    var h2 = 0x15051505;
    for (var i = 0; i < len; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c;
      h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
      h2 = (((h2 << 5) + h2) ^ (c * 0x9e3779b1)) >>> 0;
    }
    var hex1 = (h1 >>> 0).toString(16);
    var hex2 = (h2 >>> 0).toString(16);
    if (hex1.length < 8) hex1 = ('00000000' + hex1).slice(-8);
    if (hex2.length < 8) hex2 = ('00000000' + hex2).slice(-8);
    return hex1 + hex2;
  }

  function normalizeUrlPathForId(rawUrl) {
    var u = String(rawUrl || '').trim();
    if (!u) return '';
    var protoIdx = u.indexOf('://');
    if (protoIdx !== -1) {
      var slashIdx = u.indexOf('/', protoIdx + 3);
      u = slashIdx !== -1 ? u.slice(slashIdx) : '';
    }
    var qIdx = u.indexOf('?');
    if (qIdx !== -1) u = u.slice(0, qIdx);
    var hIdx = u.indexOf('#');
    if (hIdx !== -1) u = u.slice(0, hIdx);

    if (u.charCodeAt(0) === 47) { // '/'
      var mTyped = u.match(TYPED_XTREAM_PATH_REGEX);
      if (mTyped) {
        return '/' + mTyped[1].toLowerCase() + '/' + mTyped[2];
      }
      var mShort = u.match(SHORT_XTREAM_PATH_REGEX);
      if (mShort) {
        return '/' + mShort[1];
      }
    }
    return u;
  }

  function buildStableItemId(rawEntry, kind, isNovela, cleanTitle, group, season, episode) {
    var src = String(rawEntry.sourceId || '');
    if (src === 'xtream' && rawEntry.xtreamId) {
      if (kind === 'series-show') return 's:xt:series:' + rawEntry.xtreamId;
      if (kind === 'novela-show') return 'n:xt:series:' + rawEntry.xtreamId;
      if (kind === 'episode') return 'i:xt:ep:' + rawEntry.xtreamId;
      if (kind === 'movie') return 'i:xt:movie:' + rawEntry.xtreamId;
      return 'i:xt:live:' + rawEntry.xtreamId;
    }
    var normPath = normalizeUrlPathForId(rawEntry.url || '');
    var sig =
      String(rawEntry.tvgId || '').toLowerCase() + '|' +
      String(cleanTitle || '').toLowerCase() + '|' +
      String(group || '').toLowerCase() + '|' +
      kind + '|' +
      (isNovela ? 'nov' : 'std') + '|' +
      (season || 0) + '|' +
      (episode || 0) + '|' +
      normPath;
    return 'i:m3u:' + stableHash53(sig);
  }

  function cleanTitleAndYear(rawTitle) {
    var title = String(rawTitle || '').trim();
    var year = null;
    if (title.indexOf('(') !== -1) {
      var yearMatch = title.match(YEAR_REGEX);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        title = title.replace(yearMatch[0], '');
      }
    }
    COMBINED_NOISE_REGEX.lastIndex = 0;
    title = title
      .replace(COMBINED_NOISE_REGEX, '')
      .replace(MULTISPACE_REGEX, ' ')
      .replace(TRIM_PUNCT_REGEX, '')
      .trim();
    return {
      cleanTitle: title || String(rawTitle || 'Sem Título').trim(),
      year: year
    };
  }

  function detectQuality(rawTitle) {
    var s = String(rawTitle || '').toUpperCase();
    if (s.indexOf('4K') !== -1 || s.indexOf('UHD') !== -1) return '4K';
    if (s.indexOf('FHD') !== -1 || s.indexOf('1080') !== -1) return 'FHD';
    if (s.indexOf('HD') !== -1 || s.indexOf('720') !== -1) return 'HD';
    return 'SD';
  }

  function analyzeGroupOnce(groupName) {
    var cached = groupDecisionCache[groupName];
    if (cached) return cached;
    var g = String(groupName || '').toLowerCase().trim();
    var isAdultGroup = ADULT_GROUP_REGEX.test(g);
    var isExplicitLiveGroup = LIVE_24H_REGEX.test(g) || LIVE_GROUP_WORDS_REGEX.test(g);
    var isNovelaGroup = !isExplicitLiveGroup && NOVELA_GROUP_WORDS_REGEX.test(g);
    var isSeriesGroup = !isExplicitLiveGroup && !isNovelaGroup && SERIES_GROUP_WORDS_REGEX.test(g);
    var isMovieGroup = !isExplicitLiveGroup && !isNovelaGroup && !isSeriesGroup && MOVIE_GROUP_WORDS_REGEX.test(g);

    var suggested = 'unclassified';
    if (isExplicitLiveGroup) suggested = 'live';
    else if (isNovelaGroup) suggested = 'novela';
    else if (isSeriesGroup) suggested = 'series';
    else if (isMovieGroup) suggested = 'movie';

    var info = {
      lowerGroup: g,
      isExplicitLiveGroup: isExplicitLiveGroup,
      isNovelaGroup: isNovelaGroup,
      isSeriesGroup: isSeriesGroup,
      isMovieGroup: isMovieGroup,
      isAdultGroup: isAdultGroup,
      suggested: suggested
    };
    groupDecisionCache[groupName] = info;
    return info;
  }

  function suggestGroupTarget(groupName) {
    return analyzeGroupOnce(groupName).suggested;
  }

  function parseEpisodeNumbers(title) {
    if (!PLAUSIBLE_EP_HINT.test(title)) return null;
    var mStrong = title.match(STRONG_EPISODE_REGEX);
    if (mStrong) {
      var s = parseInt(mStrong[1] || mStrong[3] || mStrong[5] || mStrong[7] || '1', 10);
      var e = parseInt(mStrong[2] || mStrong[4] || mStrong[6] || mStrong[8] || '1', 10);
      return {
        isStrong: true,
        isCap: false,
        season: s,
        episode: e,
        matchedText: mStrong[0]
      };
    }
    var mCap = title.match(CAP_EP_REGEX);
    if (mCap) {
      return {
        isStrong: false,
        isCap: !!mCap[1],
        season: 1,
        episode: parseInt(mCap[3] || '1', 10),
        matchedText: mCap[0]
      };
    }
    return null;
  }

  function normalizeSortAndSearchText(str) {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyEntry(rawEntry, mappingProfile) {
    var profile = mappingProfile || {};
    var customRules = profile.customGroupRules || {};
    var renamedGroups = profile.renamedGroups || {};
    var mode = profile.mode || 'auto';

    var title = String(rawEntry.title || rawEntry.tvgName || 'Sem Título').trim();
    var group = String(rawEntry.groupTitle || rawEntry.groupOriginal || 'Sem Grupo').trim() || 'Sem Grupo';
    var displayGroup = renamedGroups[group] || group;
    var url = String(rawEntry.url || '').trim();
    var tvgType = String(rawEntry.tvgType || '').toLowerCase().trim();
    var lowerUrl = url.toLowerCase();
    var sourceId = String(rawEntry.sourceId || 'default');

    var grpInfo = analyzeGroupOnce(group);
    var cleaned = cleanTitleAndYear(title);
    var lang = (LEG_REGEX.test(title) || LEG_REGEX.test(group)) ? 'LEG' : 'DUB';
    var has24hInTitleOrGroup = grpInfo.isExplicitLiveGroup ? (LIVE_24H_REGEX.test(group) || LIVE_24H_REGEX.test(title)) : LIVE_24H_REGEX.test(title);

    var epInfo = parseEpisodeNumbers(title);
    var season = epInfo ? epInfo.season : (rawEntry.season || null);
    var episode = epInfo ? epInfo.episode : (rawEntry.episode || null);

    var kind = 'unclassified';
    var kindSource = 'unclassified-fallback';
    var kindConfidence = 'low';
    var isNovela = false;

    var hasLiveUrlPath = lowerUrl.indexOf('/live/') !== -1;
    var hasMovieUrlPath = lowerUrl.indexOf('/movie/') !== -1 || lowerUrl.indexOf('/vod/') !== -1;
    var hasSeriesUrlPath = lowerUrl.indexOf('/series/') !== -1;

    if (mode === 'all_live') {
      kind = 'live';
      isNovela = false;
      kindSource = 'profile-all-live';
      kindConfidence = 'high';
    } else if (customRules[group]) {
      var rule = customRules[group];
      if (rule === 'hidden') {
        kind = 'hidden';
      } else if (rule === 'novela') {
        kind = rawEntry.xtreamKind === 'series-show' ? 'novela-show' : 'episode';
        isNovela = true;
      } else if (rule === 'series') {
        kind = rawEntry.xtreamKind === 'series-show' ? 'series-show' : 'episode';
        isNovela = false;
      } else {
        kind = rule;
        isNovela = false;
      }
      kindSource = 'custom-rule';
      kindConfidence = 'high';
    } else if (sourceId === 'xtream' && (rawEntry.xtreamKind || tvgType)) {
      var xk = rawEntry.xtreamKind || tvgType;
      if (xk === 'live') {
        kind = 'live';
      } else if (xk === 'movie' || xk === 'vod') {
        kind = 'movie';
      } else if (xk === 'series-show' || xk === 'novela-show') {
        isNovela = (xk === 'novela-show') || grpInfo.isNovelaGroup;
        kind = isNovela ? 'novela-show' : 'series-show';
      } else if (xk === 'series' || xk === 'novela' || xk === 'episode') {
        isNovela = (xk === 'novela') || grpInfo.isNovelaGroup;
        kind = 'episode';
      }
      kindSource = 'xtream-api';
      kindConfidence = 'high';
    } else if (rawEntry.forcedKind) {
      var fk = rawEntry.forcedKind;
      if (fk === 'live') kind = 'live';
      else if (fk === 'movie') kind = 'movie';
      else if (fk === 'series') {
        isNovela = grpInfo.isNovelaGroup;
        kind = rawEntry.needsSeriesInfo ? (isNovela ? 'novela-show' : 'series-show') : 'episode';
      }
      kindSource = 'forced-kind';
      kindConfidence = 'high';
    } else if (has24hInTitleOrGroup && !hasMovieUrlPath && !hasSeriesUrlPath) {
      kind = 'live';
      isNovela = false;
      kindSource = 'live-24h';
      kindConfidence = 'high';
    } else if (hasLiveUrlPath) {
      kind = 'live';
      isNovela = false;
      kindSource = 'url-path-live';
      kindConfidence = 'high';
    } else if (hasMovieUrlPath) {
      kind = 'movie';
      isNovela = false;
      kindSource = 'url-path-movie';
      kindConfidence = 'high';
    } else if (hasSeriesUrlPath) {
      kind = 'episode';
      isNovela = grpInfo.isNovelaGroup || (tvgType === 'novela') || !!(epInfo && epInfo.isCap);
      kindSource = 'url-path-series';
      kindConfidence = 'high';
    } else if (tvgType === 'live' || tvgType === 'movie' || tvgType === 'series' || tvgType === 'novela') {
      isNovela = (tvgType === 'novela') || grpInfo.isNovelaGroup;
      kind = (tvgType === 'novela' || tvgType === 'series') ? 'episode' : tvgType;
      kindSource = 'tvg-type';
      kindConfidence = 'high';
    } else if (epInfo && epInfo.isStrong) {
      if (grpInfo.isExplicitLiveGroup) {
        kind = 'unclassified';
        kindSource = 'conflict-ep-in-live-group';
        kindConfidence = 'low';
      } else {
        kind = 'episode';
        isNovela = grpInfo.isNovelaGroup;
        kindSource = 'title-episode-pattern';
        kindConfidence = 'high';
      }
    } else if (epInfo && !grpInfo.isExplicitLiveGroup && (grpInfo.isNovelaGroup || grpInfo.isSeriesGroup)) {
      kind = 'episode';
      isNovela = grpInfo.isNovelaGroup || epInfo.isCap;
      kindSource = 'title-cap-in-show-group';
      kindConfidence = 'medium';
    } else if (grpInfo.suggested === 'live') {
      kind = 'live';
      kindSource = 'group-name-live';
      kindConfidence = 'medium';
    } else if (grpInfo.suggested === 'novela') {
      kind = 'episode';
      isNovela = true;
      kindSource = 'group-name-novela';
      kindConfidence = 'medium';
    } else if (grpInfo.suggested === 'series') {
      kind = 'episode';
      isNovela = false;
      kindSource = 'group-name-series';
      kindConfidence = 'medium';
    } else if (grpInfo.suggested === 'movie') {
      kind = 'movie';
      kindSource = 'group-name-movie';
      kindConfidence = 'medium';
    } else if (VOD_EXT_REGEX.test(lowerUrl)) {
      kind = 'movie';
      kindSource = 'ext-vod';
      kindConfidence = 'low';
    } else {
      kind = 'unclassified';
      kindSource = 'unclassified-fallback';
      kindConfidence = 'low';
    }

    var adult = grpInfo.isAdultGroup || ADULT_TITLE_REGEX.test(title);
    var seriesKey = null;
    var seriesTitle = cleaned.cleanTitle;

    if (kind === 'episode' || kind === 'series') {
      if (epInfo && epInfo.matchedText) {
        seriesTitle = cleaned.cleanTitle
          .replace(STRONG_EPISODE_REGEX, '')
          .replace(CAP_EP_REGEX, '')
          .replace(TRAIL_EP_PUNCT_REGEX, '')
          .trim() || cleaned.cleanTitle;
      }
      var prefix = isNovela ? 'n:' : 's:';
      var normShowKey =
        seriesTitle.toLowerCase() + '|' +
        grpInfo.lowerGroup + '|' +
        lang.toLowerCase() + '|' +
        (cleaned.year || '');
      seriesKey = prefix + 'show_' + stableHash53(normShowKey);
      if (!season) season = 1;
      if (!episode) episode = 1;
    } else if (kind === 'series-show' || kind === 'novela-show') {
      seriesKey = buildStableItemId(rawEntry, kind, isNovela, cleaned.cleanTitle, group, null, null);
    }

    var groupMapped = 'Não classificado';
    if (kind === 'hidden') groupMapped = 'Oculto';
    else if (isNovela || kind === 'novela-show') groupMapped = 'Novelas';
    else if (kind === 'movie') groupMapped = 'Filmes';
    else if (kind === 'episode' || kind === 'series' || kind === 'series-show') groupMapped = 'Séries';
    else if (kind === 'live') groupMapped = 'Canais';

    var rating = parseFloat(rawEntry.tvgRating || rawEntry.rating || '0') || 8.0;
    var itemId = buildStableItemId(rawEntry, kind, isNovela, cleaned.cleanTitle, group, season, episode);
    var legacyId = stableHash((rawEntry.tvgId || '') + '|' + url);

    var entryObj = {
      id: itemId,
      legacyId: legacyId,
      kind: kind,
      kindSource: kindSource,
      kindConfidence: kindConfidence,
      isNovela: isNovela,
      title: title,
      cleanTitle: cleaned.cleanTitle,
      seriesTitle: seriesTitle,
      year: cleaned.year || rawEntry.year || 2024,
      rating: rating,
      groupOriginal: group,
      groupDisplay: displayGroup,
      groupMapped: groupMapped,
      logo: rawEntry.tvgLogo || rawEntry.logo || '',
      backdrop: rawEntry.backdrop || '',
      url: url,
      tvgId: rawEntry.tvgId || '',
      season: season,
      episode: episode,
      seriesKey: seriesKey,
      addedAt: rawEntry.addedAt || Date.now(),
      quality: detectQuality(title),
      lang: lang,
      adult: adult,
      sourceId: sourceId
    };

    if (rawEntry.epgNow) entryObj.epgNow = rawEntry.epgNow;
    if (rawEntry.epgNext) entryObj.epgNext = rawEntry.epgNext;
    if (rawEntry.httpUserAgent) entryObj.httpUserAgent = rawEntry.httpUserAgent;
    if (rawEntry.httpReferrer) entryObj.httpReferrer = rawEntry.httpReferrer;
    if (rawEntry.xtreamSeriesId) entryObj.xtreamSeriesId = rawEntry.xtreamSeriesId;
    if (rawEntry.needsSeriesInfo) entryObj.needsSeriesInfo = true;
    if (rawEntry.totalEpisodes) entryObj.totalEpisodes = rawEntry.totalEpisodes;
    if (rawEntry.synopsis) entryObj.synopsis = rawEntry.synopsis;

    return entryObj;
  }

  function applyProfileMapping(item, mappingProfile) {
    if (!item || !mappingProfile) return item;
    var mode = mappingProfile.mode || 'auto';
    var customRules = mappingProfile.customGroupRules || {};
    var renamedGroups = mappingProfile.renamedGroups || {};
    var grp = item.groupOriginal || 'Sem Grupo';
    item.groupDisplay = renamedGroups[grp] || grp;

    if (mode === 'all_live') {
      item.kind = 'live';
      item.isNovela = false;
      item.groupMapped = 'Canais';
    } else if (customRules[grp]) {
      var r = customRules[grp];
      if (r === 'hidden') {
        item.kind = 'hidden';
        item.groupMapped = 'Oculto';
      } else if (r === 'novela') {
        item.kind = item.xtreamSeriesId ? 'novela-show' : 'episode';
        item.isNovela = true;
        item.groupMapped = 'Novelas';
      } else if (r === 'series') {
        item.kind = item.xtreamSeriesId ? 'series-show' : 'episode';
        item.isNovela = false;
        item.groupMapped = 'Séries';
      } else if (r === 'movie') {
        item.kind = 'movie';
        item.isNovela = false;
        item.groupMapped = 'Filmes';
      } else if (r === 'live') {
        item.kind = 'live';
        item.isNovela = false;
        item.groupMapped = 'Canais';
      }
    }
    return item;
  }

  var api = {
    CLASSIFIER_VERSION: CLASSIFIER_VERSION,
    stableHash: stableHash,
    stableHash53: stableHash53,
    normalizeUrlPathForId: normalizeUrlPathForId,
    buildStableItemId: buildStableItemId,
    cleanTitleAndYear: cleanTitleAndYear,
    analyzeGroupOnce: analyzeGroupOnce,
    suggestGroupTarget: suggestGroupTarget,
    normalizeSortAndSearchText: normalizeSortAndSearchText,
    classifyEntry: classifyEntry,
    applyProfileMapping: applyProfileMapping
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LuminaClassifier = api;
})(typeof window !== 'undefined' ? window : global);
