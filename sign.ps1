# Signs the built FoxLauncher artifacts with an Authenticode certificate.
#
# Prerequisites:
#   - A code-signing certificate imported into the Windows certificate store.
#   - Windows SDK (signtool.exe) installed.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File sign.ps1 -Thumbprint <sha1-thumbprint>
#
# The thumbprint can also come from the FOXLAUNCHER_CERT_THUMBPRINT environment
# variable. Build the artifacts first with build.ps1.

[CmdletBinding()]
param(
    [string]$Thumbprint = $env:FOXLAUNCHER_CERT_THUMBPRINT,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

. (Join-Path $root "tools\signing.ps1")

if ([string]::IsNullOrWhiteSpace($Thumbprint)) {
    throw "Provide -Thumbprint <sha1-thumbprint> or set the FOXLAUNCHER_CERT_THUMBPRINT environment variable."
}

$signtool = Get-SignTool
if (-not $signtool) {
    throw "signtool.exe not found under the Windows Kits bin folder."
}

$targets = @(
    (Join-Path $root "artifacts\publish\FoxLauncher.exe"),
    (Join-Path $root "artifacts\installer\Launcher.Installer.exe")
)

foreach ($target in $targets) {
    if (-not (Test-Path $target)) {
        Write-Warning "Skipping missing file: $target"
        continue
    }
    Invoke-SignFile -Path $target -SignTool $signtool -Thumbprint $Thumbprint -TimestampUrl $TimestampUrl
}

Write-Host "Signing complete." -ForegroundColor Green
