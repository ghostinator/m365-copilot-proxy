import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { BackupScheduler } from "./backup-scheduler.js";
const result={version:1 as const,id:"12345678-1234-4234-8234-123456789abc",createdAt:"2026-10-25T00:00:00.000Z",bytes:4096,sha256:"a".repeat(64),schema:5 as const,requests:2,modelReports:0,verified:true as const};
function fixture(){const dir=mkdtempSync(join(tmpdir(),"m365-schedule-"));let now=100_000;const create=vi.fn(async()=>result),scheduler=new BackupScheduler(dir,create,()=>now);return{dir,create,scheduler,at:(time:number)=>now=time}}
it("is disabled and creates no files or backups until explicitly configured",async()=>{
 const f=fixture();f.scheduler.start();await f.scheduler.pump();expect(f.scheduler.summary().settings.enabled).toBe(false);expect(existsSync(f.scheduler.path)).toBe(false);expect(f.create).not.toHaveBeenCalled();await f.scheduler.close();
});
it("runs only after a full interval, verifies once, and retains history across restart without replay",async()=>{
 const f=fixture();const state=f.scheduler.configure({enabled:true,intervalHours:1});expect(state.nextAt).toBe(new Date(3_700_000).toISOString());await f.scheduler.pump();expect(f.create).not.toHaveBeenCalled();
 f.at(3_700_000);await f.scheduler.pump();await f.scheduler.pump();expect(f.create).toHaveBeenCalledTimes(1);expect(f.scheduler.snapshot().runs[0]).toMatchObject({status:"succeeded",backup_id:result.id,bytes:4096});await f.scheduler.close();
 const second=new BackupScheduler(f.dir,f.create,()=>7_300_000);await second.pump();expect(f.create).toHaveBeenCalledTimes(2);expect(second.snapshot().total).toBe(2);await second.close();
});
it("performs one overdue run after long downtime and preserves due time on unchanged save",async()=>{
 const f=fixture();f.scheduler.configure({enabled:true,intervalHours:1});f.at(200_000);expect(f.scheduler.configure({enabled:true,intervalHours:1}).nextAt).toBe(new Date(3_700_000).toISOString());
 f.at(30*24*3600_000);await f.scheduler.pump();await f.scheduler.pump();expect(f.create).toHaveBeenCalledTimes(1);expect(f.scheduler.snapshot().nextAt).toBe(new Date(30*24*3600_000+3600_000).toISOString());await f.scheduler.close();
});
it("records sanitized failures and waits for the next interval rather than retrying on every tick",async()=>{
 const f=fixture();f.create.mockRejectedValue(new Error("C:/private-host secret-token"));f.scheduler.configure({enabled:true,intervalHours:1});f.at(3_700_000);await f.scheduler.pump();for(let i=0;i<5;i++)await f.scheduler.pump();
 expect(f.create).toHaveBeenCalledTimes(1);expect(f.scheduler.snapshot().runs[0].status).toBe("failed");expect(JSON.stringify(f.scheduler.snapshot())).not.toMatch(/private-host|secret-token/);await f.scheduler.close();
});
it("does not overlap instances, lets a running backup finish after disable, and drains on close",async()=>{
 const f=fixture();let finish!:(r:typeof result)=>void;f.create.mockImplementation(()=>new Promise(resolve=>finish=resolve));f.scheduler.configure({enabled:true,intervalHours:1});f.at(3_700_000);const pending=f.scheduler.pump();
 const second=new BackupScheduler(f.dir,f.create,()=>3_700_001);await second.pump();expect(f.create).toHaveBeenCalledTimes(1);f.scheduler.configure({enabled:false,intervalHours:1});let closed=false;const closing=f.scheduler.close().then(()=>closed=true);await Promise.resolve();expect(closed).toBe(false);
 finish(result);await pending;await closing;expect(second.snapshot().settings.enabled).toBe(false);expect(second.snapshot().nextAt).toBeNull();expect(second.snapshot().runs[0].status).toBe("succeeded");await second.close();
});
it("marks expired leases interrupted and fences a late completion without deleting backups or locks",async()=>{
 const f=fixture();let finish!:(r:typeof result)=>void;f.create.mockImplementation(()=>new Promise(resolve=>finish=resolve));f.scheduler.configure({enabled:true,intervalHours:1});f.at(3_700_000);const pending=f.scheduler.pump();
 const second=new BackupScheduler(f.dir,vi.fn(async()=>result),()=>4_600_001);await second.pump();expect(second.snapshot().runs[0].status).toBe("interrupted");finish(result);await pending;expect(second.snapshot().runs[0].status).toBe("interrupted");await f.scheduler.close();await second.close();
});
it("validates settings, supports paging, and fails closed on unsupported storage",async()=>{
 const f=fixture();expect(()=>f.scheduler.configure({enabled:true,intervalHours:2} as any)).toThrow();expect(()=>new BackupScheduler(undefined,f.create).configure({enabled:true,intervalHours:1})).toThrow();
 f.scheduler.configure({enabled:true,intervalHours:1});for(let i=1;i<=21;i++){f.at(100_000+i*3600_000);await f.scheduler.pump()}expect(f.scheduler.snapshot().runs).toHaveLength(20);expect(f.scheduler.snapshot(20).runs).toHaveLength(1);await f.scheduler.close();
 const db=new DatabaseSync(join(f.dir,"backup-schedule.sqlite"));db.exec("PRAGMA user_version=99");db.close();const second=new BackupScheduler(f.dir,f.create);await second.pump();expect(second.summary().error).toContain("unavailable");await second.close();
});
