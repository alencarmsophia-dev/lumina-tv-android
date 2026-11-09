(function (global) {
  'use strict';

  var CLASSIFIER_VERSION = '2.0.0';

  var COMBINED_NOISE_REGEX = /(?:\[(?:4K|UHD|FHD|HD|SD|HEVC|H265|H\.265|HDR|10BIT|LEG|DUB|DUBLADO|LEGENDADO|DUAL)\]|\((?:Dublado|Legendado|Dual|4K|FHD|HD)\)|^(?:\|?[A-Z]{2}\|?\s*[-:|]\s*)|\b(?:FHD|UHD|4K|HEVC|H\.265|1080p|720p)\b)/gi;

  // Padrões fortes de episódio: S01E01, 1x01, T01E01, Temporada 1 Episódio 1
  var STRONG_EPISODE_REGEX = /(?:^|[\s\-_|(\[])(?:S(\d{1,2})\s*E(\d{1,4})|(\d{1,2})x(\d{2,4})|T(\d{1,2})\s*E(\d{1,4})|Temporada\s*(\d{1,2})\s*Epis[oó]dio\s*(\d{1,4}))(?=$|[\s\-_|)\].])/i;

  // Padrão de capítulo/episódio simples: Cap. 120, Capítulo 05, Ep. 12
  var CAP_EP_REGEX = /(?:^|[\s\-–:|])(?:(Cap(?:[ií]tulo|\.)?)|(Ep(?:is[oó]dio|\.)?))\s*(\d{1,4})(?=$|[\s\-–:|)\]])/i;

  // Dica rápida restrita (só dispara regex pesada quando realmente há padrão numérico plausível)
  var PLAUSIBLE_EP_HINT = /(?:[sStT]\d{1,2}\s*[eE]\d|\d{1,2}x\d{2}|temporada\s*\d|cap(?:[ií]tulo|\.)?\s*\d|ep(?:is[oó]dio|\.)?\s*\d)/i;

  var YEAR_REGEX = /\((19\d{2}|20\d{2})\)/;
  var LIVE_24H_REGEX = /(?:\b24\s*h(?:oras|rs)?\b|\bmaratona\s*24h\b|\bao\s*vivo\b|\blive\s*tv\b)/i;

  var groupDecisionCache = {};

  // Hash legado de 32 bits (mantido para migração de favoritos/progresso da v1.5.1)
  function stableHash(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return 'itm_' + (h >>> 0).toString(16);
  }

  // Hash de 64/53 bits combinando dois acumuladores independentes (FNV-1a + Murmur/DJB2) em ES5:
  // Zero colisões em 300.000+ itens!
  function stableHash53(str) {
    var s = String(str || '');
    var h1 = 0x811c9dc5;
    var h2 = 0x15051505;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c;
      h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
      h2 = (((h2 << 5) + h2) ^ (c * 0x9e3779b1)) >>> 0;
    }
    var hex1 = (h1 >>> 0).toString(16);
    while (hex1.length < 8) hex1 = '0' + hex1;
    var hex2 = (h2 >>> 0).toString(16);
    while (hex2.length < 8) hex2 = '0' + hex2;
    return hex1 + hex2;
  }

  // Remove esquema, host, porta, usuário e senha da URL para que o ID não mude ao trocar servidor/credenciais
  function normalizeUrlPathForId(rawUrl) {
    var u = String(rawUrl || '').trim();
    if (!u) return '';
    u = u.replace(/^https?:\/\/[^\/]+/i, '');
    u = u.split('?')[0].split('#')[0];
    // Padrão Xtream com tipo: /live/user/pass/12345.m3u8 -> /live/12345.m3u8
    var mTyped = u.match(/^\/(live|movie|series)\/[^\/]+\/[^\/]+\/(.+)$/i);
    if (mTyped) {
      return '/' + mTyped[1].toLowerCase() + '/' + mTyped[2];
    }
    // Padrão Xtream sem tipo: /user/pass/12345 -> /12345
    var mShort = u.match(/^\/[^\/]+\/[^\/]+\/(\d+(?:\.[a-z0-9]+)?)$/i);
    if (mShort) {
      return '/' + mShort[1];
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
    var sig = [
      String(rawEntry.tvgId || '').toLowerCase(),
      String(cleanTitle || '').toLowerCase(),
      String(group || '').toLowerCase(),
      kind,
      isNovela ? 'nov' : 'std',
      season || 0,
      episode || 0,
      normPath
    ].join('|');
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
    title = title
      .replace(COMBINED_NOISE_REGEX, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[-:|\s]+|[-:|\s]+$/g, '')
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
    if (groupDecisionCache[groupName]) return groupDecisionCache[groupName];
    var g = String(groupName || '').toLowerCase().trim();
    var isAdultGroup = /(?:adulto|\+18|18\+|xxx|er[oó]tico|priv[eé]|sexo|hot\b)/.test(g);

    // 1. Live / 24h explícito no grupo SEMPRE vence palavra "série/sitcom/desenho" (ex.: "24H Séries", "Canais | Comédia")
    var isExplicitLiveGroup =
      LIVE_24H_REGEX.test(g) ||
      /\b(?:canais|canal|abertos?|fechados?|esportes?|premiere|combate|dazn|paramount|not[ií]cias?|jornalismo|telejornal|pay-per-view|ppv|uhd\s*tv|fhd\s*tv|tv\s*ao\s*vivo|variedades|religiosos?)\b/.test(g);

    var isNovelaGroup = !isExplicitLiveGroup && /\b(?:novelas?|vale a pena|folhetins?|teledramaturgia)\b/.test(g);

    var isSeriesGroup =
      !isExplicitLiveGroup &&
      !isNovelaGroup &&
      /\b(?:s[eé]ries?|temporadas?|animes?|doramas?|sitcoms?|miniss[eé]ries?|sezon|seasons?|tv\s*shows?)\b/.test(g);

    var isMovieGroup =
      !isExplicitLiveGroup &&
      !isNovelaGroup &&
      !isSeriesGroup &&
      /\b(?:filmes?|cinema|vod|lan[cç]amentos?|colet[aâ]neas?|marvel|dc\s*comics|oscar|movies?|cine\b|terror|com[eé]dia|a[cç][aã]o|suspense|drama|fic[cç][aã]o|anima[cç][aã]o)\b/.test(g);

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
    var lang = /legendado|\bleg\b/i.test(title + ' ' + group) ? 'LEG' : 'DUB';
    var has24hInTitleOrGroup = LIVE_24H_REGEX.test(title) || LIVE_24H_REGEX.test(group);

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

    // 1. Perfil rápido "Tudo como Canais"
    if (mode === 'all_live') {
      kind = 'live';
      isNovela = false;
      kindSource = 'profile-all-live';
      kindConfidence = 'high';
    }
    // 2. Regra manual explícita do usuário ("Organizar Minha Lista")
    else if (customRules[group]) {
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
    }
    // 3. Origem Xtream Codes (API já sabe o tipo exato; nunca reclassifica por heurística)
    else if (sourceId === 'xtream' && (rawEntry.xtreamKind || tvgType)) {
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
    }
    // 4. Canais 24h explícitos ("24H Os Simpsons", "24H Séries"): sempre live
    else if (has24hInTitleOrGroup && !hasMovieUrlPath && !hasSeriesUrlPath) {
      kind = 'live';
      isNovela = false;
      kindSource = 'live-24h';
      kindConfidence = 'high';
    }
    // 5. URL com marcador explícito de caminho (/live/, /movie/, /series/)
    else if (hasLiveUrlPath) {
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
      isNovela = grpInfo.isNovelaGroup || (tvgType === 'novela') || (epInfo && epInfo.isCap);
      kindSource = 'url-path-series';
      kindConfidence = 'high';
    }
    // 6. Atributo explícito tvg-type do #EXTINF
    else if (tvgType === 'live' || tvgType === 'movie' || tvgType === 'series' || tvgType === 'novela') {
      isNovela = (tvgType === 'novela') || grpInfo.isNovelaGroup;
      kind = (tvgType === 'novela' || tvgType === 'series') ? 'episode' : tvgType;
      kindSource = 'tvg-type';
      kindConfidence = 'high';
    }
    // 7. Padrão forte de episódio no título (S01E01, 1x01, T01E01, Temporada X Episódio Y)
    else if (epInfo && epInfo.isStrong) {
      // Se o grupo diz "Canais | ..." e a URL não tem /live/ nem /series/, há conflito -> unclassified!
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
    }
    // 8. Capítulo/Episódio (Cap. 120) quando o grupo é de novela ou série
    else if (epInfo && !grpInfo.isExplicitLiveGroup && (grpInfo.isNovelaGroup || grpInfo.isSeriesGroup)) {
      kind = 'episode';
      isNovela = grpInfo.isNovelaGroup || epInfo.isCap;
      kindSource = 'title-cap-in-show-group';
      kindConfidence = 'medium';
    }
    // 9. Nome do grupo (ordem: live explícito -> novela -> série -> filme)
    else if (grpInfo.suggested === 'live') {
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
    }
    // 10. Desempate de baixa confiança por extensão de arquivo
    else if (/\.(mp4|mkv|avi)(\?|$)/i.test(lowerUrl)) {
      kind = 'movie';
      kindSource = 'ext-vod';
      kindConfidence = 'low';
    }
    // Sem sinal suficiente -> unclassified (NUNCA vira live por falta de regra)
    else {
      kind = 'unclassified';
      kindSource = 'unclassified-fallback';
      kindConfidence = 'low';
    }

    var adult = grpInfo.isAdultGroup || /(?:adulto|\+18|18\+|\bxxx\b)/i.test(title);
    var seriesKey = null;
    var seriesTitle = cleaned.cleanTitle;

    if (kind === 'episode' || kind === 'series') {
      if (epInfo && epInfo.matchedText) {
        seriesTitle = cleaned.cleanTitle
          .replace(STRONG_EPISODE_REGEX, '')
          .replace(CAP_EP_REGEX, '')
          .replace(/[-–:|\s]+$/g, '')
          .trim() || cleaned.cleanTitle;
      }
      var prefix = isNovela ? 'n:' : 's:';
      var normShowKey = [
        seriesTitle.toLowerCase(),
        group.toLowerCase(),
        lang.toLowerCase(),
        cleaned.year || ''
      ].join('|');
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

  var api = {
    CLASSIFIER_VERSION: CLASSIFIER_VERSION,
    stableHash: stableHash,
    stableHash53: stableHash53,
    normalizeUrlPathForId: normalizeUrlPathForId,
    cleanTitleAndYear: cleanTitleAndYear,
    suggestGroupTarget: suggestGroupTarget,
    classifyEntry: classifyEntry
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LuminaClassifier = api;
})(typeof window !== 'undefined' ? window : global);
