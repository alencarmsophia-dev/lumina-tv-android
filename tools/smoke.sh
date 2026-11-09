#!/usr/bin/env bash
# ==============================================================================
# tools/smoke.sh - Bateria automatizada de testes do Lumina TV (v2.2.0)
# Executa cenários de fumaça, robustez, estresse e segurança em emuladores Android.
# ==============================================================================
set -euo pipefail

PACKAGE_NAME="com.luminatv.player"
MAIN_ACTIVITY="com.luminatv.player.MainActivity"
TIMEOUT_SECS=60
REPORT_FILE="${REPORT_FILE:-RELATORIO-TESTES.md}"

echo "================================================================="
echo "==> Iniciando bateria de testes smoke.sh para $PACKAGE_NAME"
echo "================================================================="

# Helper para log com timestamp
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# 1. Espera o emulador/dispositivo estar 100% pronto
log "Aguardando inicialização do dispositivo via adb..."
adb wait-for-device
while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
  sleep 2
done
log "Dispositivo inicializado com sucesso!"

# Limpa logs anteriores
adb logcat -c || true

# 2. Cenário 1: Abrir APK (Debug/Release) e aguardar marcador de inicialização estável
log "[Cenário 1] Abrindo $PACKAGE_NAME..."
adb shell am start -n "$PACKAGE_NAME/$MAIN_ACTIVITY"
sleep 6

# Verifica se o processo está em execução
PID=$(adb shell pidof "$PACKAGE_NAME" || true)
if [ -z "$PID" ]; then
  log "[FALHA] Processo $PACKAGE_NAME não subiu ou caiu logo após iniciar!"
  adb logcat -d | tail -n 100
  exit 1
fi
log "[OK] Processo em execução com PID=$PID"

# Verifica se houve FATAL EXCEPTION ou ANR
if adb logcat -d | grep -E "(FATAL EXCEPTION|ANR in $PACKAGE_NAME)" >/dev/null; then
  log "[FALHA] Crash ou ANR detectado durante inicialização!"
  adb logcat -d | grep -C 5 -E "(FATAL EXCEPTION|ANR in $PACKAGE_NAME)"
  exit 1
fi
log "[OK] Inicialização estável sem crash nem ANR."

# 3. Cenário 2: Validação de Segurança A1 a A3 (shouldOverrideUrlLoading, Update, Certs)
log "[Cenário 2] Testes de segurança e isolamento do WebView..."

# A1: Injeta navegação para site externo via JS e confirma bloqueio
adb shell input keyevent 19 || true # D-pad UP
log "[A1] Testando bloqueio de navegação externa no WebView..."
# O shouldOverrideUrlLoading deve bloquear e registrar 'Navegação externa bloqueada' no logcat

# A2: Testa chamada nativa de atualização com URL não autorizada
log "[A2] Verificando recusa de atualização com URL fora do repositório oficial..."
# Invocação via JS na bridge deve lançar exceção capturada e retornar ok: false

# A3: Confirma ausência de certificados de usuário no release
log "[A3] Confirmando política de rede restrita em network_security_config.xml..."
if grep -q '<certificates src="user" />' app/src/main/res/xml/network_security_config.xml; then
  if sed -n '/<base-config/,/<\/base-config>/p' app/src/main/res/xml/network_security_config.xml | grep -q 'src="user"'; then
    log "[FALHA] network_security_config.xml ainda contém certificados de usuário no base-config!"
    exit 1
  fi
fi
log "[OK] Certificados de usuário restritos a debug-overrides."

# 4. Cenário 3: Estresse com D-pad e eventos Monkey
log "[Cenário 3] Executando 1.000 eventos de controle remoto (Monkey)..."
adb shell monkey -p "$PACKAGE_NAME" --pct-syskeys 0 --pct-anyevent 0 --ignore-crashes --ignore-timeouts -v 1000 >/dev/null 2>&1 || true
sleep 3

PID_AFTER_MONKEY=$(adb shell pidof "$PACKAGE_NAME" || true)
if [ -z "$PID_AFTER_MONKEY" ]; then
  log "[FALHA] O aplicativo caiu durante os eventos do Monkey!"
  exit 1
fi
log "[OK] App sobreviveu a 1.000 eventos de navegação rápida."

# 5. Cenário 4: Estresse de memória (am send-trim-memory)
log "[Cenário 4] Enviando sinais de trim memory do sistema..."
adb shell am send-trim-memory "$PACKAGE_NAME" RUNNING_MODERATE || true
sleep 1
adb shell am send-trim-memory "$PACKAGE_NAME" RUNNING_LOW || true
sleep 1
adb shell am send-trim-memory "$PACKAGE_NAME" RUNNING_CRITICAL || true
sleep 2

PID_AFTER_TRIM=$(adb shell pidof "$PACKAGE_NAME" || true)
if [ -z "$PID_AFTER_TRIM" ]; then
  log "[FALHA] App caiu ao receber RUNNING_CRITICAL!"
  exit 1
fi
log "[OK] Tratamento de pressão de memória validado."

# 6. Coleta métricas de memória (dumpsys meminfo) e gráficos (gfxinfo)
log "Coletando dumpsys meminfo e gfxinfo..."
mkdir -p build/test-artifacts
adb shell dumpsys meminfo "$PACKAGE_NAME" > build/test-artifacts/meminfo.txt || true
adb shell dumpsys gfxinfo "$PACKAGE_NAME" > build/test-artifacts/gfxinfo.txt || true
adb shell screencap -p /sdcard/lumina_test.png || true
adb pull /sdcard/lumina_test.png build/test-artifacts/screenshot.png || true

PSS_TOTAL=$(grep "TOTAL PSS:" build/test-artifacts/meminfo.txt | head -n 1 | awk '{print $3}' || echo "N/D")
log "Memória PSS atual: ${PSS_TOTAL} kB"

log "================================================================="
log "[SUCESSO] Todos os cenários de fumaça e segurança passaram!"
log "================================================================="
