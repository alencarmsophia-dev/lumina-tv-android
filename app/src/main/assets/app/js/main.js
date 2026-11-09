(function (global) {
  'use strict';

  function loadAppConfig(done) {
    try {
      if (typeof XMLHttpRequest === 'undefined') return done();
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'app-config.json', true);
      xhr.timeout = 2000;
      xhr.onload = function () {
        try {
          var cfg = JSON.parse(xhr.responseText);
          if (cfg.pairing && cfg.pairing.baseUrl) {
            global.LuminaStore.set('pairingBaseUrl', cfg.pairing.baseUrl);
          }
          if (cfg.tmdb && cfg.tmdb.apiKey) {
            var curTmdb = global.LuminaStore.get('tmdb') || {};
            global.LuminaStore.set('tmdb', {
              enabled: true,
              apiKey: cfg.tmdb.apiKey,
              language: cfg.tmdb.language || 'pt-BR',
              enrichedCount: curTmdb.enrichedCount || 0
            });
          }
        } catch (e) {}
        done();
      };
      xhr.onerror = done;
      xhr.ontimeout = done;
      xhr.send();
    } catch (e) {
      done();
    }
  }

  function runOptionalDeferredTasksAfter3Seconds() {
    // Parte 9.2: Em Modo Seguro, NÃO executa nenhuma tarefa em segundo plano!
    if (global.LuminaBootGuard && global.LuminaBootGuard.isSafeMode()) {
      return;
    }

    var activeListId = global.LuminaStore.get('activeListId') || 'default_list';
    var src = global.LuminaStore.get('source');

    // 1. Verifica se há um checkpoint de importação M3U interrompida para retomar (Parte 4.3 e 9.1)
    if (src && src.type === 'm3u' && src.url && global.LuminaStorage) {
      global.LuminaStorage.getRecord('checkpoints', activeListId, function (_, cpRec) {
        if (cpRec && cpRec.byteOffset > 0) {
          if (global.LuminaUI && global.LuminaUI.toast) {
            global.LuminaUI.toast('Retomando importação interrompida…');
          }
          global.LuminaRepository.loadFromUrlOrLocalPath(
            src.url,
            activeListId,
            function () {
              if (global.LuminaUI && global.LuminaUI.renderCurrentRoute) {
                global.LuminaUI.renderCurrentRoute();
              }
            },
            function () {
              if (global.LuminaUI && global.LuminaUI.renderCurrentRoute) {
                global.LuminaUI.renderCurrentRoute();
              }
            },
            { resumeFromCheckpoint: true }
          );
        }
      });
    }

    // 2. Limpa blocos antigos g*:chunk:* da v2.1.0 em pequenos lotes quando a nova geração já estiver pronta (Parte 10.2)
    if (global.LuminaCatalog && global.LuminaStorage) {
      global.LuminaCatalog.getListState(activeListId, function (_, state) {
        if (state && state.generationId) {
          global.LuminaStorage.cleanupLegacyV21ChunksInBatches(15, function () {});
        }
      });
    }

    // 3. Verifica atualização do APK Android uma vez por dia
    if (global.LuminaPlatform && global.LuminaPlatform.isAndroid && global.LuminaPlatform.hasBridge()) {
      global.LuminaStorage.loadMeta('lastApkUpdateCheckAt', 0, function (lastCheck) {
        var DAY_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - (lastCheck || 0) < DAY_MS) return;
        global.LuminaStorage.saveMeta('lastApkUpdateCheckAt', Date.now());
        global.LuminaPlatform.checkForAppUpdate(function (err, info) {
          if (!err && info) {
            global.LuminaStore.set('appUpdateInfo', info);
            if (info.hasUpdate && global.LuminaUI && global.LuminaUI.toast) {
              global.LuminaUI.toast('Nova versão ' + info.latestVersion + ' disponível em Ajustes > Atualizações.');
            }
          }
        });
      });
    }
  }

  // Parte 9.1: Ordem estrita de abertura rápida (<= 1.5s, zero loadCatalog, zero classificação, zero rede na abertura)
  function startApp(onReadyCallback) {
    // 1. Registra início do boot no detector anti-loop (Parte 9.2)
    if (global.LuminaBootGuard) {
      global.LuminaBootGuard.recordBootStart();
    }

    // 2. Inicializa teclas, foco, roteador, player e OSD
    if (global.LuminaKeys) global.LuminaKeys.init();
    if (global.LuminaFocus) global.LuminaFocus.init();
    if (global.LuminaRouter) global.LuminaRouter.init();
    if (global.LuminaPlayer) global.LuminaPlayer.init();
    if (global.LuminaOSD) global.LuminaOSD.init();
    if (global.LuminaDiagLog && global.LuminaDiagLog.loadFromStorage) {
      global.LuminaDiagLog.loadFromStorage();
    }

    // 3. Lê apenas metadados pequenos em paralelo (configurações, listas salvas, favoritos, progresso, estado da lista)
    global.LuminaSettings.loadAndApplySettings(function () {
      if (global.LuminaPlatform && global.LuminaPlatform.setDefaultUserAgent && global.LuminaPlayer) {
        global.LuminaPlatform.setDefaultUserAgent(global.LuminaPlayer.resolveUserAgentForItem(null, ''));
      }

      global.LuminaStorage.loadMeta('savedLists', [], function (savedLists) {
        if (Array.isArray(savedLists)) global.LuminaStore.set('savedLists', savedLists);
        global.LuminaStorage.loadMeta('activeListId', '', function (activeListId) {
          if (activeListId) global.LuminaStore.set('activeListId', activeListId);

          global.LuminaStorage.loadMeta('favorites', {}, function (favs) {
            global.LuminaStore.set('favorites', favs || {});
            global.LuminaStorage.loadMeta('watchProgress', {}, function (prog) {
              global.LuminaStore.set('watchProgress', prog || {});
              global.LuminaStorage.loadMeta('mappingProfile', { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }, function (prof) {
                global.LuminaStore.set('mappingProfile', prof || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] });
                global.LuminaStorage.loadMeta('accountInfo', null, function (acc) {
                  if (acc) global.LuminaStore.set('accountInfo', acc);
                  global.LuminaStorage.loadMeta('source', null, function (src) {
                    if (src) {
                      global.LuminaStore.set('source', src);
                      if (src.type === 'xtream' && src.creds) global.LuminaStore.set('xtreamCreds', src.creds);
                      if (!activeListId && global.LuminaStore.buildListId) {
                        activeListId = global.LuminaStore.buildListId(src);
                        global.LuminaStore.set('activeListId', activeListId);
                      }
                    }

                    var effListId = activeListId || 'default_list';
                    global.LuminaStorage.loadMeta('recentChannels_' + effListId, [], function (recCh) {
                      if (Array.isArray(recCh)) global.LuminaStore.set('recentChannels', recCh);

                      global.LuminaCatalog.getListState(effListId, function (_, listState) {
                        if (listState && listState.sections) {
                          global.LuminaStore.set('listCatalogMeta', listState.sections);
                        }

                        // Parte 10.1: Verifica se havia catálogo antigo da 2.1.0 sem carregá-lo!
                        global.LuminaStorage.loadMeta('catalogGeneration', null, function (legacyGen) {
                          var hasNewGen = !!(listState && listState.generationId);
                          if (!hasNewGen && legacyGen && legacyGen.generation && src) {
                            global.LuminaStore.set('needsV22Migration', true);
                          }

                          // 4. Renderiza o Início imediatamente e agenda marcação de abertura estável após 5 s
                          if (global.LuminaUI) {
                            global.LuminaUI.init();
                          }
                          if (global.LuminaBootGuard) {
                            global.LuminaBootGuard.scheduleBootStableTimer(5000);
                          }
                          if (onReadyCallback) onReadyCallback();

                          // 5. Tarefas opcionais em segundo plano com atraso de 3 s (Parte 9.1)
                          setTimeout(runOptionalDeferredTasksAfter3Seconds, 3000);
                        });
                      });
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

  function bootstrap() {
    loadAppConfig(function () {
      startApp();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
    else bootstrap();
  }

  var api = {
    startApp: startApp,
    bootstrap: bootstrap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LuminaMain = api;
})(typeof window !== 'undefined' ? window : global);
