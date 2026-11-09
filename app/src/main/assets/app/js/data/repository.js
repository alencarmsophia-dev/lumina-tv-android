(function (global) {
  'use strict';

  var M3U_DOWNLOAD_TIMEOUT_MS = 180000;
  var SLICE_READ_BYTES = 1024 * 1024; // 1 MB por fatia (Parte 3.3 e 4.1)
  var activeDownloadSource = null;
  var activeImportControl = null;

  // Parte 7.7 e 13.8h: Verifica se a atualização em segundo plano precisa de reflow comparando os 40 primeiros IDs
  function evaluateBackgroundUpdateDiff(oldFirst40Ids, newFirst40Ids) {
    if (!Array.isArray(oldFirst40Ids) || !Array.isArray(newFirst40Ids)) {
      return { sameTop40: false, needsReflow: true };
    }
    if (oldFirst40Ids.length !== newFirst40Ids.length || oldFirst40Ids.length === 0) {
      return { sameTop40: false, needsReflow: true };
    }
    var limit = Math.min(40, oldFirst40Ids.length);
    for (var i = 0; i < limit; i++) {
      if (oldFirst40Ids[i] !== newFirst40Ids[i]) {
        return { sameTop40: false, needsReflow: true };
      }
    }
    return { sameTop40: true, needsReflow: false };
  }

  function updateStoreImportStatus(patch) {
    if (!global.LuminaStore) return;
    var cur = global.LuminaStore.get('importStatus') || {};
    var keys = Object.keys(patch || {});
    for (var i = 0; i < keys.length; i++) {
      cur[keys[i]] = patch[keys[i]];
    }
    global.LuminaStore.set('importStatus', cur);
  }

  function cancelActiveLoad() {
    if (activeDownloadSource && typeof activeDownloadSource.cancel === 'function') {
      activeDownloadSource.cancel();
      activeDownloadSource = null;
    }
    if (activeImportControl) {
      activeImportControl.cancelled = true;
      activeImportControl = null;
    }
    updateStoreImportStatus({ active: false, paused: false, stage: 'Cancelado' });
    return true;
  }

  function pauseActiveImport() {
    if (activeDownloadSource && typeof activeDownloadSource.pause === 'function') {
      activeDownloadSource.pause();
    }
    if (activeImportControl) {
      activeImportControl.paused = true;
    }
    updateStoreImportStatus({ paused: true, stage: 'Pausado' });
  }

  function resumeActiveImport() {
    if (activeDownloadSource && typeof activeDownloadSource.resume === 'function') {
      activeDownloadSource.resume();
    }
    if (activeImportControl && activeImportControl.paused) {
      activeImportControl.paused = false;
      if (typeof activeImportControl.continueStep === 'function') {
        activeImportControl.continueStep();
      }
    }
    updateStoreImportStatus({ paused: false });
  }

  // Importa um arquivo/buffer M3U em fatias de 1 MB com suporte a checkpoint e retomada exata (Parte 4.1–4.7)
  function runChunkedM3uImportFromSource(listId, sourceReader, totalBytes, options, onProgress, callback) {
    var opts = options || {};
    var sliceSize = opts.sliceSize || SLICE_READ_BYTES;
    var session = global.LuminaImportWorker.createStreamingImportSession({
      listId: listId,
      generationId: opts.generationId || ('gen_' + Date.now()),
      storage: opts.storage || global.LuminaStorage,
      classifier: opts.classifier || global.LuminaClassifier,
      simulateCrashAtByteOffset: opts.simulateCrashAtByteOffset || -1
    });

    var control = {
      cancelled: false,
      paused: false,
      continueStep: null
    };
    activeImportControl = control;

    function startReadingFrom(startOffset) {
      var offset = startOffset;

      function nextSlice() {
        if (control.cancelled) {
          return callback(new Error('Importação cancelada pelo usuário.'), null);
        }
        if (control.paused) {
          control.continueStep = nextSlice;
          return;
        }
        // Parte 14: Pausa importação em 2º plano enquanto um vídeo estiver tocando para não competir com o player
        if (!opts.ignorePlayerPause && global.LuminaPlayer && global.LuminaPlayer.getState && global.LuminaPlayer.getState() === 'PLAYING') {
          setTimeout(nextSlice, 1000);
          return;
        }

        sourceReader(offset, sliceSize, function (readErr, chunk) {
          if (readErr) return callback(readErr, null);
          var len = chunk ? chunk.length : 0;
          var isLast = (len === 0) || (totalBytes > 0 && (offset + len) >= totalBytes);

          session.processByteOrTextSlice(chunk, len, isLast, function (procErr) {
            if (procErr) {
              // Se ocorreu falha/interrupção, grava checkpoint para retomar depois! (Parte 4.3)
              session.saveCheckpointSnapshot(function () {
                callback(procErr, null);
              });
              return;
            }

            offset += len;
            var st = session.getStats();
            var pct = totalBytes > 0 ? Math.min(99, Math.round((offset / totalBytes) * 100)) : 50;

            updateStoreImportStatus({
              active: true,
              paused: false,
              stage: 'Indexando lista… ' + pct + '%',
              percent: pct,
              availableItems: st.totalEntries
            });

            if (onProgress) {
              onProgress({
                stage: 'Indexando (' + pct + '% \u00B7 ' + st.totalEntries + ' itens)',
                percent: pct,
                itemsCount: st.totalEntries,
                stats: st
              });
            }

            if (isLast) {
              session.finalizeImport(function (finErr, listMeta) {
                activeImportControl = null;
                updateStoreImportStatus({
                  active: false,
                  paused: false,
                  stage: 'Pronto',
                  percent: 100,
                  availableItems: st.totalEntries
                });
                if (finErr) return callback(finErr, null);
                if (global.LuminaStore) {
                  global.LuminaStore.set('listCatalogMeta', listMeta.sections);
                  global.LuminaStore.set('needsV22Migration', false);
                }
                if (global.LuminaCatalog) {
                  global.LuminaCatalog.clearMemoryCaches();
                  global.LuminaCatalog.notifySubscribers('all', { type: 'import-complete', listMeta: listMeta });
                }
                callback(null, listMeta);
              });
            } else {
              if (opts.syncLoopForTests) {
                nextSlice();
              } else {
                setTimeout(nextSlice, 0);
              }
            }
          });
        });
      }

      nextSlice();
    }

    // Verifica se há um checkpoint salvo para retomar de onde parou (Parte 4.3)
    var st = opts.storage || global.LuminaStorage;
    if (opts.resumeFromCheckpoint && st) {
      st.getRecord('checkpoints', listId, function (_, cpRec) {
        if (cpRec && cpRec.byteOffset > 0) {
          session.restoreFromCheckpoint(cpRec);
          var resumePct = totalBytes > 0 ? Math.round((cpRec.byteOffset / totalBytes) * 100) : 0;
          if (onProgress) {
            onProgress({
              stage: 'Retomando importação\u2026 ' + resumePct + '%',
              percent: resumePct,
              resumedFromOffset: cpRec.byteOffset
            });
          }
          startReadingFrom(cpRec.byteOffset);
        } else {
          startReadingFrom(0);
        }
      });
    } else {
      startReadingFrom(0);
    }
  }

  // Importa M3U diretamente de uma string ou Uint8Array (usado em testes de 50k..1M e no WebStreamSource em memória)
  function importM3uBufferOrText(listId, bufferOrText, options, onProgress, callback) {
    var u8 = bufferOrText;
    if (typeof bufferOrText === 'string') {
      if (typeof Buffer !== 'undefined') {
        u8 = new Uint8Array(Buffer.from(bufferOrText, 'utf8'));
      } else if (typeof TextEncoder !== 'undefined') {
        u8 = new TextEncoder().encode(bufferOrText);
      } else {
        u8 = new Uint8Array(bufferOrText.length);
        for (var i = 0; i < bufferOrText.length; i++) u8[i] = bufferOrText.charCodeAt(i) & 0xFF;
      }
    }

    var totalBytes = u8.length;
    var reader = function (offset, length, cb) {
      if (offset >= totalBytes) return cb(null, new Uint8Array(0));
      var end = Math.min(totalBytes, offset + length);
      cb(null, u8.subarray(offset, end));
    };

    runChunkedM3uImportFromSource(listId, reader, totalBytes, options, onProgress, callback);
  }

  // Parte 3.1 e 4: Baixa M3U via LuminaListSource e importa em fluxo com checkpoint
  function loadFromUrlOrLocalPath(url, sourceId, onProgress, callback, options) {
    var opts = options || {};
    var listId = sourceId || (global.LuminaStore ? global.LuminaStore.buildListId({ type: 'm3u', url: url }) : 'm3u_default');
    cancelActiveLoad();

    var dlSource = global.LuminaListSource.createSource({
      listId: listId,
      url: url,
      ext: 'm3u',
      userAgent: opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20',
      onProgress: function (p) {
        var mbDone = (p.bytesDone / 1048576).toFixed(1);
        var mbTotal = p.bytesTotal ? (' / ' + (p.bytesTotal / 1048576).toFixed(1) + ' MB') : ' MB';
        var pct = p.bytesTotal ? Math.min(45, Math.round((p.bytesDone / p.bytesTotal) * 45)) : 20;
        var msg = p.message || ('Baixando a lista (' + mbDone + mbTotal + ')…');
        updateStoreImportStatus({
          active: true,
          paused: false,
          stage: msg,
          percent: pct,
          bytesDone: p.bytesDone,
          bytesTotal: p.bytesTotal,
          speedBps: p.speedBps,
          etaSec: p.etaSec
        });
        if (onProgress) onProgress({ stage: msg, percent: pct, downloadProgress: p });
      },
      onDone: function (dlRes) {
        activeDownloadSource = null;
        // Confere cabeçalho #EXTM3U nos primeiros 2 KB antes de indexar (Parte 11 e 12)
        dlSource.readSlice(0, 2048, function (hErr, headSlice) {
          if (hErr || !headSlice || !headSlice.length) {
            return callback(new Error('A lista baixada está vazia.'), null);
          }
          var headStr = global.LuminaImportWorker.createUtf8ChunkDecoder().decodeChunk(headSlice, true).trim();
          if (/^<!DOCTYPE\s+html|^<html/i.test(headStr)) {
            return callback(new Error('O servidor pediu login ou retornou uma página web em vez da lista M3U.'), null);
          }
          if (headStr.indexOf('#EXTM3U') === -1 && headStr.indexOf('#EXTINF') === -1) {
            return callback(new Error('O arquivo baixado não é uma lista M3U válida (não começa com #EXTM3U).'), null);
          }

          runChunkedM3uImportFromSource(
            listId,
            function (offset, length, rCb) {
              dlSource.readSlice(offset, length, rCb);
            },
            dlRes.sizeBytes,
            opts,
            onProgress,
            function (impErr, listMeta) {
              if (impErr) return callback(impErr, null);
              callback(null, listMeta, { stats: listMeta.stats });
            }
          );
        });
      },
      onError: function (dlErr) {
        activeDownloadSource = null;
        updateStoreImportStatus({ active: false, error: dlErr });
        var err = new Error(dlErr.humanMessage || 'Falha no download da lista.');
        err.code = dlErr.code || 'DOWNLOAD_ERROR';
        callback(err, null);
      }
    });

    activeDownloadSource = dlSource;
    dlSource.start();
  }

  // Parte 5.1: Conectar Xtream baixa apenas autenticação e categorias!
  function loadFromXtream(creds, onProgress, callback, options) {
    var opts = options || {};
    var listId = opts.listId || (global.LuminaStore ? global.LuminaStore.buildListId({ type: 'xtream', creds: creds }) : 'xt_default');
    global.LuminaXtream.connectXtreamAndLoadCategories(creds, listId, onProgress, function (err, res) {
      if (err) return callback(err, null);
      if (global.LuminaStore) {
        global.LuminaCatalog.getListState(listId, function (_, st) {
          if (st && st.sections) global.LuminaStore.set('listCatalogMeta', st.sections);
          callback(null, res, { categoryCounts: res.categoryCounts });
        });
      } else {
        callback(null, res, { categoryCounts: res.categoryCounts });
      }
    }, opts);
  }

  // Parte 6.6: Troca instantânea entre listas salvas quando já importadas
  function activateSavedList(listId, onProgress, callback) {
    var store = global.LuminaStore;
    if (!store) return callback && callback(new Error('Store indisponível'));
    var savedLists = store.get('savedLists') || [];
    var target = null;
    for (var i = 0; i < savedLists.length; i++) {
      if (savedLists[i].id === listId) {
        target = savedLists[i];
        break;
      }
    }
    if (!target) {
      return callback && callback(new Error('Lista salva não encontrada.'));
    }

    var oldListId = store.get('activeListId');
    if (oldListId && global.LuminaStorage) {
      global.LuminaStorage.saveMeta('favorites_' + oldListId, store.get('favorites') || {});
      global.LuminaStorage.saveMeta('watchProgress_' + oldListId, store.get('watchProgress') || {});
    }

    store.set('activeListId', target.id);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('activeListId', target.id);

    var srcObj = target.type === 'xtream'
      ? { id: target.id, type: 'xtream', name: target.name, creds: target.creds }
      : { id: target.id, type: 'm3u', name: target.name, url: target.url };
    store.set('source', srcObj);
    if (target.type === 'xtream' && target.creds) store.set('xtreamCreds', target.creds);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('source', srcObj);

    if (global.LuminaCatalog) global.LuminaCatalog.clearMemoryCaches();

    global.LuminaStorage.loadMeta('favorites_' + target.id, {}, function (favs) {
      store.set('favorites', favs || {});
      global.LuminaStorage.loadMeta('watchProgress_' + target.id, {}, function (prog) {
        store.set('watchProgress', prog || {});
        global.LuminaCatalog.getListState(target.id, function (_, listState) {
          var hasReadyData = listState && listState.generationId;
          if (hasReadyData) {
            store.set('listCatalogMeta', listState.sections);
            return callback && callback(null, listState);
          }
          // Se a lista salva ainda não tinha sido importada no formato v2.2.0:
          if (target.type === 'xtream' && target.creds) {
            loadFromXtream(target.creds, onProgress, callback, { listId: target.id });
          } else if (target.type === 'm3u' && target.url) {
            loadFromUrlOrLocalPath(target.url, target.id, onProgress, callback);
          } else {
            callback && callback(null, listState);
          }
        });
      });
    });
  }

  // Parte 6.7: Organizador de grupos opera apenas no perfil salvo (aplicado na leitura de getGroups, sem reprocessar itens!)
  function applyMappingAndPersist(newProfile, cb) {
    var curProfile = global.LuminaStore.get('mappingProfile');
    if (curProfile) {
      var undoStack = (global.LuminaStore.get('organizerUndoStack') || []).slice(-9);
      undoStack.push(JSON.parse(JSON.stringify(curProfile)));
      global.LuminaStore.set('organizerUndoStack', undoStack);
    }
    global.LuminaStore.set('mappingProfile', newProfile);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('mappingProfile', newProfile);
    if (global.LuminaCatalog) global.LuminaCatalog.clearMemoryCaches();
    if (cb) cb();
  }

  function undoLastMappingChange(cb) {
    var stack = (global.LuminaStore.get('organizerUndoStack') || []).slice();
    if (!stack.length) return cb && cb(false);
    var prev = stack.pop();
    global.LuminaStore.set('organizerUndoStack', stack);
    global.LuminaStore.set('mappingProfile', prev);
    if (global.LuminaStorage) global.LuminaStorage.saveMeta('mappingProfile', prev);
    if (global.LuminaCatalog) global.LuminaCatalog.clearMemoryCaches();
    if (cb) cb(true);
  }

  // Testador de stream sem abrir vídeo ("Testar minha lista") adaptado para LuminaCatalog (Parte 1)
  function testMyListStreams(callback, onProgress) {
    var store = global.LuminaStore;
    if (!store) return callback && callback(new Error('Store indisponível'));

    global.LuminaCatalog.getPage('live', 'all', 'default', 0, function (_, livePage) {
      global.LuminaCatalog.getPage('movie', 'all', 'default', 0, function (_, moviePage) {
        var samples = [];
        var liveItems = (livePage && livePage.items) || [];
        var movieItems = (moviePage && moviePage.items) || [];

        if (liveItems.length) {
          samples.push({ label: 'Canal ao vivo', title: liveItems[0].cleanTitle, url: liveItems[0].url, item: liveItems[0] });
        }
        if (movieItems.length) {
          samples.push({ label: 'Filme', title: movieItems[0].cleanTitle, url: movieItems[0].url, item: movieItems[0] });
        }
        if (liveItems.length > 1) {
          samples.push({ label: 'Canal #2', title: liveItems[1].cleanTitle, url: liveItems[1].url, item: liveItems[1] });
        }

        if (!samples.length) {
          return callback(new Error('Abra uma categoria de canais ou filmes primeiro para testar os streams da lista.'), null);
        }

        var results = [];
        var idx = 0;

        function testNext() {
          if (idx >= samples.length) {
            var allOk = true;
            var any403 = false;
            var anyTimeout = false;
            for (var i = 0; i < results.length; i++) {
              if (!results[i].ok) allOk = false;
              if (results[i].httpStatus === 401 || results[i].httpStatus === 403) any403 = true;
              if (/timeout|tempo/i.test(String(results[i].error || ''))) anyTimeout = true;
            }
            var recommendation = 'Tudo pronto! Os streams da sua lista estão respondendo normalmente.';
            if (!allOk) {
              if (any403) {
                recommendation = 'O servidor recusou a conexão (HTTP 401/403). Experimente mudar o User-Agent em Ajustes > Player ou verifique se outra TV está usando sua conta.';
              } else if (anyTimeout) {
                recommendation = 'O servidor demorou para responder. Experimente trocar o Formato preferido ao vivo para MPEG-TS (.ts) ou aumentar o Buffer.';
              } else {
                recommendation = 'Alguns itens falharam no teste. Verifique sua conexão ou atualize a categoria.';
              }
            }
            var summary = { testedAt: Date.now(), results: results, allOk: allOk, recommendation: recommendation };
            store.set('streamTestResults', summary);
            store.set('streamTestRunning', false);
            return callback(null, summary);
          }

          var sample = samples[idx++];
          var ua = (global.LuminaPlayer && global.LuminaPlayer.resolveUserAgentForItem)
            ? global.LuminaPlayer.resolveUserAgentForItem(sample.item, sample.url)
            : 'VLC/3.0.20 LibVLC/3.0.20';

          if (onProgress) onProgress({ index: idx, total: samples.length, title: sample.title });

          global.LuminaPlatform.probeStream(sample.url, ua, 8000, function (_, probeRes) {
            var r = probeRes || { ok: false, httpStatus: 0, elapsedMs: 0, error: 'Sem resposta' };
            results.push({
              label: sample.label,
              title: sample.title,
              ok: !!r.ok,
              httpStatus: Number(r.httpStatus || 0),
              elapsedMs: Number(r.elapsedMs || 0),
              detectedFormat: r.detectedFormat || '-',
              error: r.error || ''
            });
            setTimeout(testNext, 50);
          });
        }

        store.set('streamTestRunning', true);
        testNext();
      });
    });
  }

  var api = {
    M3U_DOWNLOAD_TIMEOUT_MS: M3U_DOWNLOAD_TIMEOUT_MS,
    SLICE_READ_BYTES: SLICE_READ_BYTES,
    evaluateBackgroundUpdateDiff: evaluateBackgroundUpdateDiff,
    runChunkedM3uImportFromSource: runChunkedM3uImportFromSource,
    importM3uBufferOrText: importM3uBufferOrText,
    loadFromUrlOrLocalPath: loadFromUrlOrLocalPath,
    loadFromXtream: loadFromXtream,
    activateSavedList: activateSavedList,
    applyMappingAndPersist: applyMappingAndPersist,
    undoLastMappingChange: undoLastMappingChange,
    cancelActiveLoad: cancelActiveLoad,
    pauseActiveImport: pauseActiveImport,
    resumeActiveImport: resumeActiveImport,
    testMyListStreams: testMyListStreams
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaRepository = api;
})(typeof window !== 'undefined' ? window : global);
