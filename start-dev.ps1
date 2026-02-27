# Claude Code Remote - Development Start Script

#Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"

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
Write-Host "Starting Claude Code Remote (DEV MODE)" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:$($env:CCR_PORT)" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:$(if ($env:CCR_VITE_PORT) { $env:CCR_VITE_PORT } else { '5173' })" -ForegroundColor Green
Write-Host ""

$backend = Start-Process -NoNewWindow -PassThru -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", $env:CCR_PORT, "--reload"

Set-Location ".\frontend"
npm run dev

if ($backend -and -not $backend.HasExited) {
    Stop-Process -Id $backend.Id -Force
    Write-Host "Backend stopped." -ForegroundColor Yellow
}
