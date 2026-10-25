[CmdletBinding()]
param([ValidateRange(1,65535)][int]$Port=4141,[string]$BindHost='127.0.0.1',[switch]$NoInteractive)
$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\packages\proxy\bin\m365-proxy.mjs'))
$env:HOST = $env:NITRO_HOST = $BindHost
$env:M365_NO_INTERACTIVE = '1'
$env:M365_ENABLE_INTERACTIVE_APPROVAL = '0'
# Foreground by design. For hidden startup use the supervised sign-in task.
& node $launcher serve $Port
exit $LASTEXITCODE
