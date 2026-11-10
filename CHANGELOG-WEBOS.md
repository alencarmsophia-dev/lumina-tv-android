# Changelog — Lumina TV para LG webOS

## [2.2.1] - 2026-11-10

### Adicionado
- **Manifesto webOS (`webos/appinfo.json`):** configurado para `com.luminatv.player` v2.2.1, resolução `1920x1080`, `disableBackHistoryAPI: true`, `handlesRelaunch: false`, `uiRevision: 2` e ícones oficiais validados (`icon.png` 80x80, `largeIcon.png` 130x130 e `splash.png` 1920x1080).
- **Camada de plataforma em overlay (`webos/js/webos-platform.js`):**
  - Integração completa para LG webOS TV 23 (Chromium 94) em JavaScript ES5 estrito sem alterar nenhum arquivo compartilhado do Android/Fire TV.
  - Tratamento do ponteiro do **Magic Remote** (`cursorStateChange`, ocultação automática ao navegar por setas e restauração ao mover o cursor) e bloqueio de abertura acidental do IME nativo sobre o `LuminaKeyboard`.
  - Saída limpa do aplicativo na tela inicial com parada de mídia seguida de `webOS.platformBack()` / `PalmSystem.platformBack()`.
  - Preferência pelo decodificador de hardware nativo (`NativeEngine` / `<video>`) para filmes e séries VOD (`.mp4`, `.mkv`, H.264, HEVC, AC3/E-AC3), mantendo `HlsJsEngine` e `MpegtsEngine` para canais ao vivo.
  - Adaptação de backup/exportação (`saveBackupToDisk`, `readBackupFromDisk` e `getClipboardText`) via armazenamento persistente e área de transferência em memória, e mensagem dedicada para atualização via pacote `.ipk`.
- **Fallback de Rede / CORS (Plano B — `webos/service/`):** serviço Node.js no barramento Luna (`com.luminatv.player.service` com `fetchUrl` e `abortFetch`) acionado automaticamente atrás de flag somente quando o `XMLHttpRequest` direto (Plano A) falha com `status === 0` em URLs HTTP/HTTPS externas sem cabeçalho CORS.
- **Automação de Build e CI/CD (`scripts/build-webos.sh`, `.github/workflows/build-webos-ipk.yml`):** geração isolada em `dist-webos/app`, injeção de `webos-platform.js` apenas na cópia de empacotamento, remoção de arquivos de preview/documentação não utilizados (`BRAND-GUIDE.md`, `logos-preview.html`, `playlists/exemplo.m3u`, `worker-ingest.js`), empacotamento via `ares-package --no-minify`, geração de SHA-256 e publicação automática em Artifacts e GitHub Releases nas tags `webos-v*`.
- **Suíte de testes estáticos e funcionais (`tests/webos.test.js`):** 88 asserções em Node.js puro (zero dependências externas) validando `appinfo.json`, dimensões binárias dos PNGs, referências do `index.html`, compatibilidade sintática ES5/Chromium 94, plano de reprodução VOD/Live e integridade dos arquivos compartilhados.
