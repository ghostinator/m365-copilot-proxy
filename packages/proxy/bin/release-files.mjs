import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve, sep } from "node:path";
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const versionPattern=/^\d+\.\d+\.\d+$/;
export function releasePath(root,name){
  if(typeof name!=='string'||!name||/[\\:\x00-\x1f<>"|?*]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('Unsafe release path');
  const path=resolve(root,name);if(!path.startsWith(resolve(root)+sep))throw Error('Release path escapes root');return path;
}
export function verifyRelease(root,platform=process.platform,arch=process.arch){
  if(lstatSync(root).isSymbolicLink())throw Error('Linked releases are not supported');
  const text=readFileSync(join(root,'manifest.json'),'utf8');if(text.length>2000000)throw Error('Manifest too large');
  const m=JSON.parse(text);if(!versionPattern.test(m.version)||m.platform!==platform||m.architecture!==arch||m.bundledNode!==true||m.stateCompatibility!==1||!Array.isArray(m.files)||!m.files.length||m.files.length>5000)throw Error('Incompatible release manifest');
  const expected=new Set(['manifest.json']);let total=0;
  for(const f of m.files){const p=releasePath(root,f.path),key=f.path.toLowerCase();if(expected.has(key)||!/^[0-9a-f]{64}$/.test(f.sha256))throw Error('Invalid or duplicate manifest entry');expected.add(key);
    const stat=lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>200000000||(total+=stat.size)>750000000)throw Error('Unsupported release file');if(sha(readFileSync(p))!==f.sha256)throw Error('Release checksum mismatch');}
  let count=0;function walk(folder,prefix=''){for(const e of readdirSync(folder,{withFileTypes:true})){const name=prefix+e.name;if(e.isSymbolicLink())throw Error('Linked release entry');if(e.isDirectory())walk(join(folder,e.name),name+'/');else if(!e.isFile()||!expected.has(name.toLowerCase()))throw Error('Unverified release file');else count++;}}
  walk(root);if(count!==expected.size)throw Error('Release entries changed');
  for(const required of ['bin/m365-proxy.mjs','.output/server/index.mjs','.output/server/runtime.mjs',platform==='win32'?'node.exe':'node'])if(!expected.has(required))throw Error('Release runtime missing');
  return {version:m.version,manifestHash:sha(text),directory:resolve(root),node:join(resolve(root),platform==='win32'?'node.exe':'node')};
}
