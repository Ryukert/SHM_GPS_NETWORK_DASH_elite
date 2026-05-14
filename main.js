const $ = (id) => document.getElementById(id);
const stateLabels = { activo:'Activo', observacion:'Observación', alerta:'Alerta', bateria_baja:'Batería baja', sin_conexion:'Sin conexión' };
const regions = {
  'Noroeste':['Baja California','Baja California Sur','Sonora','Sinaloa'],
  'Norte':['Chihuahua','Coahuila','Nuevo León','Durango','Zacatecas','San Luis Potosí','Tamaulipas'],
  'Occidente':['Nayarit','Jalisco','Colima','Michoacán','Aguascalientes','Guanajuato'],
  'Centro':['Querétaro','Hidalgo','Estado de México','Ciudad de México','Morelos','Tlaxcala','Puebla'],
  'Sur-Sureste':['Guerrero','Oaxaca','Chiapas','Veracruz','Tabasco','Campeche','Yucatán','Quintana Roo']
};
const capitals = [
  ['Baja California','Mexicali',32.6245,-115.4523],['Baja California Sur','La Paz',24.1426,-110.3128],['Sonora','Hermosillo',29.0729,-110.9559],['Sinaloa','Culiacán',24.8091,-107.3940],
  ['Chihuahua','Chihuahua',28.6353,-106.0889],['Coahuila','Saltillo',25.4380,-100.9737],['Nuevo León','Monterrey',25.6866,-100.3161],['Durango','Durango',24.0277,-104.6532],['Zacatecas','Zacatecas',22.7709,-102.5832],['San Luis Potosí','San Luis Potosí',22.1565,-100.9855],['Tamaulipas','Ciudad Victoria',23.7369,-99.1411],
  ['Nayarit','Tepic',21.5042,-104.8946],['Jalisco','Guadalajara',20.6597,-103.3496],['Colima','Colima',19.2452,-103.7241],['Michoacán','Morelia',19.7008,-101.1844],['Aguascalientes','Aguascalientes',21.8853,-102.2916],['Guanajuato','Guanajuato',21.0190,-101.2574],
  ['Querétaro','Querétaro',20.5888,-100.3899],['Hidalgo','Pachuca',20.1011,-98.7591],['Estado de México','Toluca',19.2826,-99.6557],['Ciudad de México','CDMX',19.4326,-99.1332],['Morelos','Cuernavaca',18.9242,-99.2216],['Tlaxcala','Tlaxcala',19.3182,-98.2375],['Puebla','Puebla',19.0414,-98.2063],
  ['Guerrero','Chilpancingo',17.5515,-99.5058],['Oaxaca','Oaxaca',17.0732,-96.7266],['Chiapas','Tuxtla Gutiérrez',16.7569,-93.1292],['Veracruz','Xalapa',19.5438,-96.9102],['Tabasco','Villahermosa',17.9895,-92.9475],['Campeche','Campeche',19.8301,-90.5349],['Yucatán','Mérida',20.9674,-89.5926],['Quintana Roo','Chetumal',18.5001,-88.2961]
];
const types = ['Puente','Edificio','Talud','Presa','Laboratorio','Patrimonio'];
const mexicoPolygons = {
  baja: [
    [32.72,-117.13],[31.80,-116.55],[30.00,-115.55],[28.20,-114.35],[26.10,-113.15],[24.10,-111.60],[22.85,-110.25],[23.40,-109.65],[25.30,-110.70],[27.60,-112.00],[29.80,-113.55],[31.90,-115.10]
  ],
  mainland: [
    [32.70,-114.85],[31.40,-111.10],[29.80,-108.50],[28.00,-105.10],[26.30,-102.20],[25.60,-99.40],[24.60,-97.40],[22.80,-97.20],[21.80,-97.90],[21.25,-90.25],[20.60,-87.00],[18.25,-87.55],[17.10,-90.60],[15.85,-92.20],[14.75,-92.10],[15.40,-95.00],[16.20,-97.90],[16.90,-100.30],[17.60,-102.80],[18.70,-104.70],[20.60,-106.70],[22.80,-108.10],[25.10,-109.10],[27.30,-110.05],[29.70,-111.15],[31.50,-112.70]
  ]
};
function pointInPoly(lat, lon, poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=poly[i][0], xi=poly[i][1];
    const yj=poly[j][0], xj=poly[j][1];
    const intersect=((yi>lat)!==(yj>lat)) && (lon < (xj-xi)*(lat-yi)/(yj-yi+1e-12)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function randomFromPolygon(poly){
  const lats=poly.map(p=>p[0]), lons=poly.map(p=>p[1]);
  const minLat=Math.min(...lats), maxLat=Math.max(...lats), minLon=Math.min(...lons), maxLon=Math.max(...lons);
  for(let tries=0; tries<500; tries++){
    const lat=rnd(minLat,maxLat,5), lon=rnd(minLon,maxLon,5);
    if(pointInPoly(lat,lon,poly)) return [lat,lon];
  }
  return [rnd(minLat,maxLat,5), rnd(minLon,maxLon,5)];
}
function randomMexicoPoint(){
  // 14% de los nodos en península de Baja California y 86% en territorio continental/peninsular.
  return Math.random()<0.14 ? randomFromPolygon(mexicoPolygons.baja) : randomFromPolygon(mexicoPolygons.mainland);
}
function nearestCapital(lat, lon){
  let best=capitals[0], bestD=Infinity;
  capitals.forEach(base=>{
    const d=((base[2]-lat)*1.18)**2 + ((base[3]-lon)*Math.cos(lat*Math.PI/180))**2;
    if(d<bestD){ bestD=d; best=base; }
  });
  return best;
}

let nodes = [];
let selectedId = 'SHM-MX-001';
let running = true;
let timer = null;
let speed = 1800;
let mode = 'campo';
let forcedRegionEvent = null;
let map, clusterGroup;
const markers = new Map();
const events = [];
const series = Array.from({length:48},(_,i)=>({ t:String(i).padStart(2,'0'), x:rnd(-3,3), y:rnd(-3,3), z:rnd(-2,2), rms:rnd(.03,.13) }));
function rnd(min,max,dec=3){ return Number((Math.random()*(max-min)+min).toFixed(dec)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function now(){ return new Date().toLocaleTimeString('es-MX',{hour12:false}); }
function regionForState(state){ return Object.entries(regions).find(([,states])=>states.includes(state))?.[0] || 'Centro'; }
function makeNode(base, idx, copy=0){
  const [state, city, lat, lon] = base;
  const region = regionForState(state);
  const type = pick(types);
  const jitter = region === 'Centro' ? 0.35 : 0.65;
  return {
    id:`SHM-MX-${String(idx).padStart(3,'0')}`,
    name:`Nodo ${type} ${city}${copy?`-${copy}`:''}`,
    type, state, city, region,
    lat:rnd(lat-jitter,lat+jitter,5), lon:rnd(lon-jitter,lon+jitter,5),
    site:`${city}, ${state}`,
    battery:rnd(18,100,0),
    installed:rnd(2024,2026,0),
    priority: pick(['Alta','Media','Baja'])
  };
}
function makeTerritoryNode(idx){
  const [lat, lon] = randomMexicoPoint();
  const [state, city] = nearestCapital(lat, lon);
  const region = regionForState(state);
  const type = pick(types);
  const zone = pick(['Urbano','Rural','Costa','Sierra','Valle','Infraestructura crítica','Corredor carretero','Zona sísmica']);
  return {
    id:`SHM-MX-${String(idx).padStart(3,'0')}`,
    name:`Nodo ${type} ${zone}`,
    type, state, city, region,
    lat:rnd(lat-0.015,lat+0.015,5), lon:rnd(lon-0.015,lon+0.015,5),
    site:`${zone}, ${state}`,
    battery:rnd(18,100,0),
    installed:rnd(2024,2026,0),
    priority: pick(['Alta','Media','Baja'])
  };
}
function generateNationalNodes(){
  const out=[]; let idx=1;
  // Cobertura base: al menos 4 nodos por estado alrededor de capitales/zonas urbanas.
  capitals.forEach(base=>{ for(let c=0;c<4;c++){ out.push(makeNode(base,idx++,c+1)); } });
  // Cobertura territorial: nodos pseudoaleatorios dentro de polígonos aproximados de México.
  while(out.length < 650){ out.push(makeTerritoryNode(idx++)); }
  return out.map(runtime);
}
function runtime(node){
  const inForced = forcedRegionEvent && node.region === forcedRegionEvent;
  const isRisk = mode === 'evento' || inForced || ['Guerrero','Oaxaca','Chiapas','Ciudad de México','Puebla','Michoacán','Jalisco','Baja California'].includes(node.state) && Math.random() < .22;
  if(Math.random() < .015) node.battery = Math.max(5,node.battery-1);
  const offline = Math.random() < .01 || node.battery < 10;
  const rmsX = rnd(.010, isRisk ? .32 : .13);
  const rmsY = rnd(.010, isRisk ? .28 : .12);
  const rmsZ = rnd(.006, isRisk ? .18 : .08);
  const rmsGlobal = Number(Math.sqrt(rmsX*rmsX + rmsY*rmsY + rmsZ*rmsZ).toFixed(3));
  const freqDominante = rnd(isRisk ? 6.8 : 1.8, isRisk ? 13.4 : 7.6, 2);
  const sampleRate = offline ? 0 : rnd(158,168,0);
  const satellites = offline ? 0 : rnd(6,15,0);
  const gpsFix = satellites >= 7;
  let status = 'activo';
  if(offline) status = 'sin_conexion';
  else if(node.battery < 25) status = 'bateria_baja';
  else if(rmsGlobal > .23 || freqDominante > 10.6) status = 'alerta';
  else if(rmsGlobal > .145 || freqDominante > 8.1) status = 'observacion';
  return { ...node, rmsX,rmsY,rmsZ,rmsGlobal,freqDominante,sampleRate,satellites,gpsFix,status,lastUpdate:now() };
}
function filteredNodes(){
  const r=$('regionFilter')?.value || 'todas'; const t=$('typeFilter')?.value || 'todos'; const s=$('statusFilter')?.value || 'todos';
  return nodes.filter(n=>(r==='todas'||n.region===r)&&(t==='todos'||n.type===t)&&(s==='todos'||n.status===s));
}
function initMap(){
  map = L.map('map',{preferCanvas:true}).setView([23.7,-102.5],5);
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
    m.bindPopup(`<b>${n.id} · ${n.name}</b><br>${n.type}<br>${n.site}<br>Región: ${n.region}<br>RMS: ${n.rmsGlobal} mm/s²<br>Freq: ${n.freqDominante} Hz<br>Estado: ${stateLabels[n.status]}`);
    markers.set(n.id,m); clusterGroup.addLayer(m);
  });
  $('visibleCount').textContent = `${visible.length} visibles`;
}
function selected(){ return nodes.find(n=>n.id===selectedId) || nodes[0]; }
function setText(id,v){ const el=$(id); if(el) el.textContent=v; }
function updateHeader(){
  const active=nodes.filter(n=>n.status==='activo').length;
  const alerts=nodes.filter(n=>n.status==='alerta'||n.status==='bateria_baja').length;
  const watch=nodes.filter(n=>n.status==='observacion').length;
  const off=nodes.filter(n=>n.status==='sin_conexion').length;
  const covered=new Set(nodes.map(n=>n.state)).size; const s=selected();
  setText('activeNodes', active); setText('totalNodes', nodes.length); setText('alertNodes', alerts); setText('watchNodes', watch); setText('offlineNodes', off);
  setText('statesCovered', covered); setText('heroSelected', s.id); setText('heroGpsFix', s.gpsFix ? 'Sí' : 'No'); setText('heroSats', s.satellites); setText('heroLastUpdate', now());
  setText('networkState', running ? 'Simulación activa' : 'Simulación pausada'); setText('activeRegionLabel', $('regionFilter')?.value === 'todas' ? 'Todas' : $('regionFilter')?.value);
}
function updateSelected(){
  const s=selected();
  setText('selectedId',s.id); setText('selectedName',s.name); setText('selectedMeta',`${s.type} · ${s.site} · ${s.region}`);
  const badge=$('selectedStatus'); badge.textContent=stateLabels[s.status]; badge.className=`state-badge ${s.status}`;
  setText('rmsX',`${s.rmsX} mm/s²`); setText('rmsY',`${s.rmsY} mm/s²`); setText('rmsZ',`${s.rmsZ} mm/s²`); setText('rmsGlobal',`${s.rmsGlobal} mm/s²`);
  setText('freqDom',`${s.freqDominante} Hz`); setText('sampleRate',`${s.sampleRate} Hz`); setText('battery',`${s.battery}%`); setText('satellites',s.satellites);
  $('jsonPacket').textContent = JSON.stringify({ device_id:s.id, name:s.name, type:s.type, state:s.state, region:s.region, lat:s.lat, lon:s.lon, gps_fix:s.gpsFix, satellites:s.satellites, rms_global_mm_s2:s.rmsGlobal, freq_dominante_hz:s.freqDominante, fs_hz:s.sampleRate, battery_percent:s.battery, status:s.status, last_update:s.lastUpdate }, null, 2);
}
function updateTable(){
  const visible=filteredNodes().slice(0,120);
  $('nodesTable').innerHTML = visible.map(n=>`<tr data-id="${n.id}"><td><b>${n.id}</b></td><td>${n.name}</td><td>${n.state}</td><td>${n.region}</td><td>${n.type}</td><td>${n.lat.toFixed(5)}</td><td>${n.lon.toFixed(5)}</td><td>${n.rmsGlobal} mm/s²</td><td>${n.freqDominante} Hz</td><td>${n.sampleRate} Hz</td><td>${n.battery}%</td><td><span class="tag ${n.status}">${stateLabels[n.status]}</span></td></tr>`).join('');
  document.querySelectorAll('#nodesTable tr').forEach(tr=>tr.addEventListener('click',()=>{ selectedId=tr.dataset.id; const n=selected(); map.setView([n.lat,n.lon],8); render(false); }));
}
function pushEvent(n){
  if(n.status==='activo') return;
  if(Math.random() > .18 && events.length>0) return;
  const msg=`${n.id} · ${n.state}: ${stateLabels[n.status]} · RMS ${n.rmsGlobal} mm/s² · ${n.freqDominante} Hz`;
  if(events[0]?.msg===msg) return;
  events.unshift({msg,status:n.status,time:now()}); events.splice(18);
}
function updateEvents(){
  const box=$('eventsList');
  if(events.length===0){ box.innerHTML='<div class="event-item">Sin eventos críticos.</div>'; return; }
  box.innerHTML=events.map(e=>`<div class="event-item ${e.status==='alerta'?'danger':e.status==='sin_conexion'?'gray':''}"><b>${e.time}</b><br>${e.msg}</div>`).join('');
}
function updateRegionCards(){
  const html=Object.keys(regions).map(r=>{
    const group=nodes.filter(n=>n.region===r); const alerts=group.filter(n=>['alerta','observacion','bateria_baja','sin_conexion'].includes(n.status)).length;
    const avg=group.length ? (group.reduce((a,n)=>a+n.rmsGlobal,0)/group.length).toFixed(3) : '0.000';
    return `<div class="region-card"><h3>${r}</h3><div class="num">${group.length}</div><p>Nodos · ${alerts} eventos · RMS ${avg} mm/s²</p></div>`;
  }).join('');
  $('regionCards').innerHTML=html;
}
function makeChart(ctx,datasets){ return new Chart(ctx,{ type:'line', data:{labels:series.map(p=>p.t),datasets}, options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{maxTicksLimit:8}},y:{beginAtZero:false}} } }); }
let accChart,rmsChart;
function initCharts(){
  accChart=makeChart($('accChart'),[{label:'X',data:series.map(p=>p.x),borderWidth:2,pointRadius:0,tension:.35},{label:'Y',data:series.map(p=>p.y),borderWidth:2,pointRadius:0,tension:.35},{label:'Z',data:series.map(p=>p.z),borderWidth:2,pointRadius:0,tension:.35}]);
  rmsChart=makeChart($('rmsChart'),[{label:'RMS',data:series.map(p=>p.rms),borderWidth:2,pointRadius:0,tension:.35,fill:true}]);
}
function updateCharts(){
  const s=selected(); const boost=s.status==='alerta'?2:s.status==='observacion'?1.35:s.status==='sin_conexion'?0.05:1;
  series.push({t:now().slice(3),x:rnd(-3.5*boost,3.5*boost),y:rnd(-3*boost,3*boost),z:rnd(-2*boost,2*boost),rms:s.rmsGlobal}); series.splice(0,Math.max(0,series.length-48));
  accChart.data.labels=series.map(p=>p.t); accChart.data.datasets[0].data=series.map(p=>p.x); accChart.data.datasets[1].data=series.map(p=>p.y); accChart.data.datasets[2].data=series.map(p=>p.z); accChart.update('none');
  rmsChart.data.labels=series.map(p=>p.t); rmsChart.data.datasets[0].data=series.map(p=>p.rms); rmsChart.update('none');
}
function tick(){ nodes=nodes.map(n=>runtime(n)); nodes.forEach(pushEvent); render(); }
function render(refreshMarkers=true){ updateHeader(); updateSelected(); if(refreshMarkers)updateMarkers(); updateTable(); updateEvents(); updateRegionCards(); updateCharts(); }
function resetTimer(){ if(timer)clearInterval(timer); timer=setInterval(()=>{ if(running)tick(); },speed); }
function addNodes(count=100){
  let idx=nodes.length+1;
  for(let i=0;i<count;i++){ nodes.push(runtime(makeTerritoryNode(idx++))); }
  render();
}

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
function hashString(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed){
  return function(){
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    const capped = r.estimated > 10000;
    setText('exportEstimate', `${Math.min(r.estimated,10000).toLocaleString('es-MX')} registros${capped ? ' (límite demo)' : ''}`);
    if(warn) warn.textContent = capped ? 'El rango seleccionado genera más de 10,000 registros. Para mantener fluido el navegador, esta versión demo limitará la descarga a 10,000 filas. Puedes aumentar el intervalo.' : '';
  }catch(err){
    setText('exportEstimate','Rango inválido');
    if(warn) warn.textContent = err.message;
  }
}
function generateSelectedNodeHistory(n, rangeOverride=null){
  const range = rangeOverride || getExportRange();
  const rand = mulberry32(hashString(`${n.id}-${range.start.toISOString()}-${range.end.toISOString()}-${range.stepSec}`));
  const rows = [];
  const maxRows = 10000;
  const totalRows = Math.min(range.estimated, maxRows);
  const baseFreq = Number(n.freqDominante) || 4.5;
  const riskFactor = n.status === 'alerta' ? 2.2 : n.status === 'observacion' ? 1.55 : n.status === 'bateria_baja' ? 1.15 : n.status === 'sin_conexion' ? 0.05 : 1;
  const stepMs = range.stepSec * 1000;
  for(let i=0;i<totalRows;i++){
    const timestampMs = range.start.getTime() + i*stepMs;
    if(timestampMs > range.end.getTime()) break;
    const timestamp = new Date(timestampMs).toISOString();
    const t = i * range.stepSec;
    const drift = Math.sin(i/180) * 0.08 * riskFactor;
    const noiseX = (rand() - 0.5) * 0.035 * riskFactor;
    const noiseY = (rand() - 0.5) * 0.030 * riskFactor;
    const noiseZ = (rand() - 0.5) * 0.022 * riskFactor;
    const ax = Number((Math.sin(2*Math.PI*baseFreq*t) * (n.rmsX || .05) * 8 + drift + noiseX).toFixed(5));
    const ay = Number((Math.cos(2*Math.PI*(baseFreq*.82)*t) * (n.rmsY || .05) * 8 + drift*.7 + noiseY).toFixed(5));
    const az = Number((Math.sin(2*Math.PI*(baseFreq*.48)*t) * (n.rmsZ || .03) * 6 + drift*.45 + noiseZ).toFixed(5));
    const rms = Number(Math.sqrt(ax*ax + ay*ay + az*az).toFixed(5));
    rows.push({
      timestamp,
      range_start:range.start.toISOString(),
      range_end:range.end.toISOString(),
      export_interval_seconds:range.stepSec,
      device_id:n.id,
      node_name:n.name,
      structure_type:n.type,
      state:n.state,
      region:n.region,
      city_reference:n.city,
      site:n.site,
      latitude:n.lat,
      longitude:n.lon,
      gps_fix:n.gpsFix ? 'true' : 'false',
      satellites:n.satellites,
      acceleration_x_mm_s2:ax,
      acceleration_y_mm_s2:ay,
      acceleration_z_mm_s2:az,
      rms_mm_s2:rms,
      rms_global_node_mm_s2:n.rmsGlobal,
      dominant_frequency_hz:n.freqDominante,
      sample_rate_hz:n.sampleRate,
      battery_percent:n.battery,
      status:n.status,
      condition:stateLabels[n.status] || n.status
    });
  }
  return rows;
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
function exportSelectedCsv(){
  try{
    const range = getExportRange();
    const rows = generateSelectedNodeHistory(selected(), range);
    downloadBlob(filenameForNode('csv', range), rowsToCsv(rows), 'text/csv;charset=utf-8');
  }catch(err){ alert(err.message); }
}
function exportSelectedExcel(){
  try{
  const n = selected();
  const range = getExportRange();
  const rows = generateSelectedNodeHistory(n, range);
  if(window.XLSX){
    const wb = XLSX.utils.book_new();
    const wsData = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, wsData, 'Historial nodo');
    const meta = [
      ['Campo','Valor'],
      ['device_id', n.id], ['name', n.name], ['type', n.type], ['state', n.state], ['region', n.region],
      ['range_start', range.start.toISOString()], ['range_end', range.end.toISOString()], ['export_interval_seconds', range.stepSec], ['exported_rows', rows.length],
      ['lat', n.lat], ['lon', n.lon], ['gps_fix', n.gpsFix], ['satellites', n.satellites],
      ['rms_global_mm_s2', n.rmsGlobal], ['freq_dominante_hz', n.freqDominante], ['sample_rate_hz', n.sampleRate],
      ['battery_percent', n.battery], ['status', stateLabels[n.status] || n.status]
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

function exportCsv(){
  const headers=['id','name','type','state','region','lat','lon','rms_global','freq_dominante_hz','fs_hz','battery','status','last_update'];
  const rows=nodes.map(n=>headers.map(h=>String(n[h]??'').replaceAll(',',';')).join(','));
  downloadBlob('red_nacional_shm_gps.csv', [headers.join(','),...rows].join('\n'), 'text/csv;charset=utf-8');
}
function bind(){
  $('btnToggle').addEventListener('click',()=>{running=!running; $('btnToggle').textContent=running?'Pausar simulación':'Reanudar simulación'; updateHeader();});
  $('btnAddNodes').addEventListener('click',()=>addNodes(100));
  $('btnClearEvents').addEventListener('click',()=>{events.length=0; updateEvents();});
  $('btnExport').addEventListener('click',exportCsv);
  $('btnExportSelectedCsv').addEventListener('click',exportSelectedCsv);
  $('btnExportSelectedExcel').addEventListener('click',exportSelectedExcel);
  $('btnNationalView').addEventListener('click',()=>map.setView([23.7,-102.5],5));
  $('btnEventPacifico').addEventListener('click',()=>{forcedRegionEvent='Sur-Sureste'; mode='evento'; $('modeSelect').value='evento'; tick(); setTimeout(()=>forcedRegionEvent=null,12000);});
  $('btnEventCentro').addEventListener('click',()=>{forcedRegionEvent='Centro'; mode='evento'; $('modeSelect').value='evento'; tick(); setTimeout(()=>forcedRegionEvent=null,12000);});
  $('speedSelect').addEventListener('change',e=>{speed=Number(e.target.value); resetTimer();});
  $('modeSelect').addEventListener('change',e=>{mode=e.target.value; tick();});
  ['exportStart','exportEnd','exportStep'].forEach(id=>$(id)?.addEventListener('change',updateExportEstimate));
  ['regionFilter','typeFilter','statusFilter'].forEach(id=>$(id).addEventListener('change',()=>render(true)));
}
function boot(){ nodes=generateNationalNodes(); initMap(); initCharts(); bind(); initExportRange(); render(); resetTimer(); }
boot();
