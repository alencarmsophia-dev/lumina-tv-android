(function (global) {
  'use strict';
  var stack = ['home'];

  var currentParams = {};
  var routeListeners = [];

  function notifyRouteListeners(route) {
    for (var i = 0; i < routeListeners.length; i++) {
      try { routeListeners[i]({ route: route, params: currentParams }); } catch (e) {}
    }
  }

  function navigate(route, params) {
    currentParams = params || {};
    // Parte 7.9: Qualquer atalho antigo para a rota universal 'search' redireciona para o Início
    var targetRoute = (route === 'search') ? 'home' : route;
    var current = stack[stack.length - 1];
    if (current === 'onboarding' && targetRoute !== 'onboarding' && global.LuminaPairing) {
      global.LuminaPairing.stopPolling();
    }
    if (global.LuminaKeyboard && typeof global.LuminaKeyboard.isOpen === 'function' && global.LuminaKeyboard.isOpen()) {
      global.LuminaKeyboard.close(false);
    }
    if (global.LuminaUI && typeof global.LuminaUI.closeSideMenu === 'function') {
      global.LuminaUI.closeSideMenu(false);
    }
    if (current && current !== targetRoute && global.LuminaNetQueue) {
      global.LuminaNetQueue.abortByTag('tab_' + current);
    }
    if (current !== targetRoute) stack.push(targetRoute);
    global.LuminaStore.set('navDirection', 'forward');
    global.LuminaStore.set('currentRoute', targetRoute);
    global.LuminaEventBus.emit('route:changed', targetRoute);
    notifyRouteListeners(targetRoute);
  }

  function back() {
    if (global.LuminaUI && typeof global.LuminaUI.isBootSplashVisible === 'function' && global.LuminaUI.isBootSplashVisible()) {
      global.LuminaUI.dismissBootSplash(true);
      return;
    }

    if (global.LuminaKeyboard && typeof global.LuminaKeyboard.isOpen === 'function' && global.LuminaKeyboard.isOpen()) {
      global.LuminaKeyboard.close(false);
      return;
    }

    if (typeof document !== 'undefined') {
      var pinModal = document.getElementById('pin-modal-backdrop');
      if (pinModal && !pinModal.classList.contains('hidden')) {
        global.LuminaEventBus.emit('pin-modal:close');
        return;
      }
      var modal = document.getElementById('modal-backdrop');
      if (modal && !modal.classList.contains('hidden')) {
        global.LuminaEventBus.emit('modal:close');
        return;
      }
    }

    if (global.LuminaUI && typeof global.LuminaUI.isSideMenuOpen === 'function' && global.LuminaUI.isSideMenuOpen()) {
      global.LuminaUI.closeSideMenu(true);
      return;
    }

    var current = stack[stack.length - 1];

    // Parte 8.6: Na tela de busca de uma aba (#filmes/busca, #series/busca, #canais/busca):
    // Voltar com campo preenchido limpa a busca; com campo vazio sai da busca e devolve foco ao botão Buscar da aba!
    if (current === 'live/search' || current === 'movies/search' || current === 'series/search') {
      var secSearch = (global.LuminaStore && global.LuminaStore.get('activeSectionSearch')) || {};
      if (secSearch.query && String(secSearch.query).length > 0) {
        secSearch.query = '';
        secSearch.results = [];
        secSearch.totalMatched = 0;
        secSearch.hasMore = false;
        secSearch.cursor = 0;
        global.LuminaStore.set('activeSectionSearch', secSearch);
        if (global.LuminaUI && global.LuminaUI.renderCurrentRoute) {
          global.LuminaUI.renderCurrentRoute();
        }
        return;
      }
      stack.pop();
      var parentTab = current.split('/')[0] || 'home';
      if (stack[stack.length - 1] !== parentTab) {
        stack.push(parentTab);
      }
      global.LuminaStore.set('navDirection', 'back');
      global.LuminaStore.set('currentRoute', parentTab);
      global.LuminaEventBus.emit('route:changed', parentTab);
      if (typeof document !== 'undefined' && global.LuminaFocus) {
        var searchBtn = document.getElementById('tab-btn-search');
        if (searchBtn) global.LuminaFocus.setFocus(searchBtn, parentTab);
      }
      return;
    }

    if (current === 'player-fullscreen') {
      stack.pop();
      var prev = stack[stack.length - 1] || 'home';
      var curItem = global.LuminaPlayer && global.LuminaPlayer.getCurrentItem ? global.LuminaPlayer.getCurrentItem() : null;
      if (curItem && curItem.adult && global.LuminaSettings && global.LuminaSettings.lockParentalSession) {
        global.LuminaSettings.lockParentalSession();
      }
      if (prev !== 'live' || (curItem && curItem.kind !== 'live')) {
        if (global.LuminaPlayer && global.LuminaPlayer.stop) global.LuminaPlayer.stop();
      }
      global.LuminaStore.set('navDirection', 'back');
      global.LuminaStore.set('currentRoute', prev);
      global.LuminaEventBus.emit('route:changed', prev);
      return;
    }

    if (current === 'onboarding' && global.LuminaStore.get('pairingStep') === 'phone-qr') {
      if (global.LuminaPairing) global.LuminaPairing.resetSession();
      global.LuminaStore.set('pairingStep', 'cards');
      global.LuminaEventBus.emit('route:changed', 'onboarding');
      return;
    }

    if (stack.length > 1) {
      stack.pop();
      var target = stack[stack.length - 1];
      global.LuminaStore.set('navDirection', 'back');
      global.LuminaStore.set('currentRoute', target);
      global.LuminaEventBus.emit('route:changed', target);
      notifyRouteListeners(target);
    } else if (current !== 'home') {
      stack = ['home'];
      global.LuminaStore.set('currentRoute', 'home');
      global.LuminaEventBus.emit('route:changed', 'home');
      notifyRouteListeners('home');
    } else {
      global.LuminaEventBus.emit('app:confirm-exit');
    }
  }

  global.LuminaRouter = {
    init: function () { global.LuminaEventBus.on('key:BACK', back); },
    navigate: navigate,
    back: back,
    getCurrent: function () { return stack[stack.length - 1]; },
    getCurrentRoute: function () { return stack[stack.length - 1]; },
    getParams: function () { return currentParams; },
    getStack: function () { return stack.slice(); },
    onChange: function (fn) {
      if (typeof fn === 'function') {
        routeListeners.push(fn);
        fn({ route: stack[stack.length - 1], params: currentParams });
      }
    }
  };
})(typeof window !== 'undefined' ? window : global);
