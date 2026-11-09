# Lumina TV v2.2.0 — Guia Completo para Amazon Fire TV, Android TV, Google TV e Android

Este projeto empacota o **Lumina TV v2.2.0** em um **APK Android nativo** (`com.luminatv.player`, `versionCode 2200`, `versionName "2.2.0"`), equipado com proxy CORS via OkHttp (com suporte a cabeçalhos `#EXTVLCOPT` por stream), escala automática `1920x1080` e **atualizador automático de APK integrado via GitHub Releases**.

---

## 1. Novidades do Projeto Android na v2.2.0

1. **Atualização do Aplicativo Dentro da Própria TV (Auto-Update via GitHub Releases):**
   - Em **Ajustes → 5. Atualizações (Lista/App)**, o botão **Verificar Atualização do App** consulta `https://api.github.com/repos/alencarmsophia-dev/lumina-tv-android/releases/latest`.
   - Quando há uma versão mais nova (ex.: `v2.2.0`), o aplicativo mostra as notas da versão e o botão **Baixar e Instalar**, fazendo o download de `lumina-tv.apk` com barra de progresso, validação de tamanho/SHA-256 e abrindo o instalador do sistema via `FileProvider`.
2. **Cabeçalhos `#EXTVLCOPT` por Canal/Stream no Proxy OkHttp:**
   - Listas M3U que especificam `#EXTVLCOPT:http-user-agent=...` ou `#EXTVLCOPT:http-referrer=...` registram esses cabeçalhos na ponte `LuminaAndroidBridge.registerStreamHeaders(...)`, e o `LuminaWebViewClient.kt` os aplica automaticamente nas requisições OkHttp.
3. **Workflow GitHub Actions com Download Automático de Vendor e Publicação de Release:**
   - O arquivo `.github/workflows/build-apk.yml` baixa automaticamente `hls.js v1.5.15` e `mpegts.js v1.7.3`, sincroniza `lumina-tv/app` para `app/src/main/assets/app`, exige os *secrets* de assinatura para nunca quebrar a atualização por cima, gera `lumina-tv.apk` + `lumina-tv.apk.sha256` e publica uma **GitHub Release** automaticamente sempre que você enviar uma tag `v*` (ex.: `git tag v2.2.0 && git push origin v2.2.0`).

---

## 2. Configuração Obrigatória dos Secrets de Assinatura no GitHub

Para que uma versão nova do APK sempre instale **por cima da anterior** na Fire TV mantendo suas listas, favoritos e progresso, o APK precisa ser assinado sempre com o **mesmo keystore**.

### Passo 1: Criar seu Keystore (uma única vez, no Termux ou PC)
```bash
pkg install -y openjdk-17
keytool -genkeypair -v \
  -keystore lumina-release-key.jks \
  -alias lumina \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass SUA_SENHA_FORTE \
  -keypass SUA_SENHA_FORTE \
  -dname "CN=Lumina TV, OU=Media, O=Lumina, L=Surubim, ST=PE, C=BR"

base64 -w 0 lumina-release-key.jks > keystore_b64.txt
cat keystore_b64.txt
```

### Passo 2: Cadastrar os 4 Secrets no GitHub
No seu repositório `alencarmsophia-dev/lumina-tv-android`, acesse **Settings → Secrets and variables → Actions → New repository secret** e crie:
- `KEYSTORE_BASE64`: conteúdo inteiro gerado pelo comando `base64` acima
- `KEYSTORE_PASSWORD`: `SUA_SENHA_FORTE`
- `KEY_ALIAS`: `lumina`
- `KEY_PASSWORD`: `SUA_SENHA_FORTE`

---

## 3. Passo a Passo Pelo Celular (Termux) para Publicar a v2.2.0 e Atualizar na TV

```bash
# 1. No Termux, entre na pasta do seu repositório
cd ~/lumina-tv-android

# 2. Copie os arquivos atualizados da v2.2.0 e sincronize os assets do app web
chmod +x scripts/sync-assets.sh
./scripts/sync-assets.sh ../lumina-tv/app

# 3. Faça commit e envie para a branch principal
git add .
git commit -m "Release Lumina TV v2.2.0"
git push origin main

# 4. Crie e envie a tag v2.2.0 para disparar a publicação automática da Release com lumina-tv.apk
git tag v2.2.0
git push origin v2.2.0
```

Assim que o workflow terminar na aba **Actions** do GitHub:
- O arquivo `lumina-tv.apk` estará publicado em **Releases** do seu repositório.
- Nas próximas versões (`v2.2.0`, `v2.2.0`, etc.), basta abrir **Ajustes → 5. Atualizações (Lista/App)** direto na Fire TV e clicar em **Baixar e Instalar**!

---

## 4. Mapeamento do Controle Remoto (Fire TV / Android TV)

| Botão no Controle Fire TV / Android TV | KeyEvent Android | Código JS | Ação no Lumina TV v2.2.0 |
|---|---|---|---|
| **Setas (Cima / Baixo / Esq / Dir)** | `KEYCODE_DPAD_*` | `38 / 40 / 37 / 39` | Navegação espacial e rolagem das listas virtualizadas |
| **Selecionar / OK (Botão Central)** | `KEYCODE_DPAD_CENTER` / `ENTER` | `13` (`OK`) | Selecionar item / Mostrar OSD no player |
| **Voltar (Seta Curva)** | `KEYCODE_BACK` | `27` (`BACK`) | Volta tela anterior / Abre confirmação de saída na Home |
| **Play / Pause** | `KEYCODE_MEDIA_PLAY_PAUSE` | `415` ou `19` | Alterna reprodução/pausa conforme estado do player |
| **Retroceder (<<) / Avançar (>>)** | `KEYCODE_MEDIA_REWIND / FF` | `412 / 417` | `-10s` / `+10s` em VOD ou troca de canal no Ao Vivo |
| **Canal + / Canal - (ou Page Up/Down)** | `KEYCODE_CHANNEL_UP / DOWN` | `427 / 428` | Pula página nas grades/listas ou faz zapping no player |
| **Menu (3 linhas) — Segurar por 2s** | `KEYCODE_MENU` (≥ 2s) | `403→404→405→406` | Abre/fecha o **Painel Flutuante de Diagnóstico** |
| **Menu (3 linhas) — Toque curto** | `KEYCODE_MENU` (< 2s) | `405` (`YELLOW`) | Favorita/desfavorita rapidamente o item em foco |
