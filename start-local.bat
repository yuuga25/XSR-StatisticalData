@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo Xross Stats Dashboard: http://localhost:8080
echo 終了するときはこの画面で Ctrl+C を押してください。
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8080
) else (
  python -m http.server 8080
)
pause
