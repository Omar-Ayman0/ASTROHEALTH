# Windows + PowerShell setup (engine, tests, API, Node)

Engine `hybrid-v2.1`, JSON contract `schema_version 1.0` (unchanged). Research prototype, synthetic data, not a medical device.

## 0. Which Python? (read this first)

| Python | Status |
|---|---|
| **3.13** | **Tested** (3.13.18, Linux) with `requirements-tested-py313.txt`: all Python tests + Node tests passed. Recommended. |
| 3.12 (you have 3.12.11) | **Not run by me** (no 3.12 environment with these packages was available). The pinned numpy 2.5.3 and scipy 1.18.1 declare `Requires-Python >= 3.12`, pandas 3.0.5 / scikit-learn 1.9.1 / matplotlib 3.11.2 declare `>= 3.11`, so 3.12 is inside what the packages allow. The engine has no version-specific code. **The proof on your machine is step 4 below: if all tests pass there, 3.12 is supported for you.** |
| 3.14 | Not run by me. `requirements.txt` holds the pins from the team's own 3.14 venv. |
| 3.11 or older | Not supported (numpy 2.5 and scipy 1.18 need 3.12+). |

Which requirements file:
* `requirements-tested-py313.txt`: engine, tests, Node tests. **Use this one** (python 3.12 or 3.13).
* `requirements.txt`: the team's 3.14 pins, includes FastAPI. Use it on 3.14 only.
* FastAPI is **not** in the tested file (it could not be installed where the tests ran). To run `api_server.py` add it: `pip install fastapi==0.162.4` (version taken from `requirements.txt`; the combination with the other pins was **not** tested by me).
* No library version was changed.

## 1. Virtual environment (separate from your backend)

```powershell
cd C:\path\to\astrohealth-engine-backend
py -3.13 -m venv .venv          # or: py -3.12 -m venv .venv   (or: python -m venv .venv)
.\.venv\Scripts\Activate.ps1    # if blocked: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
python --version
python -m pip install --upgrade pip
pip install -r requirements-tested-py313.txt
pip install fastapi==0.162.4    # only needed for api_server.py
```

Run every command from the package root (the folder that contains `engine\`, `tests\`, `integration\`): the scripts use relative paths.

## 2. Python tests

```powershell
python tests\test_engine.py     # 28 tests, about 2-3 min
python tests\test_live.py       # 20 tests, about 4-5 min
# or the same with pytest:  python -m pytest -q
```

## 3. Node tests (no FastAPI needed)

```powershell
node --version                  # must be >= 22.13
cd integration\node
$env:PYTHON = (Get-Command python).Source     # optional: pin the interpreter (the venv python)
npm test                        # 7 tests, about 2 min; starts the Python test server itself
```
`npm test` looks for `python3`, `python`, then `py -3` (Windows-aware) and needs Python >= 3.12. If it says
"No usable Python", set `$env:PYTHON` to the full path of the venv's `python.exe`.
If `integration\node` was copied out of the package, set `$env:ENGINE_SHIM` to the full path of `tests\stdlib_shim_server.py`.

## 4. Real FastAPI server (the check that I could not run)

Terminal 1:
```powershell
$env:HEALTH_ASTRONAUT_COUNT = "6"
python -m uvicorn api_server:app --host 127.0.0.1 --port 8000
```
Terminal 2:
```powershell
curl.exe http://127.0.0.1:8000/health
start http://127.0.0.1:8000/docs
python tests\smoke_api.py http://127.0.0.1:8000 --astronauts 6 --stateless --docs   # exit code 0 = all passed
cd integration\node
$env:ENGINE_URL = "http://127.0.0.1:8000"; npm test    # fresh engine only; skips the restart / engine-down steps
Remove-Item Env:ENGINE_URL
```
The smoke test moves the simulation (resets ASTRO_01/02), so run it on a freshly started engine.

## 5. One command for all of it

`scripts\windows_verify.ps1` runs steps 1-4 and prints a summary (**written without a Windows machine: if it fails, run the steps above by hand and tell me where**).
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows_verify.ps1 -Python py -PythonArgs "-3.13"
```

## 6. Environment variables

| Variable | Meaning |
|---|---|
| `HEALTH_ASTRONAUT_COUNT` | 1-7, default 4. Use 6 for the six-astronaut setup |
| `HEALTH_SIM_AUTOSTART=1`, `HEALTH_SIM_INTERVAL=1.0` | start the built-in simulator at boot |
| `HEALTH_PUSH_URL` | optional best-effort push; pull cursors are the reliable path |
| `PYTHON`, `ENGINE_SHIM`, `ENGINE_URL`, `SHIM_PORT` | Node test settings (section 3, 4; `SHIM_PORT` default 8791) |
