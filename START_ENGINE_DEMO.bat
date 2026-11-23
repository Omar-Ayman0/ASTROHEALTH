@echo off
REM Starts the engine in TEMPORARY DEMO MODE (synthetic, clearly labelled events). Not tested on Windows.
REM Normal start without synthetic events: use START_ASTROHEALTH.bat as before (demo mode is off there).
cd /d "%~dp0"
set HEALTH_DEMO_MODE=1
set HEALTH_DEMO_SCENARIO=medium_then_high
set HEALTH_SIM_AUTOSTART=1
if exist ".venv\Scripts\python.exe" (set PY=.venv\Scripts\python.exe) else (set PY=python)
"%PY%" -m uvicorn api_server:app --host 127.0.0.1 --port 8000
