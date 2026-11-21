# Start the existing Engine with its built-in demonstration telemetry scenarios.
# This does not alter the Backend API contract or event JSON structure.
$ErrorActionPreference = 'Stop'

$env:HEALTH_ASTRONAUT_COUNT = '6'
$env:HEALTH_SIM_AUTOSTART = '1'
$env:HEALTH_SIM_INTERVAL = '0.2'

Write-Host 'Starting ASTROHEALTH demo with six astronaut profiles...'
Write-Host 'Telemetry scenarios are simulated and must be presented as demo data.'
Write-Host 'Existing API routes, event envelope, IDs, sequence, and persistence remain unchanged.'

python -m uvicorn api_server:app --host 0.0.0.0 --port 8000
