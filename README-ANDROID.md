# Lumina TV v1.5.1 — Guia Completo para Android, Android TV, Google TV e Amazon Fire TV

Este projeto empacota o aplicativo **Lumina TV v1.5.1** (originalmente desenvolvido para LG webOS) em um **APK Android nativo** leve (abaixo de 5 MB), mantendo **100% de compatibilidade** com a pasta `app/` original sem alterar uma única linha do código JavaScript, HTML ou CSS existente.

---

## 1. Como a Arquitetura Funciona

1. **Integridade total do `app/` (Regra Nº 1):**
   - A pasta `lumina-tv/app/` é copiada integralmente para `app/src/main/assets/app/` pelo script `scripts/sync-assets.sh` (ou `scripts/sync-assets.bat` no Windows).
   - O mesmo diretório `lumina-tv/app/` continua gerando normalmente o pacote `.ipk` da TV LG com `ares-package app -o dist`.
2. **Contexto Seguro (`https://`) e Pareamento WebCrypto (`crypto.subtle`):**
   - Em vez de carregar por `file:///android_asset/...` (onde `window.isSecureContext` é `false` e `crypto.subtle` é bloqueado pelo Chromium), o app utiliza `WebViewAssetLoader` servindo os arquivos em `https://appassets.androidplatform.net/assets/app/index.html`.
   - Com isso, a criptografia ponta-a-ponta (`ECDH P-256` + `AES-GCM`) do pareamento com `https://surubim-player-pairing.vercel.app` funciona nativamente.
3. **Proxy de CORS Transparente (`LuminaWebViewClient.kt`):**
   - Como a origem do app é `https://appassets.androidplatform.net`, servidores de listas M3U e painéis Xtream Codes bloqueariam chamadas `XMLHttpRequest` por falta do cabeçalho `Access-Control-Allow-Origin`.
   - O `LuminaWebViewClient` intercepta requisições `GET`/`HEAD`/`OPTIONS` externas (exceto o servidor de pareamento `surubim-player-pairing.vercel.app`, que já possui CORS aberto e usa requisições `POST` com corpo JSON) e executa a chamada nativamente via **OkHttp**, injetando `Access-Control-Allow-Origin: *` e devolvendo o `InputStream` em **modo streaming** (sem carregar listas ou segmentos inteiros na memória RAM).
   - Requisições diretas da tag `<video>` (`Sec-Fetch-Dest: video` ou arquivos `.mp4`/`.mkv`/`.ts` em modo `no-cors`) retornam `null` em `shouldInterceptRequest`, deixando o pipeline multimídia nativo em C++ do Chromium lidar diretamente com conexões persistentes, buffering de hardware e `Range` requests.
4. **Escala Automática 1920×1080 em 720p, 1080p, 4K e Celulares:**
   - O layout do Lumina TV foi desenhado com coordenadas fixas `1920x1080`.
   - No Android, combinamos `WebView.setInitialScale(...)` calculado a partir da resolução física da tela com um *shim* injetado por fora via `evaluateJavascript` (`window.__luminaFitViewport`), que remove o `initial-scale=1.0` do `<meta name="viewport">` em memória e aplica escala proporcional com centralização automática:
     - **Fire TV 720p (1280×720):** escala exata de `66.67%` ocupando 100% da tela sem cortes.
     - **Fire TV / Android TV 1080p (1920×1080):** mapeamento 1:1 (`100%`) independente do DPI (`density 1.5` ou `2.0`).
     - **Fire TV 4K (3840×2160):** escala `200%` com nitidez máxima.
     - **Celulares / Tablets (20:9 ou 16:10):** centralização automática em *letterbox/pillarbox* preservando a proporção 16:9 e o motor de foco espacial (`getBoundingClientRect()`).

---

## 2. Como Criar o Keystore de Assinatura

Para assinar o APK de release localmente, execute o comando abaixo na pasta raiz (ou um nível acima de `lumina-tv-android/`):

```bash
keytool -genkeypair -v   -keystore lumina-release-key.jks   -alias lumina   -keyalg RSA   -keysize 2048   -validity 10000   -storepass SUA_SENHA_FORTE   -keypass SUA_SENHA_FORTE   -dname "CN=Lumina TV, OU=Media, O=Lumina, L=Surubim, ST=PE, C=BR"
```

Em seguida, copie o arquivo `keystore.properties.example` para `keystore.properties` (que já está no `.gitignore` para nunca ir para o Git) e preencha com os dados:

```properties
storeFile=../lumina-release-key.jks
storePassword=SUA_SENHA_FORTE
keyAlias=lumina
keyPassword=SUA_SENHA_FORTE
```

> **Dica:** Se você rodar `./gradlew assembleRelease` sem criar o `keystore.properties`, o `app/build.gradle.kts` assina automaticamente com a chave de debug padrão do Android para que o APK já possa ser instalado imediatamente na Fire TV.

---

## 3. Como Gerar o APK

### Opção A — Pelo Celular (Sem Computador, via GitHub Actions + Termux)
Compilar um projeto Android completo direto dentro do Termux no celular costuma falhar por falta de binários oficiais do `aapt2`/Android SDK para ARM64 e alto consumo de RAM do daemon do Gradle. **A forma mais rápida, gratuita e confiável estando só com o celular é usar o GitHub Actions** (o workflow `.github/workflows/build-apk.yml` já está pronto no projeto):

1. No Termux, instale o `git` e suba a pasta `lumina-tv-android` para um repositório (público ou privado) na sua conta do GitHub:
   ```bash
   pkg update && pkg install -y git
   cd lumina-tv-android
   git init
   git branch -M main
   git add .
   git commit -m "Lumina TV Android v1.5.1"
   git remote add origin https://github.com/SEU_USUARIO/lumina-tv-android.git
   git push -u origin main
   ```
2. Assim que o `git push` terminar, abra o repositório no navegador do celular → aba **Actions** → workflow **Build Lumina TV APK (Fire TV & Android TV)**.
3. Em cerca de 2 minutos a compilação termina e você baixa o arquivo **`lumina-tv-v1.5.1-firetv-release-apk.zip`** (contendo o `app-release.apk` assinado) direto pelo celular!

### Opção B — Pelo Computador via Linha de Comando
1. Certifique-se de ter o **JDK 17** e o **Android SDK** (`ANDROID_HOME`) configurados.
2. Sincronize a pasta `app/` e compile:
   ```bash
   cd lumina-tv-android
   ./scripts/sync-assets.sh ../lumina-tv/app
   ./gradlew assembleRelease
   ```
   - APK de Release assinado: `app/build/outputs/apk/release/app-release.apk`
   - APK de Debug (para testes): `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`

### Opção C — Pelo Android Studio
1. Abra o **Android Studio** → **Open** → selecione a pasta `lumina-tv-android`.
2. Aguarde o Gradle sincronizar as dependências (`androidx.webkit` e `okhttp`).
3. No menu superior, clique em **Build → Build Bundle(s) / APK(s) → Build APK(s)** ou **Generate Signed Bundle / APK**.

---

## 4. Como Instalar na Amazon Fire TV por Sideload

### Passo 1: Ativar as Opções do Desenvolvedor na Fire TV
1. Na tela inicial da Fire TV, vá em **Configurações (ícone de engrenagem)** → **Meu Fire TV** (ou **Dispositivo e Software**) → **Informações**.
2. Posicione o seletor sobre o nome do seu aparelho (ex.: **Fire TV Stick 4K**) e aperte o botão **OK (central)** **7 vezes seguidas** até aparecer a mensagem *"Não é necessário, você já é um desenvolvedor"*.
3. Aperte **Voltar** uma vez e entre no novo menu **Opções para desenvolvedores**.
4. Ative **Depuração ADB** (`ON`).
5. Ative **Instalar aplicativos desconhecidos** (ou **Apps de fontes desconhecidas**) para o aplicativo **Downloader** (ou para os seus gerenciadores de arquivos).

### Passo 2A: Instalar via ADB (pelo Computador ou pelo Celular com Termux)
1. Descubra o IP da sua Fire TV em **Configurações → Meu Fire TV → Informações → Rede** (ex.: `192.168.1.50`).
2. No computador ou no **Termux** do celular (`pkg install android-tools`), execute:
   ```bash
   adb connect 192.168.1.50:5555
   ```
3. Olhe para a TV: aparecerá uma janela perguntando *"Permitir depuração USB?"*. Marque **"Sempre permitir a partir deste computador"** e clique em **OK**.
4. Instale (ou atualize) o APK:
   ```bash
   adb install -r app-release.apk
   ```
5. O **Lumina TV** aparecerá na lista de aplicativos da Fire TV com seu banner `320x180`.

### Passo 2B: Instalar pelo aplicativo Downloader na Fire TV
1. Na loja da Fire TV (Amazon Appstore), busque e instale o app gratuito **Downloader** (ícone laranja).
2. Abra o **Downloader** e, no campo de URL/código, digite o link direto onde você hospedou o seu `app-release.apk` (por exemplo, um link de Release do seu GitHub ou um servidor HTTP local na mesma rede Wi-Fi com `python3 -m http.server 8000` no Termux: `http://IP_DO_CELULAR:8000/app-release.apk`).
3. Quando o download terminar, clique em **Instalar** e depois em **Concluído**.

---

## 5. Como Atualizar o `app/` no Futuro sem Refazer o Projeto Android

Sempre que você fizer melhorias na pasta `lumina-tv/app/` (para a TV LG):

1. No Linux / macOS / Termux:
   ```bash
   cd lumina-tv-android
   ./scripts/sync-assets.sh ../lumina-tv/app
   ```
2. No Windows (Prompt de Comando ou PowerShell):
   ```bat
   cd lumina-tv-android
   scripts\sync-assets.bat ..\lumina-tvpp
   ```
3. Se você subiu a versão no `app/appinfo.json`, atualize também `versionCode` e `versionName` em `app/build.gradle.kts` e recompile o APK (`./gradlew assembleRelease` ou `git push` para o GitHub Actions).

---

## 6. Mapeamento do Controle Remoto (Fire TV / Android TV)

O arquivo `KeyBridge.kt` traduz automaticamente os botões físicos do controle remoto Android / Fire TV para os códigos esperados por `app/js/core/keys.js`:

| Botão no Controle Fire TV / Android TV | KeyEvent Android | Código JS Injetado | Ação no Lumina TV |
|---|---|---|---|
| **Setas (Cima / Baixo / Esq / Dir)** | `KEYCODE_DPAD_*` | `38 / 40 / 37 / 39` | Navegação espacial 10-foot |
| **Selecionar / OK (Botão Central)** | `KEYCODE_DPAD_CENTER` / `ENTER` | `13` (`OK`) | Selecionar item / Mostrar OSD no player |
| **Voltar (Seta Curva)** | `KEYCODE_BACK` | `27` (`BACK`) | Volta tela anterior / Abre confirmação de saída na Home |
| **Play / Pause** | `KEYCODE_MEDIA_PLAY_PAUSE` | `415` (`PLAY`) ou `19` (`PAUSE`) | Alterna reprodução/pausa conforme estado do `LuminaPlayer` |
| **Retroceder (<<)** | `KEYCODE_MEDIA_REWIND` | `412` (`REWIND`) | `-10s` em Filmes/Séries ou Canal Anterior no Ao Vivo |
| **Avançar (>>)** | `KEYCODE_MEDIA_FAST_FORWARD` | `417` (`FAST_FORWARD`) | `+10s` em Filmes/Séries ou Próximo Canal no Ao Vivo |
| **Canal + / Próximo / Page Up** | `KEYCODE_CHANNEL_UP` / `MEDIA_NEXT` | `427` (`CH_UP`) | Zapping para o próximo canal ao vivo |
| **Canal - / Anterior / Page Down** | `KEYCODE_CHANNEL_DOWN` / `MEDIA_PREVIOUS` | `428` (`CH_DOWN`) | Zapping para o canal anterior |
| **Menu (3 linhas) — Segurar por 2s** | `KEYCODE_MENU` (long press ≥ 2s) | `403 → 404 → 405 → 406` | Abre/fecha o **Painel de Diagnóstico** (`R·G·Y·B`) |
| **Menu (3 linhas) — Toque curto** | `KEYCODE_MENU` (short press) | `405` (`YELLOW`) | Atalho para tecla Amarela |
| **Teclas Coloridas (TVs Android)** | `KEYCODE_PROG_RED/GREEN/YELLOW/BLUE` | `403 / 404 / 405 / 406` | Sequência `R·G·Y·B` abre o Painel de Diagnóstico |
| **Home (Casinha)** | Sistema (`KEYCODE_HOME`) | Tratado pelo Fire OS | Sai para a tela inicial da TV e pausa o vídeo |

---

## 7. Comportamento de Vídeo, Backup JSON e Limitações Conhecidas por Versão do Fire OS

1. **Comportamento das Engines de Vídeo (`NativeEngine`, `HlsJsEngine`, `MpegtsEngine`):**
   - Na análise do código original (`app/js/player/player-core.js` linha 153 e `app/js/vendor/hls.min.js` / `mpegts.min.js`), o `player-core.js` instancia `LuminaNativeEngine.create(videoEl, callbacks)` e os arquivos em `app/js/vendor/` são *stubs* leves.
   - No Android / Fire TV, isso é uma vantagem importante para streams HLS (`.m3u8`) e MP4: diferentemente do Chrome de desktop, a tag `<video>` nativa do Android WebView (`NativeEngine`) possui **suporte nativo a HLS (`.m3u8`) e MP4 (H.264/HEVC)** via `MediaPlayer` / `MediaCodec` do sistema Android!
   - **Canais em `.ts` bruto contínuo (MPEG-TS HTTP progressivo):** como os servidores Xtream do app (`app/js/data/xtream-client.js` linha 58) já montam as URLs de canais ao vivo com final **`.m3u8`** (`/live/user/pass/streamId.m3u8`), o `NativeEngine` do Android WebView reproduz os canais Xtream nativamente. Apenas listas M3U manuais que apontem diretamente para fluxos `.ts` brutos sem manifesto `.m3u8` podem não abrir no `<video>` nativo se o firmware do aparelho não demuxar MPEG-TS diretamente na tag `<video>`.
2. **Codecs de Áudio e Vídeo (MKV, AC3, EAC3 / Dolby Digital Plus, HEVC / H.265):**
   - A decodificação na `NativeEngine` usa os codecs de hardware (`MediaCodec`) do próprio aparelho Fire TV / Android TV:
     - **Fire TV Stick 4K / 4K Max / Cube (Fire OS 6, 7 e 8):** decodificam **H.264, HEVC (H.265) 10-bit, VP9, AAC, AC3 e EAC3 (Dolby Digital Plus)** por hardware.
     - **Fire TV Stick 1ª/2ª Geração (Fire OS 5 — Android 5.1, API 22):** decodifica H.264 até 1080p e áudio AAC/MP3/EAC3; vídeos em HEVC 4K ou containers `.mkv` com trilhas DTS não suportadas pelo hardware antigo podem falhar ou ficar sem áudio.
   - **Seleção de múltiplas faixas de áudio (`videoEl.audioTracks`):** no Android WebView, a API experimental `HTMLMediaElement.audioTracks` muitas vezes retorna apenas a faixa padrão (`1/1`). O botão **Áudio** no OSD continuará funcionando sem erro e exibindo `"Áudio Padrão (1/1)"`.
3. **Fire OS 5 (API 22) e Versão do System WebView:**
   - Como todo o código em `app/js/` foi escrito em **ES5 estrito** (`var`, `function`, sem arrow functions), o aplicativo roda inclusive em WebViews mais antigos (Chromium 55+ no Fire OS 5). Caso o aparelho tenha um WebView abaixo do Chromium 50, a `MainActivity` exibe uma tela amigável orientando a atualização do sistema.
4. **Backup JSON na Fire TV:**
   - O botão **Exportar Backup JSON** em **Ajustes** continua salvando o backup completo no `IndexedDB` e no `localStorage` exatamente como na LG.
   - Além disso, o wrapper Android espelha automaticamente o arquivo exportado em `/sdcard/Android/data/com.luminatv.player/files/lumina-backup.json` (sem alterar o JS do app), permitindo copiar o arquivo via `adb pull /sdcard/Android/data/com.luminatv.player/files/lumina-backup.json` se desejar guardá-lo fora da TV.
5. **Evolução Futura Opcional (Fase Híbrida com Media3 / ExoPlayer):**
   - Caso no futuro você queira reproduzir arquivos `.mkv` com múltiplas faixas de áudio/legenda embutidas e streams `.ts` brutos em qualquer TV Box genérica, é possível adicionar uma ponte `@JavascriptInterface` com **AndroidX Media3 (ExoPlayer)** posicionando um `PlayerView` atrás do `WebView` transparente (`Color.TRANSPARENT` quando `#video-stage.is-active` estiver ativo). Nesta versão, mantivemos 100% o player original do `app/` conforme especificado.
