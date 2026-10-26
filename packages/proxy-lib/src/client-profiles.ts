import { existsSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { CONFIG_DIR, atomicWritePrivate, getAvailableModels } from "@m365-copilot/core";
import { proxyApiKeys, type ApiKeyStore } from "./api-keys.js";
const model=z.string().max(96).refine(value=>getAvailableModels().includes(value),{message:"Choose a registered model ID"});
const state=z.object({version:z.literal(1),profiles:z.array(z.object({keyId:z.uuid(),defaultModel:model}).strict()).max(1000)}).strict();
export class ClientProfiles {
 readonly path:string;
 constructor(private directory=CONFIG_DIR){this.path=join(directory,"client-profiles.json")}
 private read(){try{return existsSync(this.path)?state.parse(JSON.parse(readFileSync(this.path,"utf8"))):{version:1 as const,profiles:[]}}catch{throw Error("Client profiles are unavailable; inspect the private profile configuration")}}
 snapshot(keys:ApiKeyStore=proxyApiKeys){const active=keys.status().keys.filter(key=>!key.revokedAt);const profiles=this.read().profiles;return {profiles:profiles.map(p=>({...p,label:active.find(k=>k.id===p.keyId)?.label??"Revoked or missing application",active:active.some(k=>k.id===p.keyId)})),keys:active,models:getAvailableModels()}}
 set(keyId:string,defaultModel:string|null,keys:ApiKeyStore=proxyApiKeys){
  z.uuid().parse(keyId);if(defaultModel!==null)model.parse(defaultModel);
  if(defaultModel!==null&&!keys.status().keys.some(k=>k.id===keyId&&!k.revokedAt))throw Error("Choose an active named application key");
  mkdirSync(this.directory,{recursive:true,mode:0o700});const lock=this.path+".lock",fd=openSync(lock,"wx",0o600);
  try{const current=this.read(),profiles=current.profiles.filter(p=>p.keyId!==keyId);if(defaultModel!==null)profiles.push({keyId,defaultModel});atomicWritePrivate(this.path,JSON.stringify(state.parse({version:1,profiles})))}finally{closeSync(fd);unlinkSync(lock)}
  return this.snapshot(keys);
 }
 apply(raw:unknown,headers:Headers,keys:ApiKeyStore=proxyApiKeys):unknown {
  if(!raw||typeof raw!=="object"||Array.isArray(raw)||("model" in raw&&raw.model!==undefined))return raw;
  const application=keys.authorize(headers).application;if(!application||application.id==="legacy")return raw;
  const profile=this.read().profiles.find(p=>p.keyId===application.id);return profile?{...raw,model:profile.defaultModel}:raw;
 }
}
export const clientProfiles=new ClientProfiles();
