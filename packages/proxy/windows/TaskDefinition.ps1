function Get-ProxyTaskName {
    param([string]$DataDir)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $suffix = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($DataDir)).ToLowerInvariant())))).Replace('-','').Substring(0,8) } finally { $sha.Dispose() }
    'M365CopilotProxy-' + $suffix
}

function New-ProxyTaskDefinition {
    param([string]$Launcher,[string]$NodePath,[string]$DataDir)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $runner = Join-Path $PSScriptRoot 'Runner.ps1'
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Launcher "{1}" -NodePath "{2}" -DataDir "{3}"' -f $runner,$Launcher,$NodePath,$DataDir
    $taskAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument $arguments -WorkingDirectory (Split-Path -Parent $Launcher)
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([timespan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    New-ScheduledTask -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description ('M365 Copilot Proxy for ' + $DataDir)
}
