$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dbPath = Join-Path $root "playwright-e2e.db"
if (Test-Path $dbPath) {
  Remove-Item $dbPath -Force
}

$env:CCR_PASSWORD = "test-password"
$env:CCR_JWT_SECRET = "test-secret"
$env:CCR_DB_PATH = $dbPath
$env:CCR_PORT = "18180"
$env:PYTHONUNBUFFERED = "1"

npm --prefix frontend run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 18180
