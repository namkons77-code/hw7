@echo off
chcp 65001 >nul
echo ==============================================
echo [React Vite] 프론트엔드 개발 서버를 시작합니다...
echo ==============================================
cd /d "%~dp0frontend"
npm.cmd run dev
pause
