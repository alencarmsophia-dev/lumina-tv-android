#!/usr/bin/env bash
# ==============================================================================
# Sincroniza a pasta ../lumina-tv/app/ para app/src/main/assets/app/
# sem alterar absolutamente nenhum arquivo original do projeto LG webOS.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_APP_DIR="${1:-$ANDROID_ROOT/../lumina-tv/app}"
DEST_ASSETS_DIR="$ANDROID_ROOT/app/src/main/assets/app"

if [ ! -d "$SOURCE_APP_DIR" ]; then
  echo "[ERRO] Pasta de origem não encontrada: $SOURCE_APP_DIR"
  echo "Uso: ./scripts/sync-assets.sh [/caminho/para/lumina-tv/app]"
  exit 1
fi

if [ ! -f "$SOURCE_APP_DIR/appinfo.json" ] || [ ! -f "$SOURCE_APP_DIR/index.html" ]; then
  echo "[ERRO] A pasta de origem não parece conter o app Lumina TV (appinfo.json ou index.html ausentes)."
  exit 1
fi

echo "[1/2] Limpando destino antigo em: $DEST_ASSETS_DIR"
rm -rf "$DEST_ASSETS_DIR"
mkdir -p "$DEST_ASSETS_DIR"

echo "[2/2] Copiando $SOURCE_APP_DIR -> $DEST_ASSETS_DIR (cópia exata)..."
cp -R "$SOURCE_APP_DIR/." "$DEST_ASSETS_DIR/"

echo "[OK] Sincronização concluída! Total de arquivos copiados:"
find "$DEST_ASSETS_DIR" -type f | wc -l
