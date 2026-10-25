[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Launcher,
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$DataDir
)
$ErrorActionPreference = 'Stop'
$env:M365_DATA_DIR = $DataDir
$env:M365_NO_INTERACTIVE = '1'
$env:M365_ENABLE_INTERACTIVE_APPROVAL = '0'
$env:M365_LOG_STDOUT = '1'
foreach ($name in @('PORT','NITRO_PORT','HOST','NITRO_HOST')) { Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue }
$logDir = Join-Path $DataDir 'service-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
foreach ($name in @('stdout.log','stderr.log')) {
    $log = Join-Path $logDir $name
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 10MB) {
        Move-Item -LiteralPath $log -Destination ($log + '.1') -Force
    }
}
# This runner stays attached for the entire Node lifetime and propagates its exit.
$supervisor = Join-Path (Split-Path -Parent $Launcher) 'supervise.mjs'
$child = Start-Process -FilePath $NodePath -ArgumentList @(('"' + $supervisor + '"'), ('"' + $Launcher + '"')) -WorkingDirectory (Split-Path -Parent $Launcher) -WindowStyle Hidden -PassThru
$child.WaitForExit()
exit $child.ExitCode
