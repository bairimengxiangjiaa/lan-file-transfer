@echo off
chcp 65001 >nul
echo.
echo ==================================================
echo   卸载 Windows 服务
echo ==================================================
echo.

cd /d "%~dp0"

node service.js uninstall

echo.
pause
