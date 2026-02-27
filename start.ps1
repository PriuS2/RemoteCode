# Claude Code Remote - Production Start Script

Set-Location $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[ERROR] venv not found. Run setup.bat first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
& ".\.venv\Scripts\Activate.ps1"

# Create default .env if not exists
if (-not (Test-Path ".\.env")) {
    @"
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_PASSWORD=changeme
CCR_JWT_SECRET=change-this-secret-key
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
# CCR_ALLOWED_ORIGINS=https://ccr.yourdomain.com,http://localhost:8080
"@ | Set-Content ".\.env" -Encoding UTF8
    Write-Host "[OK] .env created with defaults" -ForegroundColor Yellow
}

# Load .env
Get-Content ".\.env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line.Split("=", 2)
        if ($parts.Length -eq 2) {
            [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
        }
    }
}
Write-Host "[OK] .env loaded" -ForegroundColor Green

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Claude Code Remote" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL: http://localhost:$($env:CCR_PORT)" -ForegroundColor Green
Write-Host ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port $env:CCR_PORT
