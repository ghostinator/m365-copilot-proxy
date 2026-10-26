import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile);
export function linuxService({dataDir,launcher,node=process.execPath,configHome=process.env.XDG_CONFIG_HOME||join(homedir(),".config"),run=execute}) {
  dataDir=resolve(dataDir);launcher=resolve(launcher);node=resolve(node);
  const unit="m365-copilot-proxy-"+createHash("sha256").update(dataDir).digest("hex").slice(0,12)+".service";
  const path=join(configHome,"systemd/user",unit),environment=join(dataDir,"service.env");
  const quote=(value,exec=false)=>{if(/[\x00-\x1f\x7f]/.test(value))throw Error("Control characters are not supported in service paths");return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$',exec?'$$':'$')+'"'};
  const text=`# Managed by m365-proxy; account data is never removed.
[Unit]
Description=M365 Copilot Proxy
After=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=simple
ExecStart=${quote(node,true)} ${quote(launcher,true)} serve
Environment=${quote('M365_DATA_DIR='+dataDir)}
Environment=M365_NO_INTERACTIVE=1
EnvironmentFile=-${quote(environment)}
UMask=0077
NoNewPrivileges=yes
Restart=on-failure
RestartPreventExitStatus=78
RestartSec=10
TimeoutStopSec=120
StandardOutput=journal
StandardError=journal
LogRateLimitIntervalSec=30s
LogRateLimitBurst=200

[Install]
WantedBy=default.target
`;
  const ctl=async(...args)=>{try{return await run('systemctl',['--user',...args],{timeout:150000,maxBuffer:65536,env:process.env})}catch{throw Error('User systemd operation failed. Run systemctl --user status '+unit+' and check the user session bus. No account data was removed.')}};
  async function status(){
    if(!existsSync(path))return {supported:true,installed:false,enabled:false,state:'not-installed',unit};
    const {stdout}=await ctl('show',unit,'--property=LoadState,ActiveState,UnitFileState,MainPID,ExecMainStatus');
    const properties=Object.fromEntries(stdout.trim().split('\n').map(line=>line.split('=')));
    return {supported:true,installed:properties.LoadState==='loaded',enabled:['enabled','enabled-runtime'].includes(properties.UnitFileState),state:properties.ActiveState,pid:Number(properties.MainPID||0),exitCode:Number(properties.ExecMainStatus||0),unit};
  }
  async function command(action){
    if(action==='render')return {unit,path,environment,text};
    if(action==='status'||action==='inspect')return status();
    if(action==='install'){
      if(!existsSync(launcher)||!existsSync(node))throw Error('Service launcher/runtime missing; extract a portable release first');
      mkdirSync(dirname(path),{recursive:true,mode:0o700});mkdirSync(dataDir,{recursive:true,mode:0o700});
      if(existsSync(path)&&!readFileSync(path,'utf8').startsWith('# Managed by m365-proxy;'))throw Error('Refusing to replace an unmanaged user unit');
      writeFileSync(path,text,{mode:0o600});chmodSync(path,0o600);
      if(!existsSync(environment))writeFileSync(environment,'# Optional private KEY=value settings; do not put secrets in the unit.\n',{mode:0o600});
      chmodSync(environment,0o600);await ctl('daemon-reload');await ctl('enable',unit);return status();
    }
    if(!['start','stop','disable','uninstall'].includes(action))throw Error('Unknown Linux service command');
    if(!existsSync(path))throw Error('The user service is not installed');
    if(action==='uninstall'){
      if(!readFileSync(path,'utf8').startsWith('# Managed by m365-proxy;'))throw Error('Refusing to remove an unmanaged user unit');
      await ctl('disable','--now',unit);unlinkSync(path);await ctl('daemon-reload');return {removed:true,accountDataPreserved:true};
    }
    await ctl(action,unit);
    if(action==='start'){
      const config=existsSync(join(dataDir,'server.json'))?JSON.parse(readFileSync(join(dataDir,'server.json'),'utf8')):{};
      let host=config.host||'127.0.0.1';if(['0.0.0.0','::'].includes(host))host='127.0.0.1';const base='http://'+(host.includes(':')?'['+host+']':host)+':'+(config.port||4141);
      for(let i=0;i<120;i++){const current=await status();if(current.state==='failed'||current.exitCode===78)throw Error('User service failed startup; inspect journalctl --user -u '+unit+' and recover sign-in on the host');
        try{const instance=JSON.parse(readFileSync(join(dataDir,'instance.json'),'utf8'));if(instance.pid===current.pid&&instance.launcher===launcher){let address=instance.host||host;if(['0.0.0.0','::'].includes(address))address='127.0.0.1';const endpoint=instance.port?'http://'+(address.includes(':')?'['+address+']':address)+':'+instance.port:base;const response=await fetch(endpoint+'/health/ready',{headers:{'X-M365-Check':'1'},signal:AbortSignal.timeout(1000)});if(response.status===200)return {...current,ready:true}}}catch{}
        await new Promise(r=>setTimeout(r,500));}
      throw Error('User service did not become ready; inspect its journal and sign-in configuration');
    }
    return status();
  }
  return {command,status,unit};
}
