@echo off
rem Abre o eCamp no navegador para teste local.
rem Mantenha esta janela preta aberta enquanto testa - ela e o "servidor".
cd /d "%~dp0"
start http://localhost:8765
python -m http.server 8765
