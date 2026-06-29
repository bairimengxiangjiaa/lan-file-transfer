@echo off
chcp 65001 >nul
echo.
echo ==================================================
echo   局域网文件传输服务启动脚本
echo ==================================================
echo.

cd /d "%~dp0"

echo 正在检查依赖...
if not exist "node_modules" (
    echo 正在安装依赖...
    npm install
    echo.
)

echo 正在启动服务...
echo.
node server.js

pause