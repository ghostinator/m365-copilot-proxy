// Isolated Windows handoff/rollback test. Fake auth; only loopback readiness HTTP.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
if(process.platform!=='win32')throw Error('Windows-only activation test');
const execute=promisify(execFile), source=resolve(process.argv[2]||'');
if(!existsSync(join(source,'manifest.json')))throw Error('Pass an extracted portable release');
const dir=mkdtempSync(join(tmpdir(),'m365-update-test-')),data=join(dir,'private'),old=join(dir,'old');
mkdirSync(data);cpSync(source,old,{recursive:true});
const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const base='http://127.0.0.1:'+port, loader=pathToFileURL(join(import.meta.dirname,'fixtures/chat-loader.mjs')).href;
const env={...process.env,M365_DATA_DIR:data,M365_CACHE_FILE:join(data,'cache.json'),M365_SECRETS_FILE:join(data,'missing.json'),M365_NO_INTERACTIVE:'1',M365_ENABLE_INTERACTIVE_APPROVAL:'0',NODE_OPTIONS:'--import='+loader,M365_TEST_UPDATE_READY:base,M365_FORCE_AGENT:'0'};
for(const k of ['PORT','HOST','NITRO_PORT','NITRO_HOST','M365_API_KEY','M365_ALLOWED_ORIGINS','NODE_PATH'])delete env[k];
writeFileSync(join(data,'server.json'),JSON.stringify({host:'127.0.0.1',port}));writeFileSync(join(data,'preserve-me'),'account/history sentinel');
let logs='';const child=spawn(join(old,'node.exe'),[join(old,'bin/m365-proxy.mjs'),'serve'],{env,cwd:dir,windowsHide:true});
child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const record=()=>JSON.parse(readFileSync(join(data,'instance.json'),'utf8'));
async function until(fn,message,ms=180000){const deadline=Date.now()+ms;while(Date.now()<deadline){try{const v=await fn();if(v)return v}catch{}await delay(250)}throw Error(message+'\n'+logs.slice(-2000))}
const cli=async(...args)=>{const current=record(),cliEnv={...env};delete cliEnv.NODE_OPTIONS;return execute(current.executable,[current.launcher,...args],{env:cliEnv,windowsHide:true,timeout:180000,maxBuffer:65536})};
const ready=()=>until(async()=>{if(child.exitCode!==null&&!existsSync(join(data,'updates')))throw Error('Initial proxy exited');const r=await fetch(base+'/health/ready',{signal:AbortSignal.timeout(1000)});return r.ok&&record()},'proxy readiness',30000);
try{
 await ready();console.log('PASS: isolated runtime ready');if(!process.argv.includes('--recovery-only')){const first=record().pid;
 await cli('update','stage-local',source);await cli('update','apply');
 await until(()=>{const p=join(data,'updates/state.json');return existsSync(p)&&JSON.parse(readFileSync(p)).phase==='applied'&&record().pid!==first},'apply handoff');
 await ready();assert.equal(readFileSync(join(data,'preserve-me'),'utf8'),'account/history sentinel');
 const second=record().pid;await cli('update','rollback');
 await until(()=>JSON.parse(readFileSync(join(data,'updates/state.json'))).phase==='applied'&&record().pid!==second,'rollback handoff');await ready();
 console.log('PASS: verified portable apply and rollback handoffs, new PIDs, readiness, preserved data');
 }
 // A valid manifest/CLI candidate that fails only when its HTTP server starts.
 const bad=join(dir,'bad');cpSync(source,bad,{recursive:true});const file='.output/server/index.mjs';writeFileSync(join(bad,file),'process.exit(78);\n');
 const manifest=JSON.parse(readFileSync(join(bad,'manifest.json')));manifest.files.find(f=>f.path===file).sha256=createHash('sha256').update(readFileSync(join(bad,file))).digest('hex');writeFileSync(join(bad,'manifest.json'),JSON.stringify(manifest));
 await cli('update','stage-local',bad);await cli('update','apply');
 await until(()=>JSON.parse(readFileSync(join(data,'updates/state.json'))).phase==='rolled-back','failed candidate recovery',240000);await ready();
 assert.equal(readFileSync(join(data,'preserve-me'),'utf8'),'account/history sentinel');
 assert(!existsSync(join(data,'updates/activation.pending')));assert(!existsSync(join(data,'updates/operation.lock')));
 console.log('PASS: failed candidate recovered previous release without touching account/history data');
}finally{
 if(existsSync(join(data,'instance.json'))){const r=record();writeFileSync(join(data,'shutdown-'+r.nonce),'stop');await until(()=>!existsSync(join(data,'instance.json')),'test cleanup',30000).catch(()=>{});}
 console.log('Isolated test files: '+dir);
}
