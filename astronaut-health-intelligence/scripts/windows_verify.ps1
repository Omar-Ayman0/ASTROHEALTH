# Runs the whole verification on Windows. NOT executed on Windows by the author: if a step fails, run it by hand (WINDOWS_SETUP.md).
param([string]$Python = "python", [string[]]$PythonArgs = @())
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$results = @()
function Step($name, [scriptblock]$body) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & $body
  $script:results += [pscustomobject]@{ Step = $name; ExitCode = $LASTEXITCODE }
}
if (-not (Test-Path ".venv")) { & $Python @PythonArgs -m venv .venv }
$py = Join-Path $root ".venv\Scripts\python.exe"
Step "python version"      { & $py --version }
Step "pip install tested"  { & $py -m pip install -r requirements-tested-py313.txt }
Step "pip install fastapi" { & $py -m pip install fastapi==0.162.4 }
Step "engine tests"        { & $py tests\test_engine.py }
Step "live tests"          { & $py tests\test_live.py }
$env:PYTHON = $py
Step "node tests"          { Push-Location integration\node; npm test; $c = $LASTEXITCODE; Pop-Location; $global:LASTEXITCODE = $c }
$env:HEALTH_ASTRONAUT_COUNT = "6"
$srv = Start-Process -FilePath $py -ArgumentList "-m","uvicorn","api_server:app","--host","127.0.0.1","--port","8000" -PassThru -NoNewWindow
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) {
    Start-Sleep -Seconds 2
    try { $up = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health).StatusCode -eq 200 } catch {}
  }
  Step "fastapi /health up"  { if ($up) { $global:LASTEXITCODE = 0 } else { $global:LASTEXITCODE = 1 } }
  if ($up) {
    Step "smoke test + /docs" { & $py tests\smoke_api.py http://127.0.0.1:8000 --astronauts 6 --stateless --docs }
    Step "node tests vs real FastAPI" {
      $env:ENGINE_URL = "http://127.0.0.1:8000"; Push-Location integration\node; npm test; $c = $LASTEXITCODE; Pop-Location
      Remove-Item Env:ENGINE_URL; $global:LASTEXITCODE = $c }
  }
} finally { if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force } }
Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
if ($results | Where-Object { $_.ExitCode -ne 0 }) { Write-Host "SOME STEPS FAILED" -ForegroundColor Red; exit 1 } else { Write-Host "ALL STEPS PASSED" -ForegroundColor Green }
