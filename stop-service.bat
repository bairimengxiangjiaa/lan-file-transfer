@echo off
chcp 65001 >nul
echo.
echo ==================================================
echo   停止服务
echo ==================================================
echo.

cd /d "%~dp0"

node service.js stop

echo.
pause
