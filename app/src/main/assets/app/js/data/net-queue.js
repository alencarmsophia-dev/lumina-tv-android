(function (global) {
  'use strict';

  var MAX_CONCURRENT = 2;
  var PRIORITY_WEIGHT = { high: 3, normal: 2, low: 1 };
  var queue = [];
  var inFlight = {};
  var inFlightCount = 0;
  var reqSeq = 0;
  var pausedLowPriority = false;
  var rateLimitUntilMs = 0;
  var stats = {
    completed: 0,
    aborted: 0,
    failed: 0,
    rateLimited: 0
  };

  function setLowPriorityPaused(paused) {
    pausedLowPriority = !!paused;
    if (!pausedLowPriority) {
      pump();
    }
  }

  function pickNextJobIndex() {
    var bestIdx = -1;
    var bestWeight = -1;
    for (var i = 0; i < queue.length; i++) {
      var job = queue[i];
      var w = PRIORITY_WEIGHT[job.priority] || 2;
      if (pausedLowPriority && job.priority === 'low') continue;
      if (w > bestWeight) {
        bestWeight = w;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function pump() {
    if (inFlightCount >= MAX_CONCURRENT) return;
    var now = Date.now();
    if (rateLimitUntilMs > now) {
      setTimeout(pump, Math.min(5000, rateLimitUntilMs - now + 10));
      return;
    }

    while (inFlightCount < MAX_CONCURRENT && queue.length > 0) {
      var nextIdx = pickNextJobIndex();
      if (nextIdx === -1) break;
      var job = queue.splice(nextIdx, 1)[0];
      executeJob(job);
    }
  }

  function executeJob(job) {
    if (job.aborted) {
      stats.aborted++;
      return;
    }
    inFlightCount++;
    inFlight[job.id] = job;
    var startMs = Date.now();

    var handle = job.executor(
      function onDone(err, result, meta) {
        if (!inFlight[job.id]) return;
        delete inFlight[job.id];
        inFlightCount = Math.max(0, inFlightCount - 1);

        var m = meta || {};
        var status = Number(m.httpStatus || (err && err.httpStatus) || (err ? 0 : 200));

        if (job.aborted) {
          stats.aborted++;
          pump();
          return;
        }

        if (status === 429) {
          stats.rateLimited++;
          var retryAfterSec = Number(m.retryAfterSec || (err && err.retryAfterSec) || 0);
          var backoffMs = retryAfterSec > 0
            ? (retryAfterSec * 1000)
            : (Math.pow(2, job.attempt) * 1500);
          rateLimitUntilMs = Date.now() + Math.min(60000, backoffMs);
          if (job.attempt < 3) {
            job.attempt++;
            queue.unshift(job);
            setTimeout(pump, Math.min(5000, backoffMs));
            return;
          }
        }

        if (err) {
          stats.failed++;
          if (global.LuminaDiagLog) {
            global.LuminaDiagLog.record('error', {
              engine: 'NetQueue',
              url: job.url || '',
              httpStatus: status,
              code: err.code || 'NET_QUEUE_ERR',
              elapsedMs: Date.now() - startMs,
              message: err.message || 'Erro na fila de rede'
            });
          }
        } else {
          stats.completed++;
        }

        if (job.callback) {
          job.callback(err, result, m);
        }
        pump();
      }
    );

    job.cancelHandle = handle;
  }

  function enqueue(options, callback) {
    var opts = options || {};
    var id = 'nq_' + (++reqSeq);
    var job = {
      id: id,
      tag: String(opts.tag || 'default'),
      priority: opts.priority || 'normal',
      url: String(opts.url || ''),
      executor: opts.executor,
      callback: callback,
      attempt: 0,
      aborted: false,
      cancelHandle: null
    };
    queue.push(job);
    pump();

    return {
      id: id,
      abort: function () {
        abortById(id);
      }
    };
  }

  function abortById(id) {
    for (var i = queue.length - 1; i >= 0; i--) {
      if (queue[i].id === id) {
        var removed = queue.splice(i, 1)[0];
        removed.aborted = true;
        stats.aborted++;
        if (removed.callback) {
          var abortErr = new Error('Requisição cancelada.');
          abortErr.code = 'ABORTED';
          removed.callback(abortErr, null);
        }
        return true;
      }
    }
    var active = inFlight[id];
    if (active) {
      active.aborted = true;
      delete inFlight[id];
      inFlightCount = Math.max(0, inFlightCount - 1);
      stats.aborted++;
      if (active.cancelHandle && typeof active.cancelHandle.abort === 'function') {
        try { active.cancelHandle.abort(); } catch (e) {}
      }
      if (active.callback) {
        var abortErr2 = new Error('Requisição cancelada.');
        abortErr2.code = 'ABORTED';
        active.callback(abortErr2, null);
      }
      pump();
      return true;
    }
    return false;
  }

  function abortByTag(tag) {
    var count = 0;
    for (var i = queue.length - 1; i >= 0; i--) {
      if (queue[i].tag === tag) {
        var job = queue.splice(i, 1)[0];
        job.aborted = true;
        stats.aborted++;
        count++;
        if (job.callback) {
          var err = new Error('Requisição abortada ao sair da aba.');
          err.code = 'ABORTED';
          job.callback(err, null);
        }
      }
    }
    var activeIds = Object.keys(inFlight);
    for (var j = 0; j < activeIds.length; j++) {
      var act = inFlight[activeIds[j]];
      if (act && act.tag === tag) {
        if (abortById(act.id)) count++;
      }
    }
    return count;
  }

  function resetForTests() {
    var ids = Object.keys(inFlight);
    for (var i = 0; i < ids.length; i++) abortById(ids[i]);
    queue = [];
    inFlight = {};
    inFlightCount = 0;
    pausedLowPriority = false;
    rateLimitUntilMs = 0;
    stats = { completed: 0, aborted: 0, failed: 0, rateLimited: 0 };
  }

  var api = {
    MAX_CONCURRENT: MAX_CONCURRENT,
    enqueue: enqueue,
    abortById: abortById,
    abortByTag: abortByTag,
    setLowPriorityPaused: setLowPriorityPaused,
    getInFlightCount: function () { return inFlightCount; },
    getQueueLength: function () { return queue.length; },
    getStats: function () { return JSON.parse(JSON.stringify(stats)); },
    resetForTests: resetForTests
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaNetQueue = api;
})(typeof window !== 'undefined' ? window : global);
