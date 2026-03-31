param(
    [ValidateSet("web", "chromium", "all")]
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = if (Test-Path ".\.venv\Scripts\python.exe") { ".\.venv\Scripts\python.exe" } else { "python" }

$version = if ($env:BUILD_VERSION) { $env:BUILD_VERSION } else { "dev" }
$appVersion = (& "node" ".\desktop\generate-update-manifest.cjs" --print-version --build-version $version).Trim()
$publishedAt = if ($env:BUILD_PUBLISHED_AT) { $env:BUILD_PUBLISHED_AT } else { (Get-Date).ToUniversalTime().ToString("o") }
$minimumSupportedVersion = if ($env:MINIMUM_SUPPORTED_VERSION) {
    (& "node" ".\desktop\generate-update-manifest.cjs" --print-version --build-version $env:MINIMUM_SUPPORTED_VERSION).Trim()
} else {
    $appVersion
}
$machine = (& $python -c "import platform; print(platform.machine().lower())").Trim()
if ($machine -in @("amd64", "x86_64")) {
    $arch = "x64"
} elseif ($machine -eq "arm64") {
    $arch = "arm64"
} else {
    $arch = $machine
}

function Remove-IfExists([string]$PathValue) {
    if (Test-Path $PathValue) {
        Remove-Item $PathValue -Recurse -Force
    }
}

Write-Host "[1/5] Installing build dependencies..."
& $python -m pip install -r backend\requirements.txt -r requirements-build.txt
& "npm.cmd" ci

Write-Host "[2/5] Building frontend..."
Set-Location frontend
npm ci
npm run build
Set-Location ..

New-Item -ItemType Directory -Force -Path release | Out-Null

if ($Target -in @("web", "all")) {
    Write-Host "[3/5] Building web package..."
    Remove-IfExists "build"
    Remove-IfExists "dist"
    & $python -m PyInstaller remote-code.spec --clean --noconfirm

    $archive = "release\remote-code-$version-windows-$arch.zip"
    if (Test-Path $archive) { Remove-Item $archive -Force }
    Compress-Archive -Path "dist\Remote Code" -DestinationPath $archive
    Write-Host "Created $archive"
}

if ($Target -in @("chromium", "all")) {
    Write-Host "[4/5] Building chromium backend server..."
    Remove-IfExists "build"
    Remove-IfExists "dist"
    Remove-IfExists "desktop-build-resources"
    Remove-IfExists "desktop-dist"

    & $python -m PyInstaller remote-code-server.spec --clean --noconfirm

    New-Item -ItemType Directory -Force -Path "desktop-build-resources\backend" | Out-Null
    Copy-Item "dist\remote-code-server.exe" "desktop-build-resources\backend\remote-code-server.exe" -Force

    $chromiumArchiveName = "remote-code-chromium-$version-windows-$arch.zip"
    & "node" ".\desktop\generate-update-manifest.cjs" `
        --output "desktop-build-resources\update-manifest.json" `
        --release-output "release\update-manifest-windows-$arch.json" `
        --platform "windows" `
        --arch $arch `
        --asset-name $chromiumArchiveName `
        --tag $version `
        --current-version $appVersion `
        --minimum-supported-version $minimumSupportedVersion `
        --published-at $publishedAt

    Write-Host "[5/5] Packaging chromium desktop app..."
    & "npm.cmd" run desktop:package:win -- --config.extraMetadata.version=$appVersion

    $stageRoot = "release\Remote Code Desktop"
    Remove-IfExists $stageRoot
    New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
    Copy-Item "desktop-dist\win-unpacked\*" $stageRoot -Recurse -Force

    $archive = "release\$chromiumArchiveName"
    if (Test-Path $archive) { Remove-Item $archive -Force }
    Compress-Archive -Path $stageRoot -DestinationPath $archive
    Remove-IfExists $stageRoot
    Write-Host "Created $archive"
}
