$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$folder=Join-Path ([IO.Path]::GetTempPath()) ('m365-zip-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder | Out-Null
$extract=Join-Path $PSScriptRoot '../packages/proxy/windows/ExpandRelease.ps1'
foreach($test in @('good','traversal','duplicate','symlink')){
 $zipPath=Join-Path $folder ($test+'.zip')
 $zip=[IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Create)
 try{
  $names=switch($test){'traversal'{@('../escape')};'duplicate'{@('File','file')};default{@('bin/test.mjs')}}
  foreach($name in $names){$entry=$zip.CreateEntry($name);if($test -eq 'symlink'){$entry.ExternalAttributes=-1577058304};$stream=New-Object IO.StreamWriter($entry.Open());$stream.Write('fixture');$stream.Dispose()}
 }finally{$zip.Dispose()}
 $target=Join-Path $folder $test
 $rejected=$false
 try{& $extract -Archive $zipPath -Target $target | Out-Null}catch{$rejected=$true}
 if($test -eq 'good'){
  if($rejected -or (Get-Content -LiteralPath (Join-Path $target 'bin/test.mjs') -Raw) -ne 'fixture'){throw 'Good archive rejected'}
 }elseif(-not $rejected -or (Test-Path -LiteralPath $target)){throw ('Unsafe archive was not rejected before extraction: '+$test)}
 Write-Output ('PASS: '+$test)
}
Write-Output ('Test files: '+$folder)
