@echo off
rem Holt den neuesten Stand von GitHub. Ueberschreibt alle Projektdateien,
rem laesst aber den Ordner data\ (Datenbank, Config, Backups) unangetastet.
cd /d "%~dp0"
git fetch origin || goto :fehler
git reset --hard origin/main || goto :fehler
call npm install || goto :fehler
echo.
echo Update fertig. Starten mit: npm start
pause
exit /b 0
:fehler
echo.
echo Update fehlgeschlagen.
pause
exit /b 1
