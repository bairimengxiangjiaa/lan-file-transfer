@echo off
title LAN File Transfer
echo.
echo ==================================================
echo   LAN File Transfer Service
echo ==================================================
echo.

:: 优先使用脚本所在目录（同目录下有 server.js 时直接用）
if exist "%~dp0server.js" (
    cd /d "%~dp0"
    goto :start
)

:: 搜索常见位置的 server.js
set "SCRIPT_PATH="
if exist "D:\lan-file-transfer\server.js" set "SCRIPT_PATH=D:\lan-file-transfer"
if exist "C:\lan-file-transfer\server.js" set "SCRIPT_PATH=C:\lan-file-transfer"
if exist "%USERPROFILE%\lan-file-transfer\server.js" set "SCRIPT_PATH=%USERPROFILE%\lan-file-transfer"
if exist "%USERPROFILE%\Desktop\lan-file-transfer\server.js" set "SCRIPT_PATH=%USERPROFILE%\Desktop\lan-file-transfer"

if defined SCRIPT_PATH (
    cd /d "%SCRIPT_PATH%"
    goto :start
)

:: 都没找到，报错
echo [错误] 找不到 server.js 文件！
echo.
echo 请确认局域网文件传输项目的位置，
echo 或者直接在项目目录下双击 start.bat。
echo.
pause
exit /b 1

:start
echo Starting service...
echo.

node server.js

echo.
echo ==================================================
echo   Service Stopped
echo ==================================================
echo.
pause
