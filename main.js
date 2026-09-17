const $ = (id) => document.getElementById(id);
const stateLabels = { activo:'Activo', observacion:'Observación', alerta:'Alerta', sin_conexion:'Sin conexión' };
const regions = {
  'Noroeste':['Baja California','Baja California Sur','Sonora','Sinaloa'],
  'Norte':['Chihuahua','Coahuila','Nuevo León','Durango','Zacatecas','San Luis Potosí','Tamaulipas'],
  'Occidente':['Nayarit','Jalisco','Colima','Michoacán','Aguascalientes','Guanajuato'],
  'Centro':['Querétaro','Hidalgo','Estado de México','Ciudad de México','Morelos','Tlaxcala','Puebla'],
  'Sur-Sureste':['Guerrero','Oaxaca','Chiapas','Veracruz','Tabasco','Campeche','Yucatán','Quintana Roo']
};

let map, clusterGroup;
const markers = new Map();
let nodes = [];
let selectedId = null;
// Centro aproximado de México, solo como respaldo antes de que carguen los nodos reales.
const FALLBACK_CENTER = [23.6, -102.5];

// ───────────────────────── Datos reales (red sísmica UABC) ─────────────────────────
const REAL_API_BASE = 'https://retriever-1031456939583.us-west2.run.app';
const REAL_POLL_MS = 4000;
let realPolling = false;
// La API real no expone GPS; usamos la ubicación conocida de cada estación como referencia
// (no es la posición exacta del sensor dentro del sitio, solo la del sitio/edificio).
const REAL_DEVICE_INFO = {
  // Dispositivo actualmente activo: unidad de pruebas instalada en la UTyP de la Sierra
  // de Guerrero, Tlacotepec (municipio Gral. Heliodoro Castillo) — no en Baja California.
  'rpi_shm_v56': { name: 'UTyP Sierra de Guerrero (Tlacotepec)', city: 'Tlacotepec, Guerrero', lat: 17.790278, lon: -99.978333, type: 'Laboratorio', region: 'Sur-Sureste', state: 'Guerrero' },
  'uabc-estacion-ensenada-01': { name: 'Estación Ensenada', city: 'Ensenada', lat: 31.8667, lon: -116.6000, type: 'Edificio', region: 'Noroeste', state: 'Baja California' },
  'uabc-estacion-mexicali-01': { name: 'Estación Mexicali', city: 'Mexicali', lat: 32.6245, lon: -115.4523, type: 'Edificio', region: 'Noroeste', state: 'Baja California' },
  'uabc-estacion-tijuana-01': { name: 'Estación Tijuana', city: 'Tijuana', lat: 32.5149, lon: -117.0382, type: 'Edificio', region: 'Noroeste', state: 'Baja California' },
};
// key = "device_id·sensor_type" -> { t:[], x:[], y:[], z:[], lastT, lastRs }
const realBuffers = new Map();
const realLastTrigger = new Map();
const realEvents = [];
const realDeviceIds = new Set(Object.keys(REAL_DEVICE_INFO));

function now(){ return new Date().toLocaleTimeString('es-MX',{hour12:false}); }
function setText(id,v){ const el=$(id); if(el) el.textContent=v; }

// ── HTTP contra la API real ──
async function httpGetJson(url){
  try{
    const res = await fetch(url, { headers:{ Accept:'application/json' } });
    let json = null;
    try{ json = await res.json(); }catch{ json = null; }
    return { status: res.status, json };
  }catch(err){
    return { status: 0, json: null, error: err.message };
  }
}
async function fetchRealDeviceList(){
  const { status, json } = await httpGetJson(`${REAL_API_BASE}/dispositivos`);
  const list = (status===200 && json && Array.isArray(json.dispositivos)) ? json.dispositivos : [];
  // Solo comparamos contra dispositivos conocidos: la API no trae GPS, así que un
  // dispositivo desconocido no tendría dónde ubicarse en el mapa.
  const known = list.filter(id=>realDeviceIds.has(id));
  return known.length ? known : Array.from(realDeviceIds);
}
async function fetchRealLatest(deviceId, sinceIso){
  const params = new URLSearchParams({ device_id:deviceId, limit:'1000', orden: sinceIso?'asc':'desc' });
  if(sinceIso) params.set('fecha_inicio', sinceIso);
  const { status, json } = await httpGetJson(`${REAL_API_BASE}/registros?${params.toString()}`);
  return (status===200 && json && Array.isArray(json.registros)) ? json.registros : [];
}
async function fetchRealHistory(deviceId, start, end, maxRecords=50000){
  let out = [], offset = 0;
  const limit = 1000;
  for(let page=0; page<Math.ceil(maxRecords/limit); page++){
    const params = new URLSearchParams({
      device_id:deviceId, fecha_inicio:start.toISOString(), fecha_fin:end.toISOString(),
      orden:'asc', limit:String(limit), offset:String(offset)
    });
    const { status, json } = await httpGetJson(`${REAL_API_BASE}/registros?${params.toString()}`);
    if(status!==200 || !json || !Array.isArray(json.registros)) break;
    out = out.concat(json.registros);
    if(json.registros.length < limit) break;
    offset += json.registros.length;
  }
  return out.slice(0, maxRecords);
}

// ── Frecuencia dominante: DFT directa sobre una rejilla de frecuencias candidatas ──
// (evita depender de una librería de FFT; con pocos cientos de muestras es instantáneo).
function estimateDominantFrequency(t, vals, fMin=0.5, fMax=20, steps=48){
  const idx = []; for(let i=0;i<vals.length;i++) if(Number.isFinite(vals[i])) idx.push(i);
  if(idx.length < 8) return 0;
  const t0 = t[idx[0]];
  const mean = idx.reduce((a,i)=>a+vals[i],0)/idx.length;
  let bestF=0, bestPow=-1;
  for(let s=0;s<=steps;s++){
    const f = fMin + (fMax-fMin)*s/steps;
    let re=0, im=0;
    for(const i of idx){
      const ang = 2*Math.PI*f*(t[i]-t0);
      const v = vals[i]-mean;
      re += v*Math.cos(ang); im -= v*Math.sin(ang);
    }
    const pow = re*re+im*im;
    if(pow>bestPow){ bestPow=pow; bestF=f; }
  }
  return bestF;
}
function computeRms(vals){
  const finite = vals.filter(Number.isFinite);
  if(!finite.length) return 0;
  return Math.sqrt(finite.reduce((a,v)=>a+v*v,0)/finite.length);
}

// ── Detección STA/LTA sobre datos reales (mismo algoritmo que el visor de escritorio) ──
function staLtaScan(key, t, x, y, z, staS, ltaS, ratioOn, cooldownS=5){
  if(t.length < 8) return [];
  const dts = []; for(let i=1;i<t.length;i++) dts.push(t[i]-t[i-1]);
  dts.sort((a,b)=>a-b);
  const dt = dts[Math.floor(dts.length/2)] || 0;
  if(!(dt>0)) return [];
  const n = Math.floor((t[t.length-1]-t[0])/dt);
  if(n < 8) return [];
  const energy = new Array(n);
  let j = 0;
  for(let k=0;k<n;k++){
    const tk = t[0] + k*dt;
    while(j < t.length-2 && t[j+1] < tk) j++;
    const t0v=t[j], t1v=t[Math.min(j+1,t.length-1)];
    const frac = t1v>t0v ? (tk-t0v)/(t1v-t0v) : 0;
    const interp = (arr)=>{
      const a = Number.isFinite(arr[j]) ? arr[j] : 0;
      const bRaw = arr[Math.min(j+1,arr.length-1)];
      const b = Number.isFinite(bRaw) ? bRaw : a;
      return a + (b-a)*frac;
    };
    const xv=interp(x), yv=interp(y), zv=interp(z);
    energy[k] = xv*xv+yv*yv+zv*zv;
  }
  const nSta = Math.max(1, Math.round(staS/dt));
  const nLta = Math.max(nSta+1, Math.round(ltaS/dt));
  if(nLta >= energy.length) return [];
  const cum = [0]; for(let k=0;k<energy.length;k++) cum.push(cum[k]+energy[k]);
  const moving = (nn)=>{ const out=new Array(energy.length).fill(NaN); for(let k=nn-1;k<energy.length;k++) out[k]=(cum[k+1]-cum[k+1-nn])/nn; return out; };
  const sta = moving(nSta), lta = moving(nLta);
  let lastT = realLastTrigger.get(key) ?? -Infinity;
  const events = [];
  for(let i=1;i<energy.length;i++){
    if(!Number.isFinite(sta[i])||!Number.isFinite(lta[i])||!Number.isFinite(sta[i-1])||!Number.isFinite(lta[i-1])) continue;
    const ti = t[0] + i*dt;
    if(ti<=lastT || (ti-lastT)<cooldownS) continue;
    const rPrev = lta[i-1]>1e-12 ? sta[i-1]/lta[i-1] : 0;
    const rNow = lta[i]>1e-12 ? sta[i]/lta[i] : 0;
    if(rPrev < ratioOn && ratioOn <= rNow){ events.push({key,t:ti,ratio:rNow}); lastT=ti; }
  }
  if(events.length) realLastTrigger.set(key,lastT);
  return events;
}
function pushRealEvent(ev){
  realEvents.unshift(ev); realEvents.splice(80);
  const box = $('eventsList');
  if(!box) return;
  const [devId,sensor] = ev.key.split('·');
  const when = new Date(ev.t*1000).toISOString().replace('T',' ').slice(0,19);
  const item = document.createElement('div');
  item.className = 'event-item danger';
  item.innerHTML = `<b>${when} UTC</b><br>${(REAL_DEVICE_INFO[devId]||{}).name || devId} · ${sensor} · razón ${ev.ratio.toFixed(1)}`;
  box.prepend(item);
  while(box.children.length>80) box.removeChild(box.lastChild);
}
function updateEvents(){
  const box=$('eventsList');
  if(!box) return;
  if(realEvents.length===0 && box.children.length===0){ box.innerHTML='<div class="event-item">Sin eventos detectados todavía.</div>'; }
}
function clearEvents(){
  realEvents.length = 0;
  realLastTrigger.clear();
  const box = $('eventsList');
  if(box) box.innerHTML = '<div class="event-item">Sin eventos detectados todavía.</div>';
}

// ── Ciclo de datos reales: arma objetos "nodo" con el mismo formato que usa el resto de la UI ──
async function realTick(){
  if(realPolling) return;
  realPolling = true;
  try{
    const deviceIds = Array.from(realDeviceIds);
    const results = await Promise.all(deviceIds.map(async devId=>{
      const bootstrapped = Array.from(realBuffers.keys()).some(k=>k.startsWith(devId+'·'));
      const since = bootstrapped ? newestIsoForDevice(devId) : null;
      const recs = await fetchRealLatest(devId, since);
      return { devId, recs };
    }));
    for(const r of results) ingestRealRecords(r.devId, r.recs);
    nodes = buildRealNodes();
    if(!selectedId) selectedId = nodes[0]?.id || null;
    setText('realStatus', `Conectado a la API real · ${nodes.length} estaciones · última actualización ${now()}`);
    render();
  }catch(err){
    setText('realStatus', `Error consultando la API real: ${err.message}`);
  }finally{
    realPolling = false;
  }
}
function newestIsoForDevice(devId){
  let best = null, bestT = -Infinity;
  for(const [key,buf] of realBuffers.entries()){
    if(!key.startsWith(devId+'·')) continue;
    if(buf.lastT > bestT){ bestT = buf.lastT; best = buf.lastRs; }
  }
  return best;
}
function ingestRealRecords(devId, recs){
  for(const r of recs){
    if(!r || typeof r!=='object') continue;
    const rs = r.rs; const tMs = Date.parse(rs);
    if(!Number.isFinite(tMs)) continue;
    const tSec = tMs/1000;
    const sensor = r.sensor_type || 'sensor';
    const key = `${devId}·${sensor}`;
    let buf = realBuffers.get(key);
    if(!buf){ buf = { t:[], x:[], y:[], z:[], lastT:-Infinity, lastRs:null }; realBuffers.set(key,buf); }
    if(tSec <= buf.lastT) continue;
    const toNum = v => v===null || v===undefined || v==='' ? NaN : Number(v);
    buf.t.push(tSec); buf.x.push(toNum(r.x_value)); buf.y.push(toNum(r.y_value)); buf.z.push(toNum(r.z_value));
    buf.lastT = tSec; buf.lastRs = rs;
  }
  // conserva solo los últimos ~10 minutos por sensor, suficiente para RMS/FFT/STA-LTA en vivo
  const keepFrom = Date.now()/1000 - 600;
  for(const [key,buf] of realBuffers.entries()){
    if(!key.startsWith(devId+'·')) continue;
    let i=0; while(i<buf.t.length && buf.t[i]<keepFrom) i++;
    if(i>0){ buf.t.splice(0,i); buf.x.splice(0,i); buf.y.splice(0,i); buf.z.splice(0,i); }
  }
}
function buildRealNodes(){
  const out = [];
  for(const devId of Object.keys(REAL_DEVICE_INFO)){
    const info = REAL_DEVICE_INFO[devId];
    const sensorKeys = Array.from(realBuffers.keys()).filter(k=>k.startsWith(devId+'·'));
    if(!sensorKeys.length){
      out.push({ id:devId, name:info.name, type:info.type, state:info.state, city:info.city, region:info.region,
        lat:info.lat, lon:info.lon, site:info.city, battery:null, priority:'Media',
        rmsX:0, rmsY:0, rmsZ:0, rmsGlobal:0, freqDominante:0, sampleRate:0, satellites:null, gpsFix:false,
        status:'sin_conexion', lastUpdate:now() });
      continue;
    }
    let rmsX=0,rmsY=0,rmsZ=0,freq=0,sampleRate=0,newestT=-Infinity,newestRs=null,usedKey=null;
    for(const key of sensorKeys){
      const buf = realBuffers.get(key);
      if(!buf.t.length) continue;
      if(buf.lastT > newestT){ newestT=buf.lastT; newestRs=buf.lastRs; usedKey=key; }
    }
    if(usedKey){
      const buf = realBuffers.get(usedKey);
      const tail = 20; // últimos ~20s para RMS/frecuencia, evita que datos viejos dominen
      let i0=0; while(i0<buf.t.length && buf.t[i0] < buf.t[buf.t.length-1]-tail) i0++;
      const tt=buf.t.slice(i0), xx=buf.x.slice(i0), yy=buf.y.slice(i0), zz=buf.z.slice(i0);
      rmsX=computeRms(xx); rmsY=computeRms(yy); rmsZ=computeRms(zz);
      freq = estimateDominantFrequency(tt, xx);
      if(tt.length>1) sampleRate = Math.round((tt.length-1)/(tt[tt.length-1]-tt[0]));
      // detección de eventos sobre el buffer completo del sensor más activo
      const evs = staLtaScan(usedKey, buf.t, buf.x, buf.y, buf.z, 1.0, 15.0, 3.5, 5.0);
      evs.forEach(pushRealEvent);
    }
    const rmsGlobal = Number(Math.sqrt(rmsX*rmsX+rmsY*rmsY+rmsZ*rmsZ).toFixed(5));
    const gapSec = newestT>-Infinity ? (Date.now()/1000 - newestT) : Infinity;
    let status = 'sin_conexion';
    if(gapSec < 15){
      status = rmsGlobal>0.5 ? 'alerta' : rmsGlobal>0.2 ? 'observacion' : 'activo';
    }
    out.push({
      id:devId, name:info.name, type:info.type, state:info.state, city:info.city, region:info.region,
      lat:info.lat, lon:info.lon, site:info.city, battery:null, priority:'Media',
      rmsX:Number(rmsX.toFixed(5)), rmsY:Number(rmsY.toFixed(5)), rmsZ:Number(rmsZ.toFixed(5)), rmsGlobal,
      freqDominante:Number(freq.toFixed(2)), sampleRate, satellites:null, gpsFix:false,
      status, lastUpdate: newestRs ? newestRs.slice(0,19).replace('T',' ') : now(), _gapSec:gapSec
    });
  }
  return out;
}

function filteredNodes(){
  const r=$('regionFilter')?.value || 'todas'; const t=$('typeFilter')?.value || 'todos'; const s=$('statusFilter')?.value || 'todos';
  return nodes.filter(n=>(r==='todas'||n.region===r)&&(t==='todos'||n.type===t)&&(s==='todos'||n.status===s));
}
function initMap(){
  map = L.map('map',{ preferCanvas:true, minZoom:3 }).setView(FALLBACK_CENTER,5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
  clusterGroup = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:44 });
  map.addLayer(clusterGroup);
}
function markerHtml(status){ return `<div class="custom-marker ${status}">📡</div>`; }
function updateMarkers(){
  const visible = filteredNodes();
  clusterGroup.clearLayers(); markers.clear();
  visible.forEach(n=>{
    const icon = L.divIcon({ html:markerHtml(n.status), className:'', iconSize:[42,42], iconAnchor:[21,21] });
    const m = L.marker([n.lat,n.lon],{icon}).on('click',()=>{ selectedId=n.id; render(false); });
    m.bindPopup(`<b>${n.id} · ${n.name}</b><br>${n.type}<br>${n.site}<br>Región: ${n.region}<br>RMS: ${n.rmsGlobal} m/s²<br>Freq: ${n.freqDominante} Hz<br>Estado: ${stateLabels[n.status]}`);
    markers.set(n.id,m); clusterGroup.addLayer(m);
  });
  $('visibleCount').textContent = `${visible.length} visibles`;
}
function selected(){ return nodes.find(n=>n.id===selectedId) || nodes[0]; }
function updateHeader(){
  const s=selected();
  if(!s){ setText('networkState','Conectando…'); return; }
  const active=nodes.filter(n=>n.status==='activo').length;
  const alerts=nodes.filter(n=>n.status==='alerta').length;
  const watch=nodes.filter(n=>n.status==='observacion').length;
  const off=nodes.filter(n=>n.status==='sin_conexion').length;
  const covered=new Set(nodes.map(n=>n.state)).size;
  setText('activeNodes', active); setText('totalNodes', nodes.length); setText('alertNodes', alerts); setText('watchNodes', watch); setText('offlineNodes', off);
  setText('statesCovered', covered); setText('heroSelected', s.id); setText('heroGpsFix', 'N/D'); setText('heroSats', 'N/D'); setText('heroLastUpdate', now());
  setText('networkState', 'Datos en vivo'); setText('activeRegionLabel', $('regionFilter')?.value === 'todas' ? 'Todas' : $('regionFilter')?.value);
}
function updateSelected(){
  const s=selected();
  if(!s) return;
  setText('selectedId',s.id); setText('selectedName',s.name); setText('selectedMeta',`${s.type} · ${s.site} · ${s.region}`);
  const badge=$('selectedStatus'); badge.textContent=stateLabels[s.status]; badge.className=`state-badge ${s.status}`;
  setText('rmsX',`${s.rmsX} m/s²`); setText('rmsY',`${s.rmsY} m/s²`); setText('rmsZ',`${s.rmsZ} m/s²`); setText('rmsGlobal',`${s.rmsGlobal} m/s²`);
  setText('freqDom',`${s.freqDominante} Hz`); setText('sampleRate',`${s.sampleRate} Hz`); setText('battery','N/D'); setText('satellites','N/D');
  $('jsonPacket').textContent = JSON.stringify({ device_id:s.id, name:s.name, type:s.type, state:s.state, region:s.region, lat:s.lat, lon:s.lon, rms_global_m_s2:s.rmsGlobal, freq_dominante_hz:s.freqDominante, fs_hz:s.sampleRate, status:s.status, last_update:s.lastUpdate }, null, 2);
}
function updateTable(){
  const visible=filteredNodes();
  $('nodesTable').innerHTML = visible.map(n=>`<tr data-id="${n.id}"><td><b>${n.id}</b></td><td>${n.name}</td><td>${n.state}</td><td>${n.region}</td><td>${n.type}</td><td>${n.lat.toFixed(5)}</td><td>${n.lon.toFixed(5)}</td><td>${n.rmsGlobal} m/s²</td><td>${n.freqDominante} Hz</td><td>${n.sampleRate} Hz</td><td>N/D</td><td><span class="tag ${n.status}">${stateLabels[n.status]}</span></td></tr>`).join('');
  document.querySelectorAll('#nodesTable tr').forEach(tr=>tr.addEventListener('click',()=>{
    selectedId=tr.dataset.id;
    const n=selected();
    map.setView([n.lat,n.lon],9);
    render(false);
  }));
}
function updateRegionCards(){
  const html=Object.keys(regions).map(r=>{
    const group=nodes.filter(n=>n.region===r); const alerts=group.filter(n=>['alerta','observacion','sin_conexion'].includes(n.status)).length;
    const avg=group.length ? (group.reduce((a,n)=>a+n.rmsGlobal,0)/group.length).toFixed(3) : '0.000';
    return `<div class="region-card"><h3>${r}</h3><div class="num">${group.length}</div><p>Nodos · ${alerts} eventos · RMS ${avg} m/s²</p></div>`;
  }).join('');
  $('regionCards').innerHTML=html;
}
function makeChart(ctx,datasets,labels){ return new Chart(ctx,{ type:'line', data:{labels,datasets}, options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{maxTicksLimit:8}},y:{beginAtZero:false}} } }); }
let accChart,rmsChart;
function initCharts(){
  accChart=makeChart($('accChart'),[{label:'X',data:[],borderWidth:2,pointRadius:0,tension:.35},{label:'Y',data:[],borderWidth:2,pointRadius:0,tension:.35},{label:'Z',data:[],borderWidth:2,pointRadius:0,tension:.35}],[]);
  rmsChart=makeChart($('rmsChart'),[{label:'RMS',data:[],borderWidth:2,pointRadius:0,tension:.35,fill:true}],[]);
}
function updateCharts(){
  const s=selected();
  const keys = s ? Array.from(realBuffers.keys()).filter(k=>k.startsWith(s.id+'·')) : [];
  let buf=null, bestT=-Infinity;
  for(const k of keys){ const b=realBuffers.get(k); if(b.t.length && b.lastT>bestT){ bestT=b.lastT; buf=b; } }
  const n=48; let labels=[],xs=[],ys=[],zs=[],rmsSeries=[];
  if(buf && buf.t.length){
    const from=Math.max(0,buf.t.length-n);
    for(let i=from;i<buf.t.length;i++){
      labels.push(new Date(buf.t[i]*1000).toISOString().slice(11,19));
      xs.push(buf.x[i]); ys.push(buf.y[i]); zs.push(buf.z[i]);
      rmsSeries.push(Math.sqrt((buf.x[i]||0)**2+(buf.y[i]||0)**2+(buf.z[i]||0)**2));
    }
  }
  accChart.data.labels=labels; accChart.data.datasets[0].data=xs; accChart.data.datasets[1].data=ys; accChart.data.datasets[2].data=zs; accChart.update('none');
  rmsChart.data.labels=labels; rmsChart.data.datasets[0].data=rmsSeries; rmsChart.update('none');
}
function render(refreshMarkers=true){ updateHeader(); updateSelected(); if(refreshMarkers)updateMarkers(); updateTable(); updateEvents(); updateRegionCards(); updateCharts(); }

function safeCell(value){
  return String(value ?? '').replace(/"/g,'""');
}
function downloadBlob(filename, content, mime){
  const blob = new Blob([content], { type:mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
function pad2(v){ return String(v).padStart(2,'0'); }
function toDatetimeLocalValue(date){
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
function initExportRange(){
  const end = new Date();
  const start = new Date(end.getTime() - 60*60*1000);
  if($('exportStart')) $('exportStart').value = toDatetimeLocalValue(start);
  if($('exportEnd')) $('exportEnd').value = toDatetimeLocalValue(end);
  updateExportEstimate();
}
function getExportRange(){
  const startInput = $('exportStart')?.value;
  const endInput = $('exportEnd')?.value;
  const stepSec = Math.max(1, Number($('exportStep')?.value || 5));
  let start = startInput ? new Date(startInput) : new Date(Date.now() - 60*60*1000);
  let end = endInput ? new Date(endInput) : new Date();
  if(Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())){
    throw new Error('Selecciona una fecha y hora válida para la descarga.');
  }
  if(end <= start){
    throw new Error('La fecha/hora final debe ser mayor que la inicial.');
  }
  const ms = end - start;
  const estimated = Math.floor(ms / (stepSec*1000)) + 1;
  return { start, end, stepSec, estimated };
}
function updateExportEstimate(){
  const warn = $('exportRangeWarning');
  try{
    const r = getExportRange();
    setText('exportEstimate', `hasta ${r.estimated.toLocaleString('es-MX')} registros (según disponibilidad real)`);
    if(warn) warn.textContent = '';
  }catch(err){
    setText('exportEstimate','Rango inválido');
    if(warn) warn.textContent = err.message;
  }
}
function rowsToCsv(rows){
  if(!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(row=>{
    lines.push(headers.map(h=>`"${safeCell(row[h])}"`).join(','));
  });
  return lines.join('\n');
}
function filenameForNode(ext, range=null){
  const n = selected();
  const r = range || getExportRange();
  const start = r.start.toISOString().slice(0,16).replace(/[:T]/g,'-');
  const end = r.end.toISOString().slice(0,16).replace(/[:T]/g,'-');
  return `${n.id}_datos_${start}_a_${end}.${ext}`;
}
function realRecordsToRows(recs){
  return recs.map(r=>({
    timestamp:r.rs, device_id:r.device_id, sensor_type:r.sensor_type, data_mode:r.data_mode,
    x_value:r.x_value, y_value:r.y_value, z_value:r.z_value, session_id:r.session_id
  }));
}
async function exportSelectedCsv(){
  try{
    const range = getExportRange();
    setText('realStatus', 'Descargando historial real…');
    const rows = realRecordsToRows(await fetchRealHistory(selected().id, range.start, range.end));
    if(!rows.length){ alert('No hay registros reales en ese rango.'); return; }
    downloadBlob(filenameForNode('csv', range), rowsToCsv(rows), 'text/csv;charset=utf-8');
  }catch(err){ alert(err.message); }
}
async function exportSelectedExcel(){
  try{
  const n = selected();
  const range = getExportRange();
  setText('realStatus', 'Descargando historial real…');
  const rows = realRecordsToRows(await fetchRealHistory(n.id, range.start, range.end));
  if(!rows.length){ alert('No hay registros reales en ese rango.'); return; }
  if(window.XLSX){
    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsData, 'Historial nodo');
    const meta = [
      ['Campo','Valor'],
      ['device_id', n.id], ['name', n.name], ['type', n.type], ['state', n.state], ['region', n.region],
      ['range_start', range.start.toISOString()], ['range_end', range.end.toISOString()], ['exported_rows', rows.length],
      ['lat', n.lat], ['lon', n.lon],
      ['rms_global_m_s2', n.rmsGlobal], ['freq_dominante_hz', n.freqDominante], ['sample_rate_hz', n.sampleRate],
      ['status', stateLabels[n.status] || n.status]
    ];
    const wsMeta = XLSX.utils.aoa_to_sheet(meta);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadatos');
    XLSX.writeFile(wb, filenameForNode('xlsx', range));
    return;
  }
  // Respaldo si no carga la librería externa: Excel abre este archivo .xls basado en HTML.
  const headers = Object.keys(rows[0]);
  const table = `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${safeCell(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  downloadBlob(filenameForNode('xls', range), table, 'application/vnd.ms-excel;charset=utf-8');
  }catch(err){ alert(err.message); }
}
function exportSnapshotCsv(){
  const headers=['id','name','type','state','region','lat','lon','rms_global_m_s2','freq_dominante_hz','fs_hz','status','last_update'];
  const rows=nodes.map(n=>headers.map(h=>String({...n,rms_global_m_s2:n.rmsGlobal,freq_dominante_hz:n.freqDominante,fs_hz:n.sampleRate}[h]??'').replaceAll(',',';')).join(','));
  downloadBlob('red_shm_snapshot.csv', [headers.join(','),...rows].join('\n'), 'text/csv;charset=utf-8');
}
function bind(){
  $('btnClearEvents')?.addEventListener('click', clearEvents);
  $('btnExport')?.addEventListener('click', exportSnapshotCsv);
  $('btnExportSelectedCsv').addEventListener('click',exportSelectedCsv);
  $('btnExportSelectedExcel').addEventListener('click',exportSelectedExcel);
  $('btnNationalView')?.addEventListener('click',()=>{
    const pts = nodes.map(n=>[n.lat,n.lon]);
    if(pts.length) map.fitBounds(L.latLngBounds(pts), { padding:[40,40] });
  });
  ['exportStart','exportEnd','exportStep'].forEach(id=>$(id)?.addEventListener('change',updateExportEstimate));
  ['regionFilter','typeFilter','statusFilter'].forEach(id=>$(id).addEventListener('change',()=>render(true)));
}
function boot(){
  initMap(); initCharts(); bind(); initExportRange();
  setText('realStatus','Conectando con la API real…');
  fetchRealDeviceList().then(ids=>{
    ids.forEach(id=>realDeviceIds.add(id));
    nodes = buildRealNodes();
    selectedId = nodes[0]?.id || null;
    const pts = nodes.map(n=>[n.lat,n.lon]);
    if(pts.length) map.fitBounds(L.latLngBounds(pts), { padding:[40,40] });
    render();
    realTick();
    setInterval(realTick, REAL_POLL_MS);
  });
}
boot();
