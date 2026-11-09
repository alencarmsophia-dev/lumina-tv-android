# Lumina TV — Changelog v2.1.0 (`versionCode 2100`)

## 1. Player Nativo Media3 ExoPlayer (`1.3.1`) e Arquitetura Híbrida
- **Media3 ExoPlayer Nativo (`NativePlayerController.kt`)**: Adicionado motor nativo Android (`androidx.media3:media3-exoplayer:1.3.1`, `media3-exoplayer-hls:1.3.1`, `media3-datasource-okhttp:1.3.1`, `media3-ui:1.3.1`) sobre `SurfaceView` posicionado abaixo do `WebView` transparente, com decodificação por hardware e fallback automático de codec (`setEnableDecoderFallback(true)`).
- **Transparência Coordenada (`html.native-video-active`)**: Quando o `ExoPlayer` está ativo, `html`, `body`, `#app-root`, `#video-stage` e `#screen-viewport` ficam transparentes e `#main-video` é ocultado, mantendo o OSD, legendas e modais da interface web renderizados por cima do vídeo nativo.
- **Abstração Única de Vídeo (`js/player/playback-facade.js` + `js/player/engines/exoplayer.js`)**: Unifica abertura, play/pause, seek, faixas de áudio/legenda e proporção de tela entre o `ExoPlayer` nativo e os motores WebView (`HlsJsEngine`, `MpegtsEngine`, `NativeEngine`).
- **Correção de `detectNativeHls()` (`js/platform/platform.js`)**: Removido o retorno forçado `|| isAndroid || isWebOS`; agora verifica estritamente `video.canPlayType`, eliminando a falha em que o `<video>` tentava abrir `.m3u8` antes do `ExoPlayer`/`HlsJsEngine`.
- **Plano de Fallback Enxuto (`js/player/player-core.js`)**: Máximo de 3 passos e teto global de 45 segundos (eliminando o loop de 3×4 tentativas). Detecção de formato por caminho (`/\.m3u8($|\?)/i` e `/\.ts($|\?)/i`), respeito a `allowed_output_formats` e `preferOutputFormat`, e watchdog de 20s (ao vivo) / 30s (VOD).
- **User-Agent VLC e Retentativa Automática em HTTP 403 (`LuminaWebViewClient.kt` + `player-core.js`)**: User-Agent padrão alterado para `"VLC/3.0.20 LibVLC/3.0.20"` com fallback automático para 3 User-Agents alternativos em caso de bloqueio `403`.
- **Classificação Semântica de Erros e Pílula Discreta no OSD (`osd.js`)**: Erros `401/403`, `404`, `429/458/884` (`max_connections`), `5xx`, DNS, timeout e codec exibem mensagens humanas claras sem trocar de motor inutilmente, com botões `"Tentar de novo"`, `"Trocar formato"`, `"Trocar motor"`, `"Ver diagnóstico"` e `"Voltar"`.

## 2. Cadastro Manual de Lista na TV e Teclado Virtual Próprio
- **Tela `"Adicionar lista"` (`app-ui.js`)**: Três cartões lado a lado (`480 × 440 px`): `"Pelo celular (QR Code)"` (recomendado), `"Xtream Codes"` (servidor, usuário e senha com botão Mostrar/Ocultar) e `"Link M3U / M3U8"`.
- **Teclado Virtual Próprio para Controle Remoto (`js/ui/onscreen-keyboard.js`)**: Grade de 10 colunas (`96 × 72 px`), camadas `abc`/`ABC`/`#+=`, coluna direita com 8 atalhos rápidos de URL (`http://`, `https://`, `.com`, `.com.br`, `.tv`, `:8080`, `/get.php`, `www.`), repetição contínua no botão Apagar (`60ms`), colagem da área de transferência (`getClipboardText()`), suporte a teclado físico USB/Bluetooth e botão `"Teclado do sistema"`.
- **Normalização e Detecção Automática de Links Xtream (`js/data/list-input.js`)**: Limpeza de espaços invisíveis e aspas curvas, adição automática de `http://`, remoção de sufixos (`/player_api.php`, `/get.php`) e portas redundantes (`:80`, `:443`), e detecção automática de links `get.php?username=...&password=...` colados nos campos M3U ou Servidor.
- **Validação em 4 Passos e Fallback por Categoria (`xtream-client.js`)**: Progresso claro (`1/4` a `4/4`), verificação de conta expirada/desativada/limite de conexões, botão `"Confiar neste servidor"` para HTTPS autoassinado, e download por categoria caso `get_vod_streams` ou `get_series` falhe por tamanho.
- **Gerenciamento de até 5 Listas Salvas (`store.js` + `repository.js`)**: Alternância rápida em `Ajustes > Minha lista` preservando favoritos e progresso de reprodução separados por lista.

## 3. Diagnóstico do Player, Teste de Stream e Rede
- **Logger Estruturado com Mascaramento de Senhas (`js/core/diag-log.js`)**: Buffer circular persistente dos últimos 50 eventos mascarando `password=`, `pass=`, `token=` e caminhos `/live|movie|series/user/***/`.
- **Tela `"Diagnóstico do player"` e `"Testar minha lista"` (`app-ui.js` + `NativePlayerController.probeStream`)**: Inspeciona codecs de hardware (`MediaCodecList`), testa 3 itens da lista sem decodificar vídeo e exporta relatório `lumina-diagnostico.txt` sem credenciais.
- **Proxy CORS Transparente em Erros (`LuminaWebViewClient.kt`)**: `executeCorsProxyRequest` nunca retorna `null` em exceções; devolve HTTP `502` JSON estruturado com `X-Lumina-Proxy-Error` (`DNS`, `TIMEOUT`, `SSL`, `CONNECT`).

## 4. Verificação e Limitações do Ambiente de Geração
- **Testes Automatizados (`npm test`)**: Todas as 9 suítes de teste (incluindo as 10 baterias novas de `tests/v21-player-lists.test.js`) passaram com 0 falhas.
- **Compilação do APK**: Como o ambiente sandbox de geração não possui acesso externo à internet para baixar artefatos Maven do Android SDK, a compilação final do APK (`assembleDebug` / `assembleRelease`) é executada pelo workflow `.github/workflows/build-apk.yml` no GitHub Actions ao enviar a tag `v2.1.0`.
