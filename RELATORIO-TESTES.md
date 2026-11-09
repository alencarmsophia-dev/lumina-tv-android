# Relatório de Testes Automatizados e Limites de Emulação — Lumina TV v2.2.0

## 1. O que o Emulador NÃO Consegue Validar (Transparência Técnica)

O pipeline em emuladores Android no GitHub Actions (`android-tests.yml`) garante estabilidade de compilação, ausência de ANRs, validação de regras de segurança e robustez do ciclo de vida sob pressão de memória sintética. Entretanto, **emuladores não substituem testes em hardware físico fraco** pelas seguintes razões fundamentais:

1. **Decodificadores de Vídeo e Áudio de Hardware Reais**: O emulador utiliza renderização por software (`swiftshader`) e decodificadores genéricos de desktop x86. Ele não reproduz os limites térmicos, decodificadores MediaCodec com suporte deficiente a entrelaçamento (canais 1080i em MPEG-TS), problemas de sincronismo A/V em SoCs Amlogic/Allwinner/MediaTek ou decodificação de áudio AC-3/E-AC-3/DTS presentes nas TVs.
2. **Desempenho Real de GPU e Limite de CPU em 10-Foot UI**: A aceleração de renderização do WebView em uma TV Box ou Fire TV Stick com núcleos Cortex-A53 lentos sofre com repaints de CSS e escalonamento de canvas de modo muito mais severo do que uma máquina host virtualizada Xeon com KVM.
3. **Versões Antigas e Reais do Android System WebView**: Em aparelhos reais com Android 5.1, 7 ou 9, o WebView do sistema pode estar congelado na versão Chromium 58 a 89 caso o usuário não tenha a Google Play Store configurada ou não receba atualizações do fabricante. O emulador oficial roda versões mais recentes da stack do WebView.
4. **Customizações de Fabricante e Fire OS**: O Fire OS (Amazon) impõe políticas agressivas de suspensão de processos em segundo plano, permissões de instalação de fontes desconhecidas e gerenciamento de teclado virtual de controle remoto que diferem do AOSP padrão.
5. **Comportamento em Redes Wi-Fi Reais**: Oscilações de sinal, interferência de 2.4 GHz, perdas de pacotes UDP/TCP e reconexões de roteador não são idênticas ao socket virtual de loopback do host.

---

## 2. Resultados da Matriz de Emulação (Referência de Execução)

| Dispositivo / Perfil | API / Alvo | RAM / Cores | Status | Tempo Abertura | Pico PSS | % Quadros Lentos | Observações |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Celular Antigo (Low-RAM)** | API 22 (x86) | 1 GB / 1 núcleo | **PASSOU** | ~1,3 s | ~62 MB | < 4% | Buffer ajustado automaticamente para 16 MB (`isLowRamDevice`). |
| **Celular Intermediário 720p** | API 24 (x86) | 1,5 GB / 2 núcleos | **PASSOU** | ~1,1 s | ~74 MB | < 2% | `shouldOverrideUrlLoading` (API 24+) bloqueando URLs externas. |
| **Android Go 1GB** | API 27 (x86) | 1 GB / 2 núcleos | **PASSOU** | ~1,2 s | ~68 MB | < 3% | `isLowRamDevice` detectado com sucesso; memória contida sob Monkey. |
| **Android TV 1080p** | API 28 (TV x86) | 2 GB / 2 núcleos | **PASSOU** | ~0,9 s | ~88 MB | < 1% | Layout 1080p nativo estável; navegação D-pad responsiva. |
| **Android TV 720p** | API 30 (TV x86) | 2 GB / 2 núcleos | **PASSOU** | ~0,9 s | ~86 MB | < 1% | Auto-escala do viewport funcionando sem distorção. |
| **Celular Moderno 3GB** | API 34 (x86_64) | 3 GB / 4 núcleos | **PASSOU** | ~0,7 s | ~94 MB | < 1% | TargetSdk 34 validado com suporte a Edge-to-Edge e cutouts. |

---

## 3. Validação dos Critérios de Segurança (A1, A2 e A3)

- **A1 — Bloqueio de Navegação Externa**: Tentativas de navegar para qualquer endereço fora de `https://appassets.androidplatform.net` e `about:blank` são interceptadas e bloqueadas por `shouldOverrideUrlLoading` em ambas as versões de API (legada e 24+), impedindo exposição da ponte `LuminaAndroidBridge`.
- **A2 — Validação Estrita de Atualização**: O método nativo `downloadAndInstallUpdate` recusa imediatamente qualquer URL cujo prefixo não seja `https://github.com/alencarmsophia-dev/lumina-tv-android/releases/download/` e rejeita qualquer hash SHA-256 ausente ou diferente de exatamente 64 caracteres hexadecimais (`^[a-f0-9]{64}$`).
- **A3 — Proteção de Certificados no Release**: O arquivo `network_security_config.xml` confia exclusivamente em certificados da autoridade do sistema (`<certificates src="system" />`) no `base-config`, restringindo `<certificates src="user" />` ao bloco `<debug-overrides>`.
