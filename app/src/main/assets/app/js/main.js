(function (global) {
  'use strict';
  // Lê app-config.json (servidor de pareamento e chave TMDB). Falha silenciosa: mantém os padrões.
  function loadAppConfig(done) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'app-config.json', true);
      xhr.timeout = 3000;
      xhr.onload = function () {
        try {
          var cfg = JSON.parse(xhr.responseText);
          if (cfg.pairing && cfg.pairing.baseUrl) global.LuminaStore.set('pairingBaseUrl', cfg.pairing.baseUrl);
          if (cfg.tmdb && cfg.tmdb.apiKey) global.LuminaStore.set('tmdb', { enabled: true, apiKey: cfg.tmdb.apiKey, language: cfg.tmdb.language || 'pt-BR', enrichedCount: 0 });
        } catch (e) {}
        done();
      };
      xhr.onerror = done; xhr.ontimeout = done;
      xhr.send();
    } catch (e) { done(); }
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

    global.LuminaStorage.loadMeta('favorites', {}, function (favs) {
      global.LuminaStore.set('favorites', favs || {});
      global.LuminaStorage.loadMeta('watchProgress', {}, function (prog) {
        global.LuminaStore.set('watchProgress', prog || {});
        global.LuminaStorage.loadMeta('mappingProfile', { mode: 'auto', customGroupRules: {}, renamedGroups: {}, groupOrder: [] }, function (prof) {
          global.LuminaStore.set('mappingProfile', prof);
          global.LuminaStorage.loadMeta('source', null, function (src) {
            if (src) {
              global.LuminaStore.set('source', src);
              if (src.type === 'xtream' && src.creds) global.LuminaStore.set('xtreamCreds', src.creds);
            }
            global.LuminaStorage.loadCatalog(function (err, rawItems) {
              global.LuminaUI.init();
              if (!err && rawItems && rawItems.length) {
                global.LuminaUI.showLoading('Carregando seu catálogo');
                global.LuminaRepository.rebuildCatalogFromRawAsync(rawItems, function (f) {
                  global.LuminaUI.setLoading('Organizando catálogo... ' + Math.round(f * 100) + '%', Math.round(f * 100));
                }, function () {
                  global.LuminaUI.hideLoading();
                  global.LuminaUI.renderCurrentRoute();
                });
              }
            });
          });
        });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})(typeof window !== 'undefined' ? window : global);
