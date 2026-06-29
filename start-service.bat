@echo off
chcp 65001 >nul
echo.
echo ==================================================
echo   启动服务
echo ==================================================
echo.

cd /d "%~dp0"

node service.js start

echo.
pause
