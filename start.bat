@echo off
title LAN File Transfer

echo.
echo ==================================================
echo   LAN File Transfer - Start Script
echo ==================================================
echo.

cd /d "%~dp0"

echo Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting service...
echo.
node server.js

pause
