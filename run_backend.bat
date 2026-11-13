@echo off
chcp 65001 >nul
echo ==============================================
echo [FastAPI] 식품안심업소 백엔드 서버를 시작합니다...
echo ==============================================
cd /d "%~dp0backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
