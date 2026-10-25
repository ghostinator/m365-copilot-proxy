export const reliabilityHtml = `<section><h2>Observed model reliability</h2>
<p id="reliability-summary" class="value">Loading…</p><p id="reliability-period" class="muted"></p>
<p>Saved application chats only. Follows time, requested model, system and application filters. Request type, error category, UUID and check type do not apply. No model tests run here. Success means completion without a recorded error, including errors inside streams; it does not grade the answer or tools. Cancellations remain separate and count in the success-rate denominator.</p>
<div class="request-box table-wrap" role="region" aria-label="Model reliability by route" tabindex="0"><table class="reliability-table"><thead><tr><th>Requested → served route</th><th>Current samples</th><th>Success</th><th>Errors</th><th>Cancelled</th><th>Success rate</th><th>Previous rate / samples</th><th>Change (points)</th><th>Mean / p95 response</th></tr></thead><tbody id="reliability-routes"></tbody></table></div>
<p id="reliability-coverage" class="muted"></p><small>Rates use observed requests, not controlled experiments. Small samples, account changes, workloads and routing can distort comparisons. A served route is the proxy-observed model identifier, not a verified upstream version. Unknown routes stay unknown. Previous-only routes are shown with zero current samples.</small>
<h3>Success rate over time</h3><div id="reliability-chart" class="performance-chart" role="img" aria-label="Observed chat success rate over time"></div>
<details><summary>Time intervals and exact sample counts</summary><div class="request-box table-wrap"><table><thead><tr><th>Interval start</th><th>Requests</th><th>Success</th><th>Errors</th><th>Cancelled</th><th>Success rate</th><th>Mean response</th></tr></thead><tbody id="reliability-buckets"></tbody></table></div></details></section>`;

export const reliabilityScript = String.raw`
const observedRate=(rate,total)=>rate==null?'no samples':(rate*100).toFixed(1)+'% / '+total+(total<20?' · limited sample':'');
function reliabilityRow(values){const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell)}return row}
function renderReliability(r){
  const c=r?.current,p=r?.previous;
  el('reliability-summary').textContent=c?c.total+' completed chats · '+observedRate(c.successRate,c.total)+' · '+c.failed+' errors · '+c.cancelled+' cancellations':'Reliability data unavailable';
  const interval=(from,to)=>new Date(from).toLocaleString()+' → '+new Date(to).toLocaleString();
  el('reliability-period').textContent=!r?'':r.from==null?'All timestamped history through '+new Date(r.to).toLocaleString()+'. Choose a rolling range for a previous-period comparison.':'Current: '+interval(r.from,r.to)+' · Previous: '+interval(r.previousFrom,r.from)+' · '+observedRate(p.successRate,p.total);
  el('reliability-routes').replaceChildren(...(r?.routes||[]).map(s=>reliabilityRow([
    (s.model||'unknown')+' → '+(s.servedModel||'unknown'),s.current.total,s.current.succeeded,s.current.failed,s.current.cancelled,
    observedRate(s.current.successRate,s.current.total),s.previous?observedRate(s.previous.successRate,s.previous.total):'not compared',
    s.changePoints==null?'not compared':(s.changePoints>0?'+':'')+s.changePoints.toFixed(1),measured(s.current.averageDurationMs)+' / '+measured(s.current.p95Ms)])));
  el('reliability-coverage').textContent=r?'Showing '+r.routes.length+' of '+r.routeCount+' requested/served route pairs, ordered by current volume (maximum '+r.routeLimit+'). Totals and chart cover all matching chats. p95 uses nearest-rank samples, including errors and cancellations.':'';
  const buckets=r?.buckets||[];
  el('reliability-buckets').replaceChildren(...buckets.map(b=>reliabilityRow([new Date(b.at).toLocaleString(),b.total,b.succeeded,b.failed,b.cancelled,observedRate(b.successRate,b.total),measured(b.averageDurationMs)])));
  el('reliability-chart').setAttribute('aria-label','Observed success rate, scale 0–100%, across '+buckets.length+' intervals of '+Math.round((r?.bucketMs||0)/60000)+' minutes. Empty intervals have no sample. Expand interval data for counts.');
  el('reliability-chart').replaceChildren(...buckets.map(b=>{const bar=document.createElement('div');bar.className='performance-bar';bar.style.height=(b.successRate==null?0:b.successRate*100)+'%';bar.title=new Date(b.at).toLocaleString()+' · '+observedRate(b.successRate,b.total)+' · '+b.failed+' errors · '+b.cancelled+' cancellations';return bar}));
}
`;
