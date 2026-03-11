# setup.ps1 – Downloads WASM dependencies for the SecureVault browser extension
# Run this ONCE from the extension folder before loading the extension.
# Requires an internet connection.

$ErrorActionPreference = 'Stop'

Write-Host "=== SecureVault Extension Setup ===" -ForegroundColor Cyan

# Create lib/ folder
$libDir = Join-Path $PSScriptRoot "lib"
if (-not (Test-Path $libDir)) { New-Item -ItemType Directory -Path $libDir | Out-Null }

# ── 1. Download argon2-browser (bundled UMD build) ─────────────────────────
Write-Host "`n[1/3] Downloading argon2-browser..." -ForegroundColor Yellow
$argon2Url  = "https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/dist/argon2-bundled.min.js"
$argon2Path = Join-Path $libDir "argon2-bundled.min.js"
Invoke-WebRequest -Uri $argon2Url -OutFile $argon2Path -UseBasicParsing
Write-Host "      Saved to lib/argon2-bundled.min.js" -ForegroundColor Green

# ── 2. Download libsodium.js (sodium-wasm UMD bundle) ─────────────────────
Write-Host "`n[2/3] Downloading libsodium-wrappers..." -ForegroundColor Yellow
$sodiumUrl  = "https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.13/dist/modules/libsodium-wrappers.js"
$sodiumPath = Join-Path $libDir "sodium.js"
Invoke-WebRequest -Uri $sodiumUrl -OutFile $sodiumPath -UseBasicParsing
Write-Host "      Saved to lib/sodium.js" -ForegroundColor Green

# ── 3. Create placeholder icons ──────────────────────────────────────────────
Write-Host "`n[3/3] Creating placeholder icons (replace with real PNG if you want)..." -ForegroundColor Yellow
$iconDir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }

# Minimal 1x1 blue PNG (base64) used as placeholder
$pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
$pngBytes  = [Convert]::FromBase64String($pngBase64)

foreach ($size in @(16, 48, 128)) {
    $p = Join-Path $iconDir "icon${size}.png"
    [IO.File]::WriteAllBytes($p, $pngBytes)
}
Write-Host "      Icons written to icons/" -ForegroundColor Green

Write-Host "`n=== Setup complete! ===" -ForegroundColor Cyan
Write-Host @"

NEXT STEPS
----------
1. Open Chrome / Edge and go to:   chrome://extensions   (or  edge://extensions)
2. Enable  'Developer mode'  (toggle, top-right)
3. Click  'Load unpacked'
4. Select this folder:  $PSScriptRoot
5. The SecureVault icon will appear in the toolbar.

Make sure your backend server is running at http://127.0.0.1:8000 before logging in.
"@ -ForegroundColor White
