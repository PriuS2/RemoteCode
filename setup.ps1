# Remote Code - Setup Script

#Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Remote Code - Setup" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""

# 1. Create default .env if not exists
if (Test-Path ".\.env") {
    Write-Host "[OK] .env already exists" -ForegroundColor Green
} else {
    Write-Host "[1/4] Creating default .env..." -ForegroundColor Yellow
    @"
CCR_HOST=0.0.0.0
CCR_PORT=8080
CCR_CLAUDE_COMMAND=claude
CCR_PASSWORD=changeme
CCR_JWT_SECRET=change-this-secret-key
CCR_JWT_EXPIRE_HOURS=72
CCR_DB_PATH=sessions.db
# CCR_ALLOWED_ORIGINS=https://ccr.yourdomain.com,http://localhost:8080

# Cloudflare Tunnel (Named Tunnel)
# CCR_VITE_PORT=5173
# CCR_DOMAIN=example.com

# ============================================================
# Claude Code Provider
# ============================================================

# --- Option 1: AWS Bedrock ---
# CLAUDE_CODE_USE_BEDROCK=1
# AWS_REGION=us-west-2
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
# ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0

# --- Option 2: Anthropic API (Direct) ---
# ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx
# ANTHROPIC_MODEL=claude-sonnet-4-20250514

# --- Option 3: LM Studio / OpenAI-compatible API ---
# ANTHROPIC_BASE_URL=http://localhost:1234/v1
# ANTHROPIC_API_KEY=lm-studio
# ANTHROPIC_MODEL=your-model-name

# --- Option 4: OpenRouter ---
# ANTHROPIC_API_KEY=""
# ANTHROPIC_BASE_URL=https://openrouter.ai/api
# OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx
# ANTHROPIC_AUTH_TOKEN=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx
# ANTHROPIC_MODEL=moonshotai/kimi-k2.5
"@ | Set-Content ".\.env" -Encoding UTF8
    Write-Host "[OK] .env created with defaults" -ForegroundColor Yellow
}

# 2. Python venv
if (Test-Path ".\.venv\Scripts\python.exe") {
    Write-Host "[OK] Python venv already exists" -ForegroundColor Green
} else {
    Write-Host "[2/4] Creating Python virtual environment..." -ForegroundColor Yellow
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

# 3. Backend dependencies
Write-Host ""
Write-Host "[3/4] Installing backend dependencies..." -ForegroundColor Yellow
pip install -r ".\backend\requirements.txt"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] pip install failed" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Backend dependencies installed" -ForegroundColor Green

# 4. Frontend dependencies
Write-Host ""
Write-Host "[4/4] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location ".\frontend"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed. Is Node.js installed?" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
#Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"
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
