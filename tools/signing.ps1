# Shared Authenticode signing helpers used by build.ps1 and sign.ps1.
# These are dot-sourced (functions only, no side effects).

function Get-SignTool {
    $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (-not (Test-Path $kitsRoot)) { return $null }

    # Prefer the newest SDK version's x64 signtool.exe.
    return Get-ChildItem $kitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -like "*\x64" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1 |
        ForEach-Object { $_.FullName }
}

function Invoke-SignFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$SignTool,
        [Parameter(Mandatory = $true)][string]$Thumbprint,
        [string]$TimestampUrl = "http://timestamp.digicert.com"
    )

    if (-not (Test-Path $Path)) { throw "File not found: $Path" }

    # SHA256 Authenticode signature with an RFC 3161 timestamp.
    & $SignTool sign /sha1 $Thumbprint /fd sha256 /tr $TimestampUrl /td sha256 "$Path"
    if ($LASTEXITCODE -ne 0) {
        throw "Signing failed for $Path (signtool exit code $LASTEXITCODE)."
    }
    Write-Host "Signed: $Path"
}
