@echo off
chcp 65001 >nul
title Tudo de Helena - Estoque PWA
cd /d "%~dp0"
echo.
echo  Tudo de Helena - Estoque ^& Locacoes
echo  Abrindo servidor local em http://localhost:8765
echo  Feche esta janela para encerrar o servidor.
echo.
start "" http://localhost:8765
python -m http.server 8765
pause
