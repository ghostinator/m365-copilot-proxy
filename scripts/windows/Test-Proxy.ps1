[CmdletBinding()]
param([string]$BaseUrl='http://127.0.0.1:4141',[switch]$Live,[switch]$Tools,[string]$Model='claude-sonnet')
$ErrorActionPreference = 'Stop'
$headers = @{}
if ($env:M365_API_KEY) { $headers.Authorization = 'Bearer ' + $env:M365_API_KEY }
$ready = Invoke-RestMethod -Uri ($BaseUrl + '/health/ready') -Headers $headers -TimeoutSec 10
if ($ready.status -ne 'ready') { throw 'Proxy is not ready' }
$models = Invoke-RestMethod -Uri ($BaseUrl + '/v1/models') -Headers $headers -TimeoutSec 10
if (-not $models.data.Count) { throw 'The model list is empty' }
Write-Output ('PASS: ready, ' + $models.data.Count + ' advertised models')
if ($Live -and $Tools) { throw 'Choose -Live or -Tools so this smoke check starts only one conversation' }
if ($Tools) {
    $pi = (Get-Command pi -ErrorAction Stop).Source
    $scratch = [IO.Path]::GetFullPath((Join-Path $env:TEMP ('m365-pi-smoke-' + [guid]::NewGuid().ToString('N'))))
    $profile = Join-Path $scratch 'agent'
    $work = Join-Path $scratch 'work'
    New-Item -ItemType Directory -Force -Path $profile,$work | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $scratch /inheritance:r /grant:r ('*'+$sid+':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot protect the isolated pi profile' }
    $key = if ($env:M365_API_KEY) { $env:M365_API_KEY } else { 'not-needed' }
    $config = @{providers=@{m365=@{api='openai-completions';apiKey=$key;baseUrl=($BaseUrl+'/v1');compat=@{supportsDeveloperRole=$false;supportsReasoningEffort=$false;supportsUsageInStreaming=$false};models=@(@{id=$Model;name=$Model})}}} | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText((Join-Path $profile 'models.json'),$config)
    $marker = 'lighthouse-' + [guid]::NewGuid().ToString('N')
    $piArgs = @('-p','--offline','--provider','m365','--model',$Model,'--tools','read,write,bash','--no-context-files','--no-extensions','--no-skills','--no-prompt-templates','--no-session',('Create sentinel.txt containing '+$marker+'. Read it back to confirm the contents, then finish.'))
    $spec = @{pi=$pi;arguments=$piArgs;profile=$profile;work=$work} | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $scratch 'run.json'),$spec)
    $childScript = @'
$ErrorActionPreference='Stop'
$spec=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'run.json') -Raw | ConvertFrom-Json
$env:PI_CODING_AGENT_DIR=$spec.profile
$env:PI_OFFLINE='1'
$env:PI_TELEMETRY='0'
Set-Location -LiteralPath $spec.work
$piArguments=@($spec.arguments)
& $spec.pi @piArguments
exit $LASTEXITCODE
'@
    $childPath = Join-Path $scratch 'run.ps1'
    [IO.File]::WriteAllText($childPath,$childScript)
    $runner = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$childPath+'"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $scratch 'stdout.log') -RedirectStandardError (Join-Path $scratch 'stderr.log') -PassThru
    # Retain the native handle before waiting: Windows PowerShell can otherwise
    # discard it on exit and expose a null ExitCode for a successful child.
    $null = $runner.Handle
    if (-not $runner.WaitForExit(180000)) {
        & taskkill.exe /PID $runner.Id /T /F | Out-Null
        throw ('The isolated pi run timed out; its own process tree was stopped. Evidence: '+$scratch)
    }
    if ($runner.ExitCode -ne 0) { throw ('pi failed; evidence: '+$scratch) }
    $sentinel = Join-Path $work 'sentinel.txt'
    if (-not (Test-Path -LiteralPath $sentinel) -or -not (Get-Content -LiteralPath $sentinel -Raw).Contains($marker)) { throw ('pi did not execute the real file write; evidence: '+$scratch) }
    Write-Output ('PASS: real pi tool loop wrote the unique sentinel. Evidence: '+$scratch)
}
if ($Live) {
    $body = @{model=$Model;messages=@(@{role='user';content='Please say hello briefly.'})} | ConvertTo-Json -Depth 5
    $reply = Invoke-RestMethod -Uri ($BaseUrl + '/v1/chat/completions') -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 180
    if (-not $reply.choices[0].message.content) { throw 'Live completion was empty' }
    Write-Output 'PASS: one live chat completion'
}
