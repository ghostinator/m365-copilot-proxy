import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, openSync, closeSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { HistoryBackups } from "./history-backups.js";
export const backupScheduleSettings = z.object({ enabled: z.boolean(), intervalHours: z.union([z.literal(1),z.literal(6),z.literal(12),z.literal(24),z.literal(168)]) }).strict();
type Settings = z.infer<typeof backupScheduleSettings>;
const defaults: Settings = { enabled: false, intervalHours: 24 };
const failure = "Scheduled backup failed. Check disk space, database access and backup/maintenance locks; existing backups were preserved.";
/** Persisted interval scheduling; no model calls, deletion or network destinations. */
export class BackupScheduler {
  private db?: DatabaseSync; private timer?: ReturnType<typeof setInterval>; private work?: Promise<void>; private closed = false; private error: string | null = null;
  readonly path: string;
  constructor(private directory: string | undefined, private create: () => ReturnType<HistoryBackups["create"]>, private now = () => Date.now()) { this.path = directory ? join(directory,"backup-schedule.sqlite") : ":memory:"; }
  private exists() { return !!this.db || !!this.directory && existsSync(this.path); }
  private open() {
    if(this.closed&&!this.work)throw Error("Backup scheduler is closed");
    if (this.db) return this.db;
    if (!this.directory) throw Error("Persistent storage is required for scheduled backups");
    mkdirSync(this.directory,{recursive:true,mode:0o700}); if(!existsSync(this.path))closeSync(openSync(this.path,"wx",0o600)); if(process.platform!=="win32")chmodSync(this.path,0o600);
    const db=new DatabaseSync(this.path);
    try {
      db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      if(Number(db.prepare("PRAGMA user_version").get()!.user_version)>1)throw Error("Unsupported backup schedule");
      db.exec(`CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,hours INTEGER NOT NULL,revision INTEGER NOT NULL,next_ms INTEGER,claim TEXT,lease_until INTEGER);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,started_ms INTEGER NOT NULL,finished_ms INTEGER,status TEXT NOT NULL,backup_id TEXT,bytes INTEGER,error TEXT);
        CREATE INDEX IF NOT EXISTS backup_runs_recent ON runs(started_ms DESC,id);
        INSERT OR IGNORE INTO settings VALUES(1,0,24,0,NULL,NULL,NULL); PRAGMA user_version=1;`);
      this.db=db; return db;
    } catch(error) { db.close(); throw error; }
  }
  private transaction<T>(run:(db:DatabaseSync)=>T):T {const db=this.open();db.exec("BEGIN IMMEDIATE");try{const result=run(db);db.exec("COMMIT");return result}catch(error){db.exec("ROLLBACK");throw error}}
  configure(input: Settings) {
    if(this.closed)throw Error("Backup scheduler is closed"); const value=backupScheduleSettings.parse(input);
    this.transaction(db=>{const old=db.prepare("SELECT * FROM settings WHERE id=1").get()!;
      if(!!old.enabled===value.enabled&&Number(old.hours)===value.intervalHours)return;
      db.prepare("UPDATE settings SET enabled=?,hours=?,revision=revision+1,next_ms=? WHERE id=1").run(Number(value.enabled),value.intervalHours,value.enabled?this.now()+value.intervalHours*3600_000:null);
    }); return this.snapshot();
  }
  start(){if(this.closed||this.timer)return;this.timer=setInterval(()=>{void this.pump()},30_000);this.timer.unref();void this.pump()}
  pump():Promise<void>{
    if(this.closed||this.work||!this.exists())return this.work??Promise.resolve();
    this.work=this.run().catch(()=>{this.error="Backup scheduling is unavailable. Inspect the private schedule database and host storage."}).finally(()=>{this.work=undefined;if(this.closed){this.db?.close();this.db=undefined}});
    return this.work;
  }
  private async run(){
    const job=this.transaction(db=>{
      const state=db.prepare("SELECT * FROM settings WHERE id=1").get()!,now=this.now();
      backupScheduleSettings.parse({enabled:!!state.enabled,intervalHours:Number(state.hours)});
      if(state.claim&&Number(state.lease_until)>now)return null;
      if(state.claim){db.prepare("UPDATE runs SET status='interrupted',finished_ms=?,error='Backup process ended before its result was recorded; inspect backup inventory and locks.' WHERE id=? AND status='running'").run(now,state.claim);db.prepare("UPDATE settings SET claim=NULL,lease_until=NULL WHERE id=1").run()}
      if(!state.enabled||state.next_ms==null||Number(state.next_ms)>now)return null;
      const id=randomUUID();db.prepare("INSERT INTO runs(id,started_ms,status) VALUES(?,?,'running')").run(id,now);
      db.prepare("UPDATE settings SET claim=?,lease_until=?,next_ms=? WHERE id=1").run(id,now+900_000,now+Number(state.hours)*3600_000);
      return {id,revision:Number(state.revision),hours:Number(state.hours)};
    });
    this.error=null;if(!job)return;
    const heartbeat=setInterval(()=>{try{this.open().prepare("UPDATE settings SET lease_until=? WHERE id=1 AND claim=?").run(this.now()+900_000,job.id)}catch{this.error="Backup scheduler lease could not be renewed. Inspect host storage."}},30_000);heartbeat.unref();
    let result:Awaited<ReturnType<HistoryBackups["create"]>>|undefined;
    try{result=await this.create()}catch{ /* Fixed diagnostic below never includes host paths or account data. */ }
    finally{clearInterval(heartbeat)}
    this.transaction(db=>{
      const state=db.prepare("SELECT * FROM settings WHERE id=1").get()!;if(state.claim!==job.id)return;
      db.prepare("UPDATE runs SET status=?,finished_ms=?,backup_id=?,bytes=?,error=? WHERE id=? AND status='running'").run(result?"succeeded":"failed",this.now(),result?.id??null,result?.bytes??null,result?null:failure,job.id);
      db.prepare("UPDATE settings SET claim=NULL,lease_until=NULL,next_ms=? WHERE id=1").run(Number(state.revision)===job.revision&&state.enabled?this.now()+job.hours*3600_000:state.next_ms);
    });
  }
  snapshot(offset=0){
    if(!this.exists())return {available:!!this.directory,settings:{...defaults},nextAt:null,inProgress:false,running:!!this.timer,lastRun:null,runs:[],total:0,offset:0,limit:20,error:this.error,retention:"unlimited"};
    const db=this.open(),state=db.prepare("SELECT * FROM settings WHERE id=1").get()!,total=Number(db.prepare("SELECT count(*) n FROM runs").get()!.n);
    offset=Math.min(Math.max(0,offset),Math.max(0,Math.ceil(total/20)-1)*20);
    const rows=db.prepare("SELECT id,started_ms,finished_ms,status,backup_id,bytes,error FROM runs ORDER BY started_ms DESC,id LIMIT 20 OFFSET ?").all(offset);
    return {available:true,settings:backupScheduleSettings.parse({enabled:!!state.enabled,intervalHours:Number(state.hours)}),nextAt:state.enabled&&state.next_ms!=null?new Date(Number(state.next_ms)).toISOString():null,inProgress:!!state.claim,running:!!this.timer,lastRun:db.prepare("SELECT status,started_ms,finished_ms FROM runs ORDER BY started_ms DESC,id LIMIT 1").get()??null,runs:rows,total,offset,limit:20,error:this.error,retention:"unlimited"};
  }
  summary(){const backupLocked=!!this.directory&&existsSync(join(this.directory,"history-backups.lock"));try{const {runs:_runs,...s}=this.snapshot();return {...s,backupLocked}}catch{return {available:false,error:"Backup scheduling status unavailable.",settings:{...defaults},inProgress:false,backupLocked,running:!!this.timer}}}
  async close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.work;this.db?.close();this.db=undefined}
}
