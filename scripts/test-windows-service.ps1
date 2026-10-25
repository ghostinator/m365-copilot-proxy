# Integration test with a local fake server. Never loads M365 auth or user state.
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scratch = [IO.Path]::GetFullPath((Join-Path $env:TEMP ('m365-service-test-' + [guid]::NewGuid().ToString('N'))))
$data = Join-Path $scratch 'state'
$bin = Join-Path $scratch 'app with spaces\bin'
New-Item -ItemType Directory -Force -Path $data,$bin | Out-Null
$socket = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$socket.Start(); $port=$socket.LocalEndpoint.Port; $socket.Stop()
[IO.File]::WriteAllText((Join-Path $data 'server.json'), ('{"port":' + $port + ',"host":"127.0.0.1"}'))
$launcher = Join-Path $bin 'm365-proxy.mjs'
$fake = @'
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir=process.env.M365_DATA_DIR, path=join(dir,'instance.json'), nonce=randomUUID();
const config=JSON.parse(readFileSync(join(dir,'server.json'),'utf8'));
writeFileSync(path,JSON.stringify({pid:process.pid,nonce,executable:process.execPath,launcher:fileURLToPath(import.meta.url),started:new Date().toISOString()}));
const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end('{"status":"ready"}');});
server.listen(config.port,'127.0.0.1');
const timer=setInterval(()=>{if(existsSync(join(dir,'shutdown-'+nonce))){clearInterval(timer);server.close(()=>{rmSync(path,{force:true});process.exit(0);});}},100);
'@
[IO.File]::WriteAllText($launcher,$fake)
Copy-Item -LiteralPath (Join-Path $repo 'packages\proxy\bin\supervise.mjs') -Destination (Join-Path $bin 'supervise.mjs')
$service = Join-Path $repo 'packages\proxy\windows\Service.ps1'
$node = (Get-Command node.exe).Source
. (Join-Path $repo 'packages\proxy\windows\TaskDefinition.ps1')
$taskName = Get-ProxyTaskName $data
$installed = $false
function Invoke-Service([string]$Operation) {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $service -Action $Operation -Launcher $launcher -NodePath $node -DataDir $data
    if ($LASTEXITCODE -ne 0) { throw ('Temporary service ' + $Operation + ' failed') }
}
try {
    Invoke-Service 'install'; $installed=$true
    Invoke-Service 'start'
    $instance = Get-Content -LiteralPath (Join-Path $data 'instance.json') -Raw | ConvertFrom-Json
    $inspection = Invoke-Service 'inspect' | ConvertFrom-Json
    if (-not $inspection.installed -or -not $inspection.enabled) { throw 'Installed task status was incorrect' }
    Invoke-Service 'disable'
    $disabled = Invoke-Service 'inspect' | ConvertFrom-Json
    if ($disabled.enabled) { throw 'Startup task remained enabled' }
    if (-not (Get-Process -Id ([int]$instance.pid) -ErrorAction SilentlyContinue)) { throw 'Disabling startup interrupted the active proxy' }
    Invoke-Service 'install'
    Stop-Process -Id ([int]$instance.pid) -Force
    $restarted=$false
    for ($i=0; $i -lt 50; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Path -LiteralPath (Join-Path $data 'instance.json')) {
            $again = Get-Content -LiteralPath (Join-Path $data 'instance.json') -Raw | ConvertFrom-Json
            if ($again.pid -ne $instance.pid) {
                try { $health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$port+'/health/ready') -TimeoutSec 1; if($health.status -eq 'ready'){$restarted=$true;break} } catch {}
            }
        }
    }
    if (-not $restarted) { throw 'The service watchdog did not restart the failed Node child' }
    Invoke-Service 'stop'
    Write-Output 'PASS: task inspect/disable preserves running process, start, Node failure/restart, and graceful stop (local fake server only)'
} finally {
    if ($installed) { Invoke-Service 'uninstall' }
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Temporary startup task was not removed' }
}
