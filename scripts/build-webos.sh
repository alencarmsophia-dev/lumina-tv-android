#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -d "lumina-tv/app" ]; then
  SRC_APP_DIR="lumina-tv/app"
elif [ -d "app/src/main/assets/app" ]; then
  SRC_APP_DIR="app/src/main/assets/app"
else
  echo "[ERRO] Diretório do web app não encontrado (esperado lumina-tv/app ou app/src/main/assets/app)." >&2
  exit 1
fi

DIST_DIR="$ROOT_DIR/dist-webos"
DIST_APP_DIR="$DIST_DIR/app"
DIST_SERVICE_DIR="$DIST_DIR/service"

echo "[1/5] Limpando e preparando diretório temporário $DIST_DIR..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_APP_DIR"

echo "[2/5] Copiando web app de '$SRC_APP_DIR' para '$DIST_APP_DIR'..."
cp -R "$SRC_APP_DIR"/. "$DIST_APP_DIR"/

echo "[3/5] Aplicando overlay do LG webOS (appinfo.json e js/platform/webos-platform.js)..."
cp "$ROOT_DIR/webos/appinfo.json" "$DIST_APP_DIR/appinfo.json"
mkdir -p "$DIST_APP_DIR/js/platform"
cp "$ROOT_DIR/webos/js/webos-platform.js" "$DIST_APP_DIR/js/platform/webos-platform.js"

# Injeta <script src="js/platform/webos-platform.js"></script> logo após platform.js SOMENTE na cópia
node -e '
  var fs = require("fs");
  var indexPath = process.argv[1];
  var html = fs.readFileSync(indexPath, "utf8");
  var target = "<script src=\"js/platform/platform.js\"></script>";
  var injection = target + "\n  <script src=\"js/platform/webos-platform.js\"></script>";
  if (html.indexOf("js/platform/webos-platform.js") === -1) {
    if (html.indexOf(target) === -1) {
      console.error("[ERRO] Tag platform.js não encontrada em " + indexPath);
      process.exit(1);
    }
    html = html.replace(target, injection);
    fs.writeFileSync(indexPath, html, "utf8");
  }
' "$DIST_APP_DIR/index.html"

echo "[4/5] Removendo arquivos de documentação/preview desnecessários na cópia webOS..."
rm -f \
  "$DIST_APP_DIR/logos-preview.html" \
  "$DIST_APP_DIR/assets/logos-preview.html" \
  "$DIST_APP_DIR/brand/logos-preview.html" \
  "$DIST_APP_DIR/assets/BRAND-GUIDE.md" \
  "$DIST_APP_DIR/brand/BRAND-GUIDE.md" \
  "$DIST_APP_DIR/playlists/exemplo.m3u" \
  "$DIST_APP_DIR/js/data/worker-ingest.js"
rmdir "$DIST_APP_DIR/playlists" 2>/dev/null || true

if [ -d "$ROOT_DIR/webos/service" ]; then
  mkdir -p "$DIST_SERVICE_DIR"
  cp -R "$ROOT_DIR/webos/service"/. "$DIST_SERVICE_DIR"/
fi

echo "[5/5] Empacotando IPK..."
if [ "${SKIP_ARES_PACKAGE:-0}" = "1" ]; then
  echo "[AVISO] SKIP_ARES_PACKAGE=1 definido; pulando chamada ao ares-package."
  exit 0
fi

if ! command -v ares-package >/dev/null 2>&1; then
  echo "[ERRO] 'ares-package' não encontrado. Instale com: npm i -g @webos-tools/cli" >&2
  exit 1
fi

rm -f "$ROOT_DIR"/*.ipk
if [ -d "$DIST_SERVICE_DIR" ]; then
  ares-package --no-minify "$DIST_APP_DIR" "$DIST_SERVICE_DIR" -o "$ROOT_DIR"
else
  ares-package --no-minify "$DIST_APP_DIR" -o "$ROOT_DIR"
fi

IPK_FILE="$(ls -1 "$ROOT_DIR"/com.luminatv.player_*.ipk 2>/dev/null | head -n 1 || true)"
if [ -z "$IPK_FILE" ] || [ ! -f "$IPK_FILE" ]; then
  echo "[ERRO] O arquivo .ipk não foi gerado." >&2
  exit 1
fi

sha256sum "$(basename "$IPK_FILE")" > "$(basename "$IPK_FILE").sha256"
echo "[OK] Pacote gerado com sucesso: $(basename "$IPK_FILE") ($(du -h "$IPK_FILE" | cut -f1))"
cat "$(basename "$IPK_FILE").sha256"
