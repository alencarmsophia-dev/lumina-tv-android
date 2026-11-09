# CHANGELOG — Lumina TV v1.6.1

**Data de Lançamento:** Novembro de 2026  
**Plataformas:** Amazon Fire TV / Android TV (`lumina-tv.apk` `versionCode 1601`) e LG webOS (`com.luminatv.player_1.6.1_all.ipk`)

---

## Adicionado
- **Motor Nativo de Escala e Centralização (`app/js/core/viewport-fit.js`):** Carregado como primeiro `<script>` do `index.html`, calcula `computeFit(viewW, viewH, safeMargin)` e aplica `transform: translate(offsetX, offsetY) scale(scale)` em `#app-root` (`1920x1080`), garantindo encaixe exato em qualquer resolução real do WebView (`960x540`, `1280x720`, `1024x768`, `1280x800`, `1920x1080`, `3840x2160`).
- **Ajuste Ao Vivo de Margem de Segurança / Overscan (`screenSafeMargin`):** Nova preferência em **Ajustes → 3. Desempenho & TMDB** (*"Margem de segurança da tela"*), ajustável com as setas **ESQUERDA/DIREITA** entre `0%`, `2%`, `4%`, `6%`, `8%` e `10%`, com efeito imediato na tela e persistência em `settings_v2` e no Backup JSON.
- **Diagnóstico de Resolução e Escala no Cabeçalho da Home:** O cabeçalho inicial agora exibe em tempo real `" • TELA W×H • ESCALA S%"` (ex.: `• TELA 1280×720 • ESCALA 66,7%`), atualizando automaticamente em eventos de redimensionamento ou ajuste de overscan.
- **Suíte de Testes de Escala (`tests/viewport-fit.test.js`):** Cobertura automatizada de todas as resoluções 16:9, 16:10, 4:3, margem de overscan de 10% e fallbacks contra `0`/`NaN`.

## Corrigido
- **B7 (Interface cortada na Fire TV ligada a projetor/TVs com viewport diferente de 1920×1080):**
  - Substituído `<meta name="viewport" content="width=1920, height=1080...">` por `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`.
  - Ajustados `html, body` em `css/base.css` para `width: 100%; height: 100%; background-color: #0B0F17`, mantendo `#video-stage.is-active` preenchendo `100vw × 100vh`.
  - Desativados `useWideViewPort` e `loadWithOverviewMode` em `MainActivity.kt`, adicionados `onConfigurationChanged`, `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` (API 28+) e chamadas a `window.__luminaFitViewport()`.
  - Corrigidos cortes de texto no card de pareamento e nos anéis de foco `.focusable.is-focused` (`scale(1.05)`), além de normalizar as coordenadas espaciais de `getBoundingClientRect()` em `focus-engine.js` pela escala ativa.
