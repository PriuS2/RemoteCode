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
    if (-not (Test-Path ".\frontend\node_modules")) {
        Write-Host "[ERROR] frontend node_modules not found. Run setup.ps1 first." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }

    $vitePort = if ($env:CCR_VITE_PORT) { $env:CCR_VITE_PORT } else { "5173" }
    Write-Host ""
    Write-Host "Starting Remote Code (DEV MODE - Desktop)" -ForegroundColor Cyan
    Write-Host "  Backend:  http://localhost:$($env:CCR_PORT)" -ForegroundColor Green
    Write-Host "  Frontend: http://127.0.0.1:$vitePort" -ForegroundColor Green
    Write-Host ""

    $vite = Start-Process -PassThru -NoNewWindow -WorkingDirectory "$PSScriptRoot\frontend" -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "--host", "127.0.0.1"
    $env:REMOTE_CODE_DEV_SERVER_URL = "http://127.0.0.1:$vitePort"

    try {
        & "npm.cmd" run desktop:start
        exit $LASTEXITCODE
    } finally {
        if ($vite -and -not $vite.HasExited) {
            taskkill /PID $vite.Id /T /F | Out-Null
        }
    }
}

& ".\.venv\Scripts\Activate.ps1"

Write-Host ""
Write-Host "Starting Remote Code (DEV MODE)" -ForegroundColor Cyan
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
