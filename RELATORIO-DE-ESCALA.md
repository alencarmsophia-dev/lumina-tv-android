# Relatório de Escala e Desempenho — Lumina TV v2.2.0

Medições reais coletadas pela suíte automatizada `npm run test:stress` (`node --max-old-space-size=256 tests/v22-stress.test.js`) com persistência paginada em disco (formato binário V8 Structured Clone equivalente ao IndexedDB do Android WebView) e lotes sintéticos determinísticos (20% canais ao vivo, 60% filmes, 20% episódios agrupados em 6% de séries).

## 1. Tabela de Desempenho por Volume de Catálogo

| Volume da Lista | Canais / Filmes / Séries (Episódios) | Velocidade (itens/s) | Tempo Total (s) | Pico de Memória Heap V8 (MB) | `getPage` 200 itens (ms) | Busca na Aba Mediana / Pior Caso (ms) | Retomada de Checkpoint (ms) | Uso de Disco Total / Por Item |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **50.000 itens** | 10.000 / 30.000 / 3.000 (10.000 eps) | 7.804 itens/s | 6.41 s | 41 MB | 6 ms | 28 ms / 41 ms | 5 ms | 34.1 MB (716 B/item) |
| **300.000 itens** | 60.000 / 180.000 / 18.000 (60.000 eps) | 8.864 itens/s | 33.84 s | 82.5 MB | 4 ms | 57 ms / 119 ms | 4 ms | 206.5 MB (722 B/item) |
| **500.000 itens** | 100.000 / 300.000 / 30.000 (100.000 eps) | 8.286 itens/s | 60.34 s | 86.1 MB | 3 ms | 59 ms / 198 ms | 5 ms | 344.4 MB (722 B/item) |
| **1.000.000 itens** | 200.000 / 600.000 / 60.000 (200.000 eps) | 8.208 itens/s | 121.84 s | 97.1 MB | 3 ms | 85 ms / 283 ms | 6 ms | 680.5 MB (714 B/item) |

## 2. Invariantes Arquiteturais Comprovados

- **Teto estrito de RAM (`--max-old-space-size=256`)**: Mesmo ao importar **1.000.000 de entradas M3U** (200.000 canais, 600.000 filmes e 200.000 episódios distribuídos em 60.000 séries), o pico de heap V8 permaneceu abaixo do limite de 256 MB, sem `OutOfMemoryError`.
- **Leitura de página em tempo constante `O(1)`**: `LuminaCatalog.getPage` lê apenas 1 registro de 200 tuplas compactas separadas por TAB a partir do armazenamento em disco, mantendo latência constante independentemente de a lista ter 50 mil ou 1 milhão de itens.
- **Ordenação A–Z e salto por letra sem estourar memória**: Chaves lexicográficas `Float64Array` + locators compactados `Uint32Array` (`(groupIdx << 20) | (pageIdx << 8) | slotIdx`) permitem ordenar 600.000 filmes em memória tipada contígua (~7,2 MB) e liberar os buffers imediatamente após gravar a loja `orders`.
- **Zero credenciais gravadas nas páginas**: Todas as páginas gravadas em disco utilizam referências neutras (`xt:...`, `xtpath:/live/{u}/{p}/...`), reconstruindo a URL autenticada apenas no instante da reprodução (`resolvePlaybackUrl`).
