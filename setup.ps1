# Claude Code Remote - Setup Script

#Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Claude Code Remote - Setup" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path ".\.venv\Scripts\python.exe") {
    Write-Host "[OK] Python venv already exists" -ForegroundColor Green
} else {
    Write-Host "[1/3] Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv ".\.venv"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to create venv. Is Python installed?" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] venv created" -ForegroundColor Green
}

& ".\.venv\Scripts\Activate.ps1"
Write-Host "[OK] venv activated" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] Installing backend dependencies..." -ForegroundColor Yellow
pip install -r ".\backend\requirements.txt"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] pip install failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Backend dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "[3/3] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location ".\frontend"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed. Is Node.js installed?" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"
Write-Host "[OK] Frontend dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Dev mode:  start-dev.bat" -ForegroundColor White
Write-Host "  Prod mode: start.bat" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
