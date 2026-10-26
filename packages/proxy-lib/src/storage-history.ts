import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, openSync, closeSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { filesystemCapacity, StorageFootprint } from "./storage-footprint.js";
const hour = 3600000;
const windows = { "24h":24, "7d":168, "30d":720, "90d":2160, "365d":8760 };
export const storageHistoryRange = z.enum(["24h","7d","30d","90d","365d","all"]);
type Range = z.infer<typeof storageHistoryRange>;
type StoragePoint = { hour: number; at: number; activityBytes: number; operationsBytes: number; backupsBytes: number; logsBytes: number; freeBytes: number | null; capacityBytes: number | null; totalBytes: number };
type Reading = ReturnType<StorageFootprint["snapshot"]> & ReturnType<typeof filesystemCapacity>;
const bytes = z.number().int().nonnegative();
const readingSchema = z.object({ activity:bytes, operations:bytes, backups:bytes, logs:bytes, free:bytes.nullable(), capacity:bytes.nullable(), complete:z.boolean() });
const failure = "Storage history is unavailable. Check its database, permissions and available disk space.";
/** One numeric-only snapshot per UTC hour; no model calls or automatic deletion. */
export class StorageHistory {
  readonly path: string;
  private db?: DatabaseSync;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private error: string | null = null;
  private inventory: StorageFootprint;
  constructor(private directory?: string, private now = () => Date.now(), private read?: () => Reading) {
    this.path=directory?join(directory,"storage-history.sqlite"):":memory:";
    this.inventory=new StorageFootprint(directory,now);
  }
  private open() {
    if(this.closed)throw Error("Storage history is closed");
    if(this.db)return this.db;
    if(!this.directory)throw Error("Persistent storage is required");
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    if(!existsSync(this.path))closeSync(openSync(this.path,"wx",0o600));
    if(process.platform!=="win32")chmodSync(this.path,0o600);
    const db=new DatabaseSync(this.path);
    try {
      db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
      if(Number(db.prepare("PRAGMA user_version").get()!.user_version)>1)throw Error("Unsupported storage history schema");
      db.exec(`CREATE TABLE IF NOT EXISTS samples(hour INTEGER PRIMARY KEY,at_ms INTEGER NOT NULL,
        activity INTEGER NOT NULL,operations INTEGER NOT NULL,backups INTEGER NOT NULL,logs INTEGER NOT NULL,
        free INTEGER,capacity INTEGER,complete INTEGER NOT NULL);PRAGMA user_version=1;`);
      this.db=db;return db;
    }catch(error){db.close();throw error}
  }
  start(){if(this.closed||this.timer||!this.directory)return;this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();this.tick()}
  tick(){
    if(this.closed||!this.directory)return;
    try {
      const db=this.open(),now=this.now(),slot=Math.floor(now/hour);
      const last=db.prepare("SELECT MAX(hour) AS h FROM samples").get()!.h;
      if(last!=null&&Number(last)>=slot){this.error=null;return}
      const f=this.read?this.read():{...this.inventory.snapshot(),...filesystemCapacity(this.directory)};
      const r=readingSchema.parse({activity:f.categories.activity.bytes,operations:f.categories.operations.bytes,
        backups:f.categories.backups.bytes,logs:f.categories.logs.bytes,free:f.freeBytes,capacity:f.capacityBytes,complete:f.complete});
      db.prepare("INSERT OR IGNORE INTO samples VALUES(?,?,?,?,?,?,?,?,?)")
        .run(slot,now,r.activity,r.operations,r.backups,r.logs,r.free,r.capacity,Number(r.complete));
      this.error=null;
    }catch{this.error=failure}
  }
  summary(){
    const base={persistent:!!this.directory,running:!!this.timer,intervalMinutes:60,retention:"unlimited",error:this.error};
    if(!this.db&&(!this.directory||!existsSync(this.path)))return {...base,available:!!this.directory,total:0,firstAt:null,lastAt:null};
    try {
      const r=this.open().prepare("SELECT COUNT(*) AS total,MIN(at_ms) AS firstAt,MAX(at_ms) AS lastAt FROM samples").get()!;
      return {...base,available:!this.error,total:Number(r.total),firstAt:r.firstAt==null?null:Number(r.firstAt),lastAt:r.lastAt==null?null:Number(r.lastAt)};
    }catch{return {...base,available:false,total:0,firstAt:null,lastAt:null,error:failure}}
  }
  snapshot(input: Range = "7d") {
    const range=storageHistoryRange.parse(input),summary=this.summary(),now=this.now();
    if(!summary.available||!summary.total)return {...summary,range,from:now,to:now,bucketHours:1,totalInRange:0,completeInRange:0,points:[],change:null};
    try {
      const db=this.open(),toHour=Math.floor(now/hour);
      const first=range==="all"?Number(db.prepare("SELECT MIN(hour) AS h FROM samples WHERE at_ms<=?").get(now)!.h??toHour):Math.floor((now-windows[range]*hour)/hour);
      const cutoff=range==="all"?first*hour:now-windows[range]*hour;
      const bucketHours=Math.max(1,Math.ceil((toHour-first+1)/240));
      const points=db.prepare(`SELECT s.hour,s.at_ms AS at,s.activity AS activityBytes,s.operations AS operationsBytes,
        s.backups AS backupsBytes,s.logs AS logsBytes,s.free AS freeBytes,s.capacity AS capacityBytes,s.complete,
        s.activity+s.operations+s.backups+s.logs AS totalBytes FROM samples s WHERE s.hour IN
        (SELECT MAX(hour) FROM samples WHERE hour>=? AND hour<=? AND at_ms>=? AND at_ms<=? GROUP BY CAST((hour-?)/? AS INTEGER)) ORDER BY s.hour LIMIT 240`)
        .all(first,toHour,cutoff,now,first,bucketHours).map(r=>({...r as StoragePoint,complete:!!r.complete}));
      const counts=db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(complete),0) AS complete FROM samples WHERE hour>=? AND hour<=? AND at_ms>=? AND at_ms<=?").get(first,toHour,cutoff,now)!;
      const end=(order:"ASC"|"DESC")=>db.prepare(`SELECT at_ms AS at,activity+operations+backups+logs AS bytes FROM samples WHERE complete=1 AND hour>=? AND hour<=? AND at_ms>=? AND at_ms<=? ORDER BY hour ${order} LIMIT 1`).get(first,toHour,cutoff,now);
      const a=end("ASC"),b=end("DESC");
      return {...summary,range,from:cutoff,to:now,bucketHours,totalInRange:Number(counts.total),completeInRange:Number(counts.complete),points,
        change:a&&b&&a.at!==b.at?{bytes:Number(b.bytes)-Number(a.bytes),from:Number(a.at),to:Number(b.at)}:null};
    }catch{return {...summary,available:false,error:failure,range,from:now,to:now,bucketHours:1,totalInRange:0,completeInRange:0,points:[],change:null}}
  }
  close(){this.closed=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;this.db?.close();this.db=undefined}
}
