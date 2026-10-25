import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { StorageHistory } from "./storage-history.js";
import { createApp } from "./index.js";
const hour=3600000, start=Date.parse("2026-10-20T12:00:00Z");
const folders:string[]=[];
const directory=()=>{const dir=mkdtempSync(join(tmpdir(),"m365-storage-history-"));folders.push(dir);return dir};
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();for(const dir of folders.splice(0))rmSync(dir,{recursive:true,force:true})});
const reading=(value=100,complete=true)=>({categories:{activity:{bytes:value,files:1},operations:{bytes:20,files:1},backups:{bytes:30,files:1},logs:{bytes:40,files:1}},totalBytes:value+90,complete,persistent:true,checkedAt:new Date(start).toISOString(),cacheSeconds:30,freeBytes:null,capacityBytes:null});
it("creates no files or samples just by construction/status and leaves memory-only instances uncollected",()=>{
 const dir=directory(),sample=vi.fn(()=>reading()),h=new StorageHistory(dir,()=>start,sample);
 expect(h.snapshot().points).toEqual([]);expect(h.summary().running).toBe(false);expect(existsSync(h.path)).toBe(false);expect(sample).not.toHaveBeenCalled();h.close();
 const memory=new StorageHistory(undefined,()=>start,sample);memory.start();memory.tick();expect(memory.summary()).toMatchObject({persistent:false,running:false,available:false});expect(sample).not.toHaveBeenCalled();memory.close();
});
it("samples once per UTC hour, persists restarts, leaves gaps and ignores clock rollback",()=>{
 const dir=directory();let now=start;const sample=vi.fn(()=>reading());const h=new StorageHistory(dir,()=>now,sample);h.tick();h.tick();now+=hour-1;h.tick();expect(sample).toHaveBeenCalledOnce();h.close();
 const next=new StorageHistory(dir,()=>now,sample);next.tick();expect(sample).toHaveBeenCalledOnce();now=start+5*hour;next.tick();expect(sample).toHaveBeenCalledTimes(2);
 now=start-hour;next.tick();expect(sample).toHaveBeenCalledTimes(2);now=start+6*hour;
 const s=next.snapshot();expect(s.total).toBe(2);expect(s.points.map(p=>Number(p.hour))).toEqual([start/hour,start/hour+5]);next.close();
});
it("deduplicates shared collectors and stops background sampling on close",async()=>{
 vi.useFakeTimers();vi.setSystemTime(start);const dir=directory(),read=vi.fn(()=>reading());
 const a=new StorageHistory(dir,()=>Date.now(),read),b=new StorageHistory(dir,()=>Date.now(),read);a.start();b.start();expect(read).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(hour);expect(read).toHaveBeenCalledTimes(2);expect(a.summary().total).toBe(2);a.close();b.close();await vi.advanceTimersByTimeAsync(hour);expect(read).toHaveBeenCalledTimes(2);
});
it("retains partial readings and unknown capacity without inventing measured changes, including shrinkage",()=>{
 let now=start, value=reading(100);const h=new StorageHistory(directory(),()=>now,()=>value);h.tick();
 now+=hour;value=reading(900,false);h.tick();expect(h.snapshot().change).toBeNull();
 now+=hour;value=reading(50);h.tick();const s=h.snapshot();expect(s).toMatchObject({totalInRange:3,completeInRange:2,change:{bytes:-50}});
 expect(s.points[1]).toMatchObject({complete:false,totalBytes:990,freeBytes:null});h.close();
});
it("bounds long-range queries, selects last readings per bucket and preserves all rows",()=>{
 let now=start;const dir=directory(),h=new StorageHistory(dir,()=>now,()=>reading());h.tick();
 const db=new DatabaseSync(h.path);db.exec('BEGIN');const insert=db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?,?,?,?)');
 for(let i=1;i<=2000;i++)insert.run(start/hour+i,start+i*hour,i,20,30,40,null,null,i%10?1:0);db.exec('COMMIT');
 now=start+2000*hour;
 for(const range of ['24h','7d','30d','90d','365d','all'] as const){const s=h.snapshot(range);expect(s.points.length).toBeLessThanOrEqual(240);expect(s.points.at(-1)?.hour).toBe(now/hour);expect(s.total).toBe(2001)}
 expect(h.snapshot('24h').totalInRange).toBe(25);now+=hour/2;expect(h.snapshot('24h').totalInRange).toBe(24);expect(db.prepare('SELECT COUNT(*) AS n FROM samples').get()!.n).toBe(2001);db.close();h.close();
});
it("excludes future points and reports corrupt/unsupported stores and sampling errors without private details",()=>{
 const dir=directory();let now=start;const h=new StorageHistory(dir,()=>now,()=>reading());h.tick();now=start-hour;expect(h.snapshot().points).toEqual([]);h.close();
 const db=new DatabaseSync(join(dir,'storage-history.sqlite'));db.exec('PRAGMA user_version=99');db.close();
 const bad=new StorageHistory(dir,()=>start);bad.tick();expect(bad.summary().error).toContain('unavailable');expect(JSON.stringify(bad.snapshot())).not.toContain(dir);bad.close();
 const failing=new StorageHistory(directory(),()=>start,()=>{throw Error('private host path')});failing.tick();expect(failing.summary().total).toBe(0);expect(JSON.stringify(failing.summary())).not.toContain('private host path');failing.close();
});
it("uses existing origin/key policy, validates queries and excludes history reads from activity",async()=>{
 vi.stubEnv('M365_API_KEY','fixture-key');const app=createApp();
 const get=(suffix='',headers={authorization:'Bearer fixture-key'})=>app.fetch(new Request('http://localhost/v1/proxy/storage-history'+suffix,{headers}));
 expect((await get('',{} as any)).status).toBe(401);
 expect((await get('',{authorization:'Bearer fixture-key',origin:'https://foreign.invalid'} as any)).status).toBe(403);
 for(const query of ['?range=bad','?other=24h','?range=7d&range=24h'])expect((await get(query)).status).toBe(400);
 const response=await get('?range=all');expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
 expect((await response.json()).persistent).toBe(false);
 const status=await(await app.fetch(new Request('http://localhost/v1/proxy/status',{headers:{authorization:'Bearer fixture-key'}}))).json();expect(status.activity.total).toBe(0);app.close();
});
