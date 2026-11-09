# Esquema de Banco e Catálogo Sob Demanda — Lumina TV v2.2.0 (`SCHEMA_VERSION = 3`)

Este documento descreve a arquitetura de armazenamento paginado em IndexedDB (`LuminaTV_DB`, versão `3`) introduzida na versão **2.2.0** para suportar listas M3U e Xtream Codes de **300.000, 500.000 e 1.000.000 de itens** com consumo constante de memória RAM (`< 100 MB` de heap V8) e abertura em `<= 1,5 s`.

---

## 1. Visão Geral das Object Stores (`LuminaTV_DB` v3)

| Object Store | Chave Primária (`keyPath`) | Finalidade |
| :--- | :--- | :--- |
| `meta` | `key` | Configurações (`settings`), estado ativo por lista (`catalogState_<listId>`), retratos de `favorites`, `watchProgress`, `savedLists` e `activeListId`. |
| `groups` | `key` (`<listId>:<genId>:<section>`) | Lista de categorias da seção (`live`, `movie`, `series`), contagens por categoria e os 40 itens mais recentes (`recentPayloadStr`). |
| `pages` | `key` (`<listId>:<genId>:<section>:<groupId>:<pageIndex>`) | Páginas de **200 itens** codificados em linhas compactas separadas por `TAB` (`payloadStr`) + checksum `FNV-1a` (`checksum`) para verificação de integridade individual por página. |
| `orders` | `key` (`<listId>:<genId>:<section>:<groupId>:az`) | Vetor tipado `Uint32Array` (`locators`) pré-ordenado alfabeticamente sem acentos + tabela `letterJump` (`#`, `A`..`Z` -> posição exata). |
| `searchIndex` | `key` (`<listId>:<genId>:<section>:run:<runIdx>:<bucket>`) | Índice invertido particionado por aba com buckets de 1 letra (`^a`..`^z`) e prefixos de 2 letras (`aa`..`99`) apontando para `Uint32Array` de locators (máx. 200.000 postings por run). |
| `episodes` | `key` (`<listId>:<genId>:series:<seriesKey>`) | Episódios agrupados sob demanda por série/novela (`payloadStr` separado por linhas `TAB`). Lido somente quando o usuário abre a tela de Detalhes da série. |
| `checkpoints` | `key` (`<listId>`) | Ponto de retomada do `import-worker.js` gravado a cada `2 MB` ou `5 s` (`byteOffset`, `carryLine`, `pendingCr`, `utf8Pending`, `stats`, contadores de página). |

---

## 2. Formato Compacto de Linha (`packTupleLine` / `unpackTupleLine`)

Para eliminar o custo de repetir nomes de propriedades JSON milhões de vezes em disco (~720 bytes/item já com índices de busca e ordenação), cada item dentro de `pages.payloadStr` e `episodes.payloadStr` é serializado como uma linha de 20 colunas separadas por `\t`:

```text
0: id              (ex.: i:m3u:live:a1b2c3d4)
1: section         ('live' | 'movie' | 'series' | 'episode')
2: title           (título original)
3: cleanTitle      (título limpo sem tags de qualidade/ano)
4: year            (ano numérico, ex.: 2024)
5: rating          (nota numérica, ex.: 8.5)
6: groupId         (ex.: g_movie_0)
7: groupOriginal   (nome original do grupo no provedor)
8: logo            (URL do pôster/logo)
9: ref             (referência neutra sem senha: xt:<kind>:<id>:<ext> ou xtpath:/movie/{u}/{p}/...)
10: quality        ('4K' | 'FHD' | 'HD' | 'SD')
11: lang           ('DUB' | 'LEG' | 'ORIG')
12: adult          ('1' | '0')
13: season         (número da temporada ou vazio)
14: episode        (número do episódio ou vazio)
15: channelNumber  (número sequencial do canal na categoria)
16: isNovela       ('1' | '0')
17: httpUserAgent  (User-Agent específico exigido por #EXTVLCOPT)
18: httpReferrer   (Referrer específico exigido por #EXTVLCOPT)
19: xtreamSeriesId (ID numérico da série no servidor Xtream)
```

---

## 3. Empacotamento Binário de Localizadores (`Uint32` Locator)

Tanto a ordenação alfabética (`orders`) quanto o índice de busca (`searchIndex`) referenciam qualquer item de uma seção usando um único inteiro de 32 bits sem sinal (`Uint32`):

```text
locator = ((groupIdx & 0xFFF) << 20) | ((pageIdx & 0xFFF) << 8) | (slotIdx & 0xFF)
```

- `groupIdx` (12 bits, `0..4095`): índice da categoria dentro da seção.
- `pageIdx` (12 bits, `0..4095`): índice da página de 200 itens dentro da categoria (até 819.200 itens por categoria).
- `slotIdx` (8 bits, `0..199`): posição do item dentro da página (`0..199`).

---

## 4. Segurança de Credenciais e Troca Instantânea de Senha

Nenhuma página em `pages` ou `episodes` armazena usuário ou senha da lista em texto puro:
- Entradas Xtream gravam `xt:<kind>:<streamId>:<ext>`.
- Entradas M3U com padrão Xtream gravam `xtpath:/<kind>/{u}/{p}/<resto>` ou `xtshort:/{u}/{p}/<id>`.
- Somente no momento de reproduzir (`LuminaCatalog.resolvePlaybackUrl`), as credenciais atuais de `LuminaStore.get('source')` são injetadas na URL final. Se o usuário atualizar a senha da lista, o catálogo inteiro continua válido sem precisar reimportar.
