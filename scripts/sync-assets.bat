@echo off
REM ============================================================================
REM Sincroniza a pasta ..\lumina-tv\app para app\src\main\assets\app no Windows
REM sem alterar nenhum arquivo original do projeto LG webOS.
REM ============================================================================
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ANDROID_ROOT=%%~fI"

if "%~1"=="" (
    set "SOURCE_APP_DIR=%ANDROID_ROOT%\..\lumina-tv\app"
) else (
    set "SOURCE_APP_DIR=%~1"
)

set "DEST_ASSETS_DIR=%ANDROID_ROOT%\app\src\main\assets\app"

if not exist "%SOURCE_APP_DIR%\index.html" (
    echo [ERRO] Pasta de origem nao encontrada ou invalida: "%SOURCE_APP_DIR%"
    echo Uso: scripts\sync-assets.bat [caminho\para\lumina-tv\app]
    exit /b 1
)

echo [1/2] Limpando destino antigo em "%DEST_ASSETS_DIR%"...
if exist "%DEST_ASSETS_DIR%" rmdir /s /q "%DEST_ASSETS_DIR%"
mkdir "%DEST_ASSETS_DIR%"

echo [2/2] Copiando arquivos de "%SOURCE_APP_DIR%" para "%DEST_ASSETS_DIR%"...
xcopy "%SOURCE_APP_DIR%\*" "%DEST_ASSETS_DIR%\" /E /I /H /Y >nul

echo [OK] Sincronizacao concluida com sucesso!
endlocal
