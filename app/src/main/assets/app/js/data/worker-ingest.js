importScripts('classifier.js', 'm3u-parser.js');

self.onmessage = function (e) {
  var data = e.data || {};
  if (data.cmd === 'PARSE_M3U') {
    LuminaM3UParser.parseChunkedAsync(
      data.text || '',
      data.sourceId || 'worker-src',
      function (raw) { return raw; },
      function (prog) { self.postMessage({ type: 'PROGRESS', payload: prog }); },
      function (err, rawItems) {
        if (err) self.postMessage({ type: 'ERROR', error: String(err) });
        else self.postMessage({ type: 'DONE', rawItems: rawItems });
      }
    );
  }
};
