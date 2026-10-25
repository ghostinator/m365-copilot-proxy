import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { AlertStore, alertSettings, defaultAlerts } from "./alert-store.js";
import { AlertMonitor, type AlertSample } from "./alert-monitor.js";
import { NotificationStore } from "./notification-store.js";
import { notificationDestination, deliveryMessage } from "./notification-schema.js";
import { RequestSources } from "./request-sources.js";
import { HttpActivity } from "./http-activity.js";
const folders: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "m365-model-alerts-")); folders.push(dir); return dir; };
afterEach(() => { vi.useRealTimers(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const rule = (model: string) => ({ model, failures: true, throttling: true, minRequests: 10, minFailures: 5, failurePercent: 50 });
const settings = { ...defaultAlerts, enabled: true, failures: false, throttling: false, models: [rule("model-a"), rule("model-b")] };
function fixture(dir?: string) {
 let now = 1000000;
 let sample: AlertSample = { total: 20, failed: 10, throttled: 5, storageError: false, authentication: "ready", models: [
  {model:"model-a",total:10,failed:5,throttled:5}, {model:"model-b",total:10,failed:5,throttled:0}] };
 const monitor = new AlertMonitor(dir, () => sample, () => now);
 return { monitor, at: (value: number) => now = 1000000 + value, sample: (value: Partial<AlertSample>) => sample = {...sample,...value} };
}
it("validates bounded unique model settings and loads old settings with no model rules", () => {
 const { models, ...old } = defaultAlerts; expect(alertSettings.parse(old).models).toEqual([]);
 for(const rows of [[rule("same"),rule("same")],[rule("<script>")],Array.from({length:11},(_,i)=>rule("m"+i)),[{...rule("m"),minFailures:11}]]) expect(()=>alertSettings.parse({...settings,models:rows})).toThrow();
 expect(alertSettings.parse({...settings,models:[rule("vendor/model:alias")]}).models).toHaveLength(1);
});
it("separates simultaneous model incidents, acknowledgement and measured recovery", () => {
 const f=fixture(); f.monitor.configure(settings); f.at(30000);f.monitor.tick();expect(f.monitor.snapshot().active).toHaveLength(0);
 f.at(60000); f.monitor.tick(); const opened=f.monitor.snapshot(); expect(opened.active).toHaveLength(3);
 expect(opened.active.filter(r=>r.rule==='failures').map(r=>r.model).sort()).toEqual(['model-a','model-b']);
 const a=opened.active.find(r=>r.rule==='failures'&&r.model==='model-a')!;f.monitor.acknowledge(String(a.id));
 f.sample({models:[{model:'model-a',total:10,failed:0,throttled:0},{model:'model-b',total:10,failed:5,throttled:0}]});f.monitor.tick();
 expect(f.monitor.snapshot().active).toHaveLength(1);expect(f.monitor.snapshot().active[0].model).toBe('model-b');f.monitor.close();
});
it("keeps model incidents on low volume, missing samples or storage failure and resets pending sustain", () => {
 const f=fixture();f.monitor.configure(settings);f.at(30000);f.sample({models:[]});f.monitor.tick();
 f.at(60000);f.sample({models:[{model:'model-a',total:10,failed:5,throttled:0}]});f.monitor.tick();expect(f.monitor.snapshot().active).toHaveLength(0);
 f.at(120000);f.monitor.tick();expect(f.monitor.snapshot().active).toHaveLength(1);
 for(const value of [{models:[]},{models:[{model:'model-a',total:1,failed:0,throttled:0}]},{storageError:true}]){f.sample(value);f.monitor.tick();expect(f.monitor.snapshot().active.some(r=>r.model==='model-a')).toBe(true)}
 f.monitor.close();
});
it("migrates v1 alert state without changing IDs, sequence numbers, acknowledgement or configuration", () => {
 const dir=directory(), db=new DatabaseSync(join(dir,'alerts.sqlite'));
 const old={...defaultAlerts};delete (old as any).models;
 db.exec(`CREATE TABLE settings(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE incidents(id TEXT PRIMARY KEY,rule TEXT NOT NULL UNIQUE,opened_ms INTEGER NOT NULL,last_seen_ms INTEGER NOT NULL,acknowledged_ms INTEGER,evidence TEXT NOT NULL);
 CREATE TABLE events(seq INTEGER PRIMARY KEY,incident_id TEXT NOT NULL,rule TEXT NOT NULL,event TEXT NOT NULL,at_ms INTEGER NOT NULL,evidence TEXT NOT NULL);PRAGMA user_version=1;
 INSERT INTO incidents VALUES('original','failures',1,2,3,'old evidence');INSERT INTO events VALUES(17,'original','failures','opened',1,'old evidence');`);
 db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(old));db.close();
 const store=new AlertStore(dir);expect(store.settings().models).toEqual([]);expect(store.snapshot().active[0]).toMatchObject({id:'original',acknowledged_ms:3,model:''});
 expect(store.deliveryEvents(0,50).events[0]).toMatchObject({seq:17,incident_id:'original',model:''});
 store.apply([{rule:'failures',model:'model-a',triggered:true,evidence:'new'}],new Map(),0,100);
 expect(store.snapshot().active).toHaveLength(2);expect(store.snapshot().events[0].seq).toBe(18);store.close();
 const reopened=new AlertStore(dir);expect(reopened.snapshot().active).toHaveLength(2);reopened.close();
});
it("persists model incidents and closes model-scoped events on reconfiguration", () => {
 const dir=directory(), f=fixture(dir);f.monitor.configure(settings);f.at(60000);f.monitor.tick();const ids=f.monitor.snapshot().active.map(r=>r.id).sort();f.monitor.close();
 const g=fixture(dir);g.monitor.tick();expect(g.monitor.snapshot().active.map(r=>r.id).sort()).toEqual(ids);
 g.monitor.configure({...settings,models:[]});expect(g.monitor.snapshot().active).toHaveLength(0);
 expect(g.monitor.snapshot().events.filter(e=>e.event==='reset').map(e=>e.model).sort()).toEqual(['model-a','model-a','model-b']);g.monitor.close();
});
it("routes model events through existing destinations with safe model identity and cancellation", () => {
 const dir=directory(), a=new AlertStore(dir), n=new NotificationStore(dir);
 const destination=notificationDestination.parse({label:'local fixture',config:{type:'webhook',url:'https://example.invalid',format:'generic'},rules:['failures'],events:['opened','resolved']});
 const id=n.save(destination,0,100);n.enable(id,true,0,100);
 a.apply([{rule:'failures',model:'model-a',triggered:true,evidence:'5 errors / 10 completed application chats in 5 minutes.'}],new Map(),0,100);
 n.ingest(a.deliveryEvents(0,50),100);const job=n.claim(100)!;expect(job.message.model).toBe('model-a');expect(job.message.text).toContain('Requested model: model-a');expect(job.message.text).toContain('5 errors / 10');
 expect(deliveryMessage('x',null,'failures','opened',100,'secret payload','bad\nmodel').text).not.toMatch(/secret|bad/);
 n.complete(job.id,job.lease,1,100);a.acknowledge(String(a.snapshot().active[0].id),101);
 a.apply([{rule:'failures',model:'model-a',triggered:false,evidence:'healthy'}],new Map(),0,102);n.ingest(a.deliveryEvents(1,50),102);
 expect(n.claim(102)!.message).toMatchObject({event:'resolved',model:'model-a'});n.close();a.close();
});
it("samples exact requested IDs from real saved chats, excluding checks, future traffic and other endpoints", async () => {
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T20:00:00Z'));const sources=new RequestSources(), activity=new HttpActivity(sources);
 const r={...rule('claude-sonnet'),minRequests:1,minFailures:1};sources.alerts.configure({...settings,sustainSeconds:30,models:[r,rule('unseen')]});sources.alerts.start();
 const fail=activity.begin('POST','/v1/chat/completions')!;fail.chat('claude-sonnet',true);fail.result(429);fail(200);
 const check=activity.begin('POST','/v1/proxy/model-check',true)!;check.chat('unseen',false);check.result(429);check(200);
 const other=activity.begin('GET','/v1/models')!;other(500);
 await vi.advanceTimersByTimeAsync(60000);
 expect(sources.alerts.snapshot().active.map(r=>[r.rule,r.model]).sort()).toEqual([['failures','claude-sonnet'],['throttling','claude-sonnet']]);sources.close();
});
