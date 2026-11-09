# Changelog — Lumina TV v2.2.1 (`versionCode 2201`)

## Versão 2.2.1

### Corrigido
- **Imports ausentes em `MainActivity.kt`**: adicionados os 6 imports essenciais (`ClipData`, `Typeface`, `Log`, `Button`, `ScrollView` e `Locale`) em ordem alfabética estrita para sanar erros de compilação na tela de diagnóstico nativa e no manipulador de exceções não capturadas.
- **Strings multilinha inválidas em `LuminaWebViewClient.kt`**: convertidas as 3 mensagens de erro em `onMainFrameLoadError` para formato de linha única com `\n` escapado, eliminando erro de sintaxe do compilador Kotlin.

### Adicionado
- **Verificador estático rápido de Kotlin (`tools/verificar-kotlin.py`)**: script executado automaticamente no CI (`.github/workflows/build-apk.yml`) antes da compilação do Gradle para blindar contra reincidência de strings multilinha não escapadas e classes comuns usadas sem import.
