@echo off
REM ============================================================
REM  AXIS-5 Robot Control - one-click builder for Windows
REM  Requires Node.js LTS: https://nodejs.org
REM ============================================================
cd /d "%~dp0"
echo.
echo [1/3] Installing dependencies (first run downloads ~110 MB)...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/3] Building Windows installers...
call npm run dist:win
if errorlevel 1 goto :fail

echo.
echo [3/3] Done! Look in the "dist" folder:
echo    - AXIS5-Robot-Control-Setup-1.0.0.exe        (installer)
echo    - AXIS5-Robot-Control-Portable-1.0.0.exe     (no install needed)
echo.
pause
exit /b 0

:fail
echo.
echo BUILD FAILED - is Node.js LTS installed? Check https://nodejs.org
pause
exit /b 1
