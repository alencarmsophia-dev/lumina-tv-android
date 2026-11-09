# RELATÓRIO DE AUDITORIA E CORREÇÃO DE BUGS — Lumina TV v1.6.0

| ID | Sintoma | Causa Raiz Confirmada | Arquivo(s) Alterado(s) | Correção Implementada | Teste Automatizado que Prova |
|---|---|---|---|---|---|
| **B1.1** | Séries desaparecem ao fechar e reabrir o app | `MAX_PERSISTED_RAW_ITEMS = 25000` em `storage.js` truncava a lista nos primeiros 25 mil itens; como o Xtream ordena `live -> vod -> series`, todas as séries do fim eram descartadas. | `app/js/core/storage.js`, `app/js/main.js` | Limite elevado para `400.000` itens, persistência de itens já classificados e migração automática `v1 -> v2` que recarrega a lista completa se veio truncada. | `tests/v16-comprehensive.test.js` (120.000 itens com 20.000 episódios no fim: contagens idênticas antes e após recarregar) |
| **B1.2** | Perda total do catálogo se a TV desligar durante o salvamento | `saveCatalogBatch` executava `objectStore('items').clear()` antes de gravar os novos blocos e `finishCatalog` ignorava o argumento `err`. | `app/js/core/storage.js`, `app/js/data/repository.js` | Gravação atômica por geração (`g<gen>:chunk:<idx>`): só atualiza o ponteiro `meta.catalogGeneration` e apaga gerações antigas após confirmar 100% dos blocos e validar checksum. | `tests/v16-comprehensive.test.js` (falha simulada no bloco 2 preserva os 120.000 itens da geração anterior) |
| **B2.1** | Episódios e filmes com grupos atípicos aparecem misturados em Canais ao Vivo | Fallback final de `classifyEntry` era `kind = 'live'`, `FAST_EP_HINT` casava com qualquer dígito/letra `s/t`, e grupos `24H Séries` caíam em série em vez de canal 24h. | `app/js/data/classifier.js`, `app/js/data/repository.js` | Classificador v2 com 10 níveis estritos de prioridade, regra explícita para `24H`, detecção de conflito (`Friends S02E05` em grupo `Canais` sem `/live/` vira `unclassified`) e fallback final `unclassified`. | `tests/classifier.test.js` (tabela obrigatória de 10 casos + testes de prioridade) |
| **B2.2** | Colisões de ID em listas grandes e perda de favoritos ao trocar URL/senha do servidor | `stableHash` usava 32 bits sob a URL completa (incluindo `host:porta/user/pass`), gerando colisões pelo paradoxo do aniversário e mudando o ID ao atualizar credenciais. | `app/js/data/classifier.js`, `app/js/data/repository.js` | IDs estruturados (`i:xt:live:<id>`, `s:xt:series:<id>`) e hash duplo de 53/64 bits (`stableHash53`) sobre o caminho normalizado sem credenciais + migração automática de `legacyId`. | `tests/classifier.test.js` (300.000 IDs gerados com zero colisões + teste de troca de host/usuário/senha) |
| **B3** | Séries Xtream exibem 2 episódios falsos (`S01E01`/`S01E02`) que não tocam | `get_series` da API Xtream retorna apenas o cadastro das séries sem episódios; `xtream-client.js` usava `sr.episodes \|\| [2 episódios fictícios]`. | `app/js/data/xtream-client.js`, `app/js/data/grouper.js`, `app/js/ui/app-ui.js` | Séries Xtream são salvas como itens-pai (`series-show` / `novela-show`, `needsSeriesInfo: true`) e carregam temporadas/episódios reais sob demanda via `get_series_info` com cache no IndexedDB. | `tests/xtream-search.test.js` (validação de `series-show` sem episódios falsos + hidratação `convertSeriesInfoResponse`) |
| **B4.1** | Falha em streams HLS/MPEG-TS quando o `<video>` nativo não suporta o formato | `hls.min.js` e `mpegts.min.js` eram stubs de 75/105 bytes e `player-core.js` instanciava apenas `LuminaNativeEngine`, repetindo 3x a mesma URL `.m3u8`. | `app/js/player/player-core.js`, `app/js/player/engines/*.js`, `tools/baixar-vendor.sh` | Cadeia real de fallback (`NativeEngine` ↔ `HlsJsEngine` ↔ `MpegtsEngine`), alternância `.m3u8` ↔ `.ts` para canais Xtream, scripts de download de `hls.js 1.5.15` e `mpegts.js 1.7.3` e token de sessão contra vazamento em zapping rápido. | `tests/v16-comprehensive.test.js` (teste de plano de fallback multi-engine e `.m3u8` -> `.ts`) |
| **B4.2** | Transmissão ao vivo congela sem reconectar; `onEnded` grava duração falsa de 120s | `watchdogTimer` nunca era armado em `player-core.js` e `onEnded` chamava `persistVodPosition(120, 120)`. | `app/js/player/player-core.js`, `app/js/player/osd.js` | Watchdog ativo a cada 2s que reconecta se `currentTime` congelar por 8s; retomada aplicada após `loadedmetadata`; `onEnded` grava a duração real de `videoEl.duration`; erros mapeados (401/403, 404, 429, timeout, offline). | `tests/v16-comprehensive.test.js` (mapeamento de erros 403/404 e validação de motor) |
| **B4.3** | Streams M3U que exigem `User-Agent` ou `Referer` específico falham | `m3u-parser.js` ignorava linhas `#EXTVLCOPT:` e `#EXTGRP:`. | `app/js/data/m3u-parser.js`, `app/js/platform/platform.js`, `LuminaWebViewClient.kt` | Parser captura `#EXTVLCOPT:http-user-agent`, `http-referrer` e `#EXTGRP`; no Android, `LuminaWebViewClient` injeta esses cabeçalhos via OkHttp para o stream correspondente. | `tests/parser.test.js` (extração de `httpUserAgent`, `httpReferrer` e `#EXTGRP`) |
| **B5** | PIN Parental, Modo de Desempenho e Proporção voltam ao padrão ao reiniciar | `main.js` nunca persistia nem carregava `parental`, `performanceMode`, `defaultAspectRatio` ou `tmdb`; PIN ficava em texto puro (`0000`) sem limite de tentativas. | `app/js/core/settings.js`, `app/js/core/store.js`, `app/js/main.js` | Módulo `settings.js` persiste todas as preferências em `settings_v2`, guarda PIN com hash `SHA-256 + salt`, bloqueia por 60s após 5 erros, expira sessão `+18` em 15 min e omite senhas no Backup JSON por padrão. | `tests/fase4-pairing-settings.test.js` (troca de PIN, bloqueio após 5 tentativas e backup sem senha em texto puro) |
| **B6.1** | Falha em uma etapa Xtream aborta toda a atualização da lista | `fetchXtreamCatalog` usava timeout curto (20s) sem retentativa e abortava tudo se `get_series` falhasse. | `app/js/data/xtream-client.js`, `app/js/data/repository.js` | Retentativa com backoff exponencial (até 3x por etapa), timeouts de 25s–60s, tolerância a falha parcial por etapa, suporte a `ETag`/`If-None-Match`, botão Cancelar e resumo de diferenças (`+X filmes`). | `tests/xtream-search.test.js` e `tests/v16-comprehensive.test.js` |
| **B6.2** | Atualização do APK exigia reinstalação manual por ADB/Downloader | Não havia verificador nem instalador de releases no wrapper Android. | `MainActivity.kt`, `AndroidManifest.xml`, `res/xml/file_paths.xml`, `build-apk.yml` | Consulta `releases/latest` no GitHub (`alencarmsophia-dev/lumina-tv-android`), baixa `lumina-tv.apk` com progresso e verificação `SHA-256` e inicia instalação via `FileProvider`. | Validado na ponte `LuminaPlatform` + workflow `build-apk.yml` |
| **S4.1** | Usuário só alcançava os primeiros 8 canais ao vivo e 12 pôsteres de filmes/séries | `renderLive` usava `Math.min(filtered.length, 8)` e `renderPosterCatalog` usava `Math.min(filtered.length, 12)` sem rolagem nem paginação. | `app/js/ui/app-ui.js`, `app/js/core/focus-engine.js` | Janelas virtualizadas em todas as telas (`handleVirtualBoundary` + salto de página `CH+/CH-` + barra de filtro `A–Z`), alcançando 100% do catálogo com < 150 nós no DOM. | Verificado em `app-ui.js` (`data-vlist`, `LIVE_CH_WIN_SIZE`, `POSTER_WIN_SIZE`) |
| **S4.2** | Títulos ou grupos com `<`, `>` ou `"` quebravam o layout ou injetavam HTML | Concatenação direta em `innerHTML` sem escape em ~19 pontos de `app-ui.js` e `osd.js`. | `app/js/ui/app-ui.js`, `app/js/player/osd.js` | Funções `escHtml` e `escAttr` aplicadas em 100% das interpolações de texto e atributos HTML. | `tests/v16-comprehensive.test.js` (`UI.escHtml` contra payload XSS) |
| **S4.3** | Títulos com vírgula no M3U (ex.: `"O Bom, o Mau e o Feio"`) ficavam cortados | `parseExtInfLine` usava `line.lastIndexOf(',')`, cortando na última vírgula dentro do próprio título. | `app/js/data/m3u-parser.js` | Função `findTitleCommaIndex` percorre os atributos ignorando vírgulas dentro de aspas e divide exatamente na primeira vírgula separadora do `#EXTINF`. | `tests/parser.test.js` (`"O Bom, o Mau e o Feio (1966)"` e `"Rick, Morty e Cia"`) |
| **S4.4** | Busca mutava cada item com `_searchKey`, inflando memória e IndexedDB | `matchListFast` gravava `it._searchKey = ...` diretamente nos objetos do catálogo. | `app/js/data/xtream-client.js` | Índice separado em memória (`searchTokenCache`) com ordenação por relevância (prefixo exato > prefixo de palavra > substring) e limpeza ao atualizar catálogo. | `tests/xtream-search.test.js` (`assert.strictEqual(hasOwnProperty('_searchKey'), false)`) |
| **S4.5** | Polling de pareamento não tratava HTTP 429 (`rate_limit`) nem expiração local | `schedulePoll` em `mobile-pairing.js` continuava consultando a cada 2,5s mesmo após 429 ou 10 min. | `app/js/data/mobile-pairing.js` | Controle local de `expiresAt` (10 min), backoff automático para 10s em caso de HTTP 429 e parada imediata ao sair da tela de pareamento. | `tests/fase4-pairing-settings.test.js` |
| **B7** | Interface do app aparece cortada (apenas canto superior esquerdo visível) na Fire TV ligada a projetor; card de pareamento corta frases | `base.css` fixava `html, body` em `1920x1080px`, `index.html` usava `meta viewport width=1920`, `MainActivity.kt` ligava `useWideViewPort/loadWithOverviewMode` e chamava `window.__luminaFitViewport()` que não existia em nenhum `.js` do app | `app/js/core/viewport-fit.js`, `app/css/base.css`, `app/css/components.css`, `app/css/screens.css`, `app/index.html`, `app/js/core/settings.js`, `app/js/core/store.js`, `app/js/core/focus-engine.js`, `app/js/ui/app-ui.js`, `MainActivity.kt`, `LuminaWebViewClient.kt` | Criado `viewport-fit.js` (`computeFit` + `applyFit` + `__luminaViewportInfo`), `html/body` 100%, `useWideViewPort=false`, preferência `screenSafeMargin` (0%–10% ao vivo com setas ESQ/DIR), cabeçalho com `TELA W×H • ESCALA S%`, `overflow-wrap:anywhere` no card de pareamento e normalização de escala no `focus-engine.js` | `tests/viewport-fit.test.js` (9 cenários exatos de resolução, proporção, overscan 10% e fallback `0`/`NaN`) |

---

## 9. Bug / Defeito de Usabilidade B8 (v1.7.0): Elementos Pequenos a 3 Metros, Excesso de Chips no Topo e Animação de Largura no Menu

### Causa Raiz Confirmada
1. Nas versões `1.6.x`, as telas de Filmes, Séries e Novelas acumulavam três barras horizontais no topo (chips de categorias `20px`, chips de ordenação e barra A–Z com 27 botões de `18px`), exigindo dezenas de toques no controle remoto para chegar aos pôsteres e ficando ilegíveis a 3 metros de distância.
2. O menu lateral animava a propriedade `width` (`108px` → `330px`), provocando *reflow/re-layout* na WebView da Fire TV, e continha 11 itens de `22px`.
3. A barra fixa inferior de dicas do controle remoto ocupava área útil em todas as telas e usava fonte de `19px`.

### Correção Implementada na v1.7.0
- **Tipografia mínima de `22px` (`--fs-min`)** auditada automaticamente por `tests/design-tokens.test.js` em todos os arquivos CSS.
- **Coluna Lateral de Filtros de `360px`** em Filmes e Séries/Novelas (seletores `Tipo`, `Ordenar`, `Idioma` e `Letra` condicional + lista vertical de `Categorias`), combinada à grade virtualizada de **4 colunas** com cartões grandes de `301×452px`.
- **Menu lateral sobreposto (`360px`)** com apenas 6 itens principais (`Início`, `Busca`, `Canais`, `Filmes`, `Séries`, `Favoritos`) + `Ajustes` no rodapé, animado exclusivamente via `transform: translateX` e `opacity` em `180ms`.
- **Consolidação em Ajustes**: 8 abas sem numeração (`Fonte e Pareamento`, `Reprodução`, `Tela e Desempenho`, `Organizar Lista`, `Controle Parental`, `Atualizações`, `Backup e Dados`, `Sobre`), movendo os atalhos do controle remoto para a aba `Sobre`.

---

## 10. Refinamento Visual e de Abertura B9 (v1.9.0): Identidade Visual Genérica, Salto no Splash e Falta de Coreografia de Entrada

### Diagnóstico Confirmado
1. O logo provisório era um quadrado arredondado azul com um `"L"` e um triângulo dentro, sem relação conceitual com o nome *Lumina* (luz).
2. O splash nativo (`splash.png`) tinha fundo chapado e transição abrupta para a abertura web (`#boot-splash`), que apenas aplicava um fade simples sem profundidade, sem controle de orçamento de quadros na Fire TV e sem continuidade espacial com o logo do menu lateral.

### Solução Implementada na v1.9.0
- **Nova Identidade Visual ("A Luz Acende a Tela")**: criado o símbolo *Facho* (3 lâminas refratadas de luz + centelha `#FDE68A` sobre grade óptica `64×64` sem contêiner) e wordmark `"LUMINA TV"` 100% em `<path>` SVG geométricos na pasta `brand/`.
- **Continuidade Perfeita Splash Nativo → Abertura Web → Menu Lateral (FLIP)**: o splash composto (`1920×1080`) e o primeiro frame (`0–250ms`) de `#boot-splash` compartilham exatamente o mesmo fundo (`#0B0F17` → `#0A1426` + brilho radial central) e o símbolo de `176px` em `(960, 540)`, encerrando aos `3000–3500ms` com transição FLIP calculada pela escala real de `viewport-fit.js` até o canto superior esquerdo do menu (`64×64`).
- **Benchmark Adaptativo de Quadros (`window.__luminaPerf`)**: medição via `requestAnimationFrame` nos primeiros `500ms` que rebaixa automaticamente para a variação `REDUZIDA` caso a mediana de tempo de quadro supere `24ms`.

---

## 11. Correção de Bug Crítico B10 (v2.1.0): Overlay de Carregamento Travado em 100%, "Aguardando envio pelo celular..." no Fundo e Erro "Importação cancelada pelo usuário."

### Sintoma
- Ao adicionar uma lista (via pareamento pelo celular, link M3U ou Xtream Codes), o overlay `#loading-overlay` avançava até `100%` com o botão `"Cancelar"` visível, nunca fechava, não abria a tela `"home"` e deixava `"Aguardando envio pelo celular..."` visível ao fundo; ao pressionar `"Cancelar"` ou `"Voltar"` no controle remoto depois disso, exibia a mensagem de erro `"Importação cancelada pelo usuário."`.

### Causa Raiz Confirmada no Código
1. **Duas chamadas a funções inexistentes (`TypeError` fatal) em `rebuildCatalogFromRawAsync` (`js/data/repository.js`, linhas 105 e 120) logo após a barra atingir `100%`**:
   - Em `commitIncomingCatalog`, `LuminaStorage.saveCatalogBatch` gravava os blocos e reportava `ratio = 1.0`, fazendo `onProgress` atualizar a barra para `90 + Math.round(1.0 * 10) = 100%`.
   - Em seguida, `commitIncomingCatalog` chamava `rebuildCatalogFromRawAsync(newRawItems, ...)`, que na linha 105 executava `global.LuminaClassifier.applyProfileMapping(it, profile)` (função inexistente em `classifier.js`, que exporta apenas `classifyEntry`) e na linha 120 executava `global.LuminaGrouper.groupCatalog(processed)` esperando `grouped.standaloneItems` (função inexistente em `grouper.js`, que exporta apenas `groupSeriesAndNovelas(items)` retornando `{ seriesList, novelasList }`).
   - Como `processSlice` rodava dentro de `setTimeout` sem `try / catch`, o `TypeError` abortava silenciosamente a execução exatamente em `100%`, sem jamais chamar o callback de `commitIncomingCatalog` nem `hideLoading()` ou `LuminaRouter.navigate('home')`.
2. **Ausência de handlers `tx.onabort`, `req.onerror`, `req.onblocked` e de timeout no IndexedDB (`js/core/storage.js`)**: as funções `openDB`, `putRecord`, `getRecord`, `deleteRecord` e `listAllKeys` escutavam apenas `tx.oncomplete` e `tx.onerror`, e `cleanupOldGenerations` podia bloquear a conclusão se a limpeza de blocos antigos falhasse ou travasse.
3. **Leitura incompleta de progresso (`js/ui/app-ui.js`)**: `onLoadProgress(p)` lia apenas `p.status` e ignorava `p.stage`, deixando o texto de status em branco durante as etapas de `repository.js`.
4. **Fluxo de cancelamento e tela de pareamento residual (`js/data/repository.js` e `js/ui/app-ui.js`)**: `onPairingPayload` não limpava a sessão/tela `"Aguardando envio pelo celular..."` antes de abrir o overlay; e ao pressionar `"Cancelar"` ou `"Voltar"`, `cancelActiveLoad()` gerava `new Error('Importação cancelada pelo usuário.')`, que os callbacks de `app-ui.js` exibiam como erro na tela.

### Arquivos Alterados
- `app/src/main/assets/app/js/core/storage.js`
- `app/src/main/assets/app/js/data/repository.js`
- `app/src/main/assets/app/js/ui/app-ui.js`
- `RELATORIO-DE-BUGS.md`

### O que foi verificado e o que NÃO pôde ser verificado na TV física
- **Verificado no ambiente de desenvolvimento (Node.js)**:
  - Checagem de sintaxe (`node --check`) nos 3 arquivos JavaScript alterados.
  - Suíte completa de testes automatizados (`npm test`) + simulação em Node.js provando: (a) execução completa de `loadFromXtream` / `rebuildCatalogFromRawAsync` sem `TypeError`, populando `channels`, `movies` e `seriesList`, (b) captura de `tx.onabort` e tolerância a falha em `cleanupOldGenerations` em `storage.js`, (c) registro de todas as etapas em `LuminaDiagLog` e watchdog de 60s, e (d) cancelamento limpo sem exibir `"Importação cancelada pelo usuário."`.
- **NÃO verificado em aparelho Fire TV físico**:
  - Como não há acesso a um dispositivo Amazon Fire TV físico neste ambiente, o teste final no APK instalado na TV física com uma lista real deve ser confirmado pelo proprietário no aparelho.

---

## 12. Correção de Bugs de Interface B11 e B12 (v2.1.0): Piscar ao Rolar Listas Longas e Canais ao Vivo Abrindo Tela de Detalhes

### B11 — Piscar ao rolar listas (`js/ui/app-ui.js`, `css/screens.css`, `css/components.css`)
- **Sintoma**: Em séries com muitos episódios (e nas listas de canais, categorias, grades de pôsteres, favoritos e grupos), cada toque para BAIXO ou para CIMA na borda da janela visível fazia a tela inteira piscar como se estivesse trocando de página, e as miniaturas/pôsteres voltavam a ficar transparentes antes de reaparecer.
- **Causa Raiz Confirmada no Código**:
  1. `handleVirtualBoundary` alterava o índice inicial da janela (`detailEpWindowStart`, `liveChWindowStart`, `liveCatWindowStart`, `filterCatWindowStart`, `posterWindowStart`, `favWindowStart`, `orgGroupWindowStart`) e chamava `renderCurrentRoute()`, que reconstruía `viewport.innerHTML` sempre com `<div class="screen-enter">` ou `getScreenEnterClass()` (`screen-enter-forward` / `screen-enter-back`), além de `.detail-poster-card` (`detailPosterEnter`) e `.detail-stagger` (`screenFadeIn`), repetindo a animação completa de entrada da tela a cada passo da lista. A variável `lastRouteRendered` era gravada no fim de `renderCurrentRoute()`, mas nunca era consultada.
  2. Todas as imagens (`img.lazy-fade`) eram recriadas sem a classe `is-loaded` (`opacity: 0`) e aguardavam um novo disparo assíncrono de `onload` para voltar a `opacity: 1`.
  3. `.episode-row`, `.cat-row` e `.channel-row` usavam `content-visibility: auto`, causando adiamento de pintura (*pop-in* de 1 quadro) ao recriar os nós no WebView.
- **Correção Implementada**:
  1. Em `renderCurrentRoute()`, calculado `isCurrentRenderRouteChange = (lastRouteRendered !== route)` antes de renderizar; `getScreenEnterClass()` retorna `'screen-in-place'` quando a rota não mudou (aplicado em todas as telas), e em `css/screens.css` `.screen-in-place` desativa as animações de entrada da tela, pôster e `.detail-stagger`.
  2. Criado cache em memória de URLs de imagens já carregadas (`loadedImageUrls` + `window.__luminaImgLoaded` + `renderLazyImgTag` + `syncLoadedImagesInViewport`), emitindo `lazy-fade is-loaded` e `loading="eager"` imediatamente para imagens já vistas.
  3. Criado estado de deslocamento de janela (`pendingWindowShift`) e helper `getVirtualRowEnterClass`, aplicando uma transição curta de `140ms` (`translateY(±18px)` + `opacity`, `.vrow-enter-down` / `.vrow-enter-up`) exclusivamente na linha/fileira que entra na janela em todas as listas virtualizadas, mantendo as demais linhas estáticas e substituindo `content-visibility: auto` por `contain: layout paint`.
- **Como testar na TV física**: Abrir uma série com mais de 10 episódios (ou a lista de Canais / grade de Filmes) e manter a seta para BAIXO e depois para CIMA pressionada: a tela de fundo, o pôster e os títulos permanecem firmes sem piscar, as imagens já carregadas não somem e apenas a nova linha na extremidade desliza suavemente em `140ms`. Ao trocar de tela (ex.: Início -> Séries -> Detalhe), a animação normal de entrada da tela continua ocorrendo.

### B12 — Canal ao vivo abrindo tela de detalhe (`js/ui/app-ui.js`)
- **Sintoma**: Abrir alguns conteúdos ao vivo (como um canal salvo na tela de Favoritos ou qualquer cartão renderizado por `renderPosterCard` / acionado via `data-detail-id`) abria a página de detalhes de filme/série em vez de iniciar a reprodução direta no player.
- **Causa Raiz Confirmada no Código**:
  1. `renderPosterCard` (usado também em `renderFavorites`) atribuía `data-detail-id` indiscriminadamente a qualquer item, inclusive quando `item.kind === 'live'`.
  2. O handler de clique de `data-detail-id` em `app-ui.js` navegava sempre para `'detail'` sem verificar se `found.kind === 'live'`.
- **Correção Implementada**:
  1. Em `renderPosterCard`, itens com `item.kind === 'live'` passam a receber `data-play-id` e subtítulo `'Ao vivo · <grupo>'`.
  2. No handler de `data-detail-id` (em `bindGlobalActions`), adicionada verificação explícita `if (found.kind === 'live')`: preserva o salvamento do histórico de busca e a checagem de PIN parental (`isItemLockedByParental` / `openParentalPinModal`), chama `LuminaPlayer.open(found)` e navega direto para `'player-fullscreen'`, sem criar entrada `'detail'` na pilha do `router.js`.
- **Como testar na TV física**: Adicionar um canal ao vivo aos Favoritos, abrir a tela Favoritos (ou Início / Busca / Canais) e pressionar OK sobre o canal: o player abre imediatamente em tela cheia, e pressionar Voltar retorna direto para a tela de origem. Filmes e séries continuam abrindo a tela de detalhes normalmente.

---

## 13. Melhorias do player (próximo episódio, lista de episódios, busca livre)

### O que foi adicionado
1. **Oferta de "Próximo episódio" antes do fim (`NEXT_EP_OFFER_SECS = 30`)**:
   - Em `js/player/player-core.js` e `js/player/osd.js`: durante a reprodução de um episódio com duração `>= 300 s`, quando restam `<= 30 s` e existe próximo episódio (`getEpisodeContext`), o player exibe o banner em modo `'offer'` (`"Próximo episódio: <título> (T1 · E2)"`) com os botões `"Assistir agora"` (focado por padrão, marca o episódio atual como concluído em `watchProgress` e abre o próximo) e `"Dispensar"` (oculta a oferta e impede o avanço automático ao terminar este episódio).
   - Se o usuário voltar no vídeo para restarem mais de `35 s`, a oferta é ocultada automaticamente. Se o usuário ignorar a oferta até o vídeo terminar, o fluxo final de contagem regressiva de `5 s` (`mode: 'countdown'`) continua funcionando normalmente.
2. **Botão "Episódios" (gaveta de temporadas/episódios dentro do player) e botões "Ep. anterior" / "Próx. ep."**:
   - Em `js/player/player-core.js`: exportado `LuminaPlayer.getEpisodeContext(item)` (fonte única de verdade para encontrar a série por `seriesKey`/`id`, episódio hidratado ou `seriesTitle`, retornando `show`, `seasons`, `flatEpisodes`, `currentIndex`, `prevEpisode`, `nextEpisode` e `needsLazyLoad`) e `loadEpisodeListForCurrent(cb)` (reutilizando `LuminaXtream.fetchSeriesInfo` para séries carregadas sob demanda).
   - Em `js/player/osd.js`: adicionados no deck (somente para episódios) os botões `"Ep. anterior"`, `"Próx. ep."` (ocultados quando não há episódio vizinho) e `"Episódios"`. A gaveta abre já posicionada na temporada e episódio atuais, exibe pílulas de temporada navegáveis com `ESQUERDA`/`DIREITA` e lista virtualizada de episódios com `CIMA`/`BAIXO` atualizando apenas os nós da gaveta (`updateEpDrawerListOnly`), sem reconstruir o OSD inteiro. Pressionar `Voltar` fecha primeiro a gaveta sem sair do player (`LuminaOSD.isDrawerOpen()` / `closeDrawer()`).
3. **Busca livre na barra de tempo (scrub com prévia) e avanço/recuo acelerado**:
   - Em `js/player/osd.js`, `js/ui/app-ui.js` e `css/screens.css`: ao focar `#osd-timeline-seek` (`data-lr-control="osd-seek"`), `ESQUERDA`/`DIREITA` deslocam uma posição de prévia com aceleração por toques consecutivos (`<= 500 ms`: toques 1–3 = `10 s`, 4–8 = `30 s`, 9–15 = `60 s`, 16+ = `5 min`, limitado a `10%` da duração), exibindo a bolha `#osd-seek-bubble` (`"1:23:40  (+5:00)"`) sem chamar `renderOsd()`. O seek é efetivado após `700 ms` sem novos toques ou imediatamente com `OK`; pressionar `Voltar` durante a prévia cancela o scrub sem sair do player.
   - Os botões `"Voltar"` / `"Avançar"` do deck e as teclas `REWIND` / `FAST_FORWARD` passam a usar a mesma aceleração progressiva em VOD, e um ticker leve de `1 s` mantém o tempo decorrido e a barra atualizados enquanto o OSD está visível.
4. **Retomada automática (Resume)**:
   - Verificado em `js/player/player-core.js` (linhas 579–584, 657–659 e 719) que a retomada automática a partir de `watchProgress[item.id].position` já estava implementada tanto para ExoPlayer (`startPositionMs`) quanto para `<video>` HTML5 (`currentTime`), permanecendo intocada.

### Arquivos Alterados
- `app/src/main/assets/app/js/player/player-core.js`
- `app/src/main/assets/app/js/player/osd.js`
- `app/src/main/assets/app/js/core/router.js`
- `app/src/main/assets/app/js/ui/app-ui.js`
- `app/src/main/assets/app/css/screens.css`
- `RELATORIO-DE-BUGS.md`

### Como testar na TV física
1. Abrir um episódio de série com mais de 5 minutos, focar na barra de tempo (`CIMA` a partir do deck), segurar `DIREITA` para ver a bolha de tempo acelerar (`+10s`, `+30s`, `+1:00`, `+5:00`) e aguardar `700 ms` (ou apertar `OK`) para pular até os `30 s` finais.
2. Confirmar que o banner `"Próximo episódio: ..."` aparece com `"Assistir agora"` e `"Dispensar"`, sem contagem regressiva e com o vídeo continuando a tocar.
3. No deck do player, abrir `"Episódios"`, trocar de temporada com `ESQUERDA`/`DIREITA`, rolar episódios com `CIMA`/`BAIXO`, pressionar `Voltar` para fechar apenas a gaveta e testar `"Ep. anterior"` / `"Próx. ep."`.
