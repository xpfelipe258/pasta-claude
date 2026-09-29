@echo off
chcp 65001 >nul
title Obra 198 - Controle de Producao
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul
if errorlevel 1 set "PY=py"
where %PY% >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Python nao encontrado. Instale em https://www.python.org/downloads/
  echo  e marque a opcao "Add python.exe to PATH" durante a instalacao.
  echo.
  pause
  exit /b 1
)

if not exist ".instalado" (
  echo Instalando componentes na primeira execucao...
  %PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
  if errorlevel 1 (
    echo Falha ao instalar componentes. Verifique a conexao com a internet.
    pause
    exit /b 1
  )
  echo ok> .instalado
)

:inicio
%PY% app.py %*
if errorlevel 3 if not errorlevel 4 goto inicio
pause
