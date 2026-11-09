# Manual de Identidade Visual — Lumina TV v1.9.0 ("A Luz Acende a Tela")

## 1. Conceito Criativo
**"Lumina"** nasce da luz. A identidade visual captura o instante exato em que o feixe de um projetor corta a escuridão da sala e acende a tela:
- **Sem contêineres genéricos**: o símbolo vive solto no espaço, sem quadrado arredondado aprisionando letras.
- **Três lâminas refratadas (Conceito A — "Facho", Padrão)**: um triângulo de *Play* com cantos suavemente arredondados (~6% de raio) seccionado por duas fendas diagonais de `20°` em três lâminas ascendentes de luz, acompanhadas de uma única centelha quente (`#FDE68A`).
- **Por que o Conceito A ("Facho") é o padrão**: suas três lâminas independentes materializam o feixe óptico do projetor, mantêm leitura cristalina de `24px` a `192px` e permitem a coreografia escalonada de `90ms` na abertura antes do pouso FLIP no menu lateral.

## 2. Grade de Construção e Equilíbrio Óptico
- **Grade base**: `64 × 64` unidades (`viewBox="0 0 64 64"`).
- **Compensação óptica**: como um triângulo apontando para a direita possui maior massa visual à esquerda, o baricentro geométrico foi deslocado `+2,5 unidades` para a direita (`x = 14..53,5`, `y = 8..52`), alinhando o centro óptico perfeitamente ao eixo `(32, 32)`.
- **Área de respiro mínima**: `1/4` (`25%`) da largura do símbolo em todos os lados (mínimo de `10 unidades` livres ao redor do símbolo dentro ou fora do `viewBox`).
- **Tamanho mínimo de exibição**: `24px × 24px` em telas digitais.

## 3. Paleta Oficial da Marca (`css/tokens.css`)
| Token CSS | Hex | Papel na Marca |
|---|---|---|
| `--bg` | `#0B0F17` | Escuridão da sala de cinema (fundo principal) |
| `--brand-a` | `#67E8F9` | Luz fria de alta intensidade (1ª lâmina / topo do degradê) |
| `--accent` | `#38BDF8` | Ciano Lumina principal (2ª lâmina / foco / feixe) |
| `--accent-dark` | `#0284C7` | Azul profundo de refração (3ª lâmina / base do degradê) |
| `--brand-violet` | `#6D5BFF` | Violeta espectral (usado com moderação apenas no fim do degradê profundo) |
| `--brand-spark` | `#FDE68A` | Centelha quente única (aparece somente em 1 ponto do símbolo e no pingo do "I" do wordmark) |

## 4. Wordmark em Paths SVG (`brand/logo-full.svg`)
- Desenhado 100% como `<path>` geométricos (retas e curvas Bézier), sem depender de arquivos de fonte externos:
  - **`LUMINA`**: caixa alta, peso semibold (`4,2px` de haste), espaçamento de `0,16em`, cor `#F8FAFC`. A letra **`I`** possui haste reduzida com a centelha quente (`#FDE68A`) flutuando acima.
  - **`TV`**: separado à direita, peso leve (`2,6px` de haste), preenchido com o degradê ciano (`#67E8F9` → `#38BDF8` → `#0284C7`).

## 5. Usos Corretos e Incorretos
- **Usos corretos**:
  - Usar `logo-mark.svg` sobre `#0B0F17` ou `#121A2C` (menu lateral recolhido, abertura, aba Sobre).
  - Usar `logo-on-light.svg` quando aplicado sobre fundos claros (`#F8FAFC`).
  - Usar `logo-mono.svg` para camadas monocromáticas (Android 13+ themed icons, marcas d'água de uma cor).
- **Usos incorretos (proibidos)**:
  - Nunca colocar o símbolo dentro de um quadrado ou círculo colorido chapado.
  - Nunca aplicar `filter: blur()`, `drop-shadow` ou `feGaussianBlur` no SVG.
  - Nunca usar a cor `--brand-spark` (`#FDE68A`) em mais de um ponto por composição.
