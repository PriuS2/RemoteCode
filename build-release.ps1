$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = if (Test-Path ".\.venv\Scripts\python.exe") { ".\.venv\Scripts\python.exe" } else { "python" }

$version = if ($env:BUILD_VERSION) { $env:BUILD_VERSION } else { "dev" }
$machine = (& $python -c "import platform; print(platform.machine().lower())").Trim()
if ($machine -in @("amd64", "x86_64")) {
    $arch = "x64"
} elseif ($machine -eq "arm64") {
    $arch = "arm64"
} else {
    $arch = $machine
}

Write-Host "[1/4] Installing build dependencies..."
& $python -m pip install -r backend\requirements.txt -r requirements-build.txt

Write-Host "[2/4] Building frontend..."
Set-Location frontend
npm ci
npm run build
Set-Location ..

Write-Host "[3/4] Building executable..."
if (Test-Path build) { Remove-Item build -Recurse -Force }
if (Test-Path dist) { Remove-Item dist -Recurse -Force }
& $python -m PyInstaller remote-code.spec --clean --noconfirm

Write-Host "[4/4] Packaging archive..."
New-Item -ItemType Directory -Force -Path release | Out-Null
$archive = "release\remote-code-$version-windows-$arch.zip"
if (Test-Path $archive) { Remove-Item $archive -Force }
Compress-Archive -Path "dist\Remote Code" -DestinationPath $archive

Write-Host ""
Write-Host "Created $archive"
