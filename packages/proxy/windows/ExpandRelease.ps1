param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Target=[IO.Path]::GetFullPath($Target)
if(Test-Path -LiteralPath $Target){throw 'Extraction target already exists'}
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try {
 $names=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 $total=[long]0
 if($zip.Entries.Count -gt 6000){throw 'Too many archive entries'}
 foreach($entry in $zip.Entries){
  $name=$entry.FullName.Replace('\','/');while($name.StartsWith('./')){$name=$name.Substring(2)}
  if(-not $name){continue}
  $fileName=$name.TrimEnd('/')
  $badParts=@($fileName.Split('/') | Where-Object {$_ -in @('.','..','') -or $_ -match '[. ]$' -or $_ -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'})
  if($fileName -match '(^/|:|[\x00-\x1f<>"|?*])' -or $badParts.Count){throw 'Unsafe archive path'}
  $mode=($entry.ExternalAttributes -shr 16) -band 61440
  if($mode -notin @(0,32768,16384)){throw 'Archive links and special files are refused'}
  if(-not $names.Add($name)){throw 'Duplicate archive entry'}
  $total+=$entry.Length
  if($entry.Length -gt 200000000 -or $total -gt 750000000){throw 'Archive size limit exceeded'}
  $path=[IO.Path]::GetFullPath((Join-Path $Target $fileName))
  if(-not $path.StartsWith($Target.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path escapes target'}
 }
 New-Item -ItemType Directory -Path $Target | Out-Null
 foreach($entry in $zip.Entries){
  $name=$entry.FullName.Replace('\','/');while($name.StartsWith('./')){$name=$name.Substring(2)}
  if(-not $name -or $name.EndsWith('/')){continue}
  $path=Join-Path $Target $name
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$path,$false)
 }
}finally{$zip.Dispose()}
