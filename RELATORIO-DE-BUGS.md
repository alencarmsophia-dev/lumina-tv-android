# Relatório de Auditoria e Correção de Bugs — Lumina TV v2.1.0

## Causas Raiz de Reprodução e Rede Corrigidas na v2.1.0 (A–G)

| ID | Causa Raiz Confirmada | Solução Implementada na v2.1.0 |
| :--- | :--- | :--- |
| **Causa A** | `detectNativeHls()` em `app/js/platform/platform.js` retornava `true` em qualquer Android (`\|\| isAndroid \|\| isWebOS`), fazendo o `<video>` (`NativeEngine`) tentar abrir `.m3u8` antes do `HlsJsEngine` e falhar na Fire TV. | `detectNativeHls()` agora consulta exclusivamente `video.canPlayType(...)` e no Android o passo 1 é sempre o **Media3 ExoPlayer nativo**. |
| **Causa B** | `player-core.js` tentava até 4 motores em sequência e repetia o ciclo 3 vezes (`maxLoopRetries = 2`), gerando ~90s de `"Reconectando..."` e abrindo múltiplas conexões simultâneas que estouravam `max_connections` do servidor Xtream. | Plano de fallback limitado a **no máximo 3 passos** e **teto global de 45s**, sem repetição em loop do plano completo, liberando a conexão anterior antes de abrir outra. |
| **Causa C** | O `<video>` e o MSE do WebView da Fire TV não suportam áudio AC-3/E-AC-3, HEVC em TS, containers `.mkv` nem fluxos `.ts` com PIDs fora do padrão. | Implementado `NativePlayerController.kt` com **Media3 ExoPlayer 1.3.1** sobre `SurfaceView` abaixo do WebView transparente (`html.native-video-active`). |
| **Causa D** | `LuminaWebViewClient.kt` tinha `CUSTOM_IPTV_USER_AGENT = ""` (enviando User-Agent de navegador bloqueado com HTTP `403` por painéis IPTV) e retornava `null` no `catch` de `executeCorsProxyRequest()`, mascarando erros de DNS/SSL/timeout. | User-Agent padrão definido como `"VLC/3.0.20 LibVLC/3.0.20"` com fallback automático para 3 User-Agents alternativos em `403`, e retorno HTTP `502` JSON com `X-Lumina-Proxy-Error`. |
| **Causa E** | `buildFallbackPlan` detectava TS com `ul.indexOf('.ts') !== -1`, casando falsamente com `.tsv`, subdomínios `ts.` ou parâmetros de query. | Substituído por regex estrita de caminho: `/\.m3u8($|\?)/i` (`isHlsPath`) e `/\.ts($|\?)/i` (`isTsPath`). |
| **Causa F** | Timeouts curtos por tentativa e ausência de classificação semântica faziam o player trocar de formato/motor mesmo em erros `401/403/404/429/458`. | `classifyPlaybackError()` distingue autenticação (`401/403`), limite de conexões (`429/458/884`), `404`, `5xx`, DNS, timeout e erro de faixa de áudio. |
| **Causa G** | Ausência de log estruturado de rede/reprodução e de testador de stream sem vídeo dificultava diagnosticar falhas da lista na TV. | Criados `app/js/core/diag-log.js` (50 eventos com mascaramento de senhas), tela `"Diagnóstico do player"` e ferramenta `"Testar minha lista"` (`probeStream`). |

- build 2.2.0 falhou por imports ausentes em MainActivity.kt e strings multilinha em LuminaWebViewClient.kt; corrigido na 2.2.1; verificador tools/verificar-kotlin.py criado para evitar reincidência.
