@echo off
title NexumCell WhatsApp
cd /d "%~dp0"
echo Conferindo os componentes...
call npm install --no-audit --no-fund
:loop
node index.js
echo O programa parou. Reiniciando em 5 segundos...
timeout /t 5 >nul
goto loop
