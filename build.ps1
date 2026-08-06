# Builds and publishes FoxLauncher.
# Outputs:
#   artifacts/publish/FoxLauncher.exe  - self-contained single-file launcher (embedded by the installer)
#   artifacts/installer/FoxLauncher.Installer.exe - standalone installer
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$publishDir = Join-Path $root "artifacts\publish"
$installerDir = Join-Path $root "artifacts\installer"

Write-Host "Publishing FoxLauncher (self-contained, single-file)..." -ForegroundColor Cyan
dotnet publish (Join-Path $root "src\Launcher.UI\Launcher.UI.csproj") `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $publishDir

$exe = Join-Path $publishDir "FoxLauncher.exe"
if (-not (Test-Path $exe)) {
    throw "Publish did not produce $exe"
}

Write-Host "Building installer..." -ForegroundColor Cyan
dotnet publish (Join-Path $root "src\Launcher.Installer\Launcher.Installer.csproj") `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $installerDir

$installer = Join-Path $installerDir "Launcher.Installer.exe"
if (-not (Test-Path $installer)) {
    throw "Publish did not produce $installer"
}

Write-Host ""
Write-Host "Build complete:" -ForegroundColor Green
Write-Host "  Launcher:   $exe"
Write-Host "  Installer:  $installer"
