# Lumina TV — Guia de Empacotamento, Instalação e Testes no LG webOS 23

> **Aviso importante:** Este pacote `.ipk` (`com.luminatv.player`) é destinado exclusivamente à instalação via **Modo Desenvolvedor (Developer Mode)** em Smart TVs LG webOS (alvo principal: **webOS TV 23 / Chromium 94**). Ele **não** é assinado para distribuição pública na loja LG Content Store.

## 1. Como gerar o pacote `.ipk` (GitHub Actions — Sem Computador)

1. Faça commit e push dos arquivos da pasta `webos/`, `scripts/build-webos.sh`, `.github/workflows/build-webos-ipk.yml` e `tests/webos.test.js` para o repositório `alencarmsophia-dev/lumina-tv-android`.
2. Para disparar pelo GitHub Actions:
   - **Opção A (Tag de Release):** crie e envie uma tag `webos-v2.2.1` (nunca use `v*`, que pertence exclusivamente ao Android/Fire TV):
     ```bash
     git tag webos-v2.2.1
     git push origin webos-v2.2.1
     ```
     O workflow criará uma Release marcada como **LG webOS** contendo `com.luminatv.player_2.2.1_all.ipk` e `com.luminatv.player_2.2.1_all.ipk.sha256`.
   - **Opção B (Execução manual):** no GitHub, abra **Actions > Build Lumina TV webOS IPK (v2.2.1) > Run workflow** e baixe o artefato `lumina-tv-v2.2.1-webos-ipk`.

## 2. Preparando a TV LG (Modo Desenvolvedor Oficial)

Conforme a documentação oficial da LG ([App Testing with Developer Mode App](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)):

1. **Criar conta gratuita de desenvolvedor LG:**
   - Acesse [webostv.developer.lge.com](https://webostv.developer.lge.com/) e crie uma conta gratuita LG Developer.
2. **Instalar o app Developer Mode na TV:**
   - Na TV LG conectada à mesma rede Wi-Fi/cabo que o seu celular, abra a loja **LG Content Store (Apps)**, busque por **Developer Mode** e instale o aplicativo oficial da LG.
3. **Ativar o Developer Mode e o Key Server:**
   - Abra o app **Developer Mode** na TV e faça login com sua conta LG Developer.
   - Mude a chave **Dev Mode Status** para **ON** (a TV vai reiniciar).
   - Após reiniciar, abra novamente o app **Developer Mode** e ative o botão **Key Server** para **ON**.
   - Anote os dados exibidos na tela da TV:
     - **IP Address** (ex.: `192.168.1.50`)
     - **Passphrase** (senha de 6 caracteres exibida na tela, ex.: `A1B2C3`)

## 3. Instalando o `.ipk` com a CLI Oficial (`ares-setup-device` e `ares-install`)

### 3.1. Pelo celular Android usando Termux *(Fluxo alternativo — NÃO TESTADO em hardware real)*

> **Transparência:** Como não há TV LG física nem emulador conectados neste ambiente, os comandos abaixo para Termux seguem estritamente a documentação da CLI oficial `@webos-tools/cli`, mas **não foram testados na prática do Termux contra uma TV real**.

```bash
# 1. Instalar Node.js e OpenSSH no Termux
pkg update && pkg install -y nodejs openssh

# 2. Instalar a CLI oficial da LG
npm i -g @webos-tools/cli

# 3. Cadastrar a TV LG (substitua 192.168.1.50 pelo IP da sua TV)
ares-setup-device --add lgwebos -i "username=prisoner" -i "host=192.168.1.50" -i "port=9922"

# 4. Baixar a chave SSH da TV (com o Key Server ligado na TV; digite a Passphrase de 6 dígitos quando solicitado)
ares-novacom --device lgwebos --getkey

# 5. Confirmar que a TV responde
ares-device -i --device lgwebos

# 6. Instalar o pacote IPK baixado do GitHub Actions / Releases
ares-install --device lgwebos com.luminatv.player_2.2.1_all.ipk

# 7. (Opcional) Iniciar o Lumina TV remotamente
ares-launch --device lgwebos com.luminatv.player
```

## 4. Prazo de Expiração do Modo Desenvolvedor

- A sessão do **Developer Mode** na TV LG tem validade de **1000 horas** (aparecendo como `999h` no contador — cerca de 41 dias).
- Se o contador chegar a `0h` (ou se a TV reiniciar 10 vezes seguidas sem conexão com a internet), o Modo Desenvolvedor é desativado automaticamente e os apps instalados por ele são removidos.
- Para renovar antes de expirar: basta abrir o app **Developer Mode** na TV e clicar no botão **Extend** (Restaurar tempo de sessão).

## 5. Checklist Manual de Validação na TV LG

- [ ] App abre sem tela preta e exibe a abertura coreografada ("A Luz Acende a Tela") idêntica à Fire TV.
- [ ] Tela Início idêntica à versão Android/Fire TV, sem corte de bordas em 1920x1080.
- [ ] Menu lateral retrátil e navegação pelas 4 telas principais (Ao Vivo, Filmes, Séries, Novelas) com filtros de Tipo/Ordenar/Idioma/Letra.
- [ ] Navegação por setas do controle remoto e pelo ponteiro do **Magic Remote** (cursor some ao usar setas e reaparece ao mover o controle).
- [ ] Botão **Voltar (461)** fecha modais/teclado/menu lateral, volta para a tela anterior e, na tela Início, abre o modal de confirmação saindo com `webOS.platformBack()`.
- [ ] Carregar lista via **M3U** e via **Xtream Codes** (testando Plano A via XHR direto e Plano B automático via serviço Luna `com.luminatv.player.service` caso o servidor bloqueie CORS).
- [ ] Pareamento pelo celular via QR Code (`https://surubim-player-pairing.vercel.app`).
- [ ] Reproduzir canal ao vivo em **HLS (`.m3u8`)** e em **MPEG-TS (`.ts`)**.
- [ ] Reproduzir **Filme** e **Episódio de Série** (`.mp4` e `.mkv`) usando o decodificador por hardware (`NativeEngine`).
- [ ] Trocar faixa de áudio, legenda e proporção de tela no OSD do player.
- [ ] Favoritar itens, retomar reprodução em **Continuar Assistindo** e testar **Controle Parental** (PIN padrão `0000`).
- [ ] Busca com o teclado na tela (`LuminaKeyboard`) sem sobreposição indevida do teclado do sistema da LG.
- [ ] Tela **Ajustes** (8 abas, exportação/restauração de backup e aviso de atualização via IPK).
- [ ] Reprodução contínua por pelo menos 1 minuto sem travamento e com uso de memória estável.
