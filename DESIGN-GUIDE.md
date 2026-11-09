# Guia Rápido de Design — Lumina TV v2.0.0

Este documento explica onde alterar cores, tamanhos, textos, logotipo e tempos de animação na interface 10-foot (1920×1080) do Lumina TV.

## 1. Cores e Temas (`app/css/tokens.css`)
Todas as cores da interface estão centralizadas no bloco `:root` de `app/css/tokens.css`:
- `--bg` (`#0B0F17`): cor de fundo principal da tela e da abertura.
- `--bg-side` (`#121A2C`): fundo do menu lateral recolhido e aberto.
- `--bg-panel` (`#131B2E`): fundo de cartões, linhas de canais, categorias e painel de Ajustes.
- `--bg-elevated` (`#1E293B`): fundo de itens em foco, botões secundários e pílulas.
- `--accent` (`#38BDF8`) e `--accent-dark` (`#0284C7`): ciano e azul de destaque (foco, botões primários, valores ativos).
- `--amber` (`#F59E0B`): reservado para estrelas de avaliação (`★ 8,4`) e favoritos.
- `--green` (`#22C55E`): reservado para o selo `NOVO` e status `Atualizada hoje`.
- `--text` (`#F8FAFC`) e `--text-2` (`#94A3B8`): texto principal e secundário.

## 2. Tamanhos de Fonte e Layout (`app/css/tokens.css`)
Nenhum tamanho é menor que `22px` (`--fs-min`), garantindo leitura confortável a 3 metros:
- **Títulos e Textos**: `--fs-hero` (`60px`), `--fs-screen` (`52px`), `--fs-panel` (`40px`), `--fs-row-title` (`32px`), `--fs-body` (`28px`), `--fs-list` (`26px`), `--fs-2` (`24px`), `--fs-min` (`22px`).
- **Medidas de Layout**:
  - Menu lateral: `--nav-w` (`120px` recolhido) e `--nav-open-w` (`360px` aberto sobreposto).
  - Margens de segurança do canvas: `--safe-x` (`84px`) e `--safe-y` (`44px`).
  - Coluna de filtros/categorias: `--filters-w` (`360px`).
  - Cartões de Filmes/Séries (4 por linha): `--card-w` (`301px`), `--card-h` (`452px`), `--card-art-h` (`336px`).
  - Cartões Horizontais 16:9 da Início (5 por linha): `--tile-w` (`314px`), `--tile-h` (`177px`).
  - Alturas de linha: `--row-h` (`68px`), `--row-h-lg` (`84px` nos canais), `--row-h-setting` (`116px` nos ajustes), `--btn-h` (`72px`).

## 3. Como Trocar o Logo Padrão (`BRAND_LOGO`)
As 3 propostas de identidade visual (`A`, `B`, `C`) podem ser visualizadas abrindo `logos-preview.html` no navegador.
- Para trocar o símbolo ativo no app inteiro, edite a constante `BRAND_LOGO = 'A'` no topo de `app/js/ui/app-ui.js` para `'A'`, `'B'` ou `'C'`.
- Os arquivos vetoriais standalone ficam em `app/assets/logo-mark.svg`, `app/assets/logo-full.svg` e `app/assets/logo-mono.svg`.

## 4. Tempo da Abertura e Transições (`app/css/tokens.css`)
- `--intro-dur` (`2600ms`): controla toda a coreografia da abertura em `app/css/screens.css` (entrada do símbolo, feixe de luz e subida do título). Na segunda abertura do mesmo dia, a classe `.is-short` reduz automaticamente para `900ms`.
- `--dur-focus` (`120ms`): velocidade do destaque e escala de foco do controle remoto.
- `--dur-screen` (`180ms`): velocidade da transição de troca de tela e de abertura do menu lateral.

## 5. Textos e Rótulos (`app/js/ui/app-ui.js`)
Todos os rótulos em português do Brasil (nomes das 6 entradas do menu, seletores `Tipo`, `Ordenar`, `Idioma`, `Letra` e as 8 abas de Ajustes) ficam centralizados em `app/js/ui/app-ui.js`.
