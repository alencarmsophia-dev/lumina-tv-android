# Relatório de Diagnóstico de Abertura — Lumina TV v2.2.0

## 1. Causas Reais Encontradas com Evidência Técnica

### Causa 1 (Confirmada com Stacktrace): `TypeError: LuminaRouter.onChange is not a function`
- **Evidência**:
  - `app/src/main/assets/app/js/ui/app-ui.js` (linha 318): `LuminaRouter.onChange(function (routeInfo) { ... })`.
  - `app/src/main/assets/app/js/core/router.js`: `global.LuminaRouter` só definia `init`, `navigate`, `back`, `getCurrent` e `getStack`.
  - Ao iniciar o app (`main.js` linha 162: `LuminaUI.init()`), a chamada gerava exceção imediata `TypeError: LuminaRouter.onChange is not a function`, interrompendo a cadeia de callbacks antes de renderizar qualquer elemento ou marcar a abertura como estável.
- **Correção**: Implementado `onChange`, `getCurrentRoute` e `getParams` em `router.js`, emitindo o evento de mudança e notificando os ouvintes.

### Causa 2 (Confirmada no Código): `ReferenceError: FocusEngine is not defined`
- **Evidência**:
  - `app/src/main/assets/app/js/ui/app-ui.js` (linhas 588, 1023, 1314, 1376, 1689, 1836): chamadas a `FocusEngine.setZone('content')` e `FocusEngine.focusElement()`.
  - O motor de foco do projeto é exportado como `global.LuminaFocus` em `focus-engine.js`. A variável `FocusEngine` não existia no escopo global, causando `ReferenceError` na primeira tentativa de navegação ou foco inicial.
- **Correção**: Criado alias `global.FocusEngine = focusApi` e métodos `setZone` e `focusElement` em `focus-engine.js`.

### Causa 3 (Confirmada no DOM): Divergência de IDs entre `app-ui.js` e `index.html`
- **Evidência**:
  - `app-ui.js` buscava `document.getElementById('sidebar-nav')`, `screen-container`, `modal-root` e `toast-root`.
  - Em `index.html`, os IDs oficiais são `side-nav`, `screen-viewport`, `modal-backdrop` e `toast-container`.
  - Como `elMain` e `elSidebar` resultavam em `null`, as funções `renderSidebar()` e `renderRoute()` retornavam imediatamente (`if (!elMain) return;`), impedindo a criação de qualquer HTML da tela principal.
- **Correção**: `app-ui.js` agora resolve `document.getElementById('side-nav') || document.getElementById('sidebar-nav')` e `document.getElementById('screen-viewport') || document.getElementById('screen-container')`.

### Causa 4 (Confirmada no CSS/DOM): Splash Overlay `#boot-splash` Cobrindo a Tela Indefinidamente
- **Evidência**:
  - Em `index.html`, `<div id="boot-splash" class="boot-splash">` possui estilo com `position: fixed; inset: 0; z-index: var(--z-splash); background: var(--bg)`.
  - Em versões anteriores, a remoção da tela de abertura ocorria via `dismissBootSplash()` adicionando a classe `.is-dismissed`. Na v2.2.0, essa rotina não era chamada, deixando o elemento visível para sempre mesmo se a página terminasse de carregar.
- **Correção**: Adicionada a função `dismissBootSplash()` chamada no `init()` e em cada renderização de rota, além de um temporizador de segurança em `index.html` (2,5 s).

### Causa 5 (Confirmada no Código): Métodos Ausentes em `LuminaSettings`
- **Evidência**:
  - `app-ui.js` chamava `LuminaSettings.getActivePlaylist()`, `getFavoritePortraits()`, `getContinueWatchingList()`, `getPortraitById()`, `isAdultLocked()`, `isFavorite()` e `toggleFavorite()`.
  - `settings.js` não exportava esses métodos auxiliares.
- **Correção**: Métodos adicionados e delegados com segurança a `LuminaStore` em `settings.js`.

---

## 2. Hipóteses Não Confirmadas (Sem Evidência de Ocorrência)

1. **Incompatibilidade da versão do Chromium do WebView**: Não confirmado. O app exige Chromium >= 50, compatível com a grande maioria dos aparelhos Android 5.1+.
2. **Divergência de Assinatura do APK**: Não confirmado sem acesso aos logs de instalação do aparelho físico. Se o erro na verdade for "App não instalado", a causa é instalar um APK assinado com a chave debug por cima de um anterior assinado com a chave release (ou vice-versa).
3. **Bloqueio de CORS/Rede no Pareamento**: Não confirmado como bloqueador da UI, pois `loadAppConfig` trata erros com timeout e fallback gracioso.

---

## 3. O que Você Deve Me Enviar de Volta se o Erro Persistir

Com a tela de diagnóstico nativa implementada na Entrega 1:
1. Se o app exibir a tela preta com texto azul **"Lumina TV — Diagnóstico de Abertura"**, toque no botão amarelo **"Copiar"** e me envie o texto colado.
2. Se rodar o workflow `diagnostico-abertura.yml` no GitHub Actions:
   - Envie as 80 linhas finais do log do job.
   - Ou baixe o artefato `diag-artifacts-*.zip` que contém `logcat.txt`, `last_crash.txt`, `dumpsys_meminfo.txt` e `screenshot.png`.
