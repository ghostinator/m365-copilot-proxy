[CmdletBinding()]
param(
    [string]$Source,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\M365CopilotProxy'),
    [string]$DataDir = (Join-Path $env:USERPROFILE '.config\opencode-m365'),
    [switch]$Rollback,
    [switch]$SkipBrowser
)
$ErrorActionPreference = 'Stop'
if (-not $Source) { $Source = Split-Path -Parent $PSScriptRoot }
. (Join-Path $PSScriptRoot 'TaskDefinition.ps1')
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataDir = [IO.Path]::GetFullPath($DataDir)
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$currentFile = Join-Path $InstallRoot 'current.json'
$previousFile = Join-Path $InstallRoot 'previous.json'
$old = if (Test-Path -LiteralPath $currentFile) { Get-Content -LiteralPath $currentFile -Raw | ConvertFrom-Json } else { $null }
if ($old -and -not $PSBoundParameters.ContainsKey('DataDir') -and $old.dataDir) { $DataDir = [IO.Path]::GetFullPath($old.dataDir) }

function Write-Selection($path, $value) {
    $temporary = $path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Depth 5))
    Move-Item -LiteralPath $temporary -Destination $path -Force
}
function Invoke-Proxy($selection, [string[]]$commands) {
    $env:M365_DATA_DIR = $DataDir
    & $selection.node (Join-Path $selection.directory 'bin\m365-proxy.mjs') @commands
    if ($LASTEXITCODE -ne 0) { throw ('Proxy command failed: ' + ($commands -join ' ')) }
}

if ($Rollback) {
    if (-not (Test-Path -LiteralPath $previousFile)) { throw 'No previous installation is recorded' }
    $next = Get-Content -LiteralPath $previousFile -Raw | ConvertFrom-Json
} else {
    $Source = [IO.Path]::GetFullPath($Source)
    $manifestFile = Join-Path $Source 'manifest.json'
    $manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
    if ($manifest.platform -ne 'win32') { throw 'Choose the Windows release archive' }
    if ($manifest.version -notmatch '^\d+\.\d+\.\d+([-.][a-zA-Z0-9.-]+)?$') { throw 'Invalid release version' }
    # Validate every manifest path before copying, including native runtime files.
    foreach ($entry in $manifest.files) {
        $sourcePath = [IO.Path]::GetFullPath((Join-Path $Source $entry.path))
        if (-not $sourcePath.StartsWith($Source.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escapes its root' }
        if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ine $entry.sha256) { throw ('Release checksum failed: ' + $entry.path) }
    }
    $manifestHash = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.Substring(0,12)
    $versions = Join-Path $InstallRoot 'versions'
    New-Item -ItemType Directory -Force -Path $versions | Out-Null
    $targetDir = Join-Path $versions ($manifest.version + '-' + $manifestHash)
    if (-not (Test-Path -LiteralPath $targetDir)) {
        $stage = Join-Path $versions ('.staging-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $stage | Out-Null
        foreach ($entry in $manifest.files) {
            $destinationPath = Join-Path $stage $entry.path
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationPath) | Out-Null
            Copy-Item -LiteralPath (Join-Path $Source $entry.path) -Destination $destinationPath
            if ((Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash -ine $entry.sha256) { throw ('Copied release checksum failed: ' + $entry.path) }
        }
        Copy-Item -LiteralPath $manifestFile -Destination (Join-Path $stage 'manifest.json')
        # Both resolved move endpoints must stay inside this installer-owned directory.
        foreach ($movePath in @($stage,$targetDir)) {
            if (-not ([IO.Path]::GetFullPath($movePath)).StartsWith($versions.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid install target' }
        }
        Move-Item -LiteralPath $stage -Destination $targetDir
    }
    $node = Join-Path $targetDir 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node.exe -ErrorAction Stop).Source }
    $next = [pscustomobject]@{ directory=$targetDir; node=$node; version=$manifest.version; dataDir=$DataDir }
}
if (-not (Test-Path -LiteralPath (Join-Path $next.directory 'bin\m365-proxy.mjs'))) { throw 'Selected release is missing its launcher' }
$next.dataDir = $DataDir
$wasInstalled = $false
$wasRunning = $false
if ($old) {
    $env:M365_DATA_DIR = $DataDir
    $task = Get-ScheduledTask -TaskName (Get-ProxyTaskName $DataDir) -ErrorAction SilentlyContinue
    $wasInstalled = $null -ne $task
    $wasRunning = $wasInstalled -and $task.State -eq 'Running'
}
try {
    if ($wasInstalled) { Invoke-Proxy $old @('service','stop') }
    $setupArgs = @('setup'); if ($SkipBrowser) { $setupArgs += '--skip-browser' }
    Invoke-Proxy $next $setupArgs
    Write-Selection $currentFile $next
    if ($wasInstalled) { Invoke-Proxy $next @('service','install') }
    if ($wasRunning) { Invoke-Proxy $next @('service','start') }
    if ($old) { Write-Selection $previousFile $old }
} catch {
    if ($old) {
        if ($wasInstalled) { try { Invoke-Proxy $next @('service','stop') } catch {} }
        Write-Selection $currentFile $old
        if ($wasInstalled) { Invoke-Proxy $old @('service','install') }
        if ($wasRunning) { Invoke-Proxy $old @('service','start') }
    }
    throw
}
$bootstrap = @'
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$ProxyArguments)
$ErrorActionPreference = 'Stop'
$selection = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current.json') -Raw | ConvertFrom-Json
$env:M365_DATA_DIR = $selection.dataDir
& $selection.node (Join-Path $selection.directory 'bin\m365-proxy.mjs') @ProxyArguments
exit $LASTEXITCODE
'@
[IO.File]::WriteAllText((Join-Path $InstallRoot 'Run.ps1'), $bootstrap)
$cmd = '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run.ps1" %*' + "`r`n" + 'exit /b %errorlevel%' + "`r`n"
[IO.File]::WriteAllText((Join-Path $InstallRoot 'm365-proxy.cmd'), $cmd)
Write-Output ('Installed ' + $next.version + ' at ' + $next.directory)
Write-Output ('Run ' + (Join-Path $InstallRoot 'm365-proxy.cmd') + ' login, then service install and service start.')
