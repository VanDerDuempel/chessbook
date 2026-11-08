@echo off
rem Startet Chessbook und oeffnet den Browser. Laeuft es schon, wird nur der Browser geoeffnet.
rem Fenster offen lassen, solange du arbeitest. Schliessen beendet den Server.
cd /d "%~dp0"
title Chessbook
if not defined PORT set PORT=3000
node scripts\open.mjs %PORT% --check && exit /b 0
if not exist node_modules (call npm install || goto :fehler)
start "" /b node scripts\open.mjs %PORT%
call npm start
echo.
echo Server beendet.
pause
exit /b 0
:fehler
echo.
echo Installation fehlgeschlagen.
pause
exit /b 1
