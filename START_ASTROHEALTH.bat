@echo off
title ASTROHEALTH SYSTEM LAUNCHER

set "ROOT=%~dp0"

echo ======================================
echo       ASTROHEALTH SYSTEM
echo ======================================

echo Starting Health Intelligence Engine...
start "ASTROHEALTH - Intelligence Engine" cmd /k "cd /d ""%ROOT%astronaut-health-intelligence"" && set HEALTH_SIM_AUTOSTART=1 && ""%ROOT%astronaut-health-intelligence\.venv\Scripts\python.exe"" -m uvicorn api_server:app --host 127.0.0.1 --port 8000"

timeout /t 3 /nobreak >nul

echo Starting Backend...
start "ASTROHEALTH - Backend" cmd /k "cd /d ""%ROOT%backend"" && node server.js"

timeout /t 3 /nobreak >nul

echo Starting Frontend...
start "ASTROHEALTH - Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm.cmd run dev"

timeout /t 5 /nobreak >nul

echo Opening ASTROHEALTH...
start http://localhost:5173/

echo.
echo ASTROHEALTH LAUNCH COMMANDS COMPLETED.
echo Keep all service windows open.
pause
