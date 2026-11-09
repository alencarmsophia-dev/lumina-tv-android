# Changelog — Lumina TV v1.9.0 (Etapa 2: Identidade Visual "A Luz Acende a Tela", Splash Composto, Abertura Coreografada com FLIP e Benchmark Adaptativo)

## 1. Conceito Criativo e Identidade Visual ("A Luz Acende a Tela")
- **Fim do ícone em quadrado chapado**: o símbolo agora vive solto sobre uma grade óptica de `64×64` com área de respiro mínima de `1/4` da largura e zero contêineres ao redor.
- **Três conceitos originais em `brand/` (`logos-preview.html` e `BRAND-GUIDE.md`)**:
  - **Conceito A — "Facho" (`BRAND_LOGO = 'A'`, Padrão)**: triângulo de *Play* de cantos suavemente arredondados (~6%) seccionado por duas fendas diagonais de `20°` em três lâminas ascendentes de luz (`#67E8F9` → `#38BDF8` → `#0284C7` → `#6D5BFF`), acompanhadas de uma única centelha quente (`#FDE68A`).
  - **Conceito B — "L de Luz" (`BRAND_LOGO = 'B'`)**: haste contínua em L com ponta em *Play* e centelha quente acima da haste vertical.
  - **Conceito C — "Horizonte" (`BRAND_LOGO = 'C'`)**: arcos luminosos concêntricos sobre a barra horizontal da tela com *Play* em espaço negativo.
- **Wordmark 100% em Paths SVG (`brand/logo-full.svg`)**: letras de `"LUMINA"` desenhadas como `<path>` geométricos semibold (`0,16em` de espaçamento) com a centelha `#FDE68A` sobre a haste do `"I"`, e `"TV"` em peso leve com degradê ciano — independente de arquivos de fonte externos.
- **Novos tokens em `css/tokens.css`**: `--brand-a: #67E8F9`, `--brand-violet: #6D5BFF`, `--brand-spark: #FDE68A`, `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` e `--ease-inout: cubic-bezier(0.65, 0, 0.35, 1)`.

## 2. Ícone Adaptativo Android (`foreground`, `background`, `monochrome`), Banner Fire TV e Splash Composto
- **Ícone Adaptativo Completo**: `ic_launcher_foreground.xml` (símbolo na zona segura de `66dp` dentro de `108dp`), `ic_launcher_background.xml` (`#0B1B33` → `#0B0F17` com brilho radial central) e `ic_launcher_monochrome.xml` (camada de uma cor para ícones temáticos do Android 13+), além dos PNGs em `mipmap-*` para compatibilidade total com `minSdk = 22` (Fire OS 5+).
- **Banner da Fire TV (`320×180`, `res/drawable/banner.png`)**: fundo em degradê escuro, símbolo *Facho* à esquerda, wordmark em paths à direita e linha fina de luz cruzando na base com margem interna de `16px`.
- **Splash Nativo Composto (`1920×1080`, `res/drawable/splash.png` e `app/splash.png`)**: degradê vertical sutil de `#0B0F17` para `#0A1426` com vinheta leve, brilho radial discreto e símbolo de `176px` centralizado em `(960, 540)` — idêntico ao primeiro frame de `#boot-splash` (zero pisca ou salto).

## 3. Abertura Animada de 3,5 s com FLIP e Desempenho Adaptativo
- **Linha do tempo derivada de `--intro-dur: 3500ms`**:
  - `0–250ms` **Continuidade**: frame idêntico ao splash nativo.
  - `250–800ms` **Ignição**: linha horizontal de luz (`1920×2px`) expande com `scaleX(0 → 1)` em `--ease-out-expo`.
  - `600–1100ms` **Campo de luz**: camada `1400×800px` pré-renderizada entra com `scale(0.55 → 1)` e `opacity(0 → 0.85)` enquanto a linha de ignição se dissipa.
  - `700–1300ms` **Marca**: as 3 lâminas do *Facho* entram escalonadas de `90ms` (`translateY(28px → 0)` + `opacity` em `360ms`).
  - `1100–1700ms` **Brilho**: faixa diagonal de `120px` a `20°` atravessa o símbolo uma única vez (`560ms`, `--ease-inout`).
  - `1400–2100ms` **Nome**: letras de `LUMINA` sobem com stagger de `55ms`, seguidas de `TV` em ciano e da centelha do `I` com leve overshoot (`cubic-bezier(0.34, 1.4, 0.64, 1)`).
  - `1900–2400ms` **Linha de apoio**: `"Sua TV e cinema em casa"` (`24px`, `#94A3B8`) sobe `8px` com fade.
  - `2400–3000ms` **Respiro**: pausa elegante (exibe barra fina de `4px` se o catálogo ainda estiver carregando, sem bloquear).
  - `3000–3500ms` **Entrega (FLIP)**: o símbolo viaja da posição central (`176×176`) exatamente até o logo do menu lateral (`64×64`) em `380ms` (`--ease-inout`), normalizado pela escala do `viewport-fit.js`, revelando o logo real no pouso sem duplicata.
  - `3200–3700ms` **Entrada da Início**: banner entra em `320ms` (`translateY(20px → 0)`) e fileiras com stagger de `60ms`.
- **Benchmark Adaptativo (`window.__luminaPerf`)**: mede o tempo dos quadros via `requestAnimationFrame` nos primeiros `500ms`; se a mediana passar de `24ms`, cai automaticamente para a variação `REDUZIDA`.

## 4. Aba Sobre Refinada
- Exibe o novo símbolo em `160px` centralizado no topo do painel, `"Lumina TV"` (`40px/800`), `"Versão 1.9.0"` (`26px`, `#94A3B8`) e a frase `"Sua TV e cinema em casa"` (`24px`, `#94A3B8`).
