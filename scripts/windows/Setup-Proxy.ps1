[CmdletBinding()]
param([switch]$SkipBrowser)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $repo
try {
    $nodeVersion = (& node --version).TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or [int]$nodeVersion.Split('.')[0] -lt 24) { throw 'Node.js 24 or later is required' }
    $package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
    $pinnedVersion = $package.packageManager -replace '^pnpm@',''
    function Invoke-PinnedPnpm([string[]]$Commands) {
        & npx.cmd --yes ('pnpm@' + $pinnedVersion) @Commands
        if ($LASTEXITCODE -ne 0) { throw ('pnpm failed: ' + ($Commands -join ' ')) }
    }
    Invoke-PinnedPnpm @('install','--frozen-lockfile')
    Invoke-PinnedPnpm @('build')
    $setupArgs = @((Join-Path $repo 'packages\proxy\bin\m365-proxy.mjs'),'setup')
    if ($SkipBrowser) { $setupArgs += '--skip-browser' }
    & node @setupArgs
    if ($LASTEXITCODE -ne 0) { throw 'Proxy setup failed' }
} finally { Pop-Location }
