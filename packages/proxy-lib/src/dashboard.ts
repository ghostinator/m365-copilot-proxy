import { authenticationStatus, getAvailableModels, METERED_BUDGETS, activePriorityAccessExhaustion, priorityAccessFallbackModel, type MeteredBudget } from "@m365-copilot/core";
import type { SessionPool } from "./session-pool.js";

/** Local observations only: no login, token refresh, chat or quota probe. */
export function operatorStatus(pool: SessionPool) {
  return {
    authentication: authenticationStatus(),
    uptimeSeconds: Math.floor(process.uptime()),
    requests: pool.status,
    models: getAvailableModels(),
    budgets: Object.entries(METERED_BUDGETS).map(([key, value]) => {
      const exhausted = activePriorityAccessExhaustion(key);
      return { id: key, label: value.label, allowance: null, observation: "unknown", exhausted: !!exhausted, window: exhausted?.window ?? null, resetsAt: exhausted?.resetsAt.toISOString() ?? null, fallbackModel: priorityAccessFallbackModel(key as MeteredBudget) };
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
<div class="grid"><section><h2>Readiness</h2><div class="value" id="ready">Unknown</div><p id="expiry" class="muted"></p></section><section><h2>Activity</h2><div class="value" id="requests">Unknown</div><p id="uptime" class="muted"></p></section></div>
<section><h2>Model budgets &amp; fallback routes</h2><ul id="budgets"></ul><small>Remaining allowances are unknown until observation support is added. A missing exhaustion record does not establish available quota.</small></section>
<section><h2>Models</h2><details><summary id="model-count">Available model identifiers</summary><pre id="models"></pre></details><small>Advertised identifiers do not establish account entitlement or upstream availability.</small></section>
<section><h2>Recovery</h2><p>If sign-in is required, run <code>m365-proxy login</code>, then restart the proxy. Windows startup controls: <code>m365-proxy service status|start|stop</code>.</p><small>This first dashboard version is read-only. It cannot restart a stopped server or open sign-in remotely.</small></section>
<script src="/dashboard-script"></script></html>`;

const script = `const el=id=>document.getElementById(id);let key='',busy=false;
async function refresh(){if(busy)return;busy=true;try{const r=await fetch('/v1/proxy/status',{headers:key?{Authorization:'Bearer '+key}:{},cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(r.status===401?'Enter your proxy API key to view status.':'Status unavailable (HTTP '+r.status+').');const s=await r.json();el('ready').textContent=s.authentication.status.replaceAll('_',' ');el('expiry').textContent=s.authentication.expiresAt?'Token expires '+new Date(s.authentication.expiresAt).toLocaleString():'No authenticated token observed';el('requests').textContent=s.requests.pending+' admitted / active';el('uptime').textContent=Math.floor(s.uptimeSeconds/60)+' minutes uptime · '+s.requests.sessions+' remembered conversations';el('model-count').textContent=s.models.length+' advertised models';el('models').textContent=s.models.join('\\n');el('budgets').replaceChildren(...s.budgets.map(b=>{const li=document.createElement('li');li.textContent=b.label+': '+(b.exhausted?'exhausted until '+new Date(b.resetsAt).toLocaleString():'no recorded exhaustion')+' · fallback: '+(b.fallbackModel||'disabled');return li}));el('message').textContent='Updated '+new Date().toLocaleTimeString()+' · refreshes every 15 seconds';}catch(e){el('ready').textContent='Unavailable';el('requests').textContent='Unknown';el('expiry').textContent='';el('uptime').textContent='';el('models').textContent='';el('model-count').textContent='Models unavailable';el('budgets').replaceChildren();el('message').textContent=e.message;}finally{busy=false}}
el('connect').addEventListener('submit',e=>{e.preventDefault();key=el('key').value;el('key').value='';refresh()});el('forget').addEventListener('click',()=>{key='';el('key').value='';refresh()});setInterval(()=>{if(!document.hidden)refresh()},15000);refresh();`;

export function dashboardResponse(path: string): Response | null {
  if (!["/dashboard", "/dashboard-script"].includes(path)) return null;
  return new Response(path === "/dashboard" ? html : script, { headers: {
    "Content-Type": path === "/dashboard" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  } });
}
