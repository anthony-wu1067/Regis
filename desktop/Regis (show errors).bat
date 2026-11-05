@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Regis (error view)
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo  Regis is not set up yet. Double-click "Setup Regis.bat" first.
  pause
  exit /b 1
)
echo  Starting Regis. If something goes wrong, the message will stay here.
echo  Leave this window open while Regis is running.
echo.
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0." 
echo.
echo  Regis exited with code %ERRORLEVEL%.
pause
