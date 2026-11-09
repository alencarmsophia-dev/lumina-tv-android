# Roteiro de Teste Manual em Aparelho Físico Fraco — Lumina TV v2.2.0

Este roteiro deve ser executado em um aparelho físico de baixo custo (TV Box, Fire TV Stick Lite ou celular antigo com 1 GB ou 1,5 GB de RAM) para validar o comportamento térmico, estabilidade de memória e decodificação de vídeo que o emulador não reproduz.

---

## 1. Preparação (Instalação e Conexão)
1. Instale o APK gerado no seu aparelho via sideload (`adb install -r lumina-tv.apk` ou via app Downloader na Fire TV).
2. Se estiver conectado via USB/Wi-Fi adb ao computador, abra uma janela de terminal para monitorar logs em tempo real:
   ```bash
   adb logcat -s LuminaProxy LuminaExo LuminaListDL LuminaBootGuard AndroidRuntime
   ```

## 2. Passo a Passo do Teste (10 Minutos de Reprodução Contínua)
1. **Abertura e Conexão**:
   - Abra o Lumina TV. Observe se a tela Início surge de forma fluida em menos de 2 segundos.
   - Adicione uma lista M3U pequena ou média (1k a 10k itens).
2. **Navegação e Carga Sob Demanda**:
   - Entre na aba **Canais**. Role rapidamente por 20 a 30 canais usando a seta do controle remoto.
   - Entre na aba **Filmes**. Role 4 a 5 linhas de pôsteres para testar o carregamento da grade virtualizada.
3. **Reprodução Contínua (10 Minutos)**:
   - Sintonize um canal ao vivo em HD (preferencialmente fluxo com áudio estéreo ou surround).
   - Mantenha o canal reproduzindo ininterruptamente por **10 minutos** com a tela ligada.
4. **Trocas Rápidas de Canal (Zapping)**:
   - Após os 10 minutos, alterne de canal 15 a 20 vezes seguidas usando as teclas Canal +/- ou setas.
5. **Teste de Áudio e Pausa**:
   - Pressione Pausa / Play duas vezes.
   - Se o canal tiver mais de um áudio, abra o menu OSD e alterne a faixa de áudio.

---

## 3. O Que Observar e Anotar no Relatório
- [ ] **Aquecimento do Aparelho**: O dongle/box esquentou excessivamente a ponto de congelar a interface ou reiniciar?
- [ ] **Sincronismo Áudio/Vídeo**: O áudio permaneceu perfeitamente sincronizado com a imagem durante os 10 minutos?
- [ ] **Fluidez do Controle**: A resposta ao controle remoto continuou rápida mesmo após 10 minutos tocando vídeo?
- [ ] **Uso de Memória PSS** (opcional via ADB):
  ```bash
  adb shell dumpsys meminfo com.luminatv.player | grep -E "(TOTAL PSS|Native Heap|Dalvik Heap)"
  ```
- [ ] **Modo Seguro**: O app permaneceu em modo normal sem ativar a barra de Modo Seguro indevidamente?
