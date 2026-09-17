// ═══════════════════════════════════════════════════════════════════════════
// Red SHM-IoT en vivo — MIIDT / UAGro
//
// Todo pasa por /api/proxy (función de Vercel) porque la API Retriever no manda
// encabezados CORS. Abrir index.html directo no funciona: usa Vercel o `vercel dev`.
//
// Lo que sabemos del sistema y que este panel toma en cuenta:
//  • La Raspberry manda 3 sensores (mpu9250_1, mpu9250_2, lsm6dsox) a ~150 Hz,
//    es decir ~450 registros por segundo por estación.
//  • x/y/z vienen en g (el firmware manda micro-g y la Raspberry divide entre 1e6).
//    Un eje incluye la gravedad (~1 g), por eso el RMS y el pico se calculan
//    quitando el promedio: si no, toda estación parecería "en alerta".
//  • `rs` es la hora en que la Raspberry leyó la muestra. La versión actual la
//    guarda en hora local SIN zona horaria (p. ej. 2026-09-15T14:43:11.123456),
//    así que el panel detecta la diferencia con UTC y la aplica.
//  • `raw_data` trae la línea cruda "SHM2,t_us,seq,...": con `seq` se cuentan
//    exactamente las muestras que se perdieron en el envío.
// ═══════════════════════════════════════════════════════════════════════════

const CFG = {
  POLL_LIVE_MS: 2000,        // estaciones en línea: cada 2 s
  POLL_OFFLINE_MS: 30000,    // estaciones sin datos recientes: revisión ligera cada 30 s
  MAX_PAGES_PER_TICK: 6,
  OFFLINE_AFTER_S: 30,
  BUFFER_S: 300,             // 5 min de señal en memoria por sensor
  STATS_WIN_S: 10,
  GAP_RESET_S: 1.0,          // un hueco mayor reinicia la calibración STA/LTA
  COINCIDENCE_S: 2.0,        // ventana para confirmar un evento entre sensores
  PGA_WATCH_MG: 10,          // umbral de "observación" (pico dinámico, mg)
  PGA_ALERT_MG: 50,          // umbral de "alerta" (pico dinámico, mg)
  COMPLETENESS_WARN: 0.8,
  FFT_N: 2048,
  DEFAULT_FS: 150,
};

// La API no trae coordenadas: ubicación conocida de cada sitio.
// offsetH = hora local de `rs` respecto a UTC (se corrige sola si los datos dicen otra cosa).
const STATION_INFO = {
  rpi_shm_v56: { name: 'UTyP Sierra de Guerrero', city: 'Tlacotepec, Guerrero', lat: 17.790278, lon: -99.978333, type: 'Laboratorio', fs: 150, offsetH: -6, sensors: ['mpu9250_1', 'mpu9250_2', 'lsm6dsox'] },
  'uabc-estacion-ensenada-01': { name: 'Estación Ensenada', city: 'Ensenada, Baja California', lat: 31.8667, lon: -116.6, type: 'Edificio', fs: 150, offsetH: 0 },
  'uabc-estacion-mexicali-01': { name: 'Estación Mexicali', city: 'Mexicali, Baja California', lat: 32.6245, lon: -115.4523, type: 'Edificio', fs: 150, offsetH: 0 },
  'uabc-estacion-tijuana-01': { name: 'Estación Tijuana', city: 'Tijuana, Baja California', lat: 32.5149, lon: -117.0382, type: 'Edificio', fs: 150, offsetH: 0 },
};

const STATUS_LABEL = { activo: 'Activa', observacion: 'Observación', alerta: 'Alerta', sin_conexion: 'Sin conexión' };
const AXIS_COLORS = { x: '#1f6fb2', y: '#b23a48', z: '#2c8657' };
const SENSOR_COLORS = ['#1f3a5f', '#c2410c', '#0f766e', '#7c3aed', '#be185d'];

// ───────────────────────── utilidades ─────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowS = () => Date.now() / 1000;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

function lowerBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
function upperBound(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo; }

function fmtMg(v, digits = 2) { return Number.isFinite(v) ? `${v.toFixed(v >= 100 ? 0 : digits)} mg` : '–'; }
function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v * 100)} %` : '–'; }
function fmtAgo(sec) {
  if (!Number.isFinite(sec)) return 'nunca';
  if (sec < 1.5) return 'ahora';
  if (sec < 60) return `hace ${Math.round(sec)} s`;
  if (sec < 3600) return `hace ${Math.round(sec / 60)} min`;
  if (sec < 86400) return `hace ${Math.round(sec / 3600)} h`;
  return `hace ${Math.round(sec / 86400)} d`;
}
function fmtLag(sec) {
  if (!Number.isFinite(sec)) return '–';
  if (sec < 60) return `${Math.max(0, sec).toFixed(1)} s`;
  return fmtAgo(sec).replace('hace ', '');
}
function fmtClock(epoch, withDate = false) {
  if (!Number.isFinite(epoch)) return '–';
  const d = new Date(epoch * 1000);
  return withDate
    ? d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : d.toLocaleTimeString('es-MX', { hour12: false });
}
function utcLabel(h) { return h === 0 ? 'UTC' : `UTC${h > 0 ? '+' : '−'}${Math.abs(h)}`; }

// ───────────────────────── tiempo de `rs` ─────────────────────────
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i;
// Algunos navegadores (Safari) no aceptan más de 3 decimales en los segundos.
const normRs = (rs) => String(rs).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');

function rsToEpoch(rs, st) {
  if (!rs) return NaN;
  const s = normRs(rs);
  if (HAS_TZ.test(s)) return Date.parse(s) / 1000;
  const ms = Date.parse(s + 'Z');
  return Number.isFinite(ms) ? ms / 1000 - st.offsetH * 3600 : NaN;
}
function epochToRs(sec, st) {
  const naive = st.rsNaive ?? st.offsetH !== 0;
  if (!naive) return new Date(sec * 1000).toISOString();
  return new Date((sec + st.offsetH * 3600) * 1000).toISOString().replace('Z', '');
}
function detectOffset(st, rec) {
  if (!rec || !rec.rs) return;
  const s = normRs(rec.rs);
  if (HAS_TZ.test(s)) { st.rsNaive = false; st.offsetH = 0; st.offsetSource = 'incluida en los datos'; return; }
  st.rsNaive = true;
  const asUtc = Date.parse(s + 'Z') / 1000;
  if (!Number.isFinite(asUtc)) return;
  const diffH = (asUtc - nowS()) / 3600;
  const cand = Math.round(diffH);
  const resid = Math.abs(diffH - cand) * 3600;
  // Solo se acepta con datos recientes (residuo pequeño); si la estación lleva horas
  // apagada no se puede saber y se conserva el valor configurado.
  if (Math.abs(cand) <= 14 && resid < (cand === st.offsetH ? 900 : 120)) {
    st.offsetH = cand;
    st.offsetSource = 'detectada automáticamente';
  }
}

// ───────────────────────── API ─────────────────────────
const api = { pageLimit: 1000, hasOrden: true, ok: null, lastError: null, requests: [] };

async function apiGet(path, params = {}) {
  const qs = new URLSearchParams({ path });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  api.requests.push(Date.now());
  try {
    const res = await fetch(`/api/proxy?${qs}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, error: err.name === 'AbortError' ? 'tiempo de espera agotado' : err.message };
  } finally {
    clearTimeout(timer);
  }
}
function recordsOf(json) {
  if (Array.isArray(json?.registros)) return json.registros;
  if (Array.isArray(json)) return json;
  for (const k of ['data', 'items', 'results']) if (Array.isArray(json?.[k])) return json[k];
  return null;
}
function apiErrorText(r) {
  if (r.status === 0) return `sin conexión con el proxy (${r.error})`;
  const d = r.json?.detail ?? r.json?.error;
  return `la API respondió ${r.status}${d ? ': ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 160) : ''}`;
}
async function fetchRecords(params) {
  const r = await apiGet('/registros', params);
  const recs = r.status === 200 ? recordsOf(r.json) : null;
  if (!recs) {
    api.ok = false; api.lastError = apiErrorText(r);
    throw new Error(api.lastError);
  }
  api.ok = true; api.lastError = null;
  return recs;
}
async function loadOpenApi() {
  const r = await apiGet('/openapi.json');
  const op = r.json?.paths?.['/registros']?.get;
  if (!op) return;
  const params = op.parameters || [];
  api.hasOrden = params.some((p) => p.name === 'orden');
  const sch = params.find((p) => p.name === 'limit')?.schema || {};
  const max = sch.maximum ?? (sch.anyOf || []).map((a) => a.maximum).find(Number.isFinite);
  if (Number.isFinite(max)) api.pageLimit = Math.max(100, Math.min(max, 10000));
}
async function loadDeviceIds() {
  const r = await apiGet('/dispositivos');
  const list = Array.isArray(r.json?.dispositivos) ? r.json.dispositivos : Array.isArray(r.json) ? r.json : [];
  return list.map((d) => (typeof d === 'string' ? d : d?.device_id || d?.id)).filter(Boolean);
}

// ───────────────────────── estado ─────────────────────────
const stations = new Map();
const allEvents = [];
let selectedId = null;
let selectedMode = null;     // nombre del sensor o "cmp"
let paused = false, pausedEnd = null;

function ensureStation(id) {
  if (stations.has(id)) return stations.get(id);
  const info = STATION_INFO[id] || { name: id, city: 'Ubicación no registrada', lat: null, lon: null, type: '–', fs: CFG.DEFAULT_FS, offsetH: 0 };
  const st = {
    id, ...info, fs: info.fs || CFG.DEFAULT_FS, offsetH: info.offsetH ?? 0,
    offsetSource: 'configurada', rsNaive: null,
    sensors: new Map(), expectedSensors: info.sensors?.length || 0,
    newestT: -Infinity, newestRs: null, lastRecord: null, cursorRs: null,
    bootstrapped: false, polling: false, nextPollAt: 0, behind: false, error: null,
    lagHist: [], events: [], stats: null, spec: null,
  };
  stations.set(id, st);
  return st;
}
function ensureBuf(st, sensor) {
  let b = st.sensors.get(sensor);
  if (!b) {
    b = { t: [], x: [], y: [], z: [], seq: [], lastT: -Infinity,
      d: { n: 0, mx: 0, my: 0, mz: 0, sta: 0, lta: 0, lastT: null, trig: false, start: 0, peakRatio: 0, peakMg: 0, rT: [], r: [], lastPush: -Infinity } };
    st.sensors.set(sensor, b);
  }
  return b;
}
const isOnline = (st) => Number.isFinite(st.newestT) && nowS() - st.newestT < CFG.OFFLINE_AFTER_S;

function parseSeq(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^SHM2?,\s*-?[\d.]+,\s*(\d+)/.exec(raw);
  return m ? Number(m[1]) : null;
}

// ───────────────────────── ingesta + STA/LTA recursivo ─────────────────────────
function ingest(st, recs) {
  const bySensor = new Map();
  for (const r of recs) {
    if (!r || typeof r !== 'object') continue;
    const t = rsToEpoch(r.rs, st);
    if (!Number.isFinite(t)) continue;
    const sensor = String(r.sensor_type || 'sensor');
    if (!bySensor.has(sensor)) bySensor.set(sensor, []);
    bySensor.get(sensor).push([t, r]);
  }
  let newest = st.newestT;
  for (const [sensor, rows] of bySensor) {
    rows.sort((a, b) => a[0] - b[0]);
    const b = ensureBuf(st, sensor);
    for (const [t, r] of rows) {
      if (t <= b.lastT) continue;
      const x = num(r.x_value), y = num(r.y_value), z = num(r.z_value);
      b.t.push(t); b.x.push(x); b.y.push(y); b.z.push(z); b.seq.push(parseSeq(r.raw_data));
      b.lastT = t;
      dspStep(st, sensor, b.d, t, x, y, z);
      if (t > newest) { newest = t; st.newestRs = r.rs; st.lastRecord = r; }
    }
    trimBuf(b);
  }
  if (newest > st.newestT) {
    st.newestT = newest;
    st.lagHist.push([nowS(), nowS() - newest]);
  }
}
function trimBuf(b) {
  const i = lowerBound(b.t, b.lastT - CFG.BUFFER_S);
  if (i > 0) { b.t.splice(0, i); b.x.splice(0, i); b.y.splice(0, i); b.z.splice(0, i); b.seq.splice(0, i); }
  const j = lowerBound(b.d.rT, b.lastT - 180);
  if (j > 0) { b.d.rT.splice(0, j); b.d.r.splice(0, j); }
}

const trig = { sta: 1, lta: 20, on: 3.5, off: 1.5 };

function dspStep(st, sensor, d, t, x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  const fs = st.fs;
  if (d.lastT !== null && t - d.lastT > CFG.GAP_RESET_S) { d.n = 0; d.trig = false; }
  d.lastT = t;
  if (d.n === 0) { d.mx = x; d.my = y; d.mz = z; d.sta = 0; d.lta = 0; }
  const aMean = 1 / (fs * 10), aSta = 1 / (fs * trig.sta), aLta = 1 / (fs * trig.lta);
  d.mx += aMean * (x - d.mx); d.my += aMean * (y - d.my); d.mz += aMean * (z - d.mz);
  const ex = x - d.mx, ey = y - d.my, ez = z - d.mz;
  const e = ex * ex + ey * ey + ez * ez;
  d.sta += aSta * (e - d.sta);
  d.lta += aLta * (e - d.lta);
  d.n++;
  const warm = d.n > fs * (trig.lta + 10);
  const ratio = warm && d.lta > 1e-14 ? d.sta / d.lta : 0;

  if (warm && !d.trig && ratio >= trig.on) {
    d.trig = true; d.start = t; d.peakRatio = ratio; d.peakMg = 0;
  }
  if (d.trig) {
    d.peakRatio = Math.max(d.peakRatio, ratio);
    d.peakMg = Math.max(d.peakMg, Math.sqrt(e) * 1000);
    if (ratio <= trig.off || t - d.start > 120) {
      d.trig = false;
      registerTrigger(st, sensor, { start: d.start, end: t, peakRatio: d.peakRatio, peakMg: d.peakMg });
    }
  }
  if (t - d.lastPush >= 0.1) { d.rT.push(t); d.r.push(ratio); d.lastPush = t; }
}
function registerTrigger(st, sensor, tr) {
  let ev = st.events.find((e) => Math.abs(e.start - tr.start) <= CFG.COINCIDENCE_S);
  if (!ev) {
    ev = { station: st.id, start: tr.start, end: tr.end, sensors: new Map(), peakRatio: 0, peakMg: 0 };
    st.events.unshift(ev);
    allEvents.push(ev);
    allEvents.sort((a, b) => b.start - a.start);
    allEvents.splice(200);
    st.events.splice(100);
  }
  ev.sensors.set(sensor, tr);
  ev.end = Math.max(ev.end, tr.end);
  ev.peakRatio = Math.max(ev.peakRatio, tr.peakRatio);
  ev.peakMg = Math.max(ev.peakMg, tr.peakMg);
}
const isConfirmed = (ev) => ev.sensors.size >= 2;

// ───────────────────────── sondeo ─────────────────────────
async function pollStation(st) {
  st.polling = true;
  try {
    if (!st.bootstrapped) {
      let recs;
      if (api.hasOrden) {
        recs = await fetchRecords({ device_id: st.id, orden: 'desc', limit: api.pageLimit });
        if (recs.length) detectOffset(st, recs[0]);
        recs = recs.slice().reverse();
      } else {
        recs = await fetchRecords({ device_id: st.id, fecha_inicio: epochToRs(nowS() - 20, st), limit: api.pageLimit });
        if (recs.length) detectOffset(st, recs[recs.length - 1]);
      }
      ingest(st, recs);
      st.bootstrapped = recs.length > 0;
      st.cursorRs = st.newestRs;
      st.behind = false;
      st.reloadNow = false;
    } else if (!isOnline(st)) {
      const recs = await fetchRecords(api.hasOrden
        ? { device_id: st.id, orden: 'desc', limit: 1 }
        : { device_id: st.id, fecha_inicio: st.cursorRs, limit: 1 });
      const t = recs.length ? rsToEpoch(recs[0].rs, st) : NaN;
      if (Number.isFinite(t) && t > st.newestT + 1) { st.bootstrapped = false; st.reloadNow = true; }   // volvió a transmitir
    } else {
      let page = 0, full = true;
      while (full && page < CFG.MAX_PAGES_PER_TICK) {
        const recs = await fetchRecords({ device_id: st.id, orden: api.hasOrden ? 'asc' : undefined,
          fecha_inicio: st.cursorRs, limit: api.pageLimit, offset: page * api.pageLimit });
        ingest(st, recs);
        full = recs.length >= api.pageLimit;
        page++;
      }
      st.cursorRs = st.newestRs || st.cursorRs;
      // Si llegan más datos de los que alcanzamos a bajar, saltamos al presente.
      st.behind = full;
      if (full) st.bootstrapped = false;
    }
    st.error = null;
    if (!st.bootstrapped) st.nextPollAt = Date.now() + (st.behind || st.reloadNow ? 0 : CFG.POLL_OFFLINE_MS);
    else st.nextPollAt = Date.now() + (isOnline(st) ? CFG.POLL_LIVE_MS : CFG.POLL_OFFLINE_MS);
  } catch (err) {
    st.error = err.message;
    st.nextPollAt = Date.now() + 5000;
  } finally {
    st.polling = false;
  }
}
function scheduler() {
  const t = Date.now();
  for (const st of stations.values()) if (!st.polling && t >= st.nextPollAt) pollStation(st);
}

// ───────────────────────── estadísticas ─────────────────────────
function sensorStats(st, b) {
  const n = b.t.length;
  if (!n) return null;
  const tEnd = b.lastT;
  const i0 = lowerBound(b.t, tEnd - CFG.STATS_WIN_S);
  const cnt = n - i0;
  const span = tEnd - b.t[i0];
  const fsMeas = span > 1 ? (cnt - 1) / span : NaN;

  let sx = 0, sy = 0, sz = 0, c = 0;
  for (let i = i0; i < n; i++) if (Number.isFinite(b.x[i]) && Number.isFinite(b.y[i]) && Number.isFinite(b.z[i])) { sx += b.x[i]; sy += b.y[i]; sz += b.z[i]; c++; }
  let vx = 0, vy = 0, vz = 0, pga = 0;
  if (c) {
    sx /= c; sy /= c; sz /= c;
    for (let i = i0; i < n; i++) {
      if (!Number.isFinite(b.x[i]) || !Number.isFinite(b.y[i]) || !Number.isFinite(b.z[i])) continue;
      const ex = b.x[i] - sx, ey = b.y[i] - sy, ez = b.z[i] - sz;
      vx += ex * ex; vy += ey * ey; vz += ez * ez;
      pga = Math.max(pga, Math.sqrt(ex * ex + ey * ey + ez * ez));
    }
    vx /= c; vy /= c; vz /= c;
  }

  // Completitud: con `seq` es exacta; si no, se estima con el muestreo nominal.
  let comp = NaN, gaps = 0, bySeq = false;
  const seqs = [];
  for (let i = i0; i < n; i++) if (b.seq[i] !== null) seqs.push(b.seq[i]);
  if (seqs.length >= Math.max(10, cnt * 0.9)) {
    let lo = Infinity, hi = -Infinity;
    for (const s of seqs) { if (s < lo) lo = s; if (s > hi) hi = s; }
    const range = hi - lo + 1;
    const unique = new Set(seqs).size;
    if (range > 0 && range < unique * 5) { comp = unique / range; gaps = range - unique; bySeq = true; }
  }
  if (!bySeq && Number.isFinite(fsMeas)) comp = Math.min(1, fsMeas / st.fs);

  return {
    fs: fsMeas, comp, gaps, bySeq, lastT: b.lastT, online: nowS() - b.lastT < CFG.OFFLINE_AFTER_S,
    rmsMg: Math.sqrt(vx + vy + vz) * 1000, pgaMg: pga * 1000, triggered: b.d.trig,
  };
}
function stationStats(st) {
  const sensors = [...st.sensors.entries()].map(([name, b]) => [name, sensorStats(st, b)]).filter(([, s]) => s);
  const lag = Number.isFinite(st.newestT) ? nowS() - st.newestT : Infinity;
  while (st.lagHist.length && nowS() - st.lagHist[0][0] > 30) st.lagHist.shift();
  const lagMin = st.lagHist.length ? Math.min(...st.lagHist.map((l) => l[1])) : lag;
  const online = sensors.filter(([, s]) => s.online);
  const pick = (f) => (online.length ? online : sensors).map(([, s]) => s[f]).filter(Number.isFinite);
  const max = (a) => (a.length ? Math.max(...a) : NaN);
  const min = (a) => (a.length ? Math.min(...a) : NaN);
  const mean = (a) => (a.length ? a.reduce((p, v) => p + v, 0) / a.length : NaN);

  const s = {
    lag, lagMin, sensors, online: isOnline(st),
    fs: mean(pick('fs')), comp: min(pick('comp')), rmsMg: max(pick('rmsMg')), pgaMg: max(pick('pgaMg')),
    reporting: online.length, expected: Math.max(st.expectedSensors, sensors.length),
    samplesPerS: online.reduce((p, [, x]) => p + (Number.isFinite(x.fs) ? x.fs : 0), 0),
    activeTriggers: online.filter(([, x]) => x.triggered).length,
    reasons: [],
  };
  const recentConfirmed = st.events.find((e) => isConfirmed(e) && nowS() - e.end < 30);

  if (!Number.isFinite(st.newestT)) {
    s.status = 'sin_conexion';
    s.reasons.push(['off', st.error ? `No se pudo consultar: ${st.error}` : st.bootstrapped || st.nextPollAt ? 'La API no tiene datos de esta estación.' : 'Consultando…']);
  } else if (!s.online) {
    s.status = 'sin_conexion';
    s.reasons.push(['off', `No llegan datos nuevos. Último dato ${fmtAgo(lag)}.`]);
  } else {
    s.status = 'activo';
    if (recentConfirmed || s.activeTriggers >= 2) { s.status = 'alerta'; s.reasons.push(['bad', 'Evento detectado por varios sensores.']); }
    if (s.pgaMg >= CFG.PGA_ALERT_MG) { s.status = 'alerta'; s.reasons.push(['bad', `Pico de ${fmtMg(s.pgaMg, 1)} (umbral ${CFG.PGA_ALERT_MG} mg).`]); }
    if (s.status !== 'alerta') {
      if (s.pgaMg >= CFG.PGA_WATCH_MG) { s.status = 'observacion'; s.reasons.push(['warn', `Vibración elevada: pico de ${fmtMg(s.pgaMg, 1)}.`]); }
      if (s.activeTriggers === 1) { s.status = 'observacion'; s.reasons.push(['warn', 'Un sensor detectó un posible evento.']); }
    }
    if (s.comp < CFG.COMPLETENESS_WARN) {
      if (s.status === 'activo') s.status = 'observacion';
      s.reasons.push(['warn', `Llega solo el ${fmtPct(s.comp)} de las muestras: se están perdiendo datos en el envío.`]);
    }
    if (s.expected && s.reporting < s.expected) {
      if (s.status === 'activo') s.status = 'observacion';
      s.reasons.push(['warn', `Reportan ${s.reporting} de ${s.expected} sensores.`]);
    }
    if (st.behind) s.reasons.push(['warn', 'Llegan más datos de los que el panel alcanza a descargar; se muestran los más recientes.']);
    if (st.error) s.reasons.push(['warn', `Última consulta con error: ${st.error}`]);
    if (!s.reasons.length) s.reasons.push(['ok', 'Todo en orden: datos completos y vibración normal.']);
  }
  st.stats = s;
  return s;
}

// ───────────────────────── espectro ─────────────────────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
function spectrum(b, tEnd) {
  if (!b) return null;
  const iEnd = upperBound(b.t, tEnd);
  let N = CFG.FFT_N;
  while (N > 256 && N > iEnd) N >>= 1;
  if (iEnd < N) return null;
  const i0 = iEnd - N;
  const span = b.t[iEnd - 1] - b.t[i0];
  if (!(span > 0)) return null;
  const fsEff = (N - 1) / span;
  const win = new Float64Array(N);
  let wSum = 0;
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); wSum += win[i]; }
  const out = { fsEff, N, f: [], amp: {} };
  for (let k = 1; k < N / 2; k++) out.f.push((k * fsEff) / N);
  const total = new Float64Array(N / 2 - 1);
  for (const axis of ['x', 'y', 'z']) {
    const src = b[axis];
    let m = 0, c = 0;
    for (let i = i0; i < iEnd; i++) if (Number.isFinite(src[i])) { m += src[i]; c++; }
    m = c ? m / c : 0;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const v = src[i0 + i]; re[i] = (Number.isFinite(v) ? v - m : 0) * win[i]; }
    fft(re, im);
    const amp = new Array(N / 2 - 1);
    for (let k = 1; k < N / 2; k++) {
      amp[k - 1] = ((2 * Math.hypot(re[k], im[k])) / wSum) * 1000;
      total[k - 1] += amp[k - 1] * amp[k - 1];
    }
    out.amp[axis] = amp;
  }
  let best = -1, bestK = -1;
  for (let k = 0; k < total.length; k++) if (out.f[k] >= 0.3 && total[k] > best) { best = total[k]; bestK = k; }
  out.dom = bestK >= 0 ? out.f[bestK] : NaN;
  out.domAmp = bestK >= 0 ? Math.sqrt(best) : NaN;
  return out;
}

// ───────────────────────── gráficas ─────────────────────────
let signalChart, specChart, staltaChart, rateChart;

function baseOptions(xTitle, yTitle) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    elements: { point: { radius: 0 }, line: { borderWidth: 1.3, tension: 0 } },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 2 } } },
    scales: {
      x: { type: 'linear', title: { display: true, text: xTitle }, grid: { color: '#eef2f6' } },
      y: { title: { display: true, text: yTitle }, grid: { color: '#eef2f6' } },
    },
  };
}
function initCharts() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = '#5b6b7f';
  signalChart = new Chart($('signalChart'), { type: 'line', data: { datasets: [] }, options: baseOptions('segundos', 'aceleración (mg)') });
  specChart = new Chart($('specChart'), { type: 'line', data: { datasets: [] }, options: baseOptions('frecuencia (Hz)', 'amplitud (mg)') });
  const so = baseOptions('segundos', 'STA / LTA');
  so.scales.y.min = 0;
  staltaChart = new Chart($('staltaChart'), { type: 'line', data: { datasets: [] }, options: so });
  const ro = baseOptions('segundos', 'muestras/s por sensor');
  ro.parsing = true; ro.scales.x = { type: 'category', ticks: { maxTicksLimit: 7 }, grid: { display: false }, title: { display: true, text: 'segundos' } };
  ro.scales.y.min = 0;
  rateChart = new Chart($('rateChart'), { type: 'bar', data: { labels: [], datasets: [] }, options: ro });
}

// Reduce miles de muestras a pares mín/máx por columna, sin perder los picos.
function windowSeries(b, key, t0, t1, tRef, buckets, center) {
  if (!b) return [];
  const i0 = lowerBound(b.t, t0), i1 = upperBound(b.t, t1);
  const n = i1 - i0;
  if (n <= 0) return [];
  const src = b[key];
  let mean = 0;
  if (center) { let c = 0; for (let i = i0; i < i1; i++) if (Number.isFinite(src[i])) { mean += src[i]; c++; } mean = c ? mean / c : 0; }
  const out = [];
  const push = (t, v) => out.push({ x: t - tRef, y: Number.isFinite(v) ? (v - mean) * 1000 : null });
  if (n <= buckets * 2) {
    for (let i = i0; i < i1; i++) {
      if (i > i0 && b.t[i] - b.t[i - 1] > 0.5) out.push({ x: b.t[i - 1] - tRef + 0.01, y: null });
      push(b.t[i], src[i]);
    }
    return out;
  }
  const w = (t1 - t0) / buckets;
  let cur = -1, minI = -1, maxI = -1, lastBucket = -1;
  const flush = () => {
    if (cur < 0) return;
    if (lastBucket >= 0 && cur - lastBucket > Math.max(2, 0.5 / w)) out.push({ x: t0 + (lastBucket + 1) * w - tRef, y: null });
    const a = Math.min(minI, maxI), c = Math.max(minI, maxI);
    push(b.t[a], src[a]);
    if (c !== a) push(b.t[c], src[c]);
    lastBucket = cur;
  };
  for (let i = i0; i < i1; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) continue;
    const k = Math.min(buckets - 1, Math.floor((b.t[i] - t0) / w));
    if (k !== cur) { flush(); cur = k; minI = maxI = i; }
    else { if (v < src[minI]) minI = i; if (v > src[maxI]) maxI = i; }
  }
  flush();
  return out;
}

function displayEnd(st) {
  if (paused && pausedEnd !== null) return pausedEnd;
  if (!Number.isFinite(st.newestT)) return nowS();
  if (!isOnline(st)) return st.newestT;
  const lagMin = st.stats?.lagMin ?? nowS() - st.newestT;
  return Math.min(nowS() - lagMin - 0.3, st.newestT);
}
function sensorNames(st) {
  const order = STATION_INFO[st.id]?.sensors || [];
  return [...st.sensors.keys()].sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));
}

function renderSignal() {
  const st = stations.get(selectedId);
  if (!st) return;
  const win = Number($('signalWin').value);
  const tEnd = displayEnd(st);
  const center = $('signalCenter').checked;
  const buckets = Math.max(200, Math.floor(($('signalChart').clientWidth || 800) / 1.5));
  const names = sensorNames(st);
  let datasets = [];
  if (selectedMode === 'cmp') {
    datasets = names.map((name, i) => ({ label: `${name} · Z`, borderColor: SENSOR_COLORS[i % SENSOR_COLORS.length], data: windowSeries(st.sensors.get(name), 'z', tEnd - win, tEnd, tEnd, buckets, center) }));
  } else {
    const b = st.sensors.get(selectedMode) || st.sensors.get(names[0]);
    if (b) datasets = ['x', 'y', 'z'].map((k) => ({ label: k.toUpperCase(), borderColor: AXIS_COLORS[k], data: windowSeries(b, k, tEnd - win, tEnd, tEnd, buckets, center) }));
  }
  const hasData = datasets.some((d) => d.data.length);
  signalChart.data.datasets = datasets;
  signalChart.options.scales.x.min = -win;
  signalChart.options.scales.x.max = 0;
  signalChart.options.scales.y.title.text = center ? 'aceleración sin gravedad (mg)' : 'aceleración (mg)';
  signalChart.update('none');
  const empty = $('signalEmpty');
  empty.hidden = hasData;
  if (!hasData) empty.textContent = !Number.isFinite(st.newestT) ? (st.error ? `No se pudo consultar: ${st.error}` : 'Esta estación no tiene datos en la API.') : 'Sin muestras en esta ventana. Prueba una ventana más larga.';
  setText('signalHint', paused ? 'En pausa. Presiona "Reanudar" para volver al tiempo real.'
    : isOnline(st) ? `En vivo · lo más reciente queda a la derecha · retraso ≈ ${fmtLag(st.stats?.lagMin)}.`
    : Number.isFinite(st.newestT) ? `Sin datos nuevos: se muestra lo último que llegó (${fmtClock(st.newestT, true)}).` : 'Esperando datos…');
}

function renderAnalysis() {
  const st = stations.get(selectedId);
  if (!st) return;
  const tEnd = displayEnd(st);
  const names = sensorNames(st);

  // Espectro
  const fmax = Number($('specMax').value);
  let sp = null;
  if (selectedMode === 'cmp') {
    specChart.data.datasets = names.map((name, i) => {
      const s = spectrum(st.sensors.get(name), tEnd);
      if (s && !sp) sp = s;
      return { label: `${name} · Z`, borderColor: SENSOR_COLORS[i % SENSOR_COLORS.length], data: s ? s.f.map((f, k) => ({ x: f, y: s.amp.z[k] })).filter((p) => p.x <= fmax) : [] };
    });
  } else {
    const b = st.sensors.get(selectedMode) || st.sensors.get(names[0]);
    sp = spectrum(b, tEnd);
    specChart.data.datasets = sp ? ['x', 'y', 'z'].map((k) => ({ label: k.toUpperCase(), borderColor: AXIS_COLORS[k], data: sp.f.map((f, i) => ({ x: f, y: sp.amp[k][i] })).filter((p) => p.x <= fmax) })) : [];
  }
  specChart.options.scales.x.min = 0;
  specChart.options.scales.x.max = fmax;
  specChart.update('none');
  $('specEmpty').hidden = !!sp;
  st.spec = sp;
  setText('specHint', sp
    ? `Pico en ${sp.dom.toFixed(2)} Hz · ${sp.N} muestras (${(sp.N / sp.fsEff).toFixed(1)} s) · resolución ${(sp.fsEff / sp.N).toFixed(3)} Hz`
    : 'FFT con ventana Hann de la estación y vista seleccionadas.');

  // STA/LTA
  const ds = names.map((name, i) => {
    const d = st.sensors.get(name).d;
    const a = lowerBound(d.rT, tEnd - 120), z = upperBound(d.rT, tEnd);
    const pts = [];
    for (let k = a; k < z; k++) pts.push({ x: d.rT[k] - tEnd, y: d.r[k] });
    return { label: name, borderColor: SENSOR_COLORS[i % SENSOR_COLORS.length], data: pts };
  });
  ds.push({ label: 'Umbral de disparo', borderColor: '#dc2626', borderDash: [6, 4], borderWidth: 1, data: [{ x: -120, y: trig.on }, { x: 0, y: trig.on }] });
  staltaChart.data.datasets = ds;
  staltaChart.options.scales.x.min = -120;
  staltaChart.options.scales.x.max = 0;
  staltaChart.options.scales.y.suggestedMax = Math.max(trig.on * 1.4, 2);
  staltaChart.update('none');

  // Muestras por segundo (últimos 2 min)
  const bins = 120, labels = [], counts = new Array(bins).fill(0);
  for (let i = 0; i < bins; i++) labels.push(String(i - bins + 1));
  const from = Math.floor(tEnd) - bins + 1;
  for (const name of names) {
    const sb = st.sensors.get(name);
    for (let k = lowerBound(sb.t, from); k < sb.t.length && sb.t[k] < from + bins; k++) counts[Math.floor(sb.t[k] - from)]++;
  }
  const perSensor = counts.map((c) => (names.length ? c / names.length : 0));
  perSensor[bins - 1] = null;   // el segundo en curso aún está incompleto
  rateChart.data.labels = labels;
  rateChart.data.datasets = [
    { type: 'bar', label: 'Muestras/s por sensor', data: perSensor, backgroundColor: perSensor.map((v) => (v !== null && v < st.fs * CFG.COMPLETENESS_WARN ? '#f59e0b' : '#1f6fb2')), barPercentage: 1, categoryPercentage: 1 },
    { type: 'line', label: `Esperado (${st.fs} Hz)`, data: labels.map(() => st.fs), borderColor: '#16a34a', borderDash: [6, 4], borderWidth: 1, pointRadius: 0 },
  ];
  rateChart.update('none');
}

// ───────────────────────── mapa ─────────────────────────
let map;
const markers = new Map();
let fittedOnce = false;

function initMap() {
  map = L.map('map', { minZoom: 3 }).setView([23.6, -102.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
}
function fitAll() {
  const pts = [...stations.values()].filter((s) => Number.isFinite(s.lat)).map((s) => [s.lat, s.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 8 });
}
function renderMap() {
  for (const st of stations.values()) {
    if (!Number.isFinite(st.lat)) continue;
    const status = st.stats?.status || 'sin_conexion';
    const cls = `marker ${status}${st.id === selectedId ? ' selected' : ''}`;
    let m = markers.get(st.id);
    if (!m) {
      m = L.marker([st.lat, st.lon], { title: st.name, keyboard: true }).addTo(map);
      m.on('click', () => selectStation(st.id));
      m.bindTooltip('', { direction: 'top', offset: [0, -10] });
      markers.set(st.id, m);
    }
    if (m._cls !== cls) {
      m.setIcon(L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }));
      m._cls = cls;
    }
    const s = st.stats;
    m.setTooltipContent(`<b>${esc(st.name)}</b><br>${esc(st.city)}<br>${STATUS_LABEL[status]}${s && Number.isFinite(st.newestT) ? ` · último dato ${fmtAgo(s.lag)}` : ''}`);
  }
  if (!fittedOnce && stations.size) { fitAll(); fittedOnce = true; }
}

// ───────────────────────── paneles ─────────────────────────
function renderKpis() {
  const list = [...stations.values()].map((st) => st.stats).filter(Boolean);
  const online = list.filter((s) => s.online).length;
  setText('kpiOnline', `${online} / ${stations.size}`);
  const count = (k) => list.filter((s) => s.status === k).length;
  setText('kpiOnlineSub', `Alerta ${count('alerta')} · Observación ${count('observacion')} · Sin conexión ${count('sin_conexion')}`);
  const rate = list.reduce((p, s) => p + (s.online ? s.samplesPerS : 0), 0);
  setText('kpiRate', Math.round(rate).toLocaleString('es-MX'));
  const comps = list.filter((s) => s.online && Number.isFinite(s.comp)).map((s) => s.comp);
  setText('kpiRateSub', comps.length ? `Completitud mínima ${fmtPct(Math.min(...comps))}` : 'Ninguna estación transmitiendo');
  const sel = stations.get(selectedId);
  setText('kpiLag', sel?.stats?.online ? fmtLag(sel.stats.lagMin) : '–');
  setText('kpiLagSub', sel ? `${sel.name} · ${Number.isFinite(sel.newestT) ? 'último dato ' + fmtAgo(sel.stats?.lag) : 'sin datos'}` : '–');
  const conf = allEvents.filter(isConfirmed);
  setText('kpiEvents', conf.length);
  setText('kpiEventsSub', conf.length ? `Último: ${fmtClock(conf[0].start, true)} · ${stations.get(conf[0].station)?.name || conf[0].station}` : 'En esta sesión del navegador');

  $('apiDot').className = `dot ${api.ok === false ? 'bad' : api.ok ? 'ok' : ''}`;
  setText('apiStatus', api.ok === false ? `Problema con la API: ${api.lastError}` : api.ok ? 'Conectado a la API Retriever' : 'Conectando con la API…');
  const t = Date.now();
  api.requests = api.requests.filter((r) => t - r < 60000);
  setText('apiMeta', `${api.requests.length} consultas/min · hasta ${api.pageLimit.toLocaleString('es-MX')} registros por consulta · ${fmtClock(nowS())}`);
}

function renderDetail() {
  const st = stations.get(selectedId);
  if (!st) return;
  const s = st.stats || stationStats(st);
  setText('dName', st.name);
  setText('dMeta', `${st.id} · ${st.city}${st.type && st.type !== '–' ? ' · ' + st.type : ''}`);
  const badge = $('dBadge');
  badge.textContent = STATUS_LABEL[s.status];
  badge.className = `badge ${s.status}`;
  $('dReasons').innerHTML = s.reasons.map(([k, txt]) => `<li class="${k}">${esc(txt)}</li>`).join('');

  const has = Number.isFinite(st.newestT);
  setText('dLast', has ? fmtClock(st.newestT, true) : '–');
  setText('dLastAgo', has ? fmtAgo(s.lag) : 'sin datos');
  setText('dLag', s.online ? fmtLag(s.lagMin) : '–');
  setText('dFs', Number.isFinite(s.fs) ? `${s.fs.toFixed(1)} Hz` : '–');
  setText('dFsSub', `nominal ${st.fs} Hz por sensor`);
  const compEl = $('dComp');
  compEl.textContent = fmtPct(s.comp);
  compEl.className = s.comp < CFG.COMPLETENESS_WARN ? 'low' : '';
  setText('dCompSub', s.sensors.some(([, x]) => x.bySeq) ? 'contada con el número de secuencia' : 'estimada con el muestreo');
  setText('dRms', fmtMg(s.rmsMg, 3));
  setText('dPga', fmtMg(s.pgaMg, 2));
  setText('dFreq', st.spec && Number.isFinite(st.spec.dom) ? `${st.spec.dom.toFixed(2)} Hz` : '–');
  setText('dFreqSub', st.spec ? `amplitud ${fmtMg(st.spec.domAmp, 3)}` : 'se calcula con la señal continua');
  setText('dSensors', s.expected ? `${s.reporting} / ${s.expected}` : '–');
  setText('dSensorsSub', s.activeTriggers ? `${s.activeTriggers} con disparo activo` : 'sin disparos activos');
  $('dChips').innerHTML = s.sensors.map(([name, x]) => {
    const cls = !x.online ? 'off' : x.comp < CFG.COMPLETENESS_WARN ? 'warn' : '';
    return `<span class="sensor-chip ${cls}"><b>${esc(name)}</b> · ${Number.isFinite(x.fs) ? x.fs.toFixed(0) + ' Hz' : '–'} · ${fmtPct(x.comp)}</span>`;
  }).join('');
  setText('dRaw', st.lastRecord ? JSON.stringify(st.lastRecord, null, 2) : '{}');
  setText('dTime', has ? `Hora de los datos: ${utcLabel(st.offsetH)} (${st.offsetSource}).` : '');
}

function renderSensorTable() {
  const st = stations.get(selectedId);
  if (!st?.stats) return;
  $('sensorTable').innerHTML = st.stats.sensors.map(([name, x]) => `<tr>
    <td><b>${esc(name)}</b></td>
    <td class="num">${Number.isFinite(x.fs) ? x.fs.toFixed(1) + ' Hz' : '–'}</td>
    <td class="num ${x.comp < CFG.COMPLETENESS_WARN ? 'low' : ''}">${fmtPct(x.comp)}</td>
    <td class="num">${x.bySeq ? x.gaps.toLocaleString('es-MX') + ' en 10 s' : '–'}</td>
    <td class="num">${fmtMg(x.rmsMg, 3)}</td>
    <td>${fmtAgo(nowS() - x.lastT)}</td></tr>`).join('') || '<tr><td colspan="6">Sin datos de sensores.</td></tr>';
}

function renderStationTable() {
  $('stationTable').innerHTML = [...stations.values()]
    .sort((a, b) => (isOnline(b) - isOnline(a)) || a.name.localeCompare(b.name))
    .map((st) => {
      const s = st.stats;
      if (!s) return '';
      const has = Number.isFinite(st.newestT);
      const conf = st.events.filter(isConfirmed).length;
      const iso = st.events.length - conf;
      return `<tr data-id="${esc(st.id)}" class="${st.id === selectedId ? 'selected' : ''}" tabindex="0">
        <td><b>${esc(st.name)}</b><br><small>${esc(st.id)}</small></td>
        <td>${esc(st.city)}</td>
        <td><span class="tag ${s.status}">${STATUS_LABEL[s.status]}</span></td>
        <td>${has ? fmtClock(st.newestT, true) : '–'}</td>
        <td class="num">${s.online ? fmtLag(s.lagMin) : has ? fmtAgo(s.lag) : '–'}</td>
        <td class="num">${s.online ? Math.round(s.samplesPerS) : '–'}</td>
        <td class="num ${s.online && s.comp < CFG.COMPLETENESS_WARN ? 'low' : ''}">${s.online ? fmtPct(s.comp) : '–'}</td>
        <td class="num">${has ? fmtMg(s.rmsMg, 3) : '–'}</td>
        <td class="num">${has ? fmtMg(s.pgaMg, 2) : '–'}</td>
        <td class="num">${conf}${iso ? ` <small>(+${iso} aislados)</small>` : ''}</td></tr>`;
    }).join('');
}

function renderEvents() {
  const box = $('eventsList');
  if (!allEvents.length) {
    box.innerHTML = '<div class="event empty">Sin eventos todavía. La detección necesita unos 30 s de señal continua para calibrarse.</div>';
    return;
  }
  box.innerHTML = allEvents.slice(0, 60).map((ev) => {
    const c = isConfirmed(ev);
    return `<div class="event ${c ? 'confirmed' : 'isolated'}">
      <b>${c ? 'Evento confirmado' : 'Disparo aislado'}</b> · ${esc(stations.get(ev.station)?.name || ev.station)} · ${fmtClock(ev.start, true)}<br>
      ${ev.sensors.size} sensor${ev.sensors.size > 1 ? 'es' : ''} (${esc([...ev.sensors.keys()].join(', '))}) ·
      duración ${(ev.end - ev.start).toFixed(1)} s · pico ${fmtMg(ev.peakMg, 1)} · STA/LTA ${ev.peakRatio.toFixed(1)}</div>`;
  }).join('');
}

function refreshModeOptions() {
  const st = stations.get(selectedId);
  const sel = $('signalMode');
  const names = st ? sensorNames(st) : [];
  const opts = names.map((n) => [n, `Sensor ${n} (X, Y, Z)`]);
  if (names.length > 1) opts.push(['cmp', 'Comparar sensores (eje Z)']);
  const html = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('') || '<option value="">Sin sensores todavía</option>';
  if (sel.dataset.h !== html) {
    sel.innerHTML = html;
    sel.dataset.h = html;
    if (!opts.some(([v]) => v === selectedMode)) selectedMode = opts[0]?.[0] || null;
    sel.value = selectedMode || '';
  }
  const ex = $('exSensor');
  const exHtml = '<option value="">Todos</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if (ex.dataset.h !== exHtml) { const cur = ex.value; ex.innerHTML = exHtml; ex.dataset.h = exHtml; ex.value = names.includes(cur) ? cur : ''; }
}

function selectStation(id) {
  if (!stations.has(id)) return;
  selectedId = id;
  selectedMode = null;
  $('signalMode').dataset.h = '';
  paused = false; pausedEnd = null;
  $('btnPause').textContent = 'Pausar';
  $('btnPause').setAttribute('aria-pressed', 'false');
  const st = stations.get(id);
  if (Number.isFinite(st.lat)) map.panTo([st.lat, st.lon]);
  try { history.replaceState(null, '', `#${encodeURIComponent(id)}`); } catch { /* sin historial */ }
  slowRender();
  renderSignal();
  updateEstimate();
}

function slowRender() {
  for (const st of stations.values()) stationStats(st);
  refreshModeOptions();
  renderAnalysis();
  renderKpis(); renderDetail(); renderMap(); renderStationTable(); renderSensorTable(); renderEvents();
}

// ───────────────────────── descarga ─────────────────────────
let exportCtrl = null;

function toLocalInput(d) {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function setRange(seconds) {
  const st = stations.get(selectedId);
  const end = st && Number.isFinite(st.newestT) ? new Date(st.newestT * 1000) : new Date();
  $('exEnd').value = toLocalInput(end);
  $('exStart').value = toLocalInput(new Date(end.getTime() - seconds * 1000));
  updateEstimate();
}
function readRange() {
  const a = new Date($('exStart').value), b = new Date($('exEnd').value);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) throw new Error('Elige la fecha y hora de inicio y de fin.');
  if (b <= a) throw new Error('La hora final debe ser posterior a la inicial.');
  return { start: a.getTime() / 1000, end: b.getTime() / 1000 };
}
function updateEstimate() {
  const box = $('exEstimate');
  const st = stations.get(selectedId);
  try {
    const { start, end } = readRange();
    const nSensors = $('exSensor').value ? 1 : Math.max(1, st?.sensors.size || st?.expectedSensors || 3);
    const est = Math.round((end - start) * (st?.fs || CFG.DEFAULT_FS) * nSensors);
    const step = Number($('exStep').value);
    const rows = step > 0 ? Math.ceil((end - start) / step) * nSensors : est;
    const requests = Math.max(1, Math.ceil(est / api.pageLimit));
    const mins = Math.ceil((requests * 0.6) / 60);
    box.className = 'estimate' + (est > 400000 ? ' warn' : '');
    box.textContent = `Hasta ${est.toLocaleString('es-MX')} muestras (${requests.toLocaleString('es-MX')} consultas${mins > 1 ? `, unos ${mins} min` : ''}). ` +
      `El archivo tendrá unas ${rows.toLocaleString('es-MX')} filas.` +
      (rows > 1048000 ? ' Excel admite como máximo 1,048,576 filas: usa CSV o un promedio.' : '') +
      (est > 400000 ? ' Es mucho: considera un rango más corto.' : '');
  } catch (err) {
    box.className = 'estimate warn';
    box.textContent = err.message;
  }
}
function setExporting(on) {
  $('btnCsv').disabled = on; $('btnXlsx').disabled = on;
  $('btnCancel').hidden = !on; $('exProgressBox').hidden = !on;
}
async function downloadRange(st, start, end, sensor, onProgress, signal) {
  const out = [];
  const chunk = 120; // bloques de 2 min para no depender de offsets enormes
  for (let a = start; a < end; a += chunk) {
    const b = Math.min(end, a + chunk);
    for (let page = 0; ; page++) {
      if (signal.aborted) throw new Error('Descarga cancelada.');
      const recs = await fetchRecords({ device_id: st.id, sensor_type: sensor || undefined, orden: api.hasOrden ? 'asc' : undefined,
        fecha_inicio: epochToRs(a, st), fecha_fin: epochToRs(b, st), limit: api.pageLimit, offset: page * api.pageLimit });
      for (const r of recs) {
        const t = rsToEpoch(r.rs, st);
        if (Number.isFinite(t) && t >= a && t < b) out.push([t, r]);
      }
      onProgress(Math.min(1, (b - start) / (end - start)), out.length);
      if (recs.length < api.pageLimit) break;
    }
  }
  out.sort((p, q) => p[0] - q[0]);
  return out;
}
function buildRows(st, data, step) {
  if (!(step > 0)) {
    return data.map(([t, r]) => ({
      hora_utc: new Date(t * 1000).toISOString(), rs_original: r.rs, device_id: r.device_id ?? st.id, sensor_type: r.sensor_type,
      x_g: num(r.x_value), y_g: num(r.y_value), z_g: num(r.z_value), seq: parseSeq(r.raw_data) ?? '',
      data_mode: r.data_mode ?? '', session_id: r.session_id ?? '',
    }));
  }
  const groups = new Map();
  for (const [t, r] of data) {
    const x = num(r.x_value), y = num(r.y_value), z = num(r.z_value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const k = `${r.sensor_type}|${Math.floor(t / step)}`;
    let g = groups.get(k);
    if (!g) { g = { t0: Math.floor(t / step) * step, sensor: r.sensor_type, n: 0, x: 0, y: 0, z: 0, v: [] }; groups.set(k, g); }
    g.n++; g.x += x; g.y += y; g.z += z; g.v.push([x, y, z]);
  }
  return [...groups.values()].sort((a, b) => a.t0 - b.t0 || String(a.sensor).localeCompare(b.sensor)).map((g) => {
    const mx = g.x / g.n, my = g.y / g.n, mz = g.z / g.n;
    let pk = 0;
    for (const [x, y, z] of g.v) pk = Math.max(pk, Math.hypot(x - mx, y - my, z - mz));
    return { inicio_utc: new Date(g.t0 * 1000).toISOString(), device_id: st.id, sensor_type: g.sensor, muestras: g.n,
      x_prom_g: +mx.toFixed(7), y_prom_g: +my.toFixed(7), z_prom_g: +mz.toFixed(7), pico_dinamico_mg: +(pk * 1000).toFixed(3) };
  });
}
function csvOf(rows) {
  if (!rows.length) return '';
  const h = Object.keys(rows[0]);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [h.join(','), ...rows.map((r) => h.map((k) => cell(r[k])).join(','))].join('\n');
}
function saveBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function doExport(kind) {
  const st = stations.get(selectedId);
  if (!st) return;
  let range;
  try { range = readRange(); } catch { updateEstimate(); return; }
  if (kind === 'xlsx' && !window.XLSX) { alert('La librería de Excel no cargó. Usa CSV.'); return; }
  const ctrl = new AbortController();
  exportCtrl = ctrl;
  setExporting(true);
  const sensor = $('exSensor').value;
  const step = Number($('exStep').value);
  const progress = (f, n) => { $('exBar').style.width = `${Math.round(f * 100)}%`; setText('exProgress', `${Math.round(f * 100)} % · ${n.toLocaleString('es-MX')} muestras`); };
  progress(0, 0);
  try {
    const data = await downloadRange(st, range.start, range.end, sensor, progress, ctrl.signal);
    if (!data.length) {
      alert(`No hay datos de ${st.name} entre ${fmtClock(range.start, true)} y ${fmtClock(range.end, true)}.`);
      return;
    }
    const rows = buildRows(st, data, step);
    const stamp = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const base = `${st.id}${sensor ? '_' + sensor : ''}_${stamp(range.start)}_a_${stamp(range.end)}${step > 0 ? `_prom${step}s` : ''}`;
    if (kind === 'csv') {
      saveBlob(`${base}.csv`, new Blob(['\ufeff' + csvOf(rows)], { type: 'text/csv;charset=utf-8' }));
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.slice(0, 1048575)), 'Datos');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Campo', 'Valor'], ['Estación', st.name], ['device_id', st.id], ['Ubicación', st.city], ['Latitud', st.lat], ['Longitud', st.lon],
        ['Desde (UTC)', new Date(range.start * 1000).toISOString()], ['Hasta (UTC)', new Date(range.end * 1000).toISOString()],
        ['Sensor', sensor || 'todos'], ['Resolución', step > 0 ? `promedio cada ${step} s` : 'todas las muestras'],
        ['Muestras descargadas', data.length], ['Filas', rows.length], ['Unidades', 'g (pico dinámico en mg)'],
        ['Hora de rs', `${utcLabel(st.offsetH)} (${st.offsetSource})`], ['Generado', new Date().toISOString()],
      ]), 'Metadatos');
      XLSX.writeFile(wb, `${base}.xlsx`);
    }
    setText('exProgress', `Listo · ${rows.length.toLocaleString('es-MX')} filas`);
  } catch (err) {
    if (!ctrl.signal.aborted) alert(`No se pudo descargar: ${err.message}`);
    else setText('exProgress', 'Descarga cancelada');
  } finally {
    setTimeout(() => setExporting(false), 1200);
    exportCtrl = null;
  }
}

// ───────────────────────── interfaz ─────────────────────────
function bind() {
  $('btnFit').addEventListener('click', fitAll);
  $('signalMode').addEventListener('change', (e) => { selectedMode = e.target.value; renderSignal(); renderAnalysis(); });
  $('signalWin').addEventListener('change', renderSignal);
  $('signalCenter').addEventListener('change', renderSignal);
  $('specMax').addEventListener('change', renderAnalysis);
  $('btnPause').addEventListener('click', () => {
    const st = stations.get(selectedId);
    paused = !paused;
    pausedEnd = paused && st ? displayEnd(st) : null;
    $('btnPause').textContent = paused ? 'Reanudar' : 'Pausar';
    $('btnPause').setAttribute('aria-pressed', String(paused));
    renderSignal(); renderAnalysis();
  });
  const readTrig = () => {
    const v = (id, def) => { const n = Number($(id).value); return Number.isFinite(n) && n > 0 ? n : def; };
    trig.sta = v('cfgSta', 1);
    trig.lta = Math.max(v('cfgLta', 20), trig.sta * 3);
    trig.on = v('cfgOn', 3.5);
    trig.off = Math.min(v('cfgOff', 1.5), trig.on - 0.1);
    for (const st of stations.values()) for (const b of st.sensors.values()) { b.d.n = 0; b.d.trig = false; }
  };
  ['cfgSta', 'cfgLta', 'cfgOn', 'cfgOff'].forEach((id) => $(id).addEventListener('change', readTrig));
  $('btnClearEvents').addEventListener('click', () => { allEvents.length = 0; for (const st of stations.values()) st.events.length = 0; slowRender(); });
  $('stationTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectStation(tr.dataset.id); });
  $('stationTable').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-id]'); if (tr) selectStation(tr.dataset.id); } });
  ['exStart', 'exEnd', 'exSensor', 'exStep'].forEach((id) => $(id).addEventListener('change', updateEstimate));
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => setRange(Number(b.dataset.range))));
  $('btnCsv').addEventListener('click', () => doExport('csv'));
  $('btnXlsx').addEventListener('click', () => doExport('xlsx'));
  $('btnCancel').addEventListener('click', () => exportCtrl?.abort());
}

// ───────────────────────── arranque ─────────────────────────
async function boot() {
  initMap(); initCharts(); bind();
  Object.keys(STATION_INFO).forEach(ensureStation);
  const fromHash = decodeURIComponent(location.hash.slice(1));
  selectedId = stations.has(fromHash) ? fromHash : Object.keys(STATION_INFO)[0];
  setRange(600);
  slowRender();

  await loadOpenApi();
  const ids = await loadDeviceIds();
  ids.forEach(ensureStation);
  if (fromHash && stations.has(fromHash)) selectedId = fromHash;

  setInterval(scheduler, 500);
  setInterval(() => { if (!document.hidden) renderSignal(); }, 200);
  setInterval(() => { if (!document.hidden) slowRender(); }, 1500);
  scheduler();
  // Si la estación inicial no tiene datos, se cambia a la primera que sí transmita.
  setTimeout(() => {
    if (fromHash || stations.get(selectedId)?.sensors.size) return;
    const live = [...stations.values()].find((s) => isOnline(s)) || [...stations.values()].find((s) => s.sensors.size);
    if (live) selectStation(live.id);
  }, 6000);
}
boot();
