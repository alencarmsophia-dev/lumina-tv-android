(function (global) {
  'use strict';

  function cleanInvisibleAndQuotes(raw) {
    if (raw === null || raw === undefined) return '';
    return String(raw)
      .replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  }

  function trimOuterWhitespace(raw) {
    return cleanInvisibleAndQuotes(raw).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  }

  function decodeQueryComponentSafe(val) {
    try {
      return decodeURIComponent(String(val || '').replace(/\+/g, '%20'));
    } catch (e) {
      return String(val || '');
    }
  }

  // Detecta se uma URL colada (no campo M3U ou no campo Servidor Xtream) é um link get.php?username=U&password=P
  function detectXtreamCredentialsFromUrl(rawUrl) {
    var clean = trimOuterWhitespace(rawUrl).replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
    if (!clean) return null;
    if (!/^https?:\/\//i.test(clean) && /[a-z0-9.-]+\.[a-z]{2,}/i.test(clean)) {
      clean = 'http://' + clean;
    }
    var m = clean.match(/^(https?:\/\/[^\/?#]+)(\/[^?#]*)?\?([^#]+)$/i);
    if (!m) return null;

    var origin = m[1];
    var path = (m[2] || '').toLowerCase();
    var query = m[3] || '';

    var params = {};
    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length >= 2) {
        var k = kv[0].toLowerCase();
        var v = decodeQueryComponentSafe(kv.slice(1).join('='));
        params[k] = v;
      }
    }

    var username = params.username || params.user || '';
    var password = params.password || params.pass || '';
    if (!username || !password) return null;

    var normSrv = normalizeXtreamServer(origin);
    if (!normSrv.ok) return null;

    return {
      isXtreamLink: true,
      server: normSrv.server,
      host: normSrv.host,
      username: username,
      password: password,
      output: params.output || params.type || '',
      originalPath: path
    };
  }

  function isValidHostOrIp(host) {
    if (!host) return false;
    var h = String(host).toLowerCase();
    if (h === 'localhost') return true;
    // IPv4
    var ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      for (var i = 1; i <= 4; i++) {
        var octet = parseInt(ipv4[i], 10);
        if (isNaN(octet) || octet < 0 || octet > 255) return false;
      }
      return true;
    }
    // Domínio com pelo menos um ponto e caracteres válidos
    if (h.indexOf('.') === -1) return false;
    if (!/^[a-z0-9.-]+$/i.test(h)) return false;
    if (h.charAt(0) === '.' || h.charAt(h.length - 1) === '.' || h.indexOf('..') !== -1) return false;
    return true;
  }

  // Normaliza URL de servidor Xtream (Seção B4)
  function normalizeXtreamServer(rawServer) {
    var s = trimOuterWhitespace(rawServer).replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
    if (!s) {
      return {
        ok: false,
        server: '',
        host: '',
        port: null,
        error: 'Informe o endereço do servidor (ex.: http://meuservidor.com:8080).'
      };
    }

    var extracted = detectXtreamCredentialsFromUrl(s);

    if (!/^https?:\/\//i.test(s)) {
      if (/^[a-z0-9]+:\/\//i.test(s)) {
        return {
          ok: false,
          server: '',
          host: '',
          port: null,
          error: 'O protocolo do servidor deve ser http:// ou https://.'
        };
      }
      s = 'http://' + s;
    }

    // Extrai protocolo e autoridade (descarta caminhos como /player_api.php, /get.php, /c/, query e hash)
    var m = s.match(/^(https?):\/\/([^\/?#]+)/i);
    if (!m) {
      return {
        ok: false,
        server: '',
        host: '',
        port: null,
        error: 'Endereço do servidor inválido. Exemplo: http://servidor.com:8080'
      };
    }

    var scheme = m[1].toLowerCase();
    var authority = m[2];
    // Se tiver user:pass@host, separa apenas host:port
    if (authority.indexOf('@') !== -1) {
      authority = authority.split('@').pop();
    }

    var host = authority;
    var portStr = '';
    var colonIdx = authority.lastIndexOf(':');
    if (colonIdx !== -1) {
      host = authority.slice(0, colonIdx);
      portStr = authority.slice(colonIdx + 1);
    }

    host = host.toLowerCase();
    if (!isValidHostOrIp(host)) {
      return {
        ok: false,
        server: '',
        host: host,
        port: null,
        error: 'Nome do servidor inválido. Verifique se há um ponto no domínio (ex.: servidor.tv).'
      };
    }

    var port = null;
    if (portStr !== '') {
      if (!/^\d+$/.test(portStr)) {
        return {
          ok: false,
          server: '',
          host: host,
          port: null,
          error: 'A porta do servidor deve conter apenas números (1 a 65535).'
        };
      }
      port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return {
          ok: false,
          server: '',
          host: host,
          port: null,
          error: 'A porta do servidor deve estar entre 1 e 65535.'
        };
      }
    }

    // Remove portas padrão redundantes (:80 em http, :443 em https)
    var includePort = port !== null && !((scheme === 'http' && port === 80) || (scheme === 'https' && port === 443));
    var normalizedServer = scheme + '://' + host + (includePort ? (':' + port) : '');

    return {
      ok: true,
      scheme: scheme,
      server: normalizedServer,
      host: host,
      port: includePort ? port : null,
      extractedCredentials: extracted,
      error: null
    };
  }

  function normalizeCredential(rawVal) {
    // Remove apenas espaços/quebras no início e no fim, preservando maiúsculas/minúsculas e símbolos especiais
    return trimOuterWhitespace(rawVal);
  }

  function buildDefaultListName(host) {
    var cleanHost = String(host || '').replace(/^www\./i, '');
    return cleanHost ? ('Lista ' + cleanHost) : 'Minha Lista';
  }

  function validateXtreamInput(input) {
    var inp = input || {};
    var rawServer = inp.server || '';
    var extracted = detectXtreamCredentialsFromUrl(rawServer);
    var srvRes = normalizeXtreamServer(rawServer);

    if (!srvRes.ok) {
      return {
        ok: false,
        field: 'server',
        error: srvRes.error
      };
    }

    var username = normalizeCredential(inp.username || (extracted && extracted.username) || '');
    var password = normalizeCredential(inp.password || (extracted && extracted.password) || '');

    if (!username) {
      return {
        ok: false,
        field: 'username',
        error: 'Informe o nome de usuário da lista Xtream.',
        server: srvRes.server,
        extractedCredentials: extracted
      };
    }

    if (!password) {
      return {
        ok: false,
        field: 'password',
        error: 'Informe a senha da lista Xtream.',
        server: srvRes.server,
        username: username,
        extractedCredentials: extracted
      };
    }

    var name = trimOuterWhitespace(inp.name || '');
    if (!name) {
      name = buildDefaultListName(srvRes.host);
    }

    return {
      ok: true,
      type: 'xtream',
      name: name,
      server: srvRes.server,
      host: srvRes.host,
      username: username,
      password: password,
      extractedCredentials: extracted,
      error: null
    };
  }

  function normalizeM3uUrl(rawUrl) {
    var s = trimOuterWhitespace(rawUrl).replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
    if (!s) {
      return {
        ok: false,
        url: '',
        host: '',
        error: 'Informe o link M3U ou M3U8 da lista.'
      };
    }

    if (!/^https?:\/\//i.test(s)) {
      if (/^[a-z0-9]+:\/\//i.test(s)) {
        return {
          ok: false,
          url: '',
          host: '',
          error: 'O link da lista deve começar com http:// ou https://.'
        };
      }
      s = 'http://' + s;
    }

    var m = s.match(/^(https?):\/\/([^\/?#]+)(\/[^#]*)?/i);
    if (!m) {
      return {
        ok: false,
        url: '',
        host: '',
        error: 'Link M3U inválido. Verifique o endereço digitado.'
      };
    }

    var scheme = m[1].toLowerCase();
    var authority = m[2];
    var rest = m[3] || '/';
    var host = authority.indexOf(':') !== -1 ? authority.slice(0, authority.lastIndexOf(':')) : authority;
    var portStr = authority.indexOf(':') !== -1 ? authority.slice(authority.lastIndexOf(':') + 1) : '';

    if (!isValidHostOrIp(host)) {
      return {
        ok: false,
        url: '',
        host: host,
        error: 'O servidor no link M3U é inválido. Confira o domínio digitado.'
      };
    }

    if (portStr !== '') {
      var p = parseInt(portStr, 10);
      if (!/^\d+$/.test(portStr) || isNaN(p) || p < 1 || p > 65535) {
        return {
          ok: false,
          url: '',
          host: host,
          error: 'A porta informada no link M3U é inválida.'
        };
      }
    }

    var fullUrl = scheme + '://' + authority + rest;
    var detectedXtream = detectXtreamCredentialsFromUrl(fullUrl);

    return {
      ok: true,
      url: fullUrl,
      host: host.toLowerCase(),
      detectedXtream: detectedXtream,
      error: null
    };
  }

  function validateM3uInput(input) {
    var inp = input || {};
    var urlRes = normalizeM3uUrl(inp.url || '');
    if (!urlRes.ok) {
      return {
        ok: false,
        field: 'url',
        error: urlRes.error
      };
    }
    var name = trimOuterWhitespace(inp.name || '');
    if (!name) {
      name = buildDefaultListName(urlRes.host);
    }
    return {
      ok: true,
      type: 'm3u',
      name: name,
      url: urlRes.url,
      host: urlRes.host,
      detectedXtream: urlRes.detectedXtream,
      error: null
    };
  }

  var api = {
    cleanInvisibleAndQuotes: cleanInvisibleAndQuotes,
    trimOuterWhitespace: trimOuterWhitespace,
    isValidHostOrIp: isValidHostOrIp,
    detectXtreamCredentialsFromUrl: detectXtreamCredentialsFromUrl,
    normalizeXtreamServer: normalizeXtreamServer,
    normalizeCredential: normalizeCredential,
    buildDefaultListName: buildDefaultListName,
    validateXtreamInput: validateXtreamInput,
    normalizeM3uUrl: normalizeM3uUrl,
    validateM3uInput: validateM3uInput
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaListInput = api;
})(typeof window !== 'undefined' ? window : global);
