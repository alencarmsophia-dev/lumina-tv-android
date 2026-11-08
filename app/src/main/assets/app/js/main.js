(function (global) {
  'use strict';

  function loadAppConfig(done) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'app-config.json', true);
      xhr.timeout = 3000;
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

  function triggerBackgroundCatalogRefresh(src, reasonMsg) {
    if (!src || !global.LuminaPairing) return;
    if (reasonMsg && global.LuminaUI && global.LuminaUI.toast) {
      global.LuminaUI.toast(reasonMsg);
    }
    var payload = src.type === 'xtream'
      ? { type: 'xtream', name: src.name, host: src.creds.server, port: 0, username: src.creds.username, password: src.creds.password }
      : src;
    global.LuminaPairing.applyMobilePayload(payload, function (err, list) {
      if (!err && list && list.length && global.LuminaUI) {
        global.LuminaUI.toast('✔ Catálogo completo sincronizado (' + list.length + ' itens).');
        global.LuminaUI.renderCurrentRoute();
      }
    });
  }

  function checkAutoAppUpdateIfAndroid() {
    if (!global.LuminaPlatform || !global.LuminaPlatform.isAndroid || !global.LuminaPlatform.hasBridge()) return;
    global.LuminaStorage.loadMeta('lastApkUpdateCheckAt', 0, function (lastCheck) {
      var DAY_MS = 24 * 60 * 60 * 1000;
      if (Date.now() - (lastCheck || 0) < DAY_MS) return;
      global.LuminaStorage.saveMeta('lastApkUpdateCheckAt', Date.now());
      global.LuminaPlatform.checkForAppUpdate(function (err, info) {
        if (!err && info) {
          global.LuminaStore.set('appUpdateInfo', info);
          if (info.hasUpdate && global.LuminaUI && global.LuminaUI.toast) {
            global.LuminaUI.toast('🎉 Nova versão ' + info.latestVersion + ' disponível em Ajustes → Atualizações!');
            global.LuminaUI.renderCurrentRoute();
          }
        }
      });
    });
  }

  function bootstrap() {
    loadAppConfig(startApp);
  }

  function startApp() {
    global.LuminaKeys.init();
    global.LuminaFocus.init();
    global.LuminaRouter.init();
    global.LuminaPlayer.init();
    global.LuminaOSD.init();

    // 1. Carrega todas as configurações persistidas (PIN com hash, modo de desempenho, proporção, autoUpdateHours)
    global.LuminaSettings.loadAndApplySettings(function () {
      global.LuminaStorage.loadMeta('favorites', {}, function (favs) {
        global.LuminaStore.set('favorites', favs || {});
        global.LuminaStorage.loadMeta('watchProgress', {}, function (prog) {
          global.LuminaStore.set('watchProgress', prog || {});
          global.LuminaStorage.loadMeta('mappingProfile', { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }, function (prof) {
            global.LuminaStore.set('mappingProfile', prof || { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] });
            global.LuminaStorage.loadMeta('accountInfo', null, function (acc) {
              if (acc) global.LuminaStore.set('accountInfo', acc);
              global.LuminaStorage.loadMeta('lastUpdateInfo', null, function (lastUpd) {
                if (lastUpd) global.LuminaStore.set('lastUpdateInfo', lastUpd);
                global.LuminaStorage.loadMeta('source', null, function (src) {
                  if (src) {
                    global.LuminaStore.set('source', src);
                    if (src.type === 'xtream' && src.creds) global.LuminaStore.set('xtreamCreds', src.creds);
                  }

                  // 2. Carrega o catálogo persistido (v2 com verificação de integridade ou migração v1)
                  global.LuminaStorage.loadCatalog(function (err, storedItems, metaInfo) {
                    global.LuminaUI.init();
                    var info = metaInfo || {};
                    var diag = global.LuminaStore.get('diagnostics') || {};
                    diag.catalogGeneration = info.generation || (info.migratedFromV1 ? 'v1-migrated' : 'empty');
                    global.LuminaStore.set('diagnostics', diag);

                    var alreadyClassified = !info.migratedFromV1 &&
                      info.classifierVersion === global.LuminaClassifier.CLASSIFIER_VERSION;

                    if (storedItems && storedItems.length) {
                      global.LuminaUI.showLoading('Abrindo seu catálogo');
                      global.LuminaRepository.rebuildCatalogFromRawAsync(
                        storedItems,
                        function (f) {
                          global.LuminaUI.setLoading('Montando catálogo... ' + Math.round(f * 100) + '%', Math.round(f * 100));
                        },
                        function () {
                          global.LuminaUI.hideLoading();
                          global.LuminaUI.renderCurrentRoute();

                          if (!info.integrityOk && src) {
                            triggerBackgroundCatalogRefresh(src, '⚠ Catálogo incompleto detectado. Atualizando sua lista em segundo plano...');
                          } else if (info.migratedFromV1 && src) {
                            triggerBackgroundCatalogRefresh(src, '⟳ Migrando para v1.6: baixando seu catálogo completo sem limite de 25 mil itens...');
                          } else if (src) {
                            var autoHours = global.LuminaStore.get('autoUpdateHours');
                            var lastTs = (lastUpd && lastUpd.updatedAt) || info.updatedAt || 0;
                            if (typeof autoHours === 'number' && autoHours > 0 && lastTs > 0) {
                              if (Date.now() - lastTs >= autoHours * 3600 * 1000) {
                                triggerBackgroundCatalogRefresh(src, '⟳ Atualizando sua lista automaticamente em segundo plano...');
                              }
                            }
                          }
                        },
                        alreadyClassified
                      );
                    }

                    checkAutoAppUpdateIfAndroid();
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
    else bootstrap();
  }
})(typeof window !== 'undefined' ? window : global);
