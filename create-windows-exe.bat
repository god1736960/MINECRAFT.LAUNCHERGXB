@echo off
chcp 65001 >nul
title OptiCraft - Crear .EXE para Windows
color 0A
cd /d "%~dp0"

echo ============================================================
echo    OPTICRAFT - GENERADOR DE .EXE (Windows)
echo ============================================================
echo.

REM --- 1) Comprobar Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js.
  echo Instala Node.js 20 o superior desde: https://nodejs.org
  echo Luego vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js %%v detectado.
echo.

REM --- 2) Instalar dependencias ---
echo [1/2] Instalando dependencias (esto puede tardar unos minutos)...
call npm install
if errorlevel 1 (
  echo [ERROR] Fallo la instalacion de dependencias.
  pause
  exit /b 1
)
echo.

REM --- 3) Compilar el .exe ---
echo [2/2] Compilando OptiCraft.exe (instalador NSIS)...
call npm run build
if errorlevel 1 (
  echo [ERROR] Fallo la compilacion.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo    LISTO! Tu instalador esta en la carpeta  dist\
echo    Busca:  OptiCraft Setup 1.0.0.exe
echo ============================================================
echo.
if exist "dist" explorer dist
pause
