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
// Vista fija del mapa: Chilpancingo de los Bravo, Guerrero.
const CHILPANCINGO_CENTER = [17.5515, -99.5058];
const CHILPANCINGO_BOUNDS = L.latLngBounds(
  [17.35, -99.72],
  [17.75, -99.30]
);
const CHILPANCINGO_ZOOM = 12;
const markers = new Map();

// ───────────────────────── Modo "API real" (red sísmica UABC) ─────────────────────────
// Fuente de datos: 'sim' (demostración nacional, comportamiento original) o 'real'
// (datos reales de la API Retriever de Sensores Sísmicos UABC, Baja California).
let dataSource = 'sim';
const REAL_API_BASE = 'https://retriever-1031456939583.us-west2.run.app';
const REAL_POLL_MS = 4000;
let realTimer = null;
let realPolling = false;
// La API real no expone GPS; usamos la ciudad de cada estación como ubicación aproximada
// (no es la posición exacta del sensor, solo la referencia de la ciudad).
const REAL_DEVICE_INFO = {
  'rpi_shm_v56': { name: 'Equipo de pruebas UABC', city: 'Ensenada (laboratorio)', lat: 31.8667, lon: -116.6000, type: 'Laboratorio' },
  'uabc-estacion-ensenada-01': { name: 'Estación Ensenada', city: 'Ensenada', lat: 31.8667, lon: -116.6000, type: 'Edificio' },
  'uabc-estacion-mexicali-01': { name: 'Estación Mexicali', city: 'Mexicali', lat: 32.6245, lon: -115.4523, type: 'Edificio' },
  'uabc-estacion-tijuana-01': { name: 'Estación Tijuana', city: 'Tijuana', lat: 32.5149, lon: -117.0382, type: 'Edificio' },
};
const BAJA_CENTER = [30.8, -115.9];
// key = "device_id·sensor_type" -> { t:[], x:[], y:[], z:[], lastT, lastRs }
const realBuffers = new Map();
const realLastTrigger = new Map();
const realEvents = [];
const realDeviceIds = new Set(Object.keys(REAL_DEVICE_INFO));
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
  const jitter = city === 'Chilpancingo' ? 0.055 : (region === 'Centro' ? 0.35 : 0.65);
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
  map = L.map('map',{
    preferCanvas:true,
    minZoom:11,
    maxBounds:CHILPANCINGO_BOUNDS,
    maxBoundsViscosity:1.0
  }).setView(CHILPANCINGO_CENTER,CHILPANCINGO_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
  clusterGroup = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:44 });
  map.addLayer(clusterGroup);
}
function markerHtml(status){ return `<div class="custom-marker ${status}">📡</div>`; }
function updateMarkers(){
  // En modo simulado el mapa muestra únicamente nodos dentro del entorno de Chilpancingo.
  // En modo real solo hay 4 estaciones (Baja California), así que se muestran todas.
  const visible = dataSource==='real'
    ? filteredNodes()
    : filteredNodes().filter(n=>CHILPANCINGO_BOUNDS.contains([n.lat,n.lon]));
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
  document.querySelectorAll('#nodesTable tr').forEach(tr=>tr.addEventListener('click',()=>{
    selectedId=tr.dataset.id;
    const n=selected();
    if(dataSource==='real') map.setView([n.lat,n.lon],9);
    else if(CHILPANCINGO_BOUNDS.contains([n.lat,n.lon])) map.setView([n.lat,n.lon],14);
    else map.setView(CHILPANCINGO_CENTER,CHILPANCINGO_ZOOM);
    render(false);
  }));
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
// ── API real: red y utilidades HTTP ──
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
  const box = $('realEventsList');
  if(!box) return;
  const [devId,sensor] = ev.key.split('·');
  const when = new Date(ev.t*1000).toISOString().replace('T',' ').slice(0,19);
  const item = document.createElement('div');
  item.className = 'event-item danger';
  item.innerHTML = `<b>${when} UTC</b><br>${(REAL_DEVICE_INFO[devId]||{}).name || devId} · ${sensor} · razón ${ev.ratio.toFixed(1)}`;
  box.prepend(item);
  while(box.children.length>80) box.removeChild(box.lastChild);
}

// ── Ciclo de datos reales: arma objetos "nodo" con el mismo formato que usa el resto de la UI ──
async function realTick(){
  if(realPolling) return;
  realPolling = true;
  try{
    const deviceIds = Array.from(realDeviceIds);
    const results = await Promise.all(deviceIds.map(async devId=>{
      const key0 = Object.keys(REAL_DEVICE_INFO).includes(devId) ? devId : null;
      if(!key0) return null;
      const anyBufKey = `${devId}·mpu9250_1`;
      const bootstrapped = realBuffers.has(anyBufKey) || Array.from(realBuffers.keys()).some(k=>k.startsWith(devId+'·'));
      const since = bootstrapped ? newestIsoForDevice(devId) : null;
      const recs = await fetchRealLatest(devId, since);
      return { devId, recs };
    }));
    for(const r of results){
      if(!r) continue;
      ingestRealRecords(r.devId, r.recs);
    }
    nodes = buildRealNodes();
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
      out.push({ id:devId, name:info.name, type:info.type, state:'Baja California', city:info.city, region:'Noroeste',
        lat:info.lat, lon:info.lon, site:info.city, battery:100, installed:2025, priority:'Media',
        rmsX:0, rmsY:0, rmsZ:0, rmsGlobal:0, freqDominante:0, sampleRate:0, satellites:0, gpsFix:false,
        status:'sin_conexion', lastUpdate:now() });
      continue;
    }
    let rmsX=0,rmsY=0,rmsZ=0,freq=0,sampleRate=0,newestT=-Infinity,newestRs=null,nSamples=0,usedKey=null;
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
      nSamples = tt.length;
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
      id:devId, name:info.name, type:info.type, state:'Baja California', city:info.city, region:'Noroeste',
      lat:info.lat, lon:info.lon, site:info.city, battery:100, installed:2025, priority:'Media',
      rmsX:Number(rmsX.toFixed(5)), rmsY:Number(rmsY.toFixed(5)), rmsZ:Number(rmsZ.toFixed(5)), rmsGlobal,
      freqDominante:Number(freq.toFixed(2)), sampleRate, satellites:0, gpsFix:false,
      status, lastUpdate: newestRs ? newestRs.slice(0,19).replace('T',' ') : now(), _gapSec:gapSec, _newestRs:newestRs
    });
  }
  return out;
}

function setDataSource(source){
  dataSource = source;
  const simCard = $('simControlsCard'); const evCard = $('realEventsCard');
  if(simCard) simCard.style.display = source==='sim' ? '' : 'none';
  if(evCard) evCard.style.display = source==='real' ? '' : 'none';
  if(source==='real'){
    if(timer) clearInterval(timer);
    map.setMaxBounds(null); map.setMinZoom(4);
    setText('realStatus','Conectando con la API real…');
    setText('mapStatus','Mapa: dispositivos reales (Baja California)');
    fetchRealDeviceList().then(ids=>{
      ids.forEach(id=>realDeviceIds.add(id));
      nodes = buildRealNodes();
      selectedId = nodes[0]?.id || selectedId;
      map.setView(BAJA_CENTER, 6);
      render();
      realTick();
      if(realTimer) clearInterval(realTimer);
      realTimer = setInterval(realTick, REAL_POLL_MS);
    });
  }else{
    if(realTimer){ clearInterval(realTimer); realTimer=null; }
    map.setMaxBounds(CHILPANCINGO_BOUNDS); map.setMinZoom(11);
    map.setView(CHILPANCINGO_CENTER, CHILPANCINGO_ZOOM);
    setText('mapStatus','Mapa Chilpancingo activo');
    setText('realStatus','Modo simulado activo.');
    nodes = generateNationalNodes();
    selectedId = 'SHM-MX-001';
    resetTimer();
    render();
  }
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
  if(dataSource==='real'){
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
    return;
  }
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
function realRecordsToRows(recs){
  return recs.map(r=>({
    timestamp:r.rs, device_id:r.device_id, sensor_type:r.sensor_type, data_mode:r.data_mode,
    x_value:r.x_value, y_value:r.y_value, z_value:r.z_value, session_id:r.session_id
  }));
}
async function getSelectedRows(range){
  const n = selected();
  if(dataSource==='real'){
    const recs = await fetchRealHistory(n.id, range.start, range.end);
    return realRecordsToRows(recs);
  }
  return generateSelectedNodeHistory(n, range);
}
async function exportSelectedCsv(){
  try{
    const range = getExportRange();
    setText('realStatus', dataSource==='real' ? 'Descargando historial real…' : 'Modo simulado activo.');
    const rows = await getSelectedRows(range);
    if(!rows.length){ alert('No hay registros reales en ese rango.'); return; }
    downloadBlob(filenameForNode('csv', range), rowsToCsv(rows), 'text/csv;charset=utf-8');
  }catch(err){ alert(err.message); }
}
async function exportSelectedExcel(){
  try{
  const n = selected();
  const range = getExportRange();
  setText('realStatus', dataSource==='real' ? 'Descargando historial real…' : 'Modo simulado activo.');
  const rows = await getSelectedRows(range);
  if(!rows.length){ alert('No hay registros reales en ese rango.'); return; }
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
  $('btnNationalView').addEventListener('click',()=>map.setView(CHILPANCINGO_CENTER,CHILPANCINGO_ZOOM));
  $('btnEventPacifico').addEventListener('click',()=>{forcedRegionEvent='Sur-Sureste'; mode='evento'; $('modeSelect').value='evento'; tick(); setTimeout(()=>{forcedRegionEvent=null; mode='campo'; $('modeSelect').value='campo';},12000);});
  $('btnEventCentro').addEventListener('click',()=>{forcedRegionEvent='Centro'; mode='evento'; $('modeSelect').value='evento'; tick(); setTimeout(()=>{forcedRegionEvent=null; mode='campo'; $('modeSelect').value='campo';},12000);});
  $('speedSelect').addEventListener('change',e=>{speed=Number(e.target.value); resetTimer();});
  $('modeSelect').addEventListener('change',e=>{mode=e.target.value; tick();});
  ['exportStart','exportEnd','exportStep'].forEach(id=>$(id)?.addEventListener('change',updateExportEstimate));
  ['regionFilter','typeFilter','statusFilter'].forEach(id=>$(id).addEventListener('change',()=>render(true)));
  $('dataSourceSelect')?.addEventListener('change',e=>setDataSource(e.target.value));
}
function boot(){ nodes=generateNationalNodes(); initMap(); initCharts(); bind(); initExportRange(); render(); resetTimer(); }
boot();
