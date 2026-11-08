# CHANGELOG — Lumina TV v1.6.0

**Data de Lançamento:** Novembro de 2026  
**Plataformas:** LG webOS (`com.luminatv.player_1.6.0_all.ipk`) e Android / Android TV / Amazon Fire TV (`lumina-tv.apk` `versionCode 1600`)

---

## Adicionado
- **Camada de Plataforma (`app/js/platform/platform.js`):** Detecção unificada de ambiente (`android`, `Fire TV`, `webos`, `browser`), versão do Chromium WebView, suporte nativo a HLS/MSE e ponte segura com `LuminaAndroidBridge`.
- **Módulo de Configurações e Segurança de PIN (`app/js/core/settings.js`):** Persistência automática de todas as preferências do usuário, hash criptográfico `SHA-256 + salt` para o PIN Parental, fluxo de alteração de PIN em 3 etapas, bloqueio progressivo após 5 tentativas incorretas (60s+) e expiração automática da sessão `+18` após 15 minutos de inatividade ou ao sair do player.
- **Atualizador Automático de APK no Android (`MainActivity.kt` + `FileProvider`):** Verificação da última Release pública em `alencarmsophia-dev/lumina-tv-android`, download com barra de progresso em tempo real, validação de tamanho e hash `SHA-256` e abertura automática do instalador do Android.
- **Hidratação Sob Demanda de Séries Xtream (`get_series_info`):** Carregamento real de temporadas e episódios ao abrir a tela de detalhe da série, com cache em memória e na store `seriesDetail` do IndexedDB.
- **Validação de Conta Xtream (`user_info`):** Exibição de status da assinatura, data de vencimento, alerta preventivo quando faltam ≤ 7 dias, conexões simultâneas (`active_cons / max_connections`) e formatos de saída permitidos.
- **Listas e Grades 100% Virtualizadas:** Navegação fluida por catálogos de 100.000+ itens em Canais ao Vivo, Filmes, Séries, Novelas, Favoritos, Continuar Assistindo, Episódios e Organizador de Grupos, mantendo menos de 150 nós no DOM.
- **Barra de Salto Rápido A–Z, Filtro de Idioma e Paginação `CH+/CH-`:** Filtros combinados nos catálogos de Filmes, Séries e Novelas, além de gaveta rápida de troca de canais dentro do OSD do player.
- **Scripts `tools/baixar-vendor.sh` e `tools/baixar-vendor.bat`:** Download automatizado e verificado das bibliotecas `hls.js v1.5.15` e `mpegts.js v1.7.3` integrado ao GitHub Actions.

## Corrigido
- **B1 (Séries sumindo ao reiniciar):** Removido o corte de `25.000` itens em `storage.js` (novo teto configurável de `400.000` itens), implementada gravação atômica por geração (`g<gen>:chunk:<n>`) com verificação de checksum e contagens por tipo, propagação real de erros de quota e migração automática `v1 -> v2`.
- **B2 (Canais ao vivo misturados com séries e filmes):** Reescrito o classificador (`classifier.js` v2) com prioridade determinística, tratamento explícito de canais `24H`, detecção de conflitos (`Friends S02E05` em grupo `Canais` vai para `unclassified`), IDs de 53 bits independentes de credenciais/servidor (zero colisões em 300.000 itens) e migração de favoritos/progresso.
- **B3 (Episódios falsos em séries Xtream):** Removida a criação de 2 episódios fictícios em `convertXtreamPayloadToRawItems`; séries Xtream agora carregam seus episódios reais via `get_series_info`.
- **B4 (Player multi-engine, congelamento e `#EXTVLCOPT`):** Implementada cadeia real de fallback (`NativeEngine` ↔ `HlsJsEngine` ↔ `MpegtsEngine`) com alternância `.m3u8` ↔ `.ts`, watchdog de congelamento a cada 2s, retomada após `loadedmetadata`, duração real no `onEnded`, leitura de `#EXTVLCOPT:http-user-agent`/`http-referrer` no parser M3U e aplicação no proxy OkHttp Android.
- **B5 (Perda de configurações e PIN ao reiniciar):** Todas as configurações agora persistem em `settings_v2`; Backup JSON não expõe mais senha Xtream nem PIN em texto puro por padrão.
- **B6 (Atualizações de lista e de APK):** Atualização incremental condicional (`ETag`/`Last-Modified`), retentativas por etapa no Xtream sem derrubar o catálogo inteiro, botão de cancelar atualização e resumo de diferenças (`+X filmes, +Y séries`).
- **Auditoria Seção 4 (Escape XSS, vírgulas no M3U, capas reais, saída no WebView antigo):** Aplicado `escHtml`/`escAttr` em 100% dos templates, corrigido corte de títulos com vírgula no `#EXTINF`, ativadas imagens reais com `loading="lazy"` e `onerror` fallback, e liberado o botão Voltar na tela de WebView desatualizado.
