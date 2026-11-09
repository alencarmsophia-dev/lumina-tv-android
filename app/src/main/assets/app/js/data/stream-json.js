(function (global) {
  'use strict';

  // Decodificador UTF-8 incremental que preserva bytes incompletos de sequências multibyte (2, 3 e 4 bytes) entre chunks
  function createIncrementalUtf8Decoder() {
    var pendingBytes = [];

    function expectedByteLength(leadByte) {
      if ((leadByte & 0x80) === 0x00) return 1;
      if ((leadByte & 0xE0) === 0xC0) return 2;
      if ((leadByte & 0xF0) === 0xE0) return 3;
      if ((leadByte & 0xF8) === 0xF0) return 4;
      return 1;
    }

    function decodeCompleteBytes(bytesArr) {
      var out = '';
      var i = 0;
      var len = bytesArr.length;
      while (i < len) {
        var b0 = bytesArr[i] & 0xFF;
        if (b0 < 0x80) {
          out += String.fromCharCode(b0);
          i += 1;
        } else if ((b0 & 0xE0) === 0xC0) {
          if (i + 1 >= len) break;
          var b1 = bytesArr[i + 1] & 0x3F;
          var cp2 = ((b0 & 0x1F) << 6) | b1;
          out += String.fromCharCode(cp2);
          i += 2;
        } else if ((b0 & 0xF0) === 0xE0) {
          if (i + 2 >= len) break;
          var b21 = bytesArr[i + 1] & 0x3F;
          var b22 = bytesArr[i + 2] & 0x3F;
          var cp3 = ((b0 & 0x0F) << 12) | (b21 << 6) | b22;
          out += String.fromCharCode(cp3);
          i += 3;
        } else if ((b0 & 0xF8) === 0xF0) {
          if (i + 3 >= len) break;
          var b31 = bytesArr[i + 1] & 0x3F;
          var b32 = bytesArr[i + 2] & 0x3F;
          var b33 = bytesArr[i + 3] & 0x3F;
          var cp4 = ((b0 & 0x07) << 18) | (b31 << 12) | (b32 << 6) | b33;
          cp4 -= 0x10000;
          out += String.fromCharCode(0xD800 + ((cp4 >> 10) & 0x3FF), 0xDC00 + (cp4 & 0x3FF));
          i += 4;
        } else {
          out += '\uFFFD';
          i += 1;
        }
      }
      pendingBytes = i < len ? bytesArr.slice(i) : [];
      return out;
    }

    return {
      pushBytes: function (byteChunk) {
        if (!byteChunk || !byteChunk.length) return '';
        var combined = pendingBytes.slice();
        for (var i = 0; i < byteChunk.length; i++) {
          combined.push(byteChunk[i] & 0xFF);
        }
        return decodeCompleteBytes(combined);
      },
      flush: function () {
        if (!pendingBytes.length) return '';
        pendingBytes = [];
        return '\uFFFD';
      },
      hasPending: function () {
        return pendingBytes.length > 0;
      }
    };
  }

  function createParser(options) {
    var opts = options || {};
    var onItem = typeof opts.onItem === 'function' ? opts.onItem : null;
    var onError = typeof opts.onError === 'function' ? opts.onError : null;
    var onEnd = typeof opts.onEnd === 'function' ? opts.onEnd : null;

    var utf8Decoder = createIncrementalUtf8Decoder();
    var pendingHighSurrogate = '';
    var startedArray = false;
    var finishedArray = false;
    var braceDepth = 0;
    var inString = false;
    var escapeNext = false;
    var currentObjectChars = [];
    var itemsCount = 0;
    var bytesProcessed = 0;
    var hasFailed = false;
    var nonWhitespaceSeen = false;

    function emitParserError(code, msg) {
      if (hasFailed) return;
      hasFailed = true;
      var errObj = {
        code: code || 'JSON_PARSE_ERROR',
        humanMessage: msg || 'A resposta JSON do servidor está incompleta ou corrompida.'
      };
      if (onError) onError(errObj);
    }

    function processTextChunk(textChunk) {
      if (hasFailed || !textChunk) return;
      var str = pendingHighSurrogate + textChunk;
      pendingHighSurrogate = '';

      if (str.length > 0) {
        var lastCode = str.charCodeAt(str.length - 1);
        if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
          pendingHighSurrogate = str.charAt(str.length - 1);
          str = str.slice(0, -1);
        }
      }

      var len = str.length;
      var objStartIdx = braceDepth > 0 ? 0 : -1;

      for (var i = 0; i < len; i++) {
        var c = str.charCodeAt(i);

        // Ignora BOM UTF-8 no início
        if (!nonWhitespaceSeen && c === 0xFEFF) {
          continue;
        }

        if (!startedArray) {
          if (c === 32 || c === 9 || c === 10 || c === 13) continue;
          nonWhitespaceSeen = true;
          if (c === 91) { // '['
            startedArray = true;
            continue;
          } else {
            emitParserError('JSON_NOT_ARRAY', 'O servidor enviou uma resposta que não é uma lista JSON válida.');
            return;
          }
        }

        if (finishedArray) {
          if (c === 32 || c === 9 || c === 10 || c === 13) continue;
          emitParserError('JSON_TRAILING_DATA', 'Dados inválidos após o fim da lista JSON.');
          return;
        }

        if (braceDepth === 0) {
          if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) { // espaço ou ','
            continue;
          }
          if (c === 93) { // ']' fim do array principal
            finishedArray = true;
            continue;
          }
          if (c === 123) { // '{' início de um objeto do array
            braceDepth = 1;
            objStartIdx = i;
            continue;
          }
          emitParserError('JSON_INVALID_TOKEN', 'Elemento inesperado dentro da lista JSON.');
          return;
        }

        // Estamos dentro de um objeto (braceDepth >= 1)
        if (inString) {
          if (escapeNext) {
            escapeNext = false;
          } else if (c === 92) { // '\'
            escapeNext = true;
          } else if (c === 34) { // '"'
            inString = false;
          }
        } else {
          if (c === 34) { // '"'
            inString = true;
          } else if (c === 123) { // '{'
            braceDepth++;
          } else if (c === 125) { // '}'
            braceDepth--;
            if (braceDepth === 0) {
              var piece = str.slice(objStartIdx, i + 1);
              var fullObjStr = currentObjectChars.length > 0
                ? (currentObjectChars.join('') + piece)
                : piece;
              currentObjectChars = [];
              objStartIdx = -1;
              try {
                var parsedObj = JSON.parse(fullObjStr);
                var idx = itemsCount++;
                if (onItem) onItem(parsedObj, idx);
              } catch (ex) {
                emitParserError('JSON_MALFORMED_OBJECT', 'Objeto JSON malformado na posição ' + itemsCount + ': ' + ex.message);
                return;
              }
            }
          }
        }
      }

      if (braceDepth > 0 && objStartIdx !== -1) {
        currentObjectChars.push(str.slice(objStartIdx));
      }
    }

    function write(chunk) {
      if (hasFailed || chunk === null || chunk === undefined) return;
      if (typeof chunk === 'string') {
        bytesProcessed += chunk.length;
        processTextChunk(chunk);
      } else if (typeof Uint8Array !== 'undefined' && (chunk instanceof Uint8Array || Array.isArray(chunk) || (typeof Buffer !== 'undefined' && Buffer.isBuffer(chunk)))) {
        bytesProcessed += chunk.length;
        var decoded = utf8Decoder.pushBytes(chunk);
        if (decoded) processTextChunk(decoded);
      } else {
        var s = String(chunk);
        bytesProcessed += s.length;
        processTextChunk(s);
      }
    }

    function end() {
      if (hasFailed) return;
      if (utf8Decoder.hasPending() || pendingHighSurrogate) {
        emitParserError('JSON_TRUNCATED', 'A resposta do servidor foi interrompida no meio de um caractere UTF-8 (JSON truncado).');
        return;
      }
      if (!startedArray || !finishedArray || braceDepth !== 0 || inString) {
        emitParserError('JSON_TRUNCATED', 'A resposta do servidor foi interrompida antes do fim (JSON truncado).');
        return;
      }
      if (onEnd) {
        onEnd({ itemsCount: itemsCount, bytesProcessed: bytesProcessed });
      }
    }

    return {
      write: write,
      end: end,
      getStats: function () {
        return {
          itemsCount: itemsCount,
          bytesProcessed: bytesProcessed,
          finishedArray: finishedArray,
          hasFailed: hasFailed
        };
      }
    };
  }

  var api = {
    createIncrementalUtf8Decoder: createIncrementalUtf8Decoder,
    createParser: createParser
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaStreamJson = api;
})(typeof window !== 'undefined' ? window : global);
