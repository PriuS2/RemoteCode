# Remote Code - Cloudflare Named Tunnel

Set-Location $PSScriptRoot

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

# Load .env
$backendPort = "8080"
$vitePort = "5173"
$domain = "example.com"
if (Test-Path ".\.env") {
    Get-Content ".\.env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split("=", 2)
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $val = $parts[1].Trim()
                switch ($key) {
                    "CCR_PORT"      { $backendPort = $val }
                    "CCR_VITE_PORT" { $vitePort = $val }
                    "CCR_DOMAIN"    { $domain = $val }
                }
            }
        }
    }
}

# Generate config.yml
$tunnelId = "7592bba9-abe6-4da3-ac60-d37e918f25b4"
$credFile = "$env:USERPROFILE\.cloudflared\$tunnelId.json"
$configPath = "$env:USERPROFILE\.cloudflared\config.yml"

@"
tunnel: $tunnelId
credentials-file: $credFile

ingress:
  - hostname: $domain
    service: http://localhost:$vitePort
  - service: http_status:404
"@ | Set-Content $configPath -Encoding UTF8

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Cloudflare Named Tunnel" -ForegroundColor Cyan
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Local:  http://localhost:$vitePort -> :$backendPort (proxy)" -ForegroundColor Green
Write-Host "  Public: https://$domain" -ForegroundColor Green
Write-Host ""
Write-Host "  (Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host ""

cloudflared tunnel run ccr-tunnel
