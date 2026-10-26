import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';import {createHash} from 'node:crypto';
import {linuxService} from '../../proxy/bin/linux-service.mjs';import {releasePath,verifyRelease} from '../../proxy/bin/release-files.mjs';
import { Updates } from '../../proxy/bin/updates.mjs';
const dirs:string[]=[];const dir=()=>{const p=mkdtempSync(join(tmpdir(),'m365-maintenance-'));dirs.push(p);return p};afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true})});
it('generates private per-data-directory systemd units with escaped arguments, bounded retries and auth-failure suppression',async()=>{
 const root=dir(),data=join(root,'data % dollar$'),launcher=join(root,'app','bin.mjs');mkdirSync(join(root,'app'));writeFileSync(launcher,'');
 const run=vi.fn(async(_file:string,_args:string[],_options:import('node:child_process').ExecFileOptions)=>({stdout:'LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled\nMainPID=0\nExecMainStatus=0'}));
 const service=linuxService({dataDir:data,launcher,configHome:join(root,'config'),run}),render=await service.command('render');
 expect(render.text).toContain('data %% dollar$');expect(render.text).toContain('RestartPreventExitStatus=78');expect(render.text).toContain('UMask=0077');expect(render.text).toContain('TimeoutStopSec=120');
 const installed=await service.command('install');expect(installed.enabled).toBe(true);const env=readFileSync(join(data,'service.env'),'utf8');expect(env).not.toMatch(/password|m365_admin_/i);
 await service.command('disable');expect(run.mock.calls.some(c=>c[1].includes('--now'))).toBe(false);
 await service.command('uninstall');expect(readFileSync(join(data,'service.env'),'utf8')).toBe(env);
});
it('rejects path traversal, duplicate manifest entries and incompatible releases before execution',()=>{
 const root=dir();for(const name of ['../bad','a/../../bad','C:/bad','a\\bad','con.txt','a:stream','a//b','a/../b'])expect(()=>releasePath(root,name)).toThrow();
 const files=['bin/m365-proxy.mjs','.output/server/index.mjs','.output/server/runtime.mjs',process.platform==='win32'?'node.exe':'node'].map(path=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),'fixture');return {path,sha256:createHash('sha256').update('fixture').digest('hex')}});
 const manifest={version:'0.24.0',platform:process.platform,architecture:process.arch,bundledNode:true,stateCompatibility:1,files};writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest));expect(verifyRelease(root).version).toBe('0.24.0');
 writeFileSync(join(root,files[0].path),'corrupt');expect(()=>verifyRelease(root)).toThrow('checksum');writeFileSync(join(root,files[0].path),'fixture');
 writeFileSync(join(root,'manifest.json'),JSON.stringify({...manifest,files:[...files,files[0]]}));expect(()=>verifyRelease(root)).toThrow('duplicate');
 writeFileSync(join(root,'manifest.json'),JSON.stringify({...manifest,stateCompatibility:2}));expect(()=>verifyRelease(root)).toThrow('Incompatible');
});

it('checks releases only on request and refuses untrusted redirects, oversized responses and prereleases', async () => {
 const root=dir(),data=join(root,'private'),updates=new Updates({root,dataDir:data,version:'0.24.0'});
 const fetcher=vi.spyOn(globalThis,'fetch');
 try {
  updates.status();expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(Response.json({tag_name:'v0.24.1',body:'Release notes',draft:false,prerelease:false}));
  expect((await updates.check()).latest?.version).toBe('0.24.1');expect(updates.status().currentVersion).toBe('0.24.0');
  await expect(updates.response('http://api.github.com/unsafe',100)).rejects.toThrow('Untrusted');
  fetcher.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://private.example/secret'}}));
  await expect(updates.response('https://github.com/example',100)).rejects.toThrow('Untrusted');
  fetcher.mockResolvedValueOnce(new Response('oversized'));
  await expect(updates.response('https://api.github.com/example',4)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(Response.json({tag_name:'v0.24.2',draft:false,prerelease:true}));
  await expect(updates.check()).rejects.toThrow('published stable');
  expect(updates.status().latest?.version).toBe('0.24.1');
  fetcher.mockResolvedValueOnce(new Response(null,{status:404}));
  await updates.command('update-stage','v0.24.2');await updates.work;
  expect(updates.status().phase).toBe('failed');
 } finally {fetcher.mockRestore()}
});
