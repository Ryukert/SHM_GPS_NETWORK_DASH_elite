const $ = (id) => document.getElementById(id);
const stateLabels = { activo:'Activo', observacion:'Observación', alerta:'Alerta', bateria_baja:'Batería baja' };
let nodes = [
  { id:'SHM-01', name:'Nodo Puente Norte', type:'Puente', lat:32.51490, lon:-117.03820, site:'Tijuana, B.C.', battery:92 },
  { id:'SHM-02', name:'Nodo Edificio A', type:'Edificio', lat:32.50720, lon:-117.02710, site:'Zona Urbana', battery:76 },
  { id:'SHM-03', name:'Nodo Mesa Vibradora', type:'Laboratorio', lat:32.50120, lon:-117.01140, site:'Banco experimental', battery:100 },
  { id:'SHM-04', name:'Nodo Talud Experimental', type:'Talud', lat:32.48970, lon:-117.04110, site:'Ladera / Talud', battery:61 },
  { id:'SHM-05', name:'Nodo Edificio B', type:'Edificio', lat:32.52540, lon:-117.01790, site:'Campus', battery:44 }
];
let selectedId = 'SHM-01';
let running = true;
let timer = null;
let speed = 1500;
let mode = 'campo';
let map;
const markers = new Map();
const events = [];
const series = Array.from({length:42},(_,i)=>({ t:String(i).padStart(2,'0'), x:rnd(-3,3), y:rnd(-3,3), z:rnd(-2,2), rms:rnd(.03,.13) }));
function rnd(min,max,dec=3){ return Number((Math.random()*(max-min)+min).toFixed(dec)); }
function now(){ return new Date().toLocaleTimeString('es-MX',{hour12:false}); }
function runtime(node){
  const isRisk = node.id === 'SHM-04' || mode === 'evento';
  const rmsX = rnd(.012, isRisk ? .24 : .13);
  const rmsY = rnd(.010, isRisk ? .21 : .12);
  const rmsZ = rnd(.006, isRisk ? .13 : .08);
  const rmsGlobal = Number(Math.sqrt(rmsX*rmsX + rmsY*rmsY + rmsZ*rmsZ).toFixed(3));
  const freqDominante = rnd(isRisk ? 7.2 : 2.1, isRisk ? 11.8 : 7.4, 2);
  const sampleRate = rnd(158,168,0);
  const satellites = rnd(7,14,0);
  const gpsFix = satellites >= 7;
  let status = 'activo';
  if(node.battery < 25) status = 'bateria_baja';
  else if(rmsGlobal > .21 || freqDominante > 10.2) status = 'alerta';
  else if(rmsGlobal > .145 || freqDominante > 8.1) status = 'observacion';
  return { ...node, rmsX,rmsY,rmsZ,rmsGlobal,freqDominante,sampleRate,satellites,gpsFix,status,lastUpdate:now() };
}
function initMap(){
  map = L.map('map').setView([32.507, -117.028], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
}
function markerHtml(status){ return `<div class="custom-marker ${status}">📡</div>`; }
function updateMarkers(){
  nodes.forEach(n=>{
    const html = markerHtml(n.status);
    const icon = L.divIcon({ html, className:'', iconSize:[42,42], iconAnchor:[21,21] });
    if(!markers.has(n.id)){
      const m = L.marker([n.lat,n.lon],{icon}).addTo(map).on('click',()=>{ selectedId=n.id; render(); });
      markers.set(n.id,m);
    }
    const marker = markers.get(n.id);
    marker.setLatLng([n.lat,n.lon]);
    marker.setIcon(icon);
    marker.bindPopup(`<b>${n.id} · ${n.name}</b><br>${n.type}<br>RMS: ${n.rmsGlobal} mm/s²<br>Freq: ${n.freqDominante} Hz<br>Estado: ${stateLabels[n.status]}`);
  });
}
function selected(){ return nodes.find(n=>n.id===selectedId) || nodes[0]; }
function setText(id,v){ const el=$(id); if(el) el.textContent=v; }
function updateHeader(){
  const active = nodes.filter(n=>n.status==='activo').length;
  const alerts = nodes.filter(n=>n.status==='alerta' || n.status==='bateria_baja').length;
  const watch = nodes.filter(n=>n.status==='observacion').length;
  const s = selected();
  setText('activeNodes', active); setText('totalNodes', nodes.length); setText('alertNodes', alerts); setText('watchNodes', watch);
  setText('heroSelected', s.id); setText('heroGpsFix', s.gpsFix ? 'Sí' : 'No'); setText('heroSats', s.satellites); setText('heroLastUpdate', now());
  setText('networkState', running ? 'Simulación activa' : 'Simulación pausada');
}
function updateSelected(){
  const s = selected();
  setText('selectedId', s.id); setText('selectedName', s.name); setText('selectedMeta', `${s.type} · ${s.site}`);
  const badge = $('selectedStatus'); badge.textContent = stateLabels[s.status]; badge.className = `state-badge ${s.status}`;
  setText('rmsX', `${s.rmsX} mm/s²`); setText('rmsY', `${s.rmsY} mm/s²`); setText('rmsZ', `${s.rmsZ} mm/s²`); setText('rmsGlobal', `${s.rmsGlobal} mm/s²`);
  setText('freqDom', `${s.freqDominante} Hz`); setText('sampleRate', `${s.sampleRate} Hz`); setText('battery', `${s.battery}%`); setText('satellites', s.satellites);
  $('jsonPacket').textContent = JSON.stringify({ device_id:s.id, name:s.name, lat:s.lat, lon:s.lon, gps_fix:s.gpsFix, satellites:s.satellites, rms_global_mm_s2:s.rmsGlobal, freq_dominante_hz:s.freqDominante, fs_hz:s.sampleRate, status:s.status, last_update:s.lastUpdate }, null, 2);
}
function updateTable(){
  $('nodesTable').innerHTML = nodes.map(n=>`<tr data-id="${n.id}"><td><b>${n.id}</b></td><td>${n.name}</td><td>${n.type}</td><td>${n.lat.toFixed(5)}</td><td>${n.lon.toFixed(5)}</td><td>${n.rmsGlobal} mm/s²</td><td>${n.freqDominante} Hz</td><td>${n.sampleRate} Hz</td><td>${n.battery}%</td><td><span class="tag ${n.status}">${stateLabels[n.status]}</span></td></tr>`).join('');
  document.querySelectorAll('#nodesTable tr').forEach(tr=>tr.addEventListener('click',()=>{ selectedId=tr.dataset.id; render(); }));
}
function pushEvent(n){
  if(n.status === 'activo') return;
  const msg = `${n.id}: ${stateLabels[n.status]} · RMS ${n.rmsGlobal} mm/s² · ${n.freqDominante} Hz`;
  if(events[0]?.msg === msg) return;
  events.unshift({ msg, status:n.status, time:now() });
  events.splice(10);
}
function updateEvents(){
  const box = $('eventsList');
  if(events.length===0){ box.innerHTML = '<div class="event-item">Sin eventos críticos.</div>'; return; }
  box.innerHTML = events.map(e=>`<div class="event-item ${e.status==='alerta'?'danger':''}"><b>${e.time}</b><br>${e.msg}</div>`).join('');
}
function makeChart(ctx, datasets){
  return new Chart(ctx,{ type:'line', data:{ labels:series.map(p=>p.t), datasets }, options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{maxTicksLimit:8}},y:{beginAtZero:false}} } });
}
let accChart, rmsChart;
function initCharts(){
  accChart = makeChart($('accChart'),[
    {label:'X',data:series.map(p=>p.x),borderWidth:2,pointRadius:0,tension:.35},
    {label:'Y',data:series.map(p=>p.y),borderWidth:2,pointRadius:0,tension:.35},
    {label:'Z',data:series.map(p=>p.z),borderWidth:2,pointRadius:0,tension:.35}
  ]);
  rmsChart = makeChart($('rmsChart'),[{label:'RMS',data:series.map(p=>p.rms),borderWidth:2,pointRadius:0,tension:.35,fill:true}]);
}
function updateCharts(){
  const s = selected();
  const eventBoost = s.status === 'alerta' ? 1.8 : s.status === 'observacion' ? 1.35 : 1;
  series.push({ t:now().slice(3), x:rnd(-3.5*eventBoost,3.5*eventBoost), y:rnd(-3*eventBoost,3*eventBoost), z:rnd(-2*eventBoost,2*eventBoost), rms:s.rmsGlobal });
  series.splice(0, Math.max(0, series.length-42));
  accChart.data.labels = series.map(p=>p.t); accChart.data.datasets[0].data=series.map(p=>p.x); accChart.data.datasets[1].data=series.map(p=>p.y); accChart.data.datasets[2].data=series.map(p=>p.z); accChart.update('none');
  rmsChart.data.labels = series.map(p=>p.t); rmsChart.data.datasets[0].data=series.map(p=>p.rms); rmsChart.update('none');
}
function tick(){
  nodes = nodes.map(n=>runtime(n));
  nodes.forEach(pushEvent);
  render();
}
function render(){ updateHeader(); updateSelected(); updateMarkers(); updateTable(); updateEvents(); updateCharts(); }
function resetTimer(){ if(timer) clearInterval(timer); timer = setInterval(()=>{ if(running) tick(); }, speed); }
function addNode(){
  const i = nodes.length + 1;
  nodes.push(runtime({ id:`SHM-${String(i).padStart(2,'0')}`, name:`Nodo Simulado ${i}`, type:'Estructura', lat:rnd(32.488,32.527,5), lon:rnd(-117.047,-117.010,5), site:'Punto simulado', battery:rnd(45,100,0) }));
  render();
}
function exportCsv(){
  const header = ['id','name','type','lat','lon','rms_global','freq_hz','sample_rate_hz','battery','status','last_update'];
  const rows = nodes.map(n=>[n.id,n.name,n.type,n.lat,n.lon,n.rmsGlobal,n.freqDominante,n.sampleRate,n.battery,n.status,n.lastUpdate]);
  const csv = [header,...rows].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`shm_nodes_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
function wire(){
  $('btnToggle').addEventListener('click',()=>{ running=!running; $('btnToggle').textContent = running ? 'Pausar simulación' : 'Reanudar simulación'; render(); });
  $('btnAddNode').addEventListener('click',addNode);
  $('btnClearEvents').addEventListener('click',()=>{ events.splice(0); updateEvents(); });
  $('btnExport').addEventListener('click',exportCsv);
  $('speedSelect').addEventListener('change',e=>{ speed=Number(e.target.value); resetTimer(); });
  $('modeSelect').addEventListener('change',e=>{ mode=e.target.value; tick(); });
}
window.addEventListener('DOMContentLoaded',()=>{
  nodes = nodes.map(runtime);
  initMap(); initCharts(); wire(); render(); resetTimer();
});
