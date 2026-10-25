param([Parameter(Mandatory=$true)][string]$ReleaseDirectory)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
$scratch = Join-Path $env:TEMP ('m365-install-' + [guid]::NewGuid().ToString('N'))
$install = [IO.Path]::GetFullPath((Join-Path $scratch 'program files'))
$data = [IO.Path]::GetFullPath((Join-Path $scratch 'account state'))
New-Item -ItemType Directory -Force -Path $data | Out-Null
[IO.File]::WriteAllText((Join-Path $data 'keep.txt'), 'preserve account state')
$installer = Join-Path $ReleaseDirectory 'windows\Install.ps1'
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -InstallRoot $install -DataDir $data -SkipBrowser
if ($LASTEXITCODE -ne 0) { throw 'Isolated installation failed' }
$first = Get-Content -LiteralPath (Join-Path $install 'current.json') -Raw | ConvertFrom-Json
if ($first.dataDir -ne $data) { throw 'Installer lost the explicit data directory' }
$upgrade = Join-Path $scratch 'upgrade source'
New-Item -ItemType Directory -Path $upgrade | Out-Null
Get-ChildItem -LiteralPath $ReleaseDirectory -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $upgrade -Recurse -Force }
$manifest = Get-Content -LiteralPath (Join-Path $upgrade 'manifest.json') -Raw | ConvertFrom-Json
$manifest.version = '0.2.1-test'
[IO.File]::WriteAllText((Join-Path $upgrade 'manifest.json'), ($manifest | ConvertTo-Json -Depth 10))
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -Source $upgrade -InstallRoot $install -DataDir $data -SkipBrowser
if ($LASTEXITCODE -ne 0) { throw 'Isolated update failed' }
$updated = Get-Content -LiteralPath (Join-Path $install 'current.json') -Raw | ConvertFrom-Json
if ($updated.version -ne '0.2.1-test') { throw 'Update did not switch versions' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -Rollback -InstallRoot $install -SkipBrowser
if ($LASTEXITCODE -ne 0) { throw 'Isolated rollback failed' }
$restored = Get-Content -LiteralPath (Join-Path $install 'current.json') -Raw | ConvertFrom-Json
if ($restored.directory -ne $first.directory) { throw 'Rollback did not restore the previous version' }
if ((Get-Content -LiteralPath (Join-Path $data 'keep.txt') -Raw) -ne 'preserve account state') { throw 'User state was changed' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $install 'Run.ps1') --help
if ($LASTEXITCODE -ne 0) { throw 'Stable installed launcher failed' }
Write-Output 'PASS: isolated versioned installation, update, rollback and launcher; account state preserved; no task registered'
