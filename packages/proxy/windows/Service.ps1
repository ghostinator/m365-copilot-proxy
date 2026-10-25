[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('install','status','start','stop','uninstall','inspect','disable')][string]$Action,
    [Parameter(Mandatory=$true)][string]$Launcher,
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$DataDir
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'TaskDefinition.ps1')
$DataDir = [IO.Path]::GetFullPath($DataDir)
$Launcher = [IO.Path]::GetFullPath($Launcher)
$NodePath = [IO.Path]::GetFullPath($NodePath)
$taskName = Get-ProxyTaskName $DataDir
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$instancePath = Join-Path $DataDir 'instance.json'

function Stop-ProxyInstance {
    if (-not (Test-Path -LiteralPath $instancePath)) { return }
    $instance = Get-Content -LiteralPath $instancePath -Raw | ConvertFrom-Json
    $target = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$instance.pid) -ErrorAction SilentlyContinue
    if (-not $target) { return }
    # Refuse a stale/reused PID. Check executable, launcher and recorded start time.
    $started = [datetime]::Parse($instance.started).ToUniversalTime()
    $actualStart = $target.CreationDate.ToUniversalTime()
    if (($target.ExecutablePath -ine $NodePath) -or ($target.CommandLine.IndexOf($Launcher,[StringComparison]::OrdinalIgnoreCase) -lt 0) -or ([Math]::Abs(($started - $actualStart).TotalSeconds) -gt 10)) {
        throw 'The recorded PID belongs to another process. No process was stopped.'
    }
    if ($instance.nonce -notmatch '^[0-9a-f-]{36}$') { throw 'Invalid instance control record' }
    $stopPath = Join-Path $DataDir ('shutdown-' + $instance.nonce)
    [IO.File]::WriteAllText($stopPath, 'stop')
    $ended = Wait-Process -Id ([int]$instance.pid) -Timeout 20 -ErrorAction SilentlyContinue
    if (Get-Process -Id ([int]$instance.pid) -ErrorAction SilentlyContinue) {
        # Recheck identity before a bounded force-stop fallback.
        $again = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$instance.pid)
        if (-not $again) { return }
        if ($again.CreationDate -ne $target.CreationDate) { throw 'PID changed; refusing to force-stop it' }
        Stop-Process -Id ([int]$instance.pid) -Force
    }
}

switch ($Action) {
    'install' {
        if (-not (Test-Path -LiteralPath $Launcher)) { throw 'Launcher not found; run setup first' }
        $definition = New-ProxyTaskDefinition -Launcher $Launcher -NodePath $NodePath -DataDir $DataDir
        Register-ScheduledTask -TaskName $taskName -InputObject $definition -Force | Out-Null
        Write-Output ('Installed sign-in task ' + $taskName + '. Run service start to start now.')
    }
    'inspect' {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        [pscustomobject]@{ supported=$true; installed=[bool]$task; enabled=([bool]$task -and $task.Settings.Enabled); state=$(if ($task) { [string]$task.State } else { 'Not installed' }); task=$taskName } | ConvertTo-Json -Compress
    }
    'disable' {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task) { Disable-ScheduledTask -TaskName $taskName | Out-Null }
        Write-Output 'Sign-in startup disabled. The running proxy was preserved.'
    }
    'status' {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $task) { Write-Output 'Not installed'; exit 1 }
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        [pscustomobject]@{ Task=$taskName; State=$task.State; LastExitCode=$info.LastTaskResult; Logs=(Join-Path $DataDir 'service-logs'); InstanceRecorded=(Test-Path -LiteralPath $instancePath) } | Format-List
    }
    'start' {
        Start-ScheduledTask -TaskName $taskName
        $config = Get-Content -LiteralPath (Join-Path $DataDir 'server.json') -Raw | ConvertFrom-Json
        $port = if ($config.port) { [int]$config.port } else { 4141 }
        $bindHost = if ($config.host -and $config.host -notin @('0.0.0.0','::')) { [string]$config.host } else { '127.0.0.1' }
        if ($bindHost.Contains(':')) { $bindHost = '[' + $bindHost + ']' }
        $ready = $false
        for ($i=0; $i -lt 60; $i++) {
            try { $r = Invoke-RestMethod -Uri ('http://' + $bindHost + ':' + $port + '/health/ready') -TimeoutSec 1; if ($r.status -eq 'ready') { $ready=$true; break } } catch {}
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw ('Proxy did not become ready. Check ' + (Join-Path $DataDir 'service-logs\stderr.log') + '; run m365-proxy login if sign-in is required.') }
        Write-Output 'Proxy is ready.'
    }
    'stop' { Disable-ScheduledTask -TaskName $taskName | Out-Null; Stop-ProxyInstance; Stop-ScheduledTask -TaskName $taskName; Enable-ScheduledTask -TaskName $taskName | Out-Null; Write-Output 'Proxy stopped.' }
    'uninstall' { Disable-ScheduledTask -TaskName $taskName | Out-Null; Stop-ProxyInstance; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Output 'Startup task removed. Application files and sign-in state were preserved.' }
}
