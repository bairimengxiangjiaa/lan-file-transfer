@echo off
chcp 65001 >nul
echo.
echo ==================================================
echo   安装 Windows 服务
echo ==================================================
echo.

cd /d "%~dp0"

echo 正在以管理员权限安装服务...
echo.

node service.js install

echo.
echo ==================================================
echo   安装完成！
echo ==================================================
echo.
echo 启动服务请运行: start-service.bat
echo 卸载服务请运行: uninstall-service.bat
echo.
pause
