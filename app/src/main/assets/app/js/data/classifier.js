(function (global) {
  'use strict';

  // Regex único combinado para limpeza em 1 única passada (3x mais rápido em 200k itens)
  var COMBINED_NOISE_REGEX = /(?:\[(?:4K|UHD|FHD|HD|SD|HEVC|H265|H\.265|HDR|10BIT|LEG|DUB|DUBLADO|LEGENDADO|DUAL)\]|\((?:Dublado|Legendado|Dual|4K|FHD|HD)\)|^(?:\|?[A-Z]{2}\|?\s*[-:|]\s*)|\b(?:FHD|UHD|4K|HEVC|H\.265|1080p|720p)\b)/gi;

  // Suporta S01E01, 1x01, T01E01, Temporada 1 Episódio 1, Cap. 01, Capítulo 120, Ep. 05
  var EPISODE_REGEX = /(?:S(\d{1,2})\s*E(\d{1,4})|(\d{1,2})x(\d{1,4})|T(\d{1,2})\s*E(\d{1,4})|Temporada\s*(\d{1,2})\s*Epis[oó]dio\s*(\d{1,4})|[-–]?\s*(?:Cap(?:[ií]tulo|\.)|Ep(?:is[oó]dio|\.)?)\s*(\d{1,4}))/i;
  var FAST_EP_HINT = /[sStT0-9]|cap|ep/i;
  var YEAR_REGEX = /\((19\d{2}|20\d{2})\)/;

  // Cache de grupos (em listas de 200.000 itens há apenas ~200 a 500 grupos distintos)
  var groupDecisionCache = {};

  function stableHash(str) {
    var h = 2166136261;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return 'itm_' + (h >>> 0).toString(16);
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
    title = title.replace(COMBINED_NOISE_REGEX, '').replace(/\s{2,}/g, ' ').replace(/^[-:|\s]+|[-:|\s]+$/g, '').trim();
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
    var g = String(groupName || '').toLowerCase();
    var isNovelaGroup = /novela|vale a pena|folhetim|dorama.*novela/.test(g);
    var isAdultGroup = /(?:adulto|\+18|18\+|xxx|er[oó]tico|priv[eé]|sexo|hot\b)/.test(g);
    var suggested = 'unclassified';

    if (isNovelaGroup) {
      suggested = 'novela';
    } else if (/s[eé]rie|temporada|anime|dorama|sitcom|miniss[eé]rie| sezon|season|tv shows?/.test(g)) {
      suggested = 'series';
    } else if (/filme|cinema|vod|lan[cç]amento|colet[aâ]nea|marvel|dc comics|oscar|dublado|legendado|movies?/.test(g) && !/canais|24h|ao vivo/.test(g)) {
      suggested = 'movie';
    } else if (/canais|canal|ao vivo|esporte|premiere|combate|dazn|paramount|aberto|not[ií]cia|24h|tv\b|document[aá]rio|infantil|kids| variedades|religioso|m[uú]sica|pay-per-view|ppv|uhd\s*tv|fhd\s*tv/.test(g)) {
      suggested = 'live';
    }

    var info = {
      lowerGroup: g,
      isNovelaGroup: isNovelaGroup,
      isAdultGroup: isAdultGroup,
      suggested: suggested
    };
    groupDecisionCache[groupName] = info;
    return info;
  }

  function suggestGroupTarget(groupName) {
    return analyzeGroupOnce(groupName).suggested;
  }

  function classifyEntry(rawEntry, mappingProfile) {
    var profile = mappingProfile || {};
    var customRules = profile.customGroupRules || {};
    var renamedGroups = profile.renamedGroups || {};
    var mode = profile.mode || 'auto';

    var title = rawEntry.title || 'Sem Título';
    var group = rawEntry.groupTitle || rawEntry.groupOriginal || 'Sem Grupo';
    var displayGroup = renamedGroups[group] || group;
    var url = rawEntry.url || '';
    var tvgType = (rawEntry.tvgType || '');
    var lowerUrl = url.toLowerCase();

    var grpInfo = analyzeGroupOnce(group);
    var cleaned = cleanTitleAndYear(title);

    var epMatch = null;
    var season = null;
    var episode = null;
    if (FAST_EP_HINT.test(title)) {
      epMatch = title.match(EPISODE_REGEX);
      if (epMatch) {
        season = parseInt(epMatch[1] || epMatch[3] || epMatch[5] || epMatch[7] || '1', 10);
        episode = parseInt(epMatch[2] || epMatch[4] || epMatch[6] || epMatch[8] || epMatch[9] || '1', 10);
      }
    }

    var kind = 'unclassified';
    var isNovela = grpInfo.isNovelaGroup || (tvgType === 'novela') || /\bcap(?:[ií]tulo|\.)\s*\d+/i.test(title);

    // 1. Perfil rápido "Tudo como Canais"
    if (mode === 'all_live') {
      kind = 'live';
      isNovela = false;
    }
    // 2. Regra explícita da tela "Organizar minha lista"
    else if (customRules[group]) {
      var rule = customRules[group];
      if (rule === 'hidden') {
        kind = 'hidden';
      } else if (rule === 'novela') {
        kind = 'episode';
        isNovela = true;
      } else if (rule === 'series') {
        kind = 'episode';
        isNovela = false;
      } else {
        kind = rule;
        isNovela = false;
      }
    }
    // 3. Ordem automática otimizada (Seção 5.3)
    else if (tvgType === 'live' || tvgType === 'movie' || tvgType === 'series' || tvgType === 'novela') {
      kind = (tvgType === 'novela' || tvgType === 'series') ? 'episode' : tvgType;
    } else if (lowerUrl.indexOf('/live/') !== -1) {
      kind = 'live';
    } else if (lowerUrl.indexOf('/movie/') !== -1) {
      kind = 'movie';
    } else if (lowerUrl.indexOf('/series/') !== -1) {
      kind = 'episode';
    } else if (epMatch) {
      kind = 'episode';
    } else if (grpInfo.suggested === 'live') {
      kind = 'live';
    } else if (grpInfo.suggested === 'movie') {
      kind = 'movie';
    } else if (grpInfo.suggested === 'series' || grpInfo.suggested === 'novela') {
      kind = 'episode';
    } else if (/\.(mp4|mkv|avi)(\?|$)/i.test(lowerUrl)) {
      kind = 'movie';
    } else if (/\.(m3u8|ts)(\?|$)/i.test(lowerUrl)) {
      kind = 'live';
    } else {
      kind = 'live';
    }

    var adult = grpInfo.isAdultGroup || /(?:adulto|\+18|xxx)/i.test(title);
    var seriesKey = null;
    var seriesTitle = cleaned.cleanTitle;

    if (kind === 'episode' || kind === 'series') {
      seriesTitle = epMatch
        ? (cleaned.cleanTitle.replace(EPISODE_REGEX, '').replace(/[-:|\s]+$/g, '').trim() || cleaned.cleanTitle)
        : cleaned.cleanTitle;
      seriesKey = stableHash((isNovela ? 'nov|' : 'ser|') + seriesTitle.toLowerCase());
      if (!season) season = 1;
      if (!episode) episode = 1;
    }

    var groupMapped = 'Canais';
    if (kind === 'hidden') groupMapped = 'Oculto';
    else if (isNovela) groupMapped = 'Novelas';
    else if (kind === 'movie') groupMapped = 'Filmes';
    else if (kind === 'episode' || kind === 'series') groupMapped = 'Séries';
    else if (kind === 'unclassified') groupMapped = 'Não classificado';

    var rating = parseFloat(rawEntry.tvgRating || rawEntry.rating || '0') || 8.0;

    return {
      id: stableHash((rawEntry.tvgId || '') + '|' + url),
      kind: kind,
      isNovela: isNovela,
      title: title,
      cleanTitle: cleaned.cleanTitle,
      seriesTitle: seriesTitle,
      year: cleaned.year || 2024,
      rating: rating,
      groupOriginal: group,
      groupDisplay: displayGroup,
      groupMapped: groupMapped,
      logo: rawEntry.tvgLogo || '',
      backdrop: '',
      url: url,
      tvgId: rawEntry.tvgId || '',
      season: season,
      episode: episode,
      seriesKey: seriesKey,
      addedAt: rawEntry.addedAt || Date.now(),
      quality: detectQuality(title),
      lang: /legendado|\bleg\b/i.test(title) ? 'LEG' : 'DUB',
      adult: adult,
      sourceId: rawEntry.sourceId || 'default'
    };
  }

  var api = {
    stableHash: stableHash,
    cleanTitleAndYear: cleanTitleAndYear,
    suggestGroupTarget: suggestGroupTarget,
    classifyEntry: classifyEntry
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LuminaClassifier = api;
})(typeof window !== 'undefined' ? window : global);
