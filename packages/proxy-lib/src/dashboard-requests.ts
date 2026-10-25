export const requestsHtml = '<section><h2>Requests</h2><p id="request-summary" role="status"></p><div class="filter-controls"><label for="activity-filter">Show</label><select id="activity-filter"><option value="all">All requests</option><option value="chat">Chat requests</option><option value="errors">Errors / cancellations</option><option value="checks">Explicit self-checks</option></select><label for="request-key">Application key</label><select id="request-key"><option value="all">All application keys</option><option value="unattributed">Keyless / unattributed</option></select><label for="history-size">Requests per page</label><select id="history-size"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></div><p id="request-notice" class="warning"></p><div class="request-box" role="region" aria-label="Live and saved requests" tabindex="0"><ul id="source-history"></ul></div><div class="pager"><button id="history-previous" disabled type="button">Previous</button><span id="history-page" role="status"></span><button id="history-next" disabled type="button">Next</button></div><small>One request list. Live requests are pinned above the current saved page until completed; saved history persists across restart. Page size applies to saved requests. Time/model/system filters apply to both; Show and Application key filter this list. Expand a row for its inspector. Keyless and older unattributed traffic remain visible. No prompts, replies, raw API keys or tool arguments are stored.</small></section>';

export const applicationsHtml = '<section><h2>Applications by API key</h2><div class="table-wrap"><table><thead><tr><th>Application key</th><th>Requested model</th><th>Served model</th><th>Requests</th><th>Errors</th><th>Cancelled</th><th>Systems</th><th>Last seen</th></tr></thead><tbody id="key-activity"></tbody></table></div><small>Completed application requests in the shared time/model/system filters, excluding explicit self-checks. Top 50 key/model/route combinations. Key labels are saved at request time. Keyless and older records are unattributed; a key identifies the application configured to use it, not a verified machine.</small></section>';

export const keysHtml = '<section><h2>Application API keys</h2><p id="key-mode"></p><div class="table-wrap"><table><thead><tr><th>Label</th><th>Key ID</th><th>Status</th><th>Created</th></tr></thead><tbody id="application-keys"></tbody></table></div><p>Create a named key on the proxy host: <code>m365-proxy keys create "Production application"</code>. Copy the token shown once into that application. Use <code>keys list</code>, <code>keys rename &lt;id&gt; "New label"</code> or <code>keys revoke &lt;id&gt;</code> to manage it. Changes apply to subsequent requests without restarting.</p><p>Creating keys leaves keyless mode available. To require a key explicitly, use <code>m365-proxy keys mode required</code>; <code>keys mode optional</code> permits keyless access unless a legacy key is configured. In optional mode, revocation removes key attribution but keyless access still works. The existing legacy API key remains supported.</p><small>Management commands require local access to the proxy account directory. Tokens and stored digests are never returned by the dashboard. Labels and IDs are metadata, not secrets. Revocation affects new requests; it does not interrupt existing chats.</small></section>';

export const requestsScript = String.raw`
let liveRecords=[],requestFrom=null,requestError=null;
function liveMatches(e){
  const kind=el('activity-filter').value||'all',model=el('activity-model').value,address=el('source-filter').value,keyId=el('request-key').value;
  return (!requestFrom||Date.parse(e.receivedAt)>=Date.parse(requestFrom))&&(!model||model==='all'||e.model===model)&&(!address||address==='all'||(e.clientAddress||e.address)===address)&&(!keyId||keyId==='all'||(keyId==='unattributed'?!e.apiKeyId:e.apiKeyId===keyId))&&(kind==='all'||kind==='chat'&&(e.endpoint==='/v1/chat/completions'||e.endpoint==='/v1/proxy/model-check')||kind==='checks'&&e.source==='self-check'||kind==='errors'&&(e.outcome==='error'||e.outcome==='cancelled'));
}
function renderSourceHistory(){
  const target=el('source-history'),opened=new Set([...target.querySelectorAll('details[open]')].map(d=>d.dataset.id));
  const live=liveRecords.filter(liveMatches).sort((a,b)=>(a.phase==='queued')-(b.phase==='queued')||Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
  const entries=new Map();for(const e of [...live,...sourceRecords])if(!entries.has(e.id))entries.set(e.id,e);
  target.replaceChildren(...[...entries.values()].map(e=>{
    const address=e.address||e.clientAddress,active=e.outcome==='pending',elapsed=active?Math.max(0,Date.now()-Date.parse(e.receivedAt)):e.durationMs;
    return requestInspector(e,(active?'LIVE · '+e.phase+' · ':'')+new Date(e.receivedAt).toLocaleString()+' · '+(sourceLabels[address]||address)+(e.apiKeyLabel?' · app '+e.apiKeyLabel:'')+' · '+e.method+' '+e.endpoint+' · '+(e.model||'model not recorded')+' · HTTP '+(e.status??'pending')+' · '+e.outcome+' · '+elapsed+' ms',opened.has(e.id));
  }));
  el('request-summary').textContent=live.length+' live requests · '+live.filter(e=>e.phase==='queued').length+' waiting in queue · live requests pinned above saved history';
  el('request-notice').textContent=requestError||'';
  if(!entries.size){const li=document.createElement('li');li.textContent=requestError?'Saved history unavailable; no matching live requests.':'No requests match these filters.';target.append(li)}
}
function renderApplicationKeys(status,sources){
  const state=status||{keys:[],required:false,legacyConfigured:false};
  el('key-mode').textContent=(state.required?'A valid key is required.':'Keyless access is allowed; named keys are optional for attribution.')+(state.legacyConfigured?' The legacy key is also accepted.':'');
  el('application-keys').replaceChildren(...state.keys.map(key=>{const row=document.createElement('tr');for(const value of [key.label,key.id,key.revokedAt?'Revoked':'Active',new Date(key.createdAt).toLocaleString()]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}return row}));
  const select=el('request-key'),selected=select.value,known=new Map(state.keys.map(key=>[key.id,key.label+(key.revokedAt?' (revoked)':'')]));
  if(state.legacyConfigured)known.set('legacy','Legacy API key');
  for(const row of sources?.keyActivity||[])if(row.id&&!known.has(row.id))known.set(row.id,row.label||row.id);
  if(selected&&selected!=='all'&&selected!=='unattributed'&&!known.has(selected))known.set(selected,selected);
  select.replaceChildren(...[['all','All application keys'],['unattributed','Keyless / unattributed'],...known].map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option}));select.value=selected||'all';
  el('key-activity').replaceChildren(...(sources?.keyActivity||[]).map(key=>{const row=document.createElement('tr');for(const value of [key.label||'Keyless / unattributed',key.model||'not recorded',key.servedModel||'not recorded',key.requests,key.failed,key.cancelled,key.systems,new Date(Number(key.lastSeen)).toLocaleString()]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell)}return row}));
}
el('activity-filter').addEventListener('change',()=>refreshHistory());
el('request-key').addEventListener('change',()=>refreshHistory());
`;
