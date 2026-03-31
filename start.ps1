param(
    [ValidateSet("web", "chromium")]
    [string]$Runtime = "web"
)

Set-Location $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[ERROR] venv not found. Run setup.ps1 first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path ".\.env")) {
    Write-Host "[ERROR] .env not found. Run setup.ps1 first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

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

if ($Runtime -eq "chromium") {
    if (-not (Test-Path ".\node_modules")) {
        Write-Host "[ERROR] root node_modules not found. Run setup.ps1 first." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host ""
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host "  Remote Code Desktop" -ForegroundColor Cyan
    Write-Host "===============================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Runtime: Desktop shell" -ForegroundColor Green
    Write-Host ""

    & "npm.cmd" run desktop:start
    exit $LASTEXITCODE
}

& ".\.venv\Scripts\Activate.ps1"

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Remote Code" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL: http://localhost:$($env:CCR_PORT)" -ForegroundColor Green
Write-Host ""

python -m uvicorn backend.main:app --host 0.0.0.0 --port $env:CCR_PORT
