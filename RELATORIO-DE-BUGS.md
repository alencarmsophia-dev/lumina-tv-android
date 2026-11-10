# Relatório de Bugs e Correções — Lumina TV

## Registro v2.2.1 — Adaptação LG webOS 23 (Pacote IPK em Overlay)
- **Contexto:** Criação do empacotamento `.ipk` para TVs LG webOS 23 (Chromium 94) a partir da base 2.2.1 sem modificar nenhum arquivo compartilhado do Android/Fire TV.
- **Pontos tratados preventivamente no overlay `webos/js/webos-platform.js` e `webos/service/`:**
  1. **Bloqueio de CORS em listas M3U / Xtream Codes no pacote local (`file://`):** segundo a documentação oficial da LG, web apps empacotados seguem a política padrão de CORS do Chromium. Mantido o Plano A (`XMLHttpRequest` direto) e adicionado o Plano B (`com.luminatv.player.service` via Luna Bus) acionado automaticamente apenas quando `status === 0`.
  2. **Economia de CPU em VOD (MP4/MKV/HEVC/AC3):** no Android sem ExoPlayer, arquivos `.mkv` tentavam variante `.mp4` antes do `<video>`. No webOS 23, o decodificador de hardware da TV suporta `.mkv` e `.mp4` nativamente; o hook em `webos-platform.js` prioriza `NativeEngine` no 1º passo para VOD, mantendo `HlsJsEngine` e `MpegtsEngine` nos canais ao vivo.
  3. **Exportação de Backup e Relatório de Diagnóstico sem download de arquivo (`Blob`):** como `<a download>` com `Blob` não baixa arquivos para disco do usuário no WebAppManager do webOS, `saveBackupToDisk` e `readBackupFromDisk` persistem o conteúdo em `localStorage`/`IndexedDB` e copiam para a área de transferência do app.
  4. **Inexistência de atualização por APK no webOS:** `checkForAppUpdate` e `downloadAndInstallUpdate` retornam aviso amigável informando que a atualização em TVs LG é realizada instalando um novo pacote `.ipk`.
