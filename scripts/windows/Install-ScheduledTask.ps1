[CmdletBinding()]
param()
$launcher = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\packages\proxy\bin\m365-proxy.mjs'))
& node $launcher service install
exit $LASTEXITCODE
