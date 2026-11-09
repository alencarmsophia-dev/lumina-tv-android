# Changelog — Lumina TV v1.7.0 (Redesign 10-Foot, Nova Identidade Visual & Abertura Coreografada)

## 1. Sistema de Design Plano e Tokens (`css/tokens.css`, `DESIGN-GUIDE.md`)
- **Zero valores mágicos**: todas as cores, tamanhos de fonte (`>= 22px`), larguras de coluna, alturas de linha, raios (`16px` e `24px`) e tempos (`--intro-dur`, `--dur-focus`, `--dur-screen`) foram centralizados em `app/css/tokens.css`.
- **Interface 100% plana para 60 fps na Fire TV**: removidos todos os efeitos pesados (`blur`, `backdrop-filter`, `box-shadow` luminoso/glow, gradientes complexos). Foco usa borda sólida de `4px var(--accent)`, fundo `var(--bg-elevated)` e `scale(1.04)` em cartões / `scale(1.03)` em linhas em `120ms`.
- **Leveza de renderização**: adicionado `contain: layout paint` nos cartões, `content-visibility: auto` nas linhas de listas/categorias e `decoding="async"` + `loading="lazy"` em todas as imagens.

## 2. Menu Lateral Sobreposto (`120px` recolhido → `360px` aberto)
- **Recolhido (`120px`)**: exibe apenas o novo logo `64×64` no topo, os 6 ícones de `38px` centralizados em botões de `72px` e `Ajustes` no rodapé, com barra ativa de `5px` à esquerda.
- **Aberto (`360px` sobreposto)**: abre ao pressionar `ESQUERDA` na primeira coluna de qualquer tela sobre uma camada `rgba(0,0,0,0.55)`, animando apenas `transform: translateX` e `opacity` em `180ms` sem alterar a largura nem deslocar o conteúdo principal.
- **6 entradas principais**: `Início`, `Busca`, `Canais`, `Filmes`, `Séries`, `Favoritos` + `Ajustes` no rodapé. As antigas entradas `Continuar`, `Organizar`, `Parear/Fontes` e `Novelas` foram integradas à Início, Ajustes e ao seletor `Tipo` em Séries.

## 3. Redesign das Telas Principais
- **Início**: banner de destaque `1668×340` (`125°` de `#172554` a `#0F172A`), selo `NOVO`, título `60px/800`, botões `▶ Assistir` e `+ Favoritar`, indicadores de página com pílula ativa de `44×12px` e fileiras horizontais de 5 cartões `16:9` (`314×177px`) com barra de progresso de `6px`. Removida a barra fixa de dicas do controle remoto (movida para `Ajustes > Sobre`).
- **Canais**: 3 colunas com rótulos `Categorias` (`360px`, linhas de `68px` e contador em pílula) e `Lista de Canais` (`620px`, linhas de `84px` com `#número`, nome `28px/600`, estrela `★` âmbar e selo `HD`/`FHD`), mais painel de prévia `16:9` com `Agora: ...`, `▶ Assistir` e `★ Favoritar`.
- **Filmes, Séries e Novelas**: substituídas as barras de chips do topo e a barra A–Z de 27 botões por uma **Coluna Lateral de Filtros de `360px`** com seletores `Tipo` (em Séries: `Séries` / `Novelas`), `Ordenar` (`Recentes`, `A–Z`, `Nota ★`), `Idioma` e `Letra` (exibido somente quando `Ordenar = A–Z`), seguidos pela lista vertical de `Categorias`. À direita, grade virtualizada de **4 colunas** com cartões `301×452px` (`336px` de arte + `112px` de metadados), capas reais ou monograma plano de 2 letras (`96px/800`) sobre degradê derivado do título, selo `NOVO` e nota `★`.
- **Ajustes**: 8 abas à esquerda (`420px`, linhas de `76px`, sem numeração): `Fonte e Pareamento`, `Reprodução`, `Tela e Desempenho`, `Organizar Lista`, `Controle Parental`, `Atualizações`, `Backup e Dados` e `Sobre`. Painel à direita com linhas de `116px`, cartão `Lista atual` com contagens e pílula verde `Atualizada hoje`.

## 4. Nova Identidade Visual & Abertura Coreografada
- **Logo Novo (`BRAND_LOGO = 'A'`)**: criado o símbolo geométrico *Prisma Lumina* (haste em L ciano/azul + prisma Play branco puro sobre janela `#0B0F17`), acompanhado das propostas `B` e `C` em `logos-preview.html` e dos arquivos `logo-mark.svg`, `logo-full.svg` e `logo-mono.svg`.
- **Ícone Adaptativo Android e Banner Fire TV**: implementados vetores XML nativos (`ic_launcher_foreground.xml` respeitando a zona segura de `66dp` dentro de `108dp`, `ic_launcher_background.xml`) e PNGs sincronizados.
- **Abertura sem salto**: o splash nativo Android (`#0B0F17`) posiciona o logo na mesma coordenada inicial da abertura web (`--intro-dur: 2600ms`, ou `900ms` na segunda abertura do mesmo dia), que anima apenas `transform` e `opacity`, carrega o catálogo em paralelo e pode ser pulada com `OK` ou `Voltar`.
