$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach ($directory in @('packages\proxy\windows','scripts\windows')) {
    Get-ChildItem -LiteralPath (Join-Path $repo $directory) -Filter '*.ps1' | ForEach-Object {
        $tokens=$null; $parseErrors=$null
        [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$parseErrors)
        if ($parseErrors.Count) { throw ($_.Name + ': ' + ($parseErrors.Message -join '; ')) }
    }
}
. (Join-Path $repo 'packages\proxy\windows\TaskDefinition.ps1')
$definition = New-ProxyTaskDefinition -Launcher 'C:\app with spaces\bin\m365-proxy.mjs' -NodePath (Get-Command node.exe).Source -DataDir 'C:\state with spaces'
if ($definition.Settings.ExecutionTimeLimit -ne 'PT0S') { throw 'Task must have no execution limit' }
if ($definition.Settings.RestartCount -ne 3) { throw 'Task must restart failures' }
if ($definition.Actions.Arguments.Contains('-NoExit')) { throw 'Task cannot use a detached -NoExit shell' }
if (-not $definition.Actions.Arguments.Contains('-WindowStyle Hidden')) { throw 'Task must run hidden' }
Write-Output 'PASS: task definition is hidden, supervised and restartable; no task registered'
$scratch = Join-Path $env:TEMP ('m365-runner-' + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $scratch 'app with spaces\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$fake = Join-Path $bin 'm365-proxy.mjs'
$env:M365_SERVICE_RESTARTS = '0'
[IO.File]::WriteAllText($fake, 'process.exit(17);')
Copy-Item -LiteralPath (Join-Path $repo 'packages\proxy\bin\supervise.mjs') -Destination (Join-Path $bin 'supervise.mjs')
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $repo 'packages\proxy\windows\Runner.ps1') -Launcher $fake -NodePath (Get-Command node.exe).Source -DataDir (Join-Path $scratch 'state')
if ($LASTEXITCODE -ne 17) { throw ('Runner lost Node exit 17; got ' + $LASTEXITCODE) }
Write-Output 'PASS: Windows runner propagates the Node exit code through paths containing spaces'
