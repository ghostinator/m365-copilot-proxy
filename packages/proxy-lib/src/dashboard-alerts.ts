export const alertBannerHtml = '<p id="alert-banner" class="warning" role="status" aria-live="polite">Alerts disabled until explicitly enabled in Settings.</p>';
export const alertsHtml = `<section><h2>Alert center</h2><p id="alerts-status" role="status"></p><ul id="alert-incidents"></ul>
<p>Proxy-wide observations, independent of dashboard filters. Acknowledgement marks this incident as seen; it does not resolve it or suppress a new incident after recovery. Unlock operator access in Settings to acknowledge or browse older events.</p>
<h3>Alert events</h3><div class="request-box" role="region" aria-label="Saved alert events" tabindex="0"><ul id="alert-events"></ul></div>
<div class="pager"><button id="alerts-previous" type="button" disabled>Previous events</button><span id="alerts-page"></span><button id="alerts-next" type="button" disabled>More events</button></div></section>`;
export const alertSettingsHtml = `<section><h2>Opt-in alerts</h2><p>Runs every 30 seconds in the proxy, even when this dashboard is closed. No model probes or login attempts. External delivery requires separately configured and enabled destinations below; desktop notifications are not implemented. Alerts appear in Overview and Errors. Monitoring stops when the proxy stops; it cannot report its own outage.</p>
<fieldset id="alert-settings" disabled><legend>Alert settings · operator access required</legend>
<label><input id="alerts-enabled" type="checkbox"> Enable background alert monitoring</label>
<label><input id="alerts-failures" type="checkbox"> Sustained chat failures</label><label><input id="alerts-throttling" type="checkbox"> Sustained throttling</label>
<label><input id="alerts-authentication" type="checkbox"> Sign-in recovery required</label><label><input id="alerts-storage" type="checkbox"> Activity storage or low free space</label>
<label>Low free-space threshold (MiB; 0 = off)<input id="alerts-minFreeMiB" type="number" min="0" max="1048576"></label>
<label>Rolling window (minutes)<input id="alerts-windowMinutes" type="number" min="1" max="60"></label>
<label>Minimum completed chats<input id="alerts-minRequests" type="number" min="1" max="10000"></label>
<label>Minimum errors / throttled chats<input id="alerts-minFailures" type="number" min="1" max="10000"></label>
<label>Error percentage threshold<input id="alerts-failurePercent" type="number" min="1" max="100"></label>
<label>Condition must persist (seconds)<input id="alerts-sustainSeconds" type="number" min="30" max="3600"></label>
<button id="alerts-save" type="button">Apply alert settings</button><button id="alerts-reset-form" type="button">Reload saved settings</button></fieldset>
<p id="alerts-settings-message" role="status"></p><small>Defaults: 5-minute window, at least 10 chats and 5 errors, 50% errors, sustained 60 seconds. Throttling uses the minimum chat/error counts without the percentage threshold. Cancellations count toward volume but are not errors. Auth/storage use the same sustain time. Low-space alerts require monitoring and the storage rule enabled; threshold 0 disables capacity checking. The threshold measures space available on the shared data volume, including other programs. Unknown observations do not imply recovery. Changing settings closes existing incidents and restarts the sustain timer; disabling closes them as disabled. Pending sustain timers restart after process restart. Incidents, acknowledgement and event history persist in a separate private alerts.sqlite, with unlimited retention; activity backups do not include this file.</small></section>`;

export const alertsScript = String.raw`
let alertData=null,alertOffset=0,alertDirty=false,alertInitialized=false,incidentButtons=[];
const alertBooleans=['enabled','failures','throttling','authentication','storage'],alertNumbers=['windowMinutes','minRequests','minFailures','failurePercent','sustainSeconds','minFreeMiB'];
function fillAlertSettings(){if(!alertData?.settings)return;for(const name of alertBooleans)el('alerts-'+name).checked=alertData.settings[name];for(const name of alertNumbers)el('alerts-'+name).value=String(alertData.settings[name]);alertDirty=false;alertInitialized=true}
function alertAccess(unlocked){el('alert-settings').disabled=!unlocked;el('alerts-previous').disabled=!unlocked||!alertOffset;el('alerts-next').disabled=!unlocked||!alertData||alertOffset+20>=alertData.total;for(const button of incidentButtons)button.disabled=!unlocked||button.dataset.acknowledged==='true';if(!unlocked)alertOffset=0}
function renderAlerts(a,history=false){
  if(!a){incidentButtons=[];alertData=null;alertOffset=0;alertInitialized=false;alertDirty=false;el('alert-incidents').replaceChildren();el('alert-events').replaceChildren();el('alerts-status').textContent='Alert data unavailable';el('alert-banner').textContent='Alert status unavailable';el('alerts-page').textContent='';return}
  const active=a.active||[],unseen=active.filter(r=>r.acknowledged_ms==null).length;
  const banner=a.error?'Alert monitor unavailable: '+a.error:!a.settings.enabled?'Alerts disabled. Enable them in Settings.':active.length?active.length+' active alerts · '+unseen+' unacknowledged · see Errors → Alert center':'Alerts enabled · no active incidents';
  if(el('alert-banner').textContent!==banner)el('alert-banner').textContent=banner;
  el('alerts-status').textContent=banner+' · '+(a.running?'monitor running':'monitor stopped')+' · last successful evaluation '+(a.checkedAt?new Date(a.checkedAt).toLocaleString():'not yet observed');
  incidentButtons=[];el('alert-incidents').replaceChildren(...active.map(r=>{const li=document.createElement('li'),text=document.createElement('p'),button=document.createElement('button');text.textContent=r.rule+' · opened '+new Date(Number(r.opened_ms)).toLocaleString()+' · last triggered '+new Date(Number(r.last_seen_ms)).toLocaleString()+' · '+r.evidence+(r.acknowledged_ms?' · acknowledged '+new Date(Number(r.acknowledged_ms)).toLocaleString():'');button.textContent=r.acknowledged_ms?'Acknowledged':'Acknowledge';button.type='button';button.dataset.acknowledged=String(r.acknowledged_ms!=null);button.disabled=!!r.acknowledged_ms||!operatorToken;button.addEventListener('click',()=>alertAction({action:'alerts-acknowledge',id:r.id}));incidentButtons.push(button);li.append(text,button);return li}));
  if(!history&&alertOffset>0){alertData={...alertData,...a,events:alertData.events,offset:alertOffset};}else{alertData=a;alertOffset=a.offset;el('alert-events').replaceChildren(...a.events.map(r=>{const li=document.createElement('li');li.textContent=new Date(Number(r.at_ms)).toLocaleString()+' · '+r.rule+' · '+r.event+' · '+r.evidence;return li}));el('alerts-page').textContent=(a.total?a.offset+1:0)+'–'+Math.min(a.total,a.offset+20)+' of '+a.total+' events'}
  if(!alertInitialized&&!alertDirty)fillAlertSettings();alertAccess(!!operatorToken);
}
async function alertAction(command){if(operatorBusy)return;operatorBusy=true;try{const result=await operatorCommand(command);if(command.action==='alerts-configure'){alertOffset=0;alertDirty=false;alertInitialized=false;el('alerts-settings-message').textContent='Alert settings saved. Existing incidents closed; new sustain timers start now.'}renderAlerts(result,true)}catch(error){el('alerts-settings-message').textContent=error.message}finally{operatorBusy=false}}
for(const name of [...alertBooleans,...alertNumbers])el('alerts-'+name).addEventListener('input',()=>{alertDirty=true});
el('alerts-save').addEventListener('click',()=>{const settings={};for(const name of alertBooleans)settings[name]=el('alerts-'+name).checked;for(const name of alertNumbers)settings[name]=Number(el('alerts-'+name).value);alertAction({action:'alerts-configure',settings})});
el('alerts-reset-form').addEventListener('click',fillAlertSettings);
el('alerts-previous').addEventListener('click',()=>alertAction({action:'alerts-history',offset:Math.max(0,alertOffset-20)}));
el('alerts-next').addEventListener('click',()=>alertAction({action:'alerts-history',offset:alertOffset+20}));
`;
