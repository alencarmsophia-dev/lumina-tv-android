(function (global) {
  'use strict';
  var entries = [];
  function push(level, tag, msg) {
    entries.push({
      ts: new Date().toISOString().slice(11, 19),
      level: level,
      tag: tag,
      msg: typeof msg === 'string' ? msg : JSON.stringify(msg)
    });
    if (entries.length > 80) entries.shift();
  }
  global.LuminaLog = {
    info: function (tag, msg) { push('INFO', tag, msg); },
    warn: function (tag, msg) { push('WARN', tag, msg); },
    error: function (tag, err) { push('ERR', tag, err && err.message ? err.message : String(err)); },
    getRecent: function () { return entries.slice(); }
  };
})(typeof window !== 'undefined' ? window : global);
