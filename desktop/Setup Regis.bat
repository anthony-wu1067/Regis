@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Setting up Regis
set "LOG=%~dp0setup-log.txt"
echo Regis setup %DATE% %TIME% > "%LOG%"
echo.
echo  Setting up Regis (one time only)...
echo.

rem --- running from inside a zip preview? ---
echo "%~dp0" | findstr /i /c:"AppData\Local\Temp" /c:".zip" >nul
if not errorlevel 1 goto :inzip

if not exist "%~dp0package.json" goto :nofiles

where node >nul 2>nul
if errorlevel 1 goto :nonode
for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo Node %NODEV% >> "%LOG%"
echo  Using Node %NODEV%

rem --- keep the Spotify audio engine (castlabs build) if it is already installed: a plain install would replace it ---
findstr /c:"wvcus" "%~dp0node_modules\electron\package.json" >nul 2>nul
if not errorlevel 1 (
  echo  Spotify audio engine found, keeping it.
  echo Kept castlabs Electron >> "%LOG%"
  goto :installed
)
echo  Installing (this takes a minute or two)...
call npm install --no-audit --no-fund
if errorlevel 1 goto :npmfail
:installed

rem --- Electron downloads its program in a post-install step; retry if that was skipped ---
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo  Finishing the Electron download...
  node "%~dp0node_modules\electron\install.js"
)
if not exist "%~dp0node_modules\electron\dist\electron.exe" goto :noelectron

node "%~dp0scripts\make-index.js"
if errorlevel 1 goto :indexfail

echo  Building the Regis app (Regis.exe) and its shortcuts...
tasklist /FI "IMAGENAME eq Regis.exe" | find /i "Regis.exe" >nul
if not errorlevel 1 (
  echo  Regis is open. Quit it first: right-click its icon by the clock, Quit Regis. Then press any key.
  pause >nul
)
node "%~dp0scripts\build-app.js" --install --no-sign
if not errorlevel 1 goto :appdone
echo  Could not build Regis.exe. Making a simple shortcut instead...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\make-shortcut.ps1"
if errorlevel 1 (
  echo  PowerShell could not make the shortcut. Trying another way...
  cscript //nologo "%~dp0scripts\make-shortcut.vbs"
  if errorlevel 1 goto :noshortcut
)
:appdone
echo.
echo  Done. A "Regis" shortcut is now on your Desktop and in the Start menu.
echo  Double-click it any time. You never need Node.js or a terminal again.
echo.
echo  If the shortcut ever shows an error, double-click "Regis (show errors).bat" and read the message.
echo.
echo Setup finished OK >> "%LOG%"
if exist "%LOCALAPPDATA%\Programs\Regis\Regis.exe" (start "" "%LOCALAPPDATA%\Programs\Regis\Regis.exe") else (start "" "%~dp0Regis.vbs")
findstr /c:"wvcus" "%~dp0node_modules\electron\package.json" >nul 2>nul
if not errorlevel 1 echo  For Spotify playback inside Regis, also double-click "Enable Spotify audio" once.
pause
exit /b 0

:inzip
echo  Regis is still inside the zip file.
echo  Right-click the zip, choose "Extract All...", then open the NEW folder and run this file again.
echo In zip >> "%LOG%"
pause
exit /b 1

:nofiles
echo  This file has to stay in the Regis folder, next to package.json.
echo  Extract the whole zip and run it from there.
pause
exit /b 1

:nonode
echo  Node.js is not installed. Opening the download page.
echo  Install the LTS version, restart your computer if asked, then run this file again.
echo No node >> "%LOG%"
start "" https://nodejs.org
pause
exit /b 1

:npmfail
echo.
echo  The install step failed. Check your internet connection and try again.
echo  If it fails again, take a screenshot of this window and send it to me.
echo npm install failed >> "%LOG%"
pause
exit /b 1

:noelectron
echo.
echo  The Electron download did not finish (a firewall, VPN or antivirus can block it).
echo  Turn those off for a minute, delete the "node_modules" folder, and run this file again.
echo electron.exe missing >> "%LOG%"
pause
exit /b 1

:indexfail
echo.
echo  Could not prepare the page. Take a screenshot of this window and send it to me.
echo make-index failed >> "%LOG%"
pause
exit /b 1

:noshortcut
echo.
echo  Could not create the shortcut automatically.
echo  You can still open Regis: double-click "Regis.vbs".
echo  To put it on your Desktop, right-click Regis.vbs, choose Show more options, Send to, Desktop (create shortcut).
echo shortcut failed >> "%LOG%"
pause
exit /b 1
