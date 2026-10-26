import { spawn, execFile } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Updates } from "./updates.mjs";
import { verifyRelease } from "./release-files.mjs";
const execute=promisify(execFile),file=process.argv[2];
const task=JSON.parse(readFileSync(file,'utf8')),data=process.env.M365_DATA_DIR;
if(!data||task.data!==data||!Number.isSafeInteger(task.pid)||!/^[-0-9a-f]{36}$/.test(task.nonce))throw Error('Invalid update handoff');
const recordPath=join(data,'instance.json'),record=JSON.parse(readFileSync(recordPath,'utf8'));
if(record.pid!==task.pid||record.nonce!==task.nonce||record.launcher!==task.old.directory+'/bin/m365-proxy.mjs'&&record.launcher!==join(task.old.directory,'bin/m365-proxy.mjs'))throw Error('Update instance changed');
const updates=new Updates({root:task.old.directory,dataDir:data,version:task.old.version});
const pending=join(updates.folder,'activation.pending'),lock=join(updates.folder,'operation.lock');const lockFd=openSync(lock,'wx',0o600);writeFileSync(lockFd,JSON.stringify({pid:process.pid}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function exited(pid,ms){const end=Date.now()+ms;while(Date.now()<end){try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')return true}await sleep(250)}return false}
async function install(source){await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(task.old.directory,'windows/Install.ps1'),'-Source',source,'-InstallRoot',join(updates.folder,'installation'),'-DataDir',data,'-SkipBrowser'],{timeout:180000,windowsHide:true,maxBuffer:65536});return JSON.parse(readFileSync(join(updates.folder,'installation/current.json'),'utf8'))}
function launch(selection){const child=spawn(selection.node,[join(selection.directory,'bin/supervise.mjs'),join(selection.directory,'bin/m365-proxy.mjs')],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,M365_DATA_DIR:data,M365_UPDATE_PENDING:'1'}});child.on('error',()=>{});child.unref();return child}
async function ready(selection){const config=existsSync(join(data,'server.json'))?JSON.parse(readFileSync(join(data,'server.json'),'utf8')):{};let host=process.env.NITRO_HOST||process.env.HOST||config.host||'127.0.0.1';if(['0.0.0.0','::'].includes(host))host='127.0.0.1';const base='http://'+(host.includes(':')?'['+host+']':host)+':'+(process.env.NITRO_PORT||process.env.PORT||config.port||4141);
 for(let i=0;i<120;i++){try{const current=JSON.parse(readFileSync(recordPath,'utf8'));if(current.launcher===join(selection.directory,'bin/m365-proxy.mjs')&&current.executable===selection.node){const r=await fetch(base+'/health/ready',{headers:{'X-M365-Check':'1'},signal:AbortSignal.timeout(1000)});if(r.status===200&&r.headers.get('x-m365-proxy-version')===selection.version)return current}}catch{}await sleep(500)}throw Error('Replacement did not become ready')}
async function stopCandidate(){if(!existsSync(recordPath))return;const current=JSON.parse(readFileSync(recordPath,'utf8'));if(!current.launcher.startsWith(join(updates.folder,'installation')+requireSeparator()))throw Error('Unexpected process; refusing rollback stop');writeFileSync(join(data,'shutdown-'+current.nonce),'stop',{mode:0o600});if(!await exited(current.pid,30000))throw Error('Replacement did not stop; no other process was started')}
function requireSeparator(){return process.platform==='win32'?'\\':'/'}
async function startup(selection){if(!task.startup.installed)return;await execute(selection.node,[join(selection.directory,'bin/m365-proxy.mjs'),'service','install'],{timeout:60000,windowsHide:true,maxBuffer:65536,env:process.env});if(!task.startup.enabled)await execute(selection.node,[join(selection.directory,'bin/m365-proxy.mjs'),'service','disable'],{timeout:60000,windowsHide:true,maxBuffer:65536,env:process.env})}
process.send?.('ready');
if(!await exited(task.pid,120000)||existsSync(recordPath)){updates.write('state',{phase:'failed',message:'Update cancelled: old process did not exit cleanly.'});process.exitCode=1}
else {
 let selected;
 try {
  if(verifyRelease(task.next.directory).manifestHash!==task.next.manifestHash||verifyRelease(task.old.directory).manifestHash!==task.old.manifestHash)throw Error('Release changed after approval');updates.write('state',{phase:'applying',message:'Switching release and checking readiness.'});writeFileSync(pending,'pending',{mode:0o600});
  const selection=join(updates.folder,'installation/current.json');if(!existsSync(selection)||JSON.parse(readFileSync(selection,'utf8')).directory!==task.old.directory)await install(task.old.directory);
  selected=await install(task.next.directory);selected={...verifyRelease(selected.directory),source:task.next.source};launch(selected);await ready(selected);await startup(selected);
  updates.write('previous',task.old);updates.write('current',selected);updates.write('state',{phase:'applied',message:'Updated release passed readiness; previous version remains available.'});unlinkSync(pending);
 }catch{
  try{await stopCandidate();const restored=await install(task.old.directory);const old={...restored,version:task.old.version};launch(old);await ready(old);await startup(old);updates.write('state',{phase:'rolled-back',message:'Update failed readiness; previous release recovered. Account and history files were not restored or overwritten.'});if(existsSync(pending))unlinkSync(pending)}
  catch{updates.write('state',{phase:'failed',message:'Update recovery needs host attention. Account/history data were preserved; inspect service logs and the recorded release selection.'});process.exitCode=1}
 }
}
closeSync(lockFd);unlinkSync(lock);unlinkSync(file);
