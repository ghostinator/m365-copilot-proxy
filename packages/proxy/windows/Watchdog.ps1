#Requires -RunAsAdministrator
# Starts the proxy service when it is Stopped. Windows stops it (exit 0) whenever Tailscale, which it depends on,
# is stopped, e.g. by a Tailscale update, and never starts a dependent again, so recovery rules do not apply.
# To stop the proxy on purpose, create <DataDir>\watchdog.pause first and delete it afterwards.
[CmdletBinding()]
param(
    [string]$Service = 'M365CopilotProxy',
    [string]$DataDir = 'C:\Users\BrandonCook\.config\opencode-m365'
)
$ErrorActionPreference = 'Stop'
if (Test-Path (Join-Path $DataDir 'watchdog.pause')) { exit 0 }
$svc = Get-Service $Service -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne 'Stopped') { exit 0 }
$log = Join-Path $DataDir 'service-logs\watchdog.log'
try {
    Start-Service $Service   # also starts Tailscale first when it is down
    Add-Content $log "$((Get-Date).ToUniversalTime().ToString('o')) $Service was Stopped; started it"
} catch {
    Add-Content $log "$((Get-Date).ToUniversalTime().ToString('o')) could not start ${Service}: $($_.Exception.Message)"
    exit 1
}
