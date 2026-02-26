# Claude Code Remote - Cloudflare Quick Tunnel

Set-Location "C:\Users\STOICPC_QQQ\Documents\ClaudeCodeRemote"

# Install cloudflared if not found
if (-not (Get-Command "cloudflared" -ErrorAction SilentlyContinue)) {
    Write-Host "[!] cloudflared not found. Installing..." -ForegroundColor Yellow
    winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Installation failed." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    # Refresh PATH for current session
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
    Write-Host "[OK] cloudflared installed" -ForegroundColor Green
}

# Load .env to read port
$port = "8080"
if (Test-Path ".\.env") {
    Get-Content ".\.env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split("=", 2)
            if ($parts.Length -eq 2 -and $parts[0].Trim() -eq "CCR_PORT") {
                $port = $parts[1].Trim()
            }
        }
    }
}

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Cloudflare Quick Tunnel" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Local:  http://localhost:$port" -ForegroundColor Green
Write-Host "  Tunnel: Starting..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  (Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host ""

cloudflared tunnel --url "http://localhost:$port"
