# Changelog — Lumina TV v2.0.0 (Etapa 3: Sistema de Movimento, Microinterações Globais, 12 Paletas / 6 Motivos Determinísticos, Início, Detalhes e Player OSD)

## 1. Linguagem de Movimento (`css/tokens.css`, `settings.js`, `store.js`)
- **Tokens oficiais de tempo e curvas**: `--dur-instant` (`90ms`), `--dur-fast` (`140ms`), `--dur-base` (`220ms`), `--dur-slow` (`360ms`), `--dur-hero` (`600ms`), `--ease-out`, `--ease-inout` e `--ease-spring` (`cubic-bezier(0.34, 1.4, 0.64, 1)`).
- **Novo ajuste "Animações" em `Ajustes > Tela e Desempenho`**: alterna entre `"Completas"`, `"Reduzidas"` e `"Desligadas"` (`motionLevel`), com rebaixamento automático para `"Reduzidas"` caso o benchmark da abertura (`window.__luminaPerf`) ou o modo leve estejam ativos.

## 2. Microinterações Globais
- **Foco e OK**: borda `4px #38BDF8` + fundo `#1E293B` + `scale(1.04)` em `--dur-fast`; nos cartões de capa, uma faixa diagonal de `90px` (branco a `10%` de alpha) percorre o cartão uma única vez em `480ms`; ao pressionar `OK`, o item faz `scale(0.98)` por `80ms`.
- **Menu lateral aberto e transições direcionais**: o painel entra com `translateX(-24px -> 0)` em `--dur-base` e os 6 itens entram com stagger de `30ms` (`translateX(-12px -> 0)`); trocas de tela deslizam `24px -> 0` ao avançar e `-24px -> 0` ao voltar.
- **Diálogos, Toast, Switch, Imagens e Skeleton**: diálogos entram com `scale(0.96 -> 1)` em `160ms`; avisos (`toast`) sobem `16px` a `84px` da esquerda e `120px` de baixo; imagens fazem fade-in de `140ms` ao carregar (`lazy-fade`); opções Sim/Não usam o interruptor `switch` (`88×48px` com botão de `36px` deslizando `40px` + `"Ligado"`/`"Desligado"`).

## 3. Arte Determinística de Capas (12 Paletas + 6 Motivos Geométricos)
- Quando um item não tem pôster, `generateDeterministicArtSvg(title)` gera a mesma arte determinística a partir do hash do título usando as 12 paletas de degradê oficiais e os 6 motivos geométricos planos (`lua`, `sol`, `montanhas em duas camadas`, `cidade em blocos`, `floresta de triângulos`, `ondas`) sob o monograma de 2 letras (`96px/800` a `60%`).

## 4. Início, Tela de Detalhes e Player OSD
- **Início**: saudação contextual (`"Bom dia"`, `"Boa tarde"`, `"Boa noite"` `26px/600`), relógio `"HH:MM"` (`28px/700`, atualizado a cada `30s`), carrossel de até 5 itens com troca automática a cada `8s` (pausada quando focado), efeito Ken Burns (`scale(1 -> 1.05)` em `9s`), preenchimento de `8s` na pílula ativa, cabeçalhos de fileira com `"Ver tudo"`, 1º cartão de `"Continuar assistindo"` em `420×236px` e estado vazio ilustrado (`"Vamos colocar sua lista aqui"` + `"Parear agora"`).
- **Tela de Detalhes**: backdrop em tela cheia (`opacity: 0.55` + gradientes lateral e inferior), pôster `360×540px` em `x=168, y=160`, coluna de texto em `x=568` (título `56px/800`, ano, duração, selo etário, `"★ 8,4"`, gêneros `24px`, sinopse `26px/500` largura `900px`, botões `"▶ Assistir"` / `"▶ Continuar · MM:SS"` e `"+ Favoritar"` / `"★ Nos favoritos"`), pílulas de temporada (`56px`) e linhas de episódio de `108px` com miniatura `168×95px`.
- **Player e OSD**: entrada/saída em `180ms` (`fade` + `translateY(12px)`), degradê superior de `220px` e inferior de `340px`, trilho de `8px` com marcador circular de `22px` ao focar, tempos nas pontas, botões quadrados de `72px` (`Play/Pause` em `88px`, `"-10 s"`, `"+10 s"`, `"Áudio e legendas"`, `"Proporção"`, `"Dormir"`, `"Anterior"`, `"Canais"`) e pílula `"AO VIVO"` (`#EF4444`).
