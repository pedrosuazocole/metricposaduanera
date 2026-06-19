@echo off
title MetricPOS Buenos Aires v7.3
color 0A

echo.
echo  ============================================
echo   METRIC POS v7.3 - Inversiones Buenos Aires
echo  ============================================
echo.

:: Verificar Node.js
node --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo  [ERROR] Node.js no esta instalado.
    echo  Descargalo en: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do echo  [OK] Node.js %%i detectado

:: Instalar dependencias si no existen
if not exist "node_modules" (
    echo.
    echo  [INFO] Primera ejecucion - Instalando dependencias...
    call npm install
    if errorlevel 1 (
        color 0C
        echo  [ERROR] Fallo la instalacion de dependencias.
        pause
        exit /b 1
    )
)

:: Crear carpeta de datos si no existe
if not exist "data" mkdir data

:: Cargar variables del .env manualmente
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        set line=%%a
        if not "!line:~0,1!"=="#" (
            if not "%%a"=="" if not "%%b"=="" set %%a=%%b
        )
    )
)

echo.
echo  [INFO] Iniciando servidor en puerto 3000...
echo  [INFO] Abre el navegador en: http://localhost:3000
echo  [INFO] Presiona Ctrl+C para detener el servidor
echo.

node server.js
pause
