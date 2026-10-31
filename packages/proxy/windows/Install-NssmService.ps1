#Requires -RunAsAdministrator
# Replaces the sign-in scheduled task with a Windows service (NSSM) that starts at boot, no logon needed.
# Runs the same Runner.ps1 command as the task, as LocalSystem (which already has full control of the data dir).
[CmdletBinding()]
param(
    [string]$Repo = 'C:\Users\BrandonCook\Desktop\m365-copilot-client-integrations',
    [string]$DataDir = 'C:\Users\BrandonCook\.config\opencode-m365',
    [string]$NodePath = 'C:\Users\BrandonCook\.config\opencode-m365\updates\installation\versions\0.24.0-ABEC3C2DEAF6\node.exe',
    [string]$TaskName = 'M365CopilotProxy-C948C980',
    [string]$Service = 'M365CopilotProxy'
)
$ErrorActionPreference = 'Stop'
$win = Join-Path $Repo 'packages\proxy\windows'
$launcher = Join-Path $Repo 'packages\proxy\bin\m365-proxy.mjs'
$nssm = 'C:\ProgramData\m365-copilot-proxy\nssm.exe'
New-Item -ItemType Directory -Force (Split-Path $nssm) | Out-Null
Copy-Item (Join-Path $DataDir 'tools\nssm.exe') $nssm -Force

# Stop the old task and its processes so the port is free.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName $TaskName; Disable-ScheduledTask -TaskName $TaskName | Out-Null }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'opencode-m365|m365-copilot-client' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Get-Service $Service -ErrorAction SilentlyContinue) { & $nssm stop $Service | Out-Null; & $nssm remove $Service confirm | Out-Null }
$args = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$win\Runner.ps1`" -Launcher `"$launcher`" -NodePath `"$NodePath`" -DataDir `"$DataDir`""
& $nssm install $Service "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" $args
& $nssm set $Service AppDirectory (Split-Path $launcher)
& $nssm set $Service DisplayName 'M365 Copilot Proxy'
& $nssm set $Service Start SERVICE_DELAYED_AUTO_START
& $nssm set $Service DependOnService Tailscale          # proxy binds the Tailscale address
& $nssm set $Service AppEnvironmentExtra "M365_DATA_DIR=$DataDir"
& $nssm set $Service AppStdout (Join-Path $DataDir 'service-logs\nssm-stdout.log')
& $nssm set $Service AppStderr (Join-Path $DataDir 'service-logs\nssm-stderr.log')
& $nssm set $Service AppRotateFiles 1
& $nssm set $Service AppRotateBytes 10485760
# Let the service exit when the app exits; Windows recovery then restarts it up to 3 times.
& $nssm set $Service AppExit Default Exit
sc.exe failure $Service reset= 86400 actions= restart/10000/restart/10000/restart/10000 | Out-Null
sc.exe failureflag $Service 1 | Out-Null

Start-Service $Service
Start-Sleep 20
Get-Service $Service | Format-Table Name, Status, StartType
Get-NetTCPConnection -LocalPort 4141 -State Listen -ErrorAction SilentlyContinue | Format-Table LocalAddress, OwningProcess
