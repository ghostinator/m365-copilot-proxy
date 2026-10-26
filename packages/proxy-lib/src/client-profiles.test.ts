import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { join } from "node:path";import { tmpdir } from "node:os";
import { afterEach,expect,it,vi } from "vitest";
import { ClientProfiles } from "./client-profiles.js";import { ApiKeyStore } from "./api-keys.js";
const dirs:string[]=[];afterEach(()=>{vi.unstubAllEnvs();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})});
function fixture(){vi.stubEnv('M365_API_KEY','');const dir=mkdtempSync(join(tmpdir(),'m365-profile-'));dirs.push(dir);return {profiles:new ClientProfiles(dir),keys:new ApiKeyStore(dir)}}
it('applies a named default only to omitted models, preserving explicit selection, keyless access and metadata privacy',()=>{
 const {profiles,keys}=fixture(),key=keys.create('Test application');profiles.set(key.id,'claude-sonnet',keys);const headers=new Headers({authorization:'Bearer '+key.token});
 const raw={messages:[{role:'user',content:'test'}]};expect(profiles.apply(raw,headers,keys)).toMatchObject({model:'claude-sonnet'});expect(raw).not.toHaveProperty('model');
 expect(profiles.apply({...raw,model:'gpt-5.5'},headers,keys)).toMatchObject({model:'gpt-5.5'});expect(profiles.apply({...raw,model:null},headers,keys)).toMatchObject({model:null});
 expect(profiles.apply(raw,new Headers(),keys)).toBe(raw);expect(keys.status().required).toBe(false);expect(readFileSync(profiles.path,'utf8')).not.toContain(key.token);
 keys.revoke(key.id);expect(profiles.apply(raw,headers,keys)).toBe(raw);expect(profiles.snapshot(keys).profiles[0].active).toBe(false);
});
it('validates key/model, persists removal and leaves configuration intact on invalid edits',()=>{
 const {profiles,keys}=fixture(),key=keys.create('Test');profiles.set(key.id,'claude-sonnet',keys);const original=readFileSync(profiles.path,'utf8');
 expect(()=>profiles.set(key.id,'invented-model',keys)).toThrow();expect(readFileSync(profiles.path,'utf8')).toBe(original);
 expect(()=>profiles.set('invalid','claude-sonnet',keys)).toThrow();profiles.set(key.id,null,keys);expect(profiles.snapshot(keys).profiles).toEqual([]);
});
