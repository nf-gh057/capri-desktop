@echo off
rem Capri's installer, for a double-click: install.ps1 next to it, past PowerShell's script policy.
rem Its options work here too: install.cmd -Yes -Ollama, install.cmd -Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 pause
