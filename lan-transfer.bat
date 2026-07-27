@echo off
title LAN File Transfer

echo.
echo ==================================================
echo   LAN File Transfer Service
echo ==================================================
echo.

rem Always run from the directory where this script lives
cd /d "%~dp0"

if not exist "server.js" (
    echo [Error] Cannot find server.js in "%~dp0"
    echo         The project files may have been moved or deleted.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [Error] Node.js not found in PATH.
    echo         Please install Node.js first: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [Info] Dependencies missing, running npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [Error] npm install failed. Check your network and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo Starting service...
echo.

node server.js

echo.
echo ==================================================
echo   Service Stopped
echo ==================================================
echo.
pause
