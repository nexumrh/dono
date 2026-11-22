@echo off
title NexumCell WhatsApp
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando (so na primeira vez)...
  call npm install
)
:loop
node index.js
echo O programa parou. Reiniciando em 5 segundos...
timeout /t 5 >nul
goto loop
