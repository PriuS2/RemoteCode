# Claude Code Remote - Production Start Script

Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[ERROR] venv not found. Run setup.bat first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
& ".\.venv\Scripts\Activate.ps1"

# Load .env
if (Test-Path ".\.env") {
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
} else {
    Write-Host "[WARN] .env not found, using defaults" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Claude Code Remote" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL: http://localhost:$($env:CCR_PORT)" -ForegroundColor Green
Write-Host ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port $env:CCR_PORT
