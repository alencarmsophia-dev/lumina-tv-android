# Changelog — Lumina TV v2.2.0 (`versionCode 2200`)

## Destaques Arquiteturais da Versão 2.2.0

1. **Abertura Instantânea (`<= 1,5 s`) e Catálogo 100% Sob Demanda**:
   - Na inicialização (`main.js`), o aplicativo lê apenas os metadados leves (`settings` e `catalogState_<listId>`), fazendo **zero** leituras de páginas do catálogo e **zero** chamadas de rede bloqueantes.
   - As chaves gigantes em memória (`rawItems`, `items`, `channels`, `movies`, `seriesList`, `novelasList`, `unclassifiedList`, `itemByIdMap`, `originalGroups`, `categories`, `movieCategories`, `seriesCategories`, `novelaCategories`) foram permanentemente removidas da `LuminaStore`.

2. **Carregamento Paginado por Seção e Categoria (`LuminaCatalog` + `SCHEMA_VERSION = 3`)**:
   - Cada aba (`Canais`, `Filmes`, `Séries`) opera como uma máquina de estados independente (`idle -> loading_groups -> loading_page -> ready | empty | error | syncing`).
   - Os itens são gravados e lidos em páginas de **200 itens** com checksum individual `FNV-1a` e cache LRU estrito de no máximo **12 páginas por seção** na memória RAM.
   - Em fontes **Xtream Codes**, a lista de categorias (`get_*_categories`) é carregada somente ao entrar na aba correspondente, e os itens (`get_*_streams` / `get_series`) são baixados sob demanda por `category_id` usando o parser incremental `stream-json.js`.

3. **Importador M3U em Fluxo (`import-worker.js`) com Checkpoint e Escala de 1.000.000 de Itens**:
   - Leitura em fatias com decodificador UTF-8 incremental seguro para caracteres de 2, 3 e 4 bytes (acentos, `€`, emojis `🔥🎬⚽`) e quebras `\r\n` cortadas na fronteira de chunk.
   - Agrupamento de episódios em séries em tempo real durante o fluxo e ordenação A–Z via `Float64Array` + `Uint32Array` sem estourar o limite de 256 MB de heap.
   - Gravação de checkpoints a cada `2 MB` / `5 s` para retomada exata e troca atômica de geração (`generationId`).

4. **Download Nativo Resiliente com `Range` e `If-Range` (`ListDownloader.kt` & `list-source.js`)**:
   - Suporte a arquivos `.part`, retomada automática via `HTTP 206 Partial Content`, fallback seguro quando o servidor responde `200 OK` sem `Range`, descompressão `gzip`, rotação automática de `User-Agent` em `HTTP 403`, respeito a `HTTP 429 Retry-After`, detector de travamento (stall de 30 s) e verificação prévia de espaço em disco via `StatFs`.
   - Servidor interno de fatias locais em `LuminaWebViewClient.kt` (`https://appassets.androidplatform.net/__lists__/<listId>.m3u`) com suporte a `Range` (`206 Partial Content`) via `RandomAccessFile`.

5. **Busca Individual por Aba (`Canais`, `Filmes`, `Séries`)**:
   - A antiga tela de busca universal foi removida do menu lateral e substituída pelo botão **"Buscar em Canais"**, **"Buscar em Filmes"** e **"Buscar em Séries"** dentro de cada aba.
   - Utiliza índice invertido particionado por aba em disco (buckets de 1 e 2 letras com `Uint32Array` de locators), teclado compacto de 9 colunas (`onscreen-keyboard.js`), ranking de relevância em 4 níveis e paginação por cursor de 60 resultados.

6. **Blindagem Anti-Loop e Modo Seguro (`boot-guard.js` & `MainActivity.kt`)**:
   - Se o app falhar ao estabilizar 2 vezes em menos de 3 minutos ou se o processo de renderização do WebView cair (`onRenderProcessGone`), o Modo Seguro é ativado automaticamente, desativando sincronizações automáticas na abertura e recriando o WebView sem fechar o aplicativo.

- Correção de compilação (Kotlin 1.9): 'continue' dentro de lambda em ListDownloader.kt
