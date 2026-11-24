@echo off
chcp 65001 >nul
rem ダブルクリック または PowerShell で .\run.cmd と打つと起動します
cd /d "%~dp0web" || goto :err
call npm install || goto :err
call npm run build || goto :err
cd /d "%~dp0server" || goto :err
if "%ADMIN_TOKEN%"=="" set ADMIN_TOKEN=dev-admin
if "%HASH_SECRET%"=="" set HASH_SECRET=dev-secret
echo.
echo ブラウザで http://localhost:8080 を開いてください
echo 管理画面のトークン: %ADMIN_TOKEN%   （止めるときは Ctrl+C）
echo.
go run . -demo
goto :eof
:err
echo.
echo エラーで止まりました。上のメッセージを確認してください。
pause
