@echo off
title LAN File Transfer

echo.
echo ==================================================
echo   LAN File Transfer Service
echo ==================================================
echo.

cd /d "D:\lan-file-transfer"

if not exist "server.js" (
    echo [Error] Cannot find server.js!
    echo.
    pause
    exit /b 1
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
