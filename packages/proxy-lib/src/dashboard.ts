import { authenticationStatus, authenticationAccountKey, getAvailableModels, METERED_BUDGETS, activePriorityAccessExhaustion, priorityAccessFallbackModel, recentOperationalErrors, type MeteredBudget } from "@m365-copilot/core";
import { usageObservations } from "./usage-observations.js";
import { httpActivity, type HttpActivity } from "./http-activity.js";
import type { SessionPool } from "./session-pool.js";

/** Local observations only: no login, token refresh, chat or quota probe. */
export function operatorStatus(pool: SessionPool, activity: HttpActivity = httpActivity) {
  const observed = usageObservations.snapshot(authenticationAccountKey());
  return {
    authentication: authenticationStatus(),
    uptimeSeconds: Math.floor(process.uptime()),
    requests: pool.status,
    activity: activity.snapshot(),
    models: getAvailableModels(),
    lastRoute: observed.route,
    recentErrors: recentOperationalErrors(),
    budgets: Object.entries(METERED_BUDGETS).map(([key, value]) => {
      const exhausted = activePriorityAccessExhaustion(key);
      const allowance = observed.budgets[key as MeteredBudget];
      return { id: key, label: value.label, allowance: allowance ? { daily: allowance.daily ?? null, weekly: allowance.weekly ?? null } : null, observedAt: allowance ? new Date(allowance.at).toISOString() : null, observation: allowance ? "last_observed" : "unknown", exhausted: !!exhausted, window: exhausted?.window ?? null, resetsAt: exhausted?.resetsAt.toISOString() ?? null, fallbackModel: priorityAccessFallbackModel(key as MeteredBudget) };
    }),
  };
}

const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>M365 Proxy · Status</title>
<style>
:root{font:16px/1.5 system-ui,sans-serif;color:#e7eef6;background:#101721;color-scheme:dark}body{max-width:960px;margin:48px auto;padding:0 24px}h1{font-size:32px;letter-spacing:-1px;margin-bottom:4px}h2{font-size:18px;margin:0 0 14px}.muted,small{color:#a9b8c9}header{margin-bottom:28px}section{background:#192330;border:1px solid #334255;border-radius:12px;padding:24px;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}.grid section{margin:0}.value{font-size:25px;font-weight:600;color:#8ae0c4}label{display:block;margin:12px 0 6px}input{width:min(100%,460px);box-sizing:border-box}input,button{font:inherit;padding:9px 12px;border:1px solid #586a80;border-radius:6px;background:#101721;color:inherit}button{cursor:pointer;background:#224c4a;margin:8px 8px 0 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:8px 0}#message{min-height:24px;color:#f3ca82}details{margin-top:12px}code{color:#b9d7fb}
</style>
<header><small>LOCAL OPERATIONS</small><h1>M365 Copilot Proxy</h1><p class="muted">Readiness and routing, without spending a chat turn.</p></header>
<section><h2>Connection</h2><form id="connect"><label for="key">Proxy API key, if configured</label><input id="key" type="password" autocomplete="off" spellcheck="false"><br><button>Connect / refresh</button><button id="forget" type="button">Forget key</button></form><small>The key stays in this page's memory only. Refreshing the page clears it.</small><p id="message" role="status" aria-live="polite">Connecting…</p></section>
<div class="grid"><section><h2>Readiness</h2><div class="value" id="ready">Unknown</div><p id="expiry" class="muted"></p></section><section><h2>Activity</h2><div class="value" id="requests">Unknown</div><p id="activity-detail" class="muted"></p><p id="uptime" class="muted"></p><small>HTTP requests since this process started. Dashboard polling is excluded.</small></section></div>
<section><h2>Recent requests</h2><ul id="http-events"></ul><small>Latest 20 requests, including rejected requests. Query strings, headers and bodies are excluded. Unknown paths are masked; 499 indicates a disconnected client.</small></section>
<section><h2>Model budgets &amp; fallback routes</h2><ul id="budgets"></ul><p id="route" class="muted"></p><small>Allowances are last observed, not live balances. Missing values are unknown; observations expire after six hours or a UTC date change. A missing exhaustion record does not establish available quota.</small></section>
<section><h2>Models</h2><details><summary id="model-count">Available model identifiers</summary><pre id="models"></pre></details><small>Advertised identifiers do not establish account entitlement or upstream availability.</small></section>
<section><h2>Recent errors</h2><ul id="errors"></ul><small>Up to 20 summaries from this process. Raw messages and request contents stay out of the dashboard.</small></section>
<section><h2>Recovery</h2><p>If sign-in is required, run <code>m365-proxy login</code>, then restart the proxy. Windows startup controls: <code>m365-proxy service status|start|stop</code>.</p><small>This first dashboard version is read-only. It cannot restart a stopped server or open sign-in remotely.</small></section>
<script src="/dashboard-script"></script></html>`;

const script = `const el=id=>document.getElementById(id);let key='',busy=false,requestId=0,controller=null;
function clearStatus(message){el('ready').textContent='Unavailable';el('requests').textContent='Unknown';el('activity-detail').textContent='';el('http-events').replaceChildren();el('expiry').textContent='';el('uptime').textContent='';el('models').textContent='';el('model-count').textContent='Models unavailable';el('budgets').replaceChildren();el('errors').replaceChildren();el('route').textContent='';el('message').textContent=message}
async function refresh(){if(busy)return;busy=true;const id=++requestId;controller=new AbortController();try{
const r=await fetch('/v1/proxy/status',{headers:key?{Authorization:'Bearer '+key}:{},cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
if(!r.ok)throw Error(r.status===401?'Enter your proxy API key to view status.':'Status unavailable (HTTP '+r.status+').');
const s=await r.json();
if(id!==requestId)return;
el('ready').textContent=s.authentication.status.replaceAll('_',' ');
el('expiry').textContent=s.authentication.expiresAt?'Token expires '+new Date(s.authentication.expiresAt).toLocaleString():'No authenticated token observed';
el('requests').textContent=s.activity.total+' total HTTP requests';
el('activity-detail').textContent=s.activity.active+' in flight · '+s.activity.completed+' finished · '+s.activity.failed+' failed · '+s.activity.categories.models+' model checks · '+s.activity.categories.chat+' chat requests · '+s.activity.categories.health+' health checks · '+s.activity.categories.other+' other';
el('uptime').textContent=Math.floor(s.uptimeSeconds/60)+' minutes uptime · '+s.requests.pending+' admitted chat requests · '+s.requests.sessions+' remembered conversations';
el('http-events').replaceChildren(...s.activity.recent.map(event=>{const li=document.createElement('li');li.textContent=new Date(event.receivedAt).toLocaleTimeString()+' · '+event.method+' '+event.endpoint+' · '+(event.status??'in flight')+(event.durationMs===null?'':' · '+event.durationMs+' ms');return li}));if(!s.activity.recent.length){const li=document.createElement('li');li.textContent='No application requests received since startup';el('http-events').append(li)}
el('model-count').textContent=s.models.length+' advertised models';el('models').textContent=s.models.join('\\n');
el('budgets').replaceChildren(...s.budgets.map(b=>{const li=document.createElement('li');const allowance=b.allowance?'daily '+(b.allowance.daily??'unknown')+' / weekly '+(b.allowance.weekly??'unknown')+' · observed '+new Date(b.observedAt).toLocaleString():'remaining allowance unknown';li.textContent=b.label+': '+allowance+' · '+(b.exhausted?'exhausted until '+new Date(b.resetsAt).toLocaleString():'no recorded exhaustion')+' · fallback: '+(b.fallbackModel||'disabled');return li}));
el('route').textContent=s.lastRoute?'Last observed upstream route: '+s.lastRoute.requested+' → '+s.lastRoute.served+(s.lastRoute.fallbackUsed?' (fallback)':'')+' · '+new Date(s.lastRoute.at).toLocaleString():'No recent upstream route observed';
el('errors').replaceChildren(...s.recentErrors.map(error=>{const li=document.createElement('li');li.textContent=new Date(error.at).toLocaleString()+' · '+error.component+': '+error.summary;return li}));if(!s.recentErrors.length){const li=document.createElement('li');li.textContent='No errors recorded in this process';el('errors').append(li)}
el('message').textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 5 seconds';
}catch(e){if(id===requestId)clearStatus(e.message)}finally{if(id===requestId){busy=false;controller=null}}}
function changeKey(value){requestId++;controller?.abort();busy=false;key=value;el('key').value='';clearStatus('Connecting…');refresh()}
el('connect').addEventListener('submit',e=>{e.preventDefault();changeKey(el('key').value)});el('forget').addEventListener('click',()=>changeKey(''));setInterval(()=>{if(!document.hidden)refresh()},5000);refresh();`;

export function dashboardResponse(path: string): Response | null {
  if (!["/dashboard", "/dashboard-script"].includes(path)) return null;
  return new Response(path === "/dashboard" ? html : script, { headers: {
    "Content-Type": path === "/dashboard" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  } });
}
