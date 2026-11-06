@echo off
setlocal
cd /d "%~dp0"
title Enable Spotify audio for Regis
where node >nul 2>nul
if errorlevel 1 (echo Node.js is not installed. Install it from nodejs.org, then run this again. & pause & exit /b 1)
echo Close Regis first (right-click its tray icon, Quit). Press any key when it is closed.
pause >nul
node scripts\drm.js on
pause
