@echo off
setlocal
cd /d "%~dp0"
title Install Regis
where node >nul 2>nul
if errorlevel 1 (echo Node.js is not installed. Run "Setup Regis" first. & pause & exit /b 1)
if not exist "%~dp0node_modules\electron\dist\electron.exe" (echo The Regis engine is missing. Run "Setup Regis" first. & pause & exit /b 1)
echo Builds Regis.exe, installs it to %LOCALAPPDATA%\Programs\Regis and updates the shortcuts.
echo Your data and settings are kept.
echo.
node "%~dp0scripts\build-app.js" --install
pause
