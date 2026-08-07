# Builds and publishes FoxLauncher.
# Outputs:
#   artifacts/publish/FoxLauncher.exe  - self-contained single-file launcher (embedded by the installer)
#   artifacts/installer/FoxLauncher.Installer.exe - standalone installer
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -CertificateThumbprint <sha1-thumbprint>
#
# Publish options used here (IncludeAllContentForSelfExtract, no single-file
# compression) produce a cleaner bundle that is less likely to trip Windows
# Defender / SmartScreen heuristics. Real protection comes from code-signing:
# pass -CertificateThumbprint (or set FOXLAUNCHER_CERT_THUMBPRINT) and the
# launcher is signed before the installer embeds it, so the embedded copy is
# signed too.

[CmdletBinding()]
param(
    [string]$CertificateThumbprint = $env:FOXLAUNCHER_CERT_THUMBPRINT
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$publishDir = Join-Path $root "artifacts\publish"
$installerDir = Join-Path $root "artifacts\installer"

. (Join-Path $root "tools\signing.ps1")

function Invoke-SignIfConfigured {
    param([string]$File)
    if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) { return }

    $signtool = Get-SignTool
    if (-not $signtool) {
        throw "signtool.exe not found in the Windows Kits, but -CertificateThumbprint was provided."
    }
    Write-Host "Signing $File ..." -ForegroundColor Cyan
    Invoke-SignFile -Path $File -SignTool $signtool -Thumbprint $CertificateThumbprint
}

Write-Host "Publishing FoxLauncher (self-contained, single-file)..." -ForegroundColor Cyan
dotnet publish (Join-Path $root "src\Launcher.UI\Launcher.UI.csproj") `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true `
    -p:EnableCompressionInSingleFile=false `
    -o $publishDir

$exe = Join-Path $publishDir "FoxLauncher.exe"
if (-not (Test-Path $exe)) {
    throw "Publish did not produce $exe"
}

# Sign the launcher before building the installer so the embedded copy is signed.
Invoke-SignIfConfigured -File $exe

Write-Host "Building installer..." -ForegroundColor Cyan
dotnet publish (Join-Path $root "src\Launcher.Installer\Launcher.Installer.csproj") `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true `
    -p:EnableCompressionInSingleFile=false `
    -o $installerDir

$installer = Join-Path $installerDir "Launcher.Installer.exe"
if (-not (Test-Path $installer)) {
    throw "Publish did not produce $installer"
}

Invoke-SignIfConfigured -File $installer

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host "  Launcher:   $exe"
Write-Host "  Installer:  $installer"
