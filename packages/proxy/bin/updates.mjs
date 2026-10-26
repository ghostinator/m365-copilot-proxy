import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyRelease, sha, versionPattern } from "./release-files.mjs";
const execute=promisify(execFile);
export function privateJson(path,value){const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,path)}
export class Updates {
 constructor({root,dataDir,version}){this.root=root;this.data=dataDir;this.version=version;this.folder=join(dataDir,'updates');this.work=null;}
 read(name,fallback=null){const p=join(this.folder,name+'.json');return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):fallback}
 write(name,value){mkdirSync(this.folder,{recursive:true,mode:0o700});privateJson(join(this.folder,name+'.json'),value)}
 repository(){const repo=this.read('source',{repository:'ghostinator/m365-copilot-proxy'}).repository;if(typeof repo!=='string'||!/^[-a-zA-Z0-9_]+\/[-a-zA-Z0-9_.]+$/.test(repo))throw Error('Invalid update repository');return repo}
 status(){const state=this.read('state',{}),stage=this.read('staged');return {supported:process.platform==='win32',repository:this.repository(),currentVersion:this.version,phase:state.phase||'idle',message:state.message||'',latest:this.read('latest'),staged:stage?{version:stage.version,source:stage.source}:null,rollbackAvailable:!!this.read('previous')};}
 async response(url,max){let response;for(let i=0;i<5;i++){const u=new URL(url);if(u.protocol!=='https:'||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname)||u.username||u.password)throw Error('Untrusted release URL');response=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(120000),headers:{'User-Agent':'m365-copilot-proxy-updater','Accept':'application/vnd.github+json'}});if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),u).href;continue}if(!response.ok)throw Error('Release request failed (HTTP '+response.status+')');let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>max){await response.body.cancel().catch(()=>{});throw Error('Release response too large')}parts.push(chunk)}return Buffer.concat(parts)}throw Error('Too many release redirects')}
 async release(tag){if(tag&&!/^v?\d+\.\d+\.\d+$/.test(tag))throw Error('Use a stable version tag');const repo=this.repository();const release=JSON.parse((await this.response('https://api.github.com/repos/'+repo+'/releases/'+(tag?'tags/'+encodeURIComponent(tag):'latest'),2000000)).toString());if(release.draft||release.prerelease||!versionPattern.test(String(release.tag_name).replace(/^v/,'')))throw Error('Choose a published stable release');return release}
 async check(){const r=await this.release();this.write('latest',{version:r.tag_name.replace(/^v/,''),tag:r.tag_name,notes:String(r.body||'').slice(0,12000),checkedAt:new Date().toISOString()});return this.status()}
 async locked(task){mkdirSync(this.folder,{recursive:true,mode:0o700});const lock=join(this.folder,'operation.lock');const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));try{return await task()}finally{closeSync(fd);unlinkSync(lock)}}
 async stageLocal(source,origin='local',held=false){
  const work=async()=>{this.write('state',{phase:'staging'});try{
   const verified=verifyRelease(resolve(source));const target=join(this.folder,'releases',verified.version+'-'+verified.manifestHash.slice(0,16));
   if(!existsSync(target)){mkdirSync(join(this.folder,'releases'),{recursive:true,mode:0o700});cpSync(source,target,{recursive:true,dereference:false,errorOnExist:true,force:false})}
   const candidate=verifyRelease(target);await execute(candidate.node,[join(target,'bin/m365-proxy.mjs'),'--help'],{timeout:30000,windowsHide:true,maxBuffer:65536});
   this.write('staged',{...candidate,source:origin});this.write('state',{phase:'staged',message:'Verified release staged. Apply is a separate action.'});return this.status();
  }catch{this.write('state',{phase:'failed',message:'Staging failed. Check the release, compatibility, storage and update lock; the running version was preserved.'});throw Error('Release could not be staged')}};return held?work():this.locked(work);
 }
 async stage(tag){
  if(process.platform!=='win32')throw Error('Automatic archive updates currently support Windows; Linux uses extracted portable releases');
  return this.locked(async()=>{const release=await this.release(tag),version=release.tag_name.replace(/^v/,''),repo=this.repository();
  const archives=release.assets.filter(a=>a.name.startsWith('m365-proxy-'+version+'-win32-'+process.arch+'-')&&a.name.endsWith('.zip'));
  if(archives.length!==1)throw Error('No unique Windows archive for this architecture');const asset=archives[0];
  const checksum=release.assets.find(a=>a.name===asset.name+'.sha256');if(!checksum||!Number.isSafeInteger(asset.size)||asset.size>250000000)throw Error('Release archive/checksum unavailable');
  for(const a of [asset,checksum])if(!a.browser_download_url.startsWith('https://github.com/'+repo+'/releases/download/'+encodeURIComponent(release.tag_name)+'/')||!/^[-a-zA-Z0-9._]+$/.test(a.name))throw Error('Asset is outside the trusted repository');
  this.write('state',{phase:'downloading',message:'Downloading explicitly requested release.'});
  try{
   const expected=(await this.response(checksum.browser_download_url,2048)).toString().trim();const match=expected.match(/^([0-9a-f]{64})[ \t]+([^\r\n]+)$/i);if(!match||match[2]!==asset.name)throw Error('Invalid archive checksum');
   const bytes=await this.response(asset.browser_download_url,250000000);if(bytes.length!==asset.size||sha(bytes)!==match[1].toLowerCase())throw Error('Archive checksum mismatch');
   const downloads=join(this.folder,'downloads');mkdirSync(downloads,{recursive:true,mode:0o700});const zip=join(downloads,randomUUID()+'.zip'),extracted=zip+'.files';writeFileSync(zip,bytes,{mode:0o600});
   await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(this.root,'windows/ExpandRelease.ps1'),'-Archive',zip,'-Target',extracted],{timeout:120000,windowsHide:true,maxBuffer:65536});
   return await this.stageLocal(extracted,repo,true);
  }catch{this.write('state',{phase:'failed',message:'Download/staging failed. Nothing was installed. Check published assets, checksums, storage and host logs.'});throw Error('Download/staging failed')}});
 }
 prepare(action){if(process.platform!=='win32')throw Error('Managed activation currently supports Windows');if(this.work||existsSync(join(this.folder,'operation.lock'))||this.read('state',{}).phase==='applying')throw Error('Wait for the current update operation to finish');verifyRelease(this.root);
  const next=this.read(action==='update-rollback'?'previous':'staged');if(!next)throw Error('No verified release is selected');
  const verified=verifyRelease(next.directory);if(verified.manifestHash!==next.manifestHash)throw Error('Staged release changed');if(next.source&&next.source!=='local'&&next.source!==this.repository())throw Error('Update source changed; stage again');return next;
 }
 async command(action,tag){if(action==='update-status')return this.status();if(action==='update-check')return this.check();if(action==='update-stage'){if(this.work)throw Error('Staging is already running');this.write('state',{phase:'downloading',message:'Fetching explicitly requested release metadata.'});this.work=this.stage(tag).catch(()=>{this.write('state',{phase:'failed',message:'Release staging failed. Check published platform assets, source, network and host storage; nothing was installed.'})}).finally(()=>{this.work=null});return this.status()}throw Error('Unknown update command')}
}
