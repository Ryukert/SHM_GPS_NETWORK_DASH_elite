// ═══════════════════════════════════════════════════════════════════════════
// Red SHM + P-Alert — VERSIÓN SIMULADA (MIIDT / UAGro)
//
// Mismo panel que la versión real, pero los datos salen de sim.js (window.SIM),
// que imita la API Retriever. No necesita Vercel ni internet para los datos
// (solo para cargar el mapa y las librerías).
//
//  • Tijuana: 10 planteles COBACH, cada uno con 1 SHM y 1 P-Alert (100 Hz, suelo).
//  • El SHM es UNA unidad con 3 sensores redundantes montados juntos (mpu9250_1,
//    mpu9250_2, lsm6dsox a 150 Hz). Igual que el programa de la Raspberry, el panel
//    los combina en una sola señal promediando los sensores válidos de cada ciclo.
//    Todo el análisis (RMS, PGA, FFT, STA/LTA) se hace sobre esa señal unificada;
//    los sensores individuales solo se usan para revisar la salud de la unidad.
//  • Guerrero: 10 edificios con SHM.
//  • Los P-Alert y SHM que detectan la onda P se asocian en un "evento de red":
//    con 3 o más sitios se estima epicentro, hora de origen y magnitud, y se
//    calcula cuánto falta para que la onda S llegue a cada sitio.
// ═══════════════════════════════════════════════════════════════════════════

const CFG = {
  POLL_LIVE_MS: 2000,
  POLL_PALERT_MS: 1000,       // P-Alert: más rápido, cada segundo cuenta para la alerta
  POLL_OFFLINE_MS: 30000,
  MAX_PAGES_PER_TICK: 6,
  OFFLINE_AFTER_S: 30,
  BUFFER_S: 120,
  STATS_WIN_S: 10,
  GAP_RESET_S: 1.0,
  COINCIDENCE_S: 2.0,
  PGA_WATCH_MG: 10,
  PGA_ALERT_MG: 50,
  PALERT_WATCH_INT: 3,
  PALERT_ALERT_INT: 4,
  COMPLETENESS_WARN: 0.8,
  FFT_N: 2048,
  NET_MIN_SITES: 3,
};

const NET = {
  tijuana: { label: 'Tijuana', window: 35, span: 1.6, step: 0.02, ref: { name: 'Tijuana', lat: 32.5149, lon: -117.0382 }, view: [[32.43, -117.16], [32.58, -116.8]] },
  guerrero: { label: 'Guerrero', window: 90, span: 2.8, step: 0.04, ref: { name: 'Chilpancingo', lat: 17.551, lon: -99.501 }, view: [[16.6, -101.8], [18.7, -98.2]] },
};

const STATION_INFO = Object.fromEntries(SIM.stations.map((s) => [s.id, s]));
const STATUS_LABEL = { activo: 'Activa', observacion: 'Observación', alerta: 'Alerta', sin_conexion: 'Sin conexión' };
const AXIS_COLORS = { x: '#1f6fb2', y: '#b23a48', z: '#2c8657' };
const SENSOR_COLORS = ['#7aa6d6', '#e79a62', '#6cbfb3', '#a78bfa', '#f472b6'];
const INT_THRESH = [0.8, 2.5, 8, 25, 80, 250, 400];   // gal → intensidad 1..7 (escala CWA de P-Alert)
const INT_TEXT = ['0 · imperceptible', '1 · muy leve', '2 · leve', '3 · débil', '4 · moderado', '5 · fuerte', '6 · muy fuerte', '7 · severo'];

// ───────────────────────── utilidades ─────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowS = () => Date.now() / 1000;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const intensity = (gal) => INT_THRESH.filter((t) => gal >= t).length;

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
function fmtLag(sec) { return !Number.isFinite(sec) ? '–' : sec < 60 ? `${Math.max(0, sec).toFixed(1)} s` : fmtAgo(sec).replace('hace ', ''); }
function fmtClock(epoch, withDate = false) {
  if (!Number.isFinite(epoch)) return '–';
  const d = new Date(epoch * 1000);
  return withDate
    ? d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : d.toLocaleTimeString('es-MX', { hour12: false });
}
function bearingText(from, to) {
  const y = Math.sin(((to.lon - from.lon) * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180);
  const x = Math.cos((from.lat * Math.PI) / 180) * Math.sin((to.lat * Math.PI) / 180) - Math.sin((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.cos(((to.lon - from.lon) * Math.PI) / 180);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}

// ───────────────────────── "API" simulada ─────────────────────────
const api = { pageLimit: 1000, hasOrden: true, ok: true, lastError: null, requests: [] };
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i;
const rsToEpoch = (rs) => (rs ? Date.parse(String(rs).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1') + (HAS_TZ.test(rs) ? '' : 'Z')) / 1000 : NaN);
const epochToRs = (sec) => new Date(sec * 1000).toISOString();

async function apiGet(path, params = {}) {
  api.requests.push(Date.now());
  const clean = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') clean[k] = String(v);
  await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));   // latencia de red simulada
  const json = SIM.handle(path, clean);
  return { status: json ? 200 : 404, json };
}
async function fetchRecords(params) {
  const r = await apiGet('/registros', params);
  if (r.status !== 200 || !Array.isArray(r.json?.registros)) throw new Error(`respuesta ${r.status}`);
  return r.json.registros;
}
async function loadOpenApi() {
  const r = await apiGet('/openapi.json');
  const params = r.json?.paths?.['/registros']?.get?.parameters || [];
  api.hasOrden = params.some((p) => p.name === 'orden');
  const max = params.find((p) => p.name === 'limit')?.schema?.maximum;
  if (Number.isFinite(max)) api.pageLimit = Math.max(100, Math.min(max, 10000));
}

// ───────────────────────── estado ─────────────────────────
const stations = new Map();
const allEvents = [];
const netEvents = [];
let selectedId = null;
let selectedMode = 'unit';
let paused = false, pausedEnd = null;
let eewNet = 'tijuana', eewNetManual = false;

function ensureStation(id) {
  if (stations.has(id)) return stations.get(id);
  const info = STATION_INFO[id];
  const st = {
    ...info, id,
    sensors: new Map(), expectedSensors: info.sensors.length,
    fused: newBuf(), pending: new Map(),
    newestT: -Infinity, newestRs: null, lastRecord: null, cursorRs: null,
    bootstrapped: false, polling: false, nextPollAt: 0, behind: false, reloadNow: false, error: null,
    lagHist: [], events: [], stats: null, spec: null, lastNetTrig: -Infinity,
  };
  stations.set(id, st);
  return st;
}
function newBuf() {
  return { t: [], x: [], y: [], z: [], seq: [], nSens: [], lastT: -Infinity,
    d: { n: 0, mx: 0, my: 0, mz: 0, sta: 0, lta: 0, lastT: null, trig: false, start: 0, peakRatio: 0, peakMg: 0, rT: [], r: [], lastPush: -Infinity } };
}
function ensureBuf(st, sensor) {
  let b = st.sensors.get(sensor);
  if (!b) { b = newBuf(); st.sensors.set(sensor, b); }
  return b;
}
const isOnline = (st) => Number.isFinite(st.newestT) && nowS() - st.newestT < CFG.OFFLINE_AFTER_S;

function parseSeq(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(?:SHM2?|PALERT),\s*-?[\d.]+,\s*(-?\d+)/.exec(raw);
  return m ? Number(m[1]) : null;
}

// ───────────────────────── ingesta + STA/LTA ─────────────────────────
function ingest(st, recs) {
  const bySensor = new Map();
  for (const r of recs) {
    const t = rsToEpoch(r.rs);
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
      const seq = parseSeq(r.raw_data);
      b.t.push(t); b.x.push(x); b.y.push(y); b.z.push(z); b.seq.push(seq);
      b.lastT = t;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const key = Math.round(t * 1000);
        let p = st.pending.get(key);
        if (!p) { p = { t, seq, vals: new Map() }; st.pending.set(key, p); }
        p.vals.set(sensor, [x, y, z]);
      }
      if (t > newest) { newest = t; st.newestRs = r.rs; st.lastRecord = r; }
    }
    trimBuf(b);
  }
  fuse(st);
  if (newest > st.newestT) { st.newestT = newest; st.lagHist.push([nowS(), nowS() - newest]); }
}

// Fusión de la unidad SHM: une las lecturas de los 3 sensores internos de un mismo
// ciclo (mismo rs) en una sola muestra.
//  1. A cada sensor se le resta su desfase de calibración respecto a los otros
//     (estimado continuamente). Sin esto, cuando falta un sensor en un ciclo el
//     promedio "salta" varios mg y aparecen picos falsos.
//  2. Si un sensor se aparta más de FUSE_REJECT_MG de la mediana de los tres, se
//     descarta en ese ciclo (sensor dañado o lectura errónea).
//  3. La muestra unificada es el promedio de los sensores que quedan.
// Un ciclo se cierra cuando todos los sensores activos ya pasaron de ese instante,
// para no promediar un ciclo al que aún le faltan sensores de la siguiente página.
const FUSE_REJECT_MG = 40;
function fuseState(st, name) {
  st.fz = st.fz || new Map();
  let z = st.fz.get(name);
  if (!z) { z = { off: [0, 0, 0], ready: 0, dyn2: 0, excl: [] }; st.fz.set(name, z); }
  return z;
}
function fuse(st) {
  const bufs = [...st.sensors.values()].filter((b) => b.t.length);
  if (!bufs.length || !st.pending.size) return;
  const maxLast = Math.max(...bufs.map((b) => b.lastT));
  const active = bufs.filter((b) => b.lastT >= maxLast - 3);
  const cutoff = Math.min(...active.map((b) => b.lastT));
  const keys = [...st.pending.keys()].sort((a, b) => a - b);
  const f = st.fused;
  const aOff = 1 / (st.fs * 20), aDyn = 1 / (st.fs * 10);
  const med3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  for (const k of keys) {
    const p = st.pending.get(k);
    const force = st.pending.size > 20000;
    if (!force && (p.t > cutoff || (p.t === cutoff && p.vals.size < active.length))) break;
    st.pending.delete(k);
    if (p.t <= f.lastT) continue;

    const entries = [...p.vals.entries()].map(([name, v]) => {
      const z = fuseState(st, name);
      return { name, v, z, c: [v[0] - z.off[0], v[1] - z.off[1], v[2] - z.off[2]] };
    });
    let used = entries;
    // Un sensor cuyo desfase ya es enorme no es confiable aunque se pueda compensar.
    const drifted = entries.filter((e) => e.z.ready && Math.hypot(...e.z.off) * 1000 > 2 * FUSE_REJECT_MG);
    if (drifted.length && drifted.length < entries.length) {
      for (const e of drifted) e.z.excl.push(p.t);
      used = entries.filter((e) => !drifted.includes(e));
    } else if (entries.length === 3) {
      const m = [0, 1, 2].map((i) => med3(entries[0].c[i], entries[1].c[i], entries[2].c[i]));
      for (const e of entries) e.dist = Math.hypot(e.c[0] - m[0], e.c[1] - m[1], e.c[2] - m[2]) * 1000;
      const out = entries.filter((e) => e.dist > FUSE_REJECT_MG);
      if (out.length === 1) { used = entries.filter((e) => e !== out[0]); out[0].z.excl.push(p.t); }
    } else if (entries.length === 2) {
      // Con solo 2 sensores no hay mayoría: si uno viene siendo descartado, se queda fuera.
      const bad = entries.filter((e) => e.z.excl.length > st.fs * CFG.STATS_WIN_S * 0.3);
      if (bad.length === 1) used = entries.filter((e) => e !== bad[0]);
    }
    let x = 0, y = 0, z = 0;
    for (const e of used) { x += e.c[0]; y += e.c[1]; z += e.c[2]; }
    x /= used.length; y /= used.length; z /= used.length;

    // Desfases: solo con ciclos de 3 sensores y sin descartes. La referencia es la
    // mediana, así un sensor que se deriva no arrastra el desfase de los otros dos.
    if (entries.length === 3 && used.length >= 2) {
      const m = used.length === 3
        ? [0, 1, 2].map((i) => med3(entries[0].c[i], entries[1].c[i], entries[2].c[i]))
        : [0, 1, 2].map((i) => (used[0].c[i] + used[1].c[i]) / 2);
      for (const e of used) {
        for (let i = 0; i < 3; i++) {
          const target = e.v[i] - m[i];
          e.z.off[i] = e.z.ready === 0 ? target : e.z.off[i] + aOff * (target - e.z.off[i]);
        }
        e.z.ready++;
      }
    }
    for (const e of entries) {
      const dd = (e.c[0] - x) ** 2 + (e.c[1] - y) ** 2 + (e.c[2] - z) ** 2;
      e.z.dyn2 += aDyn * (Math.min(dd, 1e-4) - e.z.dyn2);
      while (e.z.excl.length && e.z.excl[0] < p.t - CFG.STATS_WIN_S) e.z.excl.shift();
    }

    f.t.push(p.t); f.x.push(x); f.y.push(y); f.z.push(z); f.seq.push(p.seq); f.nSens.push(used.length);
    f.lastT = p.t;
    dspStep(st, f.d, p.t, x, y, z);
  }
  trimBuf(f);
}
function trimBuf(b) {
  const i = lowerBound(b.t, b.lastT - CFG.BUFFER_S);
  if (i > 0) { b.t.splice(0, i); b.x.splice(0, i); b.y.splice(0, i); b.z.splice(0, i); b.seq.splice(0, i); b.nSens.splice(0, i); }
  const j = lowerBound(b.d.rT, b.lastT - CFG.BUFFER_S);
  if (j > 0) { b.d.rT.splice(0, j); b.d.r.splice(0, j); }
}

const trig = { sta: 1, lta: 20, on: 3.5, off: 1.5 };

function dspStep(st, d, t, x, y, z) {
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
    onTriggerStart(st, t);
  }
  if (d.trig) {
    d.peakRatio = Math.max(d.peakRatio, ratio);
    d.peakMg = Math.max(d.peakMg, Math.sqrt(e) * 1000);
    if (ratio <= trig.off || t - d.start > 120) {
      d.trig = false;
      registerTrigger(st, { start: d.start, end: t, peakRatio: d.peakRatio, peakMg: d.peakMg });
    }
  }
  if (t - d.lastPush >= 0.1) { d.rT.push(t); d.r.push(ratio); d.lastPush = t; }
}
function registerTrigger(st, tr) {
  const ev = { station: st.id, ...tr };
  const prev = st.events.find((e) => Math.abs(e.start - tr.start) < 5);
  if (prev && prev.netEvent) ev.netEvent = prev.netEvent;
  if (prev) st.events.splice(st.events.indexOf(prev), 1);
  st.events.unshift(ev);
  st.events.splice(100);
  allEvents.unshift(ev);
  allEvents.splice(300);
}
// Una detección es confirmada cuando la misma onda la detectan 3 o más sitios de la red.
const isConfirmed = (ev) => !!ev.netEvent;

// ───────────────────────── red: asociación, localización, magnitud ─────────────────────────
function onTriggerStart(st, t) {
  if (t - st.lastNetTrig < 45) return;          // una detección por estación por sismo
  st.lastNetTrig = t;
  const cfg = NET[st.network];
  let ev = netEvents.find((e) => e.net === st.network && t >= e.firstT - cfg.window && t <= e.firstT + cfg.window);
  if (!ev) {
    ev = { id: `net-${Math.round(t * 1000)}`, net: st.network, firstT: t, picks: new Map(), est: null, detectedAt: nowS() };
    netEvents.unshift(ev);
    netEvents.splice(40);
  }
  if (!ev.picks.has(st.id)) ev.picks.set(st.id, { t });
  ev.firstT = Math.min(ev.firstT, t);
  ev.dirty = true;
}
function groundPga(st, t0, t1) {
  const b = st.fused;
  if (!b.t.length) return NaN;
  const a0 = lowerBound(b.t, t0 - 4), a1 = lowerBound(b.t, t0), z = upperBound(b.t, t1);
  if (z <= a1) return NaN;
  let mx = 0, my = 0, mz = 0, c = 0;
  for (let i = a0; i < a1; i++) { mx += b.x[i]; my += b.y[i]; mz += b.z[i]; c++; }
  if (!c) { mx = b.x[a1]; my = b.y[a1]; mz = b.z[a1]; c = 1; } else { mx /= c; my /= c; mz /= c; }
  let pk = 0;
  for (let i = a1; i < z; i++) pk = Math.max(pk, Math.hypot(b.x[i] - mx, b.y[i] - my, b.z[i] - mz));
  return pk * 981;
}
function locate(ev) {
  const cfg = NET[ev.net];
  const bySite = new Map();
  for (const [id, p] of ev.picks) {
    const st = stations.get(id);
    if (!st) continue;
    const prev = bySite.get(st.site);
    if (!prev || p.t < prev.t) bySite.set(st.site, { st, t: p.t });
  }
  const picks = [...bySite.values()];
  ev.nSites = picks.length;
  if (picks.length < CFG.NET_MIN_SITES) return;
  const cLat = picks.reduce((p, x) => p + x.st.lat, 0) / picks.length;
  const cLon = picks.reduce((p, x) => p + x.st.lon, 0) / picks.length;
  const depth = ev.net === 'guerrero' ? 20 : 10;
  const test = (lat, lon) => {
    const o = picks.map((p) => p.t - Math.hypot(SIM.distKm(lat, lon, p.st.lat, p.st.lon), depth) / SIM.VP);
    const t0 = median(o);
    const rms = Math.sqrt(o.reduce((s, v) => s + (v - t0) ** 2, 0) / o.length);
    return { lat, lon, t0, rms };
  };
  let best = null;
  const coarse = cfg.step * 4;
  for (let la = cLat - cfg.span; la <= cLat + cfg.span; la += coarse)
    for (let lo = cLon - cfg.span; lo <= cLon + cfg.span; lo += coarse) { const r = test(la, lo); if (!best || r.rms < best.rms) best = r; }
  const fine = best;
  for (let la = fine.lat - coarse; la <= fine.lat + coarse; la += cfg.step)
    for (let lo = fine.lon - coarse; lo <= fine.lon + coarse; lo += cfg.step) { const r = test(la, lo); if (r.rms < best.rms) best = r; }

  // Magnitud: log10(PGA) = 0.5 M − 1.5 log10(R) + 1.25 invertida en cada sitio.
  const mags = [];
  // En Tijuana la magnitud se calcula con los P-Alert (en el suelo): el SHM está dentro
  // del edificio y la estructura amplifica el movimiento.
  const free = picks.filter((p) => p.st.kind === 'palert');
  for (const p of free.length >= 2 ? free : picks) {
    const R = Math.hypot(SIM.distKm(best.lat, best.lon, p.st.lat, p.st.lon), depth);
    const gal = groundPga(p.st, p.t, p.t + 40);
    if (Number.isFinite(gal) && gal > 0.5) mags.push((Math.log10(gal) + 1.5 * Math.log10(Math.max(R, 5)) - 1.25) / 0.5);
  }
  const M = median(mags);
  const truth = SIM.quakes.filter((q) => q.network === ev.net).map((q) => ({ q, dt: Math.abs(q.t0 - best.t0) })).filter((x) => x.dt < 25).sort((a, b) => a.dt - b.dt)[0]?.q || null;
  ev.est = { ...best, depth, M: Number.isFinite(M) ? M : null, updatedAt: nowS() };
  ev.truth = truth;
  if (truth) truth.detection = ev;
  // Marcar los disparos P-Alert de este evento como confirmados por la red
  for (const [id, p] of ev.picks) { const st = stations.get(id); if (st) st.netPick = { ev: ev.id, t: p.t }; for (const e of st?.events || []) if (Math.abs(e.start - p.t) < 5) e.netEvent = ev.id; }
  ev.dirty = false;
}
function updateNetwork() {
  for (const ev of netEvents) {
    const age = nowS() - ev.firstT;
    if (age > 240) continue;
    if (ev.dirty || age < 90) locate(ev);
  }
}
function siteList(net) {
  const m = new Map();
  for (const st of stations.values()) if (st.network === net && !m.has(st.site)) m.set(st.site, { name: st.siteName, lat: st.lat, lon: st.lon });
  return [...m.values()];
}

// ───────────────────────── sondeo ─────────────────────────
async function pollStation(st) {
  st.polling = true;
  try {
    if (!st.bootstrapped) {
      let recs = await fetchRecords({ device_id: st.id, orden: 'desc', limit: api.pageLimit });
      recs = recs.slice().reverse();
      ingest(st, recs);
      st.bootstrapped = recs.length > 0;
      st.cursorRs = st.newestRs;
      st.behind = false;
      st.reloadNow = false;
    } else if (!isOnline(st)) {
      const recs = await fetchRecords({ device_id: st.id, orden: 'desc', limit: 1 });
      const t = recs.length ? rsToEpoch(recs[0].rs) : NaN;
      if (Number.isFinite(t) && t > st.newestT + 1) { st.bootstrapped = false; st.reloadNow = true; }
    } else {
      let page = 0, full = true;
      while (full && page < CFG.MAX_PAGES_PER_TICK) {
        const recs = await fetchRecords({ device_id: st.id, orden: 'asc', fecha_inicio: st.cursorRs, limit: api.pageLimit, offset: page * api.pageLimit });
        ingest(st, recs);
        full = recs.length >= api.pageLimit;
        page++;
      }
      st.cursorRs = st.newestRs || st.cursorRs;
      st.behind = full;
      if (full) st.bootstrapped = false;
    }
    st.error = null;
    if (!st.bootstrapped) st.nextPollAt = Date.now() + (st.behind || st.reloadNow ? 0 : CFG.POLL_OFFLINE_MS);
    else st.nextPollAt = Date.now() + (isOnline(st) ? (st.kind === 'palert' ? CFG.POLL_PALERT_MS : CFG.POLL_LIVE_MS) : CFG.POLL_OFFLINE_MS);
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
  for (let i = i0; i < n; i++) if (Number.isFinite(b.x[i])) { sx += b.x[i]; sy += b.y[i]; sz += b.z[i]; c++; }
  let vx = 0, vy = 0, vz = 0, pga = 0, pgv = 0;
  if (c) {
    sx /= c; sy /= c; sz /= c;
    const dt = 1 / st.fs, leak = 1 - dt / 4;
    let velX = 0, velY = 0;
    for (let i = i0; i < n; i++) {
      if (!Number.isFinite(b.x[i])) continue;
      const ex = b.x[i] - sx, ey = b.y[i] - sy, ez = b.z[i] - sz;
      vx += ex * ex; vy += ey * ey; vz += ez * ez;
      pga = Math.max(pga, Math.sqrt(ex * ex + ey * ey + ez * ez));
      if (st.kind === 'palert') {
        velX = (velX + ex * 981 * dt) * leak; velY = (velY + ey * 981 * dt) * leak;
        pgv = Math.max(pgv, Math.hypot(velX, velY));
      }
    }
    vx /= c; vy /= c; vz /= c;
  }
  let comp = NaN, gaps = 0, bySeq = false;
  const seqs = [];
  for (let i = i0; i < n; i++) if (b.seq[i] !== null) seqs.push(b.seq[i]);
  if (seqs.length >= Math.max(10, cnt * 0.9)) {
    let lo = Infinity, hi = -Infinity;
    for (const s of seqs) { if (s < lo) lo = s; if (s > hi) hi = s; }
    const range = hi - lo + 1, unique = new Set(seqs).size;
    if (range > 0 && range < unique * 5) { comp = unique / range; gaps = range - unique; bySeq = true; }
  }
  if (!bySeq && Number.isFinite(fsMeas)) comp = Math.min(1, fsMeas / st.fs);
  return { fs: fsMeas, comp, gaps, bySeq, lastT: b.lastT, online: nowS() - b.lastT < CFG.OFFLINE_AFTER_S,
    rmsMg: Math.sqrt(vx + vy + vz) * 1000, pgaMg: pga * 1000, pgv, triggered: b.d.trig,
    meanAxes: c ? [sx, sy, sz] : null };
}
// Salud de cada sensor interno según la fusión:
// offsetMg = desfase de calibración respecto a los otros (se compensa),
// dynMg = diferencia dinámica (ruido o falla), exclPct = % de ciclos descartado.
function consistency(st, name, b) {
  const z = st.fz?.get(name);
  if (!z) return null;
  const inWin = z.excl.filter((t) => t >= b.lastT - CFG.STATS_WIN_S).length;
  const exclPct = inWin / (st.fs * CFG.STATS_WIN_S);
  if (z.ready < st.fs * 5 && exclPct < 0.05) return null;
  return { offsetMg: z.ready ? Math.hypot(...z.off) * 1000 : NaN, dynMg: Math.sqrt(z.dyn2) * 1000, exclPct };
}
function stationStats(st) {
  const sensors = sensorNames(st).map((name) => [name, st.sensors.get(name)]).map(([name, b]) => {
    const s = sensorStats(st, b);
    if (s && st.kind === 'shm') s.cons = consistency(st, name, b);
    return [name, s];
  }).filter(([, s]) => s);
  const fz = sensorStats(st, st.fused);
  const lag = Number.isFinite(st.newestT) ? nowS() - st.newestT : Infinity;
  while (st.lagHist.length && nowS() - st.lagHist[0][0] > 30) st.lagHist.shift();
  const lagMin = st.lagHist.length ? Math.min(...st.lagHist.map((l) => l[1])) : lag;
  const online = sensors.filter(([, s]) => s.online);
  const pick = (f) => (online.length ? online : sensors).map(([, s]) => s[f]).filter(Number.isFinite);
  const max = (a) => (a.length ? Math.max(...a) : NaN);
  const min = (a) => (a.length ? Math.min(...a) : NaN);
  const mean = (a) => (a.length ? a.reduce((p, v) => p + v, 0) / a.length : NaN);
  const groundSensor = sensors.find(([n]) => n === 'palert' || n === 'mpu9250_1')?.[1];
  void groundSensor; void max; void mean;
  // Métricas de la unidad = señal unificada. Salud = sensores internos.
  const s = {
    lag, lagMin, sensors, fused: fz, online: isOnline(st),
    fs: fz?.fs ?? NaN, comp: min(pick('comp')), cycleComp: fz?.comp ?? NaN,
    rmsMg: fz?.rmsMg ?? NaN, pgaMg: fz?.pgaMg ?? NaN, pgaGal: fz ? fz.pgaMg * 0.981 : NaN, pgv: fz?.pgv ?? NaN,
    reporting: online.length, expected: st.expectedSensors,
    samplesPerS: online.reduce((p, [, x]) => p + (Number.isFinite(x.fs) ? x.fs : 0), 0),
    triggered: st.fused.d.trig, reasons: [],
  };
  s.intensity = Number.isFinite(s.pgaGal) ? intensity(s.pgaGal) : NaN;
  const netConfirmed = st.netPick && nowS() - st.netPick.t < 60;

  if (!Number.isFinite(st.newestT)) {
    s.status = 'sin_conexion';
    s.reasons.push(['off', st.bootstrapped || st.nextPollAt ? 'No hay datos de esta estación.' : 'Consultando…']);
  } else if (!s.online) {
    s.status = 'sin_conexion';
    s.reasons.push(['off', `No llegan datos nuevos. Último dato ${fmtAgo(lag)}.`]);
  } else {
    s.status = 'activo';
    if (st.kind === 'palert') {
      if (s.intensity >= CFG.PALERT_ALERT_INT) { s.status = 'alerta'; s.reasons.push(['bad', `Intensidad ${INT_TEXT[s.intensity]} (${s.pgaGal.toFixed(1)} gal).`]); }
      else if (s.intensity >= CFG.PALERT_WATCH_INT) { s.status = 'observacion'; s.reasons.push(['warn', `Intensidad ${INT_TEXT[s.intensity]} (${s.pgaGal.toFixed(1)} gal).`]); }
      if (s.triggered) { if (s.status === 'activo') s.status = 'observacion'; s.reasons.push(['warn', 'Detectó una onda sísmica (STA/LTA activo).']); }
    } else {
      if (s.pgaMg >= CFG.PGA_ALERT_MG) { s.status = 'alerta'; s.reasons.push(['bad', `Pico de ${fmtMg(s.pgaMg, 1)} en la estructura (umbral ${CFG.PGA_ALERT_MG} mg).`]); }
      else if (s.pgaMg >= CFG.PGA_WATCH_MG) { s.status = 'observacion'; s.reasons.push(['warn', `Vibración elevada: pico de ${fmtMg(s.pgaMg, 1)}.`]); }
      if (s.triggered && s.status === 'activo') { s.status = 'observacion'; s.reasons.push(['warn', 'La unidad detectó un posible evento (STA/LTA activo).']); }
    }
    if (netConfirmed) { if (s.status !== 'alerta') s.status = 'alerta'; s.reasons.unshift(['bad', 'Sismo confirmado por la red (3 o más sitios).']); }
    if (st.kind === 'shm') {
      const cons = sensors.filter(([, x]) => x.online && x.cons).map(([n, x]) => [n, x.cons]);
      const ref = median(cons.map(([, c]) => c.dynMg));
      for (const [n, c] of cons) {
        if (c.exclPct > 0.05) s.reasons.push(['warn', `El sensor ${n} no coincide con los otros dos y se descarta en el ${fmtPct(c.exclPct)} de los ciclos.`]);
        else if (c.offsetMg > FUSE_REJECT_MG) s.reasons.push(['warn', `El sensor ${n} se aparta ${c.offsetMg.toFixed(0)} mg de los otros (posible descalibración o falla). Se compensa en la señal unificada.`]);
        else if (cons.length >= 3 && c.dynMg > Math.max(0.8, 3 * ref)) s.reasons.push(['warn', `El sensor ${n} tiene más ruido que los otros (${c.dynMg.toFixed(2)} mg).`]);
      }
      if (s.reasons.some(([, t]) => t.startsWith('El sensor')) && s.status === 'activo') s.status = 'observacion';
    }
    if (s.comp < CFG.COMPLETENESS_WARN) {
      if (s.status === 'activo') s.status = 'observacion';
      s.reasons.push(['warn', `Llega solo el ${fmtPct(s.comp)} de las muestras: se pierden datos en el envío.`]);
    }
    if (s.expected && s.reporting < s.expected) {
      if (s.status === 'activo') s.status = 'observacion';
      s.reasons.push(['warn', `Reportan ${s.reporting} de ${s.expected} sensores internos; la unidad sigue midiendo con los demás.`]);
    }
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
    let m = 0;
    for (let i = i0; i < iEnd; i++) m += src[i];
    m /= N;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (src[i0 + i] - m) * win[i];
    fft(re, im);
    const amp = new Array(N / 2 - 1);
    for (let k = 1; k < N / 2; k++) { amp[k - 1] = ((2 * Math.hypot(re[k], im[k])) / wSum) * 1000; total[k - 1] += amp[k - 1] ** 2; }
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
  ro.parsing = true;
  ro.scales.x = { type: 'category', ticks: { maxTicksLimit: 7 }, grid: { display: false }, title: { display: true, text: 'segundos' } };
  ro.scales.y.min = 0;
  rateChart = new Chart($('rateChart'), { type: 'bar', data: { labels: [], datasets: [] }, options: ro });
}
function windowSeries(b, key, t0, t1, tRef, buckets, center) {
  if (!b) return [];
  const i0 = lowerBound(b.t, t0), i1 = upperBound(b.t, t1);
  const n = i1 - i0;
  if (n <= 0) return [];
  const src = b[key];
  let mean = 0;
  if (center) { for (let i = i0; i < i1; i++) mean += src[i]; mean /= n; }
  const out = [];
  const push = (t, v) => out.push({ x: t - tRef, y: (v - mean) * 1000 });
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
    const k = Math.min(buckets - 1, Math.floor((b.t[i] - t0) / w));
    if (k !== cur) { flush(); cur = k; minI = maxI = i; }
    else { if (src[i] < src[minI]) minI = i; if (src[i] > src[maxI]) maxI = i; }
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
const sensorNames = (st) => STATION_INFO[st.id].sensors.filter((n) => st.sensors.has(n));
const unitTitle = (st) => (st.kind === 'palert' ? 'P-Alert' : 'SHM unificado');
const sensorTitle = (st, n) => (st.kind === 'palert' ? 'P-Alert' : n);
// Vista actual: 'unit' = señal unificada; 'cmp' = comparar sensores internos; otro = un sensor.
function viewBuffer(st) {
  if (selectedMode === 'unit' || selectedMode === 'cmp' || !st.sensors.has(selectedMode)) return st.fused;
  return st.sensors.get(selectedMode);
}

function renderSignal() {
  const st = stations.get(selectedId);
  if (!st) return;
  const win = Number($('signalWin').value);
  const tEnd = displayEnd(st);
  const center = $('signalCenter').checked;
  const buckets = Math.max(200, Math.floor(($('signalChart').clientWidth || 800) / 1.5));
  let datasets = [];
  if (selectedMode === 'cmp') {
    datasets = sensorNames(st).map((name, i) => ({ label: `${name} · X`, borderColor: SENSOR_COLORS[i % SENSOR_COLORS.length], data: windowSeries(st.sensors.get(name), 'x', tEnd - win, tEnd, tEnd, buckets, center) }));
    datasets.push({ label: 'Unificado · X', borderColor: '#111827', borderWidth: 2, data: windowSeries(st.fused, 'x', tEnd - win, tEnd, tEnd, buckets, center) });
  } else {
    const b = viewBuffer(st);
    datasets = ['x', 'y', 'z'].map((k) => ({ label: k.toUpperCase(), borderColor: AXIS_COLORS[k], data: windowSeries(b, k, tEnd - win, tEnd, tEnd, buckets, center) }));
  }
  const hasData = datasets.some((d) => d.data.length);
  signalChart.data.datasets = datasets;
  signalChart.options.scales.x.min = -win;
  signalChart.options.scales.x.max = 0;
  signalChart.options.scales.y.title.text = center ? 'aceleración sin gravedad (mg)' : 'aceleración (mg)';
  signalChart.update('none');
  $('signalEmpty').hidden = hasData;
  if (!hasData) setText('signalEmpty', Number.isFinite(st.newestT) ? 'Sin muestras en esta ventana.' : 'Esta estación no tiene datos.');
  const what = selectedMode === 'cmp' ? 'sensores internos comparados' : viewBuffer(st) === st.fused ? unitTitle(st) : `solo el sensor ${selectedMode}`;
  setText('signalHint', paused ? 'En pausa. Presiona "Reanudar" para volver al tiempo real.'
    : isOnline(st) ? `${st.siteName} · ${what} · en vivo · retraso ≈ ${fmtLag(st.stats?.lagMin)}.`
    : Number.isFinite(st.newestT) ? `${st.siteName} · sin datos nuevos desde ${fmtClock(st.newestT, true)}.` : 'Esperando datos…');
}

function renderAnalysis() {
  const st = stations.get(selectedId);
  if (!st) return;
  const tEnd = displayEnd(st);
  const fmax = Number($('specMax').value);

  // Espectro de la señal que se está viendo (por defecto, la unificada).
  let sp = null;
  if (selectedMode === 'cmp') {
    const names = sensorNames(st);
    specChart.data.datasets = names.map((name, i) => {
      const s = spectrum(st.sensors.get(name), tEnd);
      return { label: `${name} · X`, borderColor: SENSOR_COLORS[i % SENSOR_COLORS.length], data: s ? s.f.map((f, k) => ({ x: f, y: s.amp.x[k] })).filter((q) => q.x <= fmax) : [] };
    });
    sp = spectrum(st.fused, tEnd);
    if (sp) specChart.data.datasets.push({ label: 'Unificado · X', borderColor: '#111827', borderWidth: 2, data: sp.f.map((f, k) => ({ x: f, y: sp.amp.x[k] })).filter((q) => q.x <= fmax) });
  } else {
    sp = spectrum(viewBuffer(st), tEnd);
    specChart.data.datasets = sp ? ['x', 'y', 'z'].map((k) => ({ label: k.toUpperCase(), borderColor: AXIS_COLORS[k], data: sp.f.map((f, i) => ({ x: f, y: sp.amp[k][i] })).filter((q) => q.x <= fmax) })) : [];
  }
  specChart.options.scales.x.min = 0;
  specChart.options.scales.x.max = fmax;
  specChart.update('none');
  $('specEmpty').hidden = !!sp;
  st.spec = spectrum(st.fused, tEnd);
  setText('specHint', sp ? `Pico en ${sp.dom.toFixed(2)} Hz · ${sp.N} muestras (${(sp.N / sp.fsEff).toFixed(1)} s) · resolución ${(sp.fsEff / sp.N).toFixed(3)} Hz${st.kind === 'shm' ? ` · modo del edificio ≈ ${st.f0} Hz` : ''}` : 'FFT con ventana Hann de la señal unificada.');

  // STA/LTA: una sola curva, la de la unidad.
  const d = st.fused.d;
  const a = lowerBound(d.rT, tEnd - 120), z = upperBound(d.rT, tEnd);
  const pts = [];
  for (let k = a; k < z; k++) pts.push({ x: d.rT[k] - tEnd, y: d.r[k] });
  staltaChart.data.datasets = [
    { label: `${unitTitle(st)} · STA/LTA`, borderColor: '#1f3a5f', data: pts },
    { label: 'Umbral de disparo', borderColor: '#dc2626', borderDash: [6, 4], borderWidth: 1, data: [{ x: -120, y: trig.on }, { x: 0, y: trig.on }] },
  ];
  if (st.netPick && st.netPick.t > tEnd - 120) staltaChart.data.datasets.push({ label: 'Llegada detectada', borderColor: '#b91c1c', borderWidth: 2, data: [{ x: st.netPick.t - tEnd, y: 0 }, { x: st.netPick.t - tEnd, y: Math.max(trig.on * 1.4, 2) }] });
  staltaChart.options.scales.x.min = -120;
  staltaChart.options.scales.x.max = 0;
  staltaChart.options.scales.y.suggestedMax = Math.max(trig.on * 1.4, 2);
  staltaChart.update('none');

  // Ciclos por segundo de la unidad y sensores internos por ciclo.
  const bins = 120, labels = [], cycles = new Array(bins).fill(0), sensSum = new Array(bins).fill(0);
  for (let i = 0; i < bins; i++) labels.push(String(i - bins + 1));
  const from = Math.floor(tEnd) - bins + 1;
  const f = st.fused;
  for (let k = lowerBound(f.t, from); k < f.t.length && f.t[k] < from + bins; k++) { const bi = Math.floor(f.t[k] - from); cycles[bi]++; sensSum[bi] += f.nSens[k]; }
  cycles[bins - 1] = null;
  rateChart.data.labels = labels;
  rateChart.data.datasets = [
    { type: 'bar', label: 'Ciclos recibidos por segundo', data: cycles, backgroundColor: cycles.map((v) => (v !== null && v < st.fs * CFG.COMPLETENESS_WARN ? '#f59e0b' : '#1f6fb2')), barPercentage: 1, categoryPercentage: 1 },
    { type: 'line', label: `Esperado (${st.fs} Hz)`, data: labels.map(() => st.fs), borderColor: '#16a34a', borderDash: [6, 4], borderWidth: 1, pointRadius: 0 },
  ];
  rateChart.update('none');
}

// ───────────────────────── mapa ─────────────────────────
let map;
const markers = new Map();
const quakeLayers = new Map();
const estLayers = new Map();

function initMap() {
  map = L.map('map', { minZoom: 3 }).setView([23.6, -106], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
}
const fitNet = (net) => map.fitBounds(NET[net].view, { padding: [20, 20] });
function fitAll() {
  const pts = [...stations.values()].map((s) => [s.lat, s.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
}
function passesFilter(st) {
  const net = $('fNet').value, kind = $('fKind').value, status = $('fStatus').value;
  return (!net || st.network === net) && (!kind || st.kind === kind) && (!status || st.stats?.status === status);
}
function renderMap() {
  for (const st of stations.values()) {
    const status = st.stats?.status || 'sin_conexion';
    const cls = `marker ${status} ${st.kind}${st.id === selectedId ? ' selected' : ''}`;
    let m = markers.get(st.id);
    if (!m) {
      m = L.marker([st.lat, st.lon], { title: st.name, keyboard: true });
      m.on('click', () => selectStation(st.id));
      m.bindTooltip('', { direction: 'top', offset: [0, -10] });
      markers.set(st.id, m);
    }
    const show = passesFilter(st);
    if (show && !map.hasLayer(m)) m.addTo(map);
    if (!show && map.hasLayer(m)) m.remove();
    if (m._cls !== cls) {
      // En el mismo plantel: SHM a la izquierda y P-Alert a la derecha del punto real.
      m.setIcon(L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [22, 22], iconAnchor: st.network === 'tijuana' ? (st.kind === 'palert' ? [-2, 11] : [24, 11]) : [11, 11] }));
      m._cls = cls;
      m.setZIndexOffset(st.id === selectedId ? 1000 : st.kind === 'palert' ? 100 : 0);
    }
    const s = st.stats;
    m.setTooltipContent(`<b>${esc(st.name)}</b><br>${STATUS_LABEL[status]}${s && Number.isFinite(st.newestT) ? ` · último dato ${fmtAgo(s.lag)}` : ''}${s && st.kind === 'palert' && Number.isFinite(s.intensity) ? `<br>Intensidad ${s.intensity}` : ''}`);
  }
}
function renderQuakeLayers() {
  const now = nowS();
  for (const q of SIM.quakes) {
    const age = now - q.t0;
    let lay = quakeLayers.get(q.id);
    if (age > 150 || age < -5) { if (lay) { lay.group.remove(); quakeLayers.delete(q.id); } continue; }
    if (!lay) {
      const group = L.layerGroup().addTo(map);
      L.marker([q.lat, q.lon], { icon: L.divIcon({ className: '', html: '<div class="epi-true">✶</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: true })
        .bindTooltip(`<b>Sismo simulado M${q.M.toFixed(1)}</b><br>${esc(q.scenario)}<br>${fmtClock(q.t0)}`).addTo(group);
      const p = L.circle([q.lat, q.lon], { radius: 1, color: '#1f6fb2', weight: 2, fill: false, dashArray: '6 6', interactive: false }).addTo(group);
      const s = L.circle([q.lat, q.lon], { radius: 1, color: '#dc2626', weight: 2.5, fillColor: '#dc2626', fillOpacity: 0.06, interactive: false }).addTo(group);
      lay = { group, p, s };
      quakeLayers.set(q.id, lay);
    }
    lay.p.setRadius(Math.max(1, SIM.VP * age * 1000));
    lay.s.setRadius(Math.max(1, SIM.VS * age * 1000));
  }
  for (const ev of netEvents) {
    const ok = ev.est && now - ev.firstT < 240;
    let m = estLayers.get(ev.id);
    if (!ok) { if (m) { m.remove(); estLayers.delete(ev.id); } continue; }
    if (!m) {
      m = L.marker([ev.est.lat, ev.est.lon], { icon: L.divIcon({ className: '', html: '<div class="epi-est">✚</div>', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 2000 }).addTo(map);
      estLayers.set(ev.id, m);
    }
    m.setLatLng([ev.est.lat, ev.est.lon]);
    m.bindTooltip(`<b>Estimación de la red</b><br>${ev.est.M ? 'M' + ev.est.M.toFixed(1) : 'magnitud en cálculo'} · ${ev.nSites} sitios`);
  }
}

// ───────────────────────── paneles ─────────────────────────
function latestNetEvent(net) {
  return netEvents.find((e) => e.net === net && e.est && nowS() - e.firstT < 300) || null;
}
function renderKpis() {
  const list = [...stations.values()].map((st) => st.stats).filter(Boolean);
  const online = list.filter((s) => s.online).length;
  setText('kpiOnline', `${online} / ${stations.size}`);
  const count = (k) => list.filter((s) => s.status === k).length;
  setText('kpiOnlineSub', `Alerta ${count('alerta')} · Observación ${count('observacion')} · Sin conexión ${count('sin_conexion')}`);
  const rate = list.reduce((p, s) => p + (s.online ? s.samplesPerS : 0), 0);
  setText('kpiRate', Math.round(rate).toLocaleString('es-MX'));
  const comps = list.filter((s) => s.online && Number.isFinite(s.comp)).map((s) => s.comp);
  setText('kpiRateSub', comps.length ? `Completitud mínima ${fmtPct(Math.min(...comps))}` : '–');
  const sel = stations.get(selectedId);
  setText('kpiLag', sel?.stats?.online ? fmtLag(sel.stats.lagMin) : '–');
  setText('kpiLagSub', sel ? sel.name : '–');

  const ev = netEvents.find((e) => e.est && nowS() - e.firstT < 300);
  const box = $('kpiEewBox');
  if (ev) {
    const active = nowS() - ev.firstT < 60;
    box.classList.toggle('alert', active);
    setText('kpiEew', `${ev.est.M ? 'M' + ev.est.M.toFixed(1) : 'Sismo'} · ${NET[ev.net].label}`);
    setText('kpiEewSub', `${active ? 'EN CURSO · ' : ''}detectado ${fmtAgo(nowS() - ev.detectedAt)} · ${ev.nSites} sitios`);
  } else {
    box.classList.remove('alert');
    setText('kpiEew', 'Sin sismos');
    setText('kpiEewSub', `${SIM.quakes.length} sismos simulados en la sesión`);
  }
  api.requests = api.requests.filter((r) => Date.now() - r < 60000);
  setText('apiStatus', 'Modo simulación · datos generados en el navegador');
  setText('apiMeta', `${stations.size} estaciones · ${api.requests.length.toLocaleString('es-MX')} consultas/min · ${fmtClock(nowS())}`);
}

function renderDetail() {
  const st = stations.get(selectedId);
  if (!st) return;
  const s = st.stats || stationStats(st);
  setText('dKind', `${st.kind === 'palert' ? 'P-Alert' : 'SHM'} · ${NET[st.network].label}`);
  setText('dName', st.siteName);
  setText('dMeta', `${st.id} · ${st.type}${st.kind === 'shm' ? ` · modo del edificio ≈ ${st.f0} Hz` : ''}`);
  const badge = $('dBadge');
  badge.textContent = STATUS_LABEL[s.status];
  badge.className = `badge ${s.status}`;
  $('dReasons').innerHTML = s.reasons.map(([k, txt]) => `<li class="${k}">${esc(txt)}</li>`).join('');
  const has = Number.isFinite(st.newestT);
  setText('dLast', has ? fmtClock(st.newestT, true) : '–');
  setText('dLastAgo', has ? fmtAgo(s.lag) : 'sin datos');
  setText('dLag', s.online ? fmtLag(s.lagMin) : '–');
  setText('dFs', Number.isFinite(s.fs) ? `${s.fs.toFixed(1)} Hz` : '–');
  setText('dFsSub', `ciclos por segundo · nominal ${st.fs} Hz`);
  const compEl = $('dComp');
  const compVal = st.kind === 'shm' ? s.cycleComp : s.comp;
  compEl.textContent = fmtPct(compVal);
  compEl.className = compVal < CFG.COMPLETENESS_WARN ? 'low' : '';
  setText('dCompSub', st.kind === 'shm' ? `ciclos con datos · peor sensor ${fmtPct(s.comp)}` : 'contada con el número de secuencia');
  setText('dRms', fmtMg(s.rmsMg, 3));
  setText('dPga', fmtMg(s.pgaMg, 2));
  setText('dPgaSub', Number.isFinite(s.pgaMg) ? `${(s.pgaMg * 0.981).toFixed(2)} gal · últimos 10 s` : 'últimos 10 s');
  if (st.kind === 'palert') {
    setText('dM7L', 'Intensidad (escala CWA)');
    setText('dM7', Number.isFinite(s.intensity) ? String(s.intensity) : '–');
    setText('dM7Sub', Number.isFinite(s.intensity) ? INT_TEXT[s.intensity].split(' · ')[1] : '');
    setText('dM8L', 'Velocidad pico (PGV)');
    setText('dM8', Number.isFinite(s.pgv) ? `${s.pgv.toFixed(2)} cm/s` : '–');
    setText('dM8Sub', 'horizontal, últimos 10 s');
  } else {
    setText('dM7L', 'Frecuencia dominante');
    setText('dM7', st.spec && Number.isFinite(st.spec.dom) ? `${st.spec.dom.toFixed(2)} Hz` : '–');
    setText('dM7Sub', st.spec ? `amplitud ${fmtMg(st.spec.domAmp, 3)}` : 'se calcula con la señal continua');
    setText('dM8L', 'Sensores internos');
    setText('dM8', `${s.reporting} / ${s.expected}`);
    setText('dM8Sub', s.reporting === s.expected ? 'los 3 promediados en cada ciclo' : 'se promedian los que siguen reportando');
  }
  $('dChips').innerHTML = st.kind === 'palert' ? '' : s.sensors.map(([name, x]) => {
    const bad = x.cons && (x.cons.offsetMg > FUSE_REJECT_MG || x.cons.exclPct > 0.05);
    const cls = !x.online ? 'off' : bad || x.comp < CFG.COMPLETENESS_WARN ? 'warn' : '';
    const dev = x.cons ? (x.cons.exclPct > 0.05 ? ' · descartado' : ` · desfase ${x.cons.offsetMg.toFixed(1)} mg`) : '';
    return `<span class="sensor-chip ${cls}"><b>${esc(name)}</b> · ${fmtPct(x.comp)}${dev}</span>`;
  }).join('');
  setText('dRaw', st.lastRecord ? JSON.stringify(st.lastRecord, null, 2) : '{}');
}

function renderSensorTable() {
  const st = stations.get(selectedId);
  if (!st?.stats) return;
  const f = st.stats.fused;
  const unitRow = f ? `<tr class="unit-row">
    <td><b>${unitTitle(st)}</b></td>
    <td class="num">${Number.isFinite(f.fs) ? f.fs.toFixed(1) + ' Hz' : '–'}</td>
    <td class="num ${f.comp < CFG.COMPLETENESS_WARN ? 'low' : ''}">${fmtPct(f.comp)}</td>
    <td class="num">${f.bySeq ? f.gaps.toLocaleString('es-MX') + ' ciclos' : '–'}</td>
    <td class="num">–</td>
    <td class="num">${fmtMg(f.rmsMg, 3)}</td></tr>` : '';
  const rows = st.kind === 'palert' ? [] : st.stats.sensors.map(([name, x]) => {
    const c = x.cons;
    const bad = c && (c.offsetMg > FUSE_REJECT_MG || c.exclPct > 0.05);
    return `<tr>
    <td>↳ ${esc(name)}</td>
    <td class="num">${Number.isFinite(x.fs) ? x.fs.toFixed(1) + ' Hz' : '–'}</td>
    <td class="num ${x.comp < CFG.COMPLETENESS_WARN ? 'low' : ''}">${fmtPct(x.comp)}</td>
    <td class="num">${x.bySeq ? x.gaps.toLocaleString('es-MX') : '–'}</td>
    <td class="num ${bad ? 'low' : ''}">${c ? (c.exclPct > 0.05 ? `descartado ${fmtPct(c.exclPct)}` : `${c.offsetMg.toFixed(1)} / ${c.dynMg.toFixed(2)} mg`) : '–'}</td>
    <td class="num">${fmtMg(x.rmsMg, 3)}</td></tr>`;
  });
  $('sensorTable').innerHTML = unitRow + rows.join('') || '<tr><td colspan="6">Sin datos.</td></tr>';
}

function renderStationTable() {
  const rows = [...stations.values()].filter(passesFilter)
    .sort((a, b) => a.network.localeCompare(b.network) || a.siteName.localeCompare(b.siteName) || a.kind.localeCompare(b.kind));
  setText('fCount', `${rows.length} de ${stations.size}`);
  $('stationTable').innerHTML = rows.map((st) => {
    const s = st.stats;
    if (!s) return '';
    const has = Number.isFinite(st.newestT);
    const conf = st.events.filter(isConfirmed).length, iso = st.events.length - conf;
    return `<tr data-id="${esc(st.id)}" class="${st.id === selectedId ? 'selected' : ''}" tabindex="0">
      <td><b>${esc(st.siteName)}</b><br><small>${esc(st.id)}</small></td>
      <td>${st.kind === 'palert' ? 'P-Alert' : 'SHM'}<br><small>${NET[st.network].label}</small></td>
      <td><span class="tag ${s.status}">${STATUS_LABEL[s.status]}</span></td>
      <td>${has ? fmtClock(st.newestT, true) : '–'}</td>
      <td class="num">${s.online ? fmtLag(s.lagMin) : has ? fmtAgo(s.lag) : '–'}</td>
      <td class="num">${s.online ? Math.round(s.samplesPerS) : '–'}</td>
      <td class="num ${s.online && s.comp < CFG.COMPLETENESS_WARN ? 'low' : ''}">${s.online ? fmtPct(s.comp) : '–'}</td>
      <td class="num">${has ? fmtMg(s.rmsMg, 3) : '–'}</td>
      <td class="num">${has ? fmtMg(s.pgaMg, 2) : '–'}</td>
      <td class="num">${has && Number.isFinite(s.intensity) ? `<span class="int int-${s.intensity}">${s.intensity}</span>` : '–'}</td>
      <td class="num">${conf}${iso ? ` <small>(+${iso})</small>` : ''}</td></tr>`;
  }).join('');
}

function renderEvents() {
  const box = $('eventsList');
  const st = stations.get(selectedId);
  const list = st ? st.events : [];
  if (!list.length) {
    box.innerHTML = `<div class="event empty">El ${unitTitle(stations.get(selectedId) || {})} no ha detectado eventos. La detección se calibra con unos 30 s de señal continua.</div>`;
    return;
  }
  box.innerHTML = list.slice(0, 40).map((ev) => {
    const c = isConfirmed(ev);
    const net = c ? netEvents.find((n) => n.id === ev.netEvent) : null;
    const what = c ? `Sismo confirmado por la red${net ? ` (${net.nSites} sitios)` : ''}` : 'Detección local, sin confirmar por otros sitios';
    return `<div class="event ${c ? 'confirmed' : 'isolated'}"><b>${what}</b> · ${fmtClock(ev.start, true)}<br>
      duración ${(ev.end - ev.start).toFixed(1)} s · pico ${fmtMg(ev.peakMg, 1)} (${(ev.peakMg * 0.981).toFixed(1)} gal) · STA/LTA ${ev.peakRatio.toFixed(1)}</div>`;
  }).join('');
}

function renderEew() {
  const box = $('eewBox');
  const ev = latestNetEvent(eewNet);
  const pending = netEvents.find((e) => e.net === eewNet && !e.est && nowS() - e.firstT < 60);
  if (!ev) {
    box.innerHTML = pending
      ? `<div class="eew-head pending"><span class="big">Posible sismo: ${pending.picks.size} detecciones</span><small>Esperando a que ${CFG.NET_MIN_SITES} sitios detecten la onda para localizarlo.</small></div>`
      : `<div class="eew-empty">Sin sismos detectados en ${NET[eewNet].label} en los últimos 5 minutos. Usa el simulador para lanzar uno.</div>`;
    return;
  }
  const e = ev.est, now = nowS();
  const epi = { lat: e.lat, lon: e.lon };
  const ref = NET[eewNet].ref;
  const dRef = SIM.distKm(ref.lat, ref.lon, e.lat, e.lon);
  const sites = siteList(eewNet).map((site) => {
    const R = Math.hypot(SIM.distKm(e.lat, e.lon, site.lat, site.lon), e.depth);
    const tS = e.t0 + R / SIM.VS;
    const gal = e.M ? SIM.pgaGal(e.M, R) : NaN;
    return { ...site, R, remain: tS - now, gal, int: Number.isFinite(gal) ? intensity(gal) : NaN };
  }).sort((a, b) => a.R - b.R);
  const anyComing = sites.some((s) => s.remain > 0);
  const maxInt = Math.max(...sites.map((s) => (Number.isFinite(s.int) ? s.int : 0)));
  const headCls = anyComing ? 'alert' : now - ev.firstT < 60 ? 'alert' : 'done';
  const q = ev.truth;
  const truthTxt = q
    ? `Simulador (valor real): M${q.M.toFixed(1)} · ${esc(q.scenario)} · error de localización ${SIM.distKm(q.lat, q.lon, e.lat, e.lon).toFixed(0)} km${e.M ? ` · error de magnitud ${(e.M - q.M >= 0 ? '+' : '') + (e.M - q.M).toFixed(1)}` : ''}`
    : 'No se asoció a un sismo simulado (posible falsa detección).';
  box.innerHTML = `
    <div class="eew-head ${headCls}">
      <span class="big">${anyComing ? '⚠ ' : ''}Sismo ${e.M ? 'M' + e.M.toFixed(1) : ''} a ${dRef.toFixed(0)} km al ${bearingText(ref, epi)} de ${esc(ref.name)}</span>
      <small>Origen ${fmtClock(e.t0)} · estimado con ${ev.nSites} sitios · residuo ${e.rms.toFixed(2)} s · intensidad máxima esperada ${maxInt}</small>
    </div>
    <p class="eew-truth">${truthTxt}</p>
    <div class="table-scroll" style="padding:0">
      <table class="mini">
        <thead><tr><th>Sitio</th><th>Distancia</th><th>Intensidad estimada</th><th>Onda S</th></tr></thead>
        <tbody>${sites.map((s) => `<tr>
          <td>${esc(s.name)}</td>
          <td class="num">${s.R.toFixed(0)} km</td>
          <td>${Number.isFinite(s.int) ? `<span class="int int-${s.int}">${s.int}</span> ${INT_TEXT[s.int].split(' · ')[1]}` : 'calculando…'}</td>
          <td class="count ${s.remain > 0 ? 'soon' : 'past'}">${s.remain > 0 ? `llega en ${Math.ceil(s.remain)} s` : `llegó ${fmtAgo(-s.remain)}`}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function renderQuakeList() {
  const rows = [...SIM.quakes].reverse().slice(0, 12);
  $('quakeList').innerHTML = rows.length ? rows.map((q) => {
    const d = q.detection;
    const est = d?.est;
    const det = est ? `M${est.M ? est.M.toFixed(1) : '?'} · ${d.nSites} sitios · ${SIM.distKm(q.lat, q.lon, est.lat, est.lon).toFixed(0)} km de error`
      : nowS() - q.t0 < 90 ? 'esperando detecciones…' : 'no detectado';
    return `<tr><td>${fmtClock(q.t0)}</td><td>${NET[q.network].label} · ${esc(q.scenario)}${q.auto ? ' <small>(auto)</small>' : ''}</td><td class="num">${q.M.toFixed(1)}</td><td>${det}</td></tr>`;
  }).join('') : '<tr><td colspan="4">Todavía no hay sismos simulados.</td></tr>';
  setText('qAutoNext', SIM.getAuto() ? `próximo en ~${Math.round(SIM.nextAutoIn())} s` : '');
}

function refreshModeOptions() {
  const st = stations.get(selectedId);
  const sel = $('signalMode');
  const names = st ? sensorNames(st) : [];
  const opts = st ? [['unit', `${unitTitle(st)} (X, Y, Z)`]] : [];
  if (st?.kind === 'shm' && names.length > 1) {
    opts.push(['cmp', 'Diagnóstico: comparar los 3 sensores internos (eje X)']);
    for (const n of names) opts.push([n, `Diagnóstico: solo ${n}`]);
  }
  const html = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('') || '<option value="">Sin sensores todavía</option>';
  if (sel.dataset.h !== html) {
    sel.innerHTML = html;
    sel.dataset.h = html;
    if (!opts.some(([v]) => v === selectedMode)) selectedMode = opts[0]?.[0] || null;
    sel.value = selectedMode || '';
  }
  const ex = $('exSensor');
  const exOpts = st?.kind === 'shm' ? [['__unit', 'SHM unificado (promedio por ciclo)'], ['', 'Los 3 sensores internos (crudo)'], ...names.map((n) => [n, `Solo ${n}`])] : [['', 'P-Alert']];
  const exHtml = exOpts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  if (ex.dataset.h !== exHtml) { const cur = ex.value; ex.innerHTML = exHtml; ex.dataset.h = exHtml; ex.value = exOpts.some(([v]) => v === cur) ? cur : exOpts[0][0]; }
}

function setEewNet(net, manual) {
  eewNet = net;
  if (manual) eewNetManual = true;
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.net === net));
  renderEew();
}
function selectStation(id, { pan = true } = {}) {
  if (!stations.has(id)) return;
  selectedId = id;
  selectedMode = 'unit';
  $('signalMode').dataset.h = '';
  paused = false; pausedEnd = null;
  $('btnPause').textContent = 'Pausar';
  $('btnPause').setAttribute('aria-pressed', 'false');
  const st = stations.get(id);
  if (pan) map.panTo([st.lat, st.lon]);
  if (!eewNetManual) setEewNet(st.network);
  try { history.replaceState(null, '', `#${encodeURIComponent(id)}`); } catch { /* sin historial */ }
  slowRender();
  renderSignal();
  updateEstimate();
}
function slowRender() {
  for (const st of stations.values()) stationStats(st);
  updateNetwork();
  refreshModeOptions();
  renderAnalysis();
  renderKpis(); renderDetail(); renderMap(); renderStationTable(); renderSensorTable(); renderEvents(); renderQuakeList();
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
    const nSensors = $('exSensor').value ? 1 : st?.expectedSensors || 1;   // '__unit' también da 1 fila por ciclo
    const est = Math.round((end - start) * (st?.fs || 150) * nSensors);
    const step = Number($('exStep').value);
    const rows = step > 0 ? Math.ceil((end - start) / step) * nSensors : est;
    box.className = 'estimate' + (est > 400000 ? ' warn' : '');
    box.textContent = `Hasta ${est.toLocaleString('es-MX')} muestras. El archivo tendrá unas ${rows.toLocaleString('es-MX')} filas.` +
      (rows > 1048000 ? ' Excel admite como máximo 1,048,576 filas: usa CSV o un promedio.' : '') + (est > 400000 ? ' Es mucho: considera un rango más corto.' : '');
  } catch (err) { box.className = 'estimate warn'; box.textContent = err.message; }
}
function setExporting(on) { $('btnCsv').disabled = on; $('btnXlsx').disabled = on; $('btnCancel').hidden = !on; $('exProgressBox').hidden = !on; }
async function downloadRange(st, start, end, sensor, onProgress, signal) {
  const out = [];
  for (let a = start; a < end; a += 120) {
    const b = Math.min(end, a + 120);
    for (let page = 0; ; page++) {
      if (signal.aborted) throw new Error('Descarga cancelada.');
      const recs = await fetchRecords({ device_id: st.id, sensor_type: sensor && sensor !== '__unit' ? sensor : undefined, orden: 'asc', fecha_inicio: epochToRs(a), fecha_fin: epochToRs(b), limit: api.pageLimit, offset: page * api.pageLimit });
      for (const r of recs) { const t = rsToEpoch(r.rs); if (t >= a && t < b) out.push([t, r]); }
      onProgress(Math.min(1, (b - start) / (end - start)), out.length);
      if (recs.length < api.pageLimit) break;
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}
// Misma fusión que en vivo, aplicada a un rango descargado: se estima el desfase de
// cada sensor (mediana de su diferencia con la mediana del ciclo), se descarta el que
// no coincide y se promedian los demás.
function fuseRows(data) {
  const byT = new Map();
  for (const [t, r] of data) {
    const x = num(r.x_value), y = num(r.y_value), z = num(r.z_value);
    if (!Number.isFinite(x)) continue;
    const k = Math.round(t * 1000);
    let g = byT.get(k);
    if (!g) { g = { t, r, vals: new Map() }; byT.set(k, g); }
    g.vals.set(r.sensor_type, [x, y, z]);
  }
  const cycles = [...byT.values()].sort((a, b) => a.t - b.t);
  const med = (arr) => median(arr);
  const med3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  const diffs = new Map(), rejects = new Map(), counts = new Map();
  const step = Math.max(1, Math.floor(cycles.length / 6000));
  for (let i = 0; i < cycles.length; i += step) {
    const e = [...cycles[i].vals.entries()];
    if (e.length !== 3) continue;
    const m = [0, 1, 2].map((j) => med3(e[0][1][j], e[1][1][j], e[2][1][j]));
    for (const [name, v] of e) {
      if (!diffs.has(name)) { diffs.set(name, [[], [], []]); rejects.set(name, 0); counts.set(name, 0); }
      diffs.get(name).forEach((arr, j) => arr.push(v[j] - m[j]));
      counts.set(name, counts.get(name) + 1);
      if (Math.hypot(v[0] - m[0], v[1] - m[1], v[2] - m[2]) * 1000 > FUSE_REJECT_MG) rejects.set(name, rejects.get(name) + 1);
    }
  }
  const off = new Map([...diffs.entries()].map(([name, d]) => [name, d.map(med)]));
  const badSensor = new Set([...counts.entries()].filter(([name, c]) => c && (rejects.get(name) / c > 0.3 || Math.hypot(...off.get(name)) * 1000 > 2 * FUSE_REJECT_MG)).map(([name]) => name));
  return cycles.map((g) => {
    let used = [...g.vals.entries()].map(([name, v]) => { const o = off.get(name) || [0, 0, 0]; return [name, [v[0] - o[0], v[1] - o[1], v[2] - o[2]]]; });
    if (badSensor.size && used.some(([n]) => !badSensor.has(n))) used = used.filter(([n]) => !badSensor.has(n));
    if (used.length === 3) {
      const m = [0, 1, 2].map((j) => med3(used[0][1][j], used[1][1][j], used[2][1][j]));
      const out = used.filter(([, c]) => Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]) * 1000 > FUSE_REJECT_MG);
      if (out.length === 1) used = used.filter((u) => u !== out[0]);
    } else if (used.length === 2) {
      const keep = used.filter(([name]) => !badSensor.has(name));
      if (keep.length === 1) used = keep;
    }
    const avg = [0, 1, 2].map((j) => used.reduce((q, [, c]) => q + c[j], 0) / used.length);
    return [g.t, { ...g.r, sensor_type: `unificado (${used.map(([n]) => n).join('+')})`, x_value: avg[0], y_value: avg[1], z_value: avg[2] }];
  });
}
function buildRows(st, data, step) {
  if (!(step > 0)) {
    return data.map(([t, r]) => ({ hora_utc: new Date(t * 1000).toISOString(), device_id: r.device_id, tipo: st.kind, sitio: st.siteName, sensor_type: r.sensor_type,
      x_g: +num(r.x_value).toFixed(7), y_g: +num(r.y_value).toFixed(7), z_g: +num(r.z_value).toFixed(7), seq: parseSeq(r.raw_data) ?? '' }));
  }
  const groups = new Map();
  for (const [t, r] of data) {
    const label = String(r.sensor_type).startsWith('unificado') ? 'unificado' : r.sensor_type;
    const k = `${label}|${Math.floor(t / step)}`;
    let g = groups.get(k);
    if (!g) { g = { t0: Math.floor(t / step) * step, sensor: label, n: 0, x: 0, y: 0, z: 0, v: [] }; groups.set(k, g); }
    const x = num(r.x_value), y = num(r.y_value), z = num(r.z_value);
    g.n++; g.x += x; g.y += y; g.z += z; g.v.push([x, y, z]);
  }
  return [...groups.values()].sort((a, b) => a.t0 - b.t0 || String(a.sensor).localeCompare(b.sensor)).map((g) => {
    const mx = g.x / g.n, my = g.y / g.n, mz = g.z / g.n;
    let pk = 0;
    for (const [x, y, z] of g.v) pk = Math.max(pk, Math.hypot(x - mx, y - my, z - mz));
    return { inicio_utc: new Date(g.t0 * 1000).toISOString(), device_id: st.id, tipo: st.kind, sitio: st.siteName, sensor_type: g.sensor, muestras: g.n,
      x_prom_g: +mx.toFixed(7), y_prom_g: +my.toFixed(7), z_prom_g: +mz.toFixed(7), pico_dinamico_mg: +(pk * 1000).toFixed(3), pico_gal: +(pk * 981).toFixed(3) };
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
  const sensor = $('exSensor').value, step = Number($('exStep').value);
  const progress = (f, n) => { $('exBar').style.width = `${Math.round(f * 100)}%`; setText('exProgress', `${Math.round(f * 100)} % · ${n.toLocaleString('es-MX')} muestras`); };
  progress(0, 0);
  try {
    let data = await downloadRange(st, range.start, range.end, sensor, progress, ctrl.signal);
    if (sensor === '__unit') data = fuseRows(data);
    if (!data.length) { alert('No hay datos en ese rango.'); return; }
    const rows = buildRows(st, data, step);
    const stamp = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const base = `SIMULADO_${st.id}${sensor ? '_' + (sensor === '__unit' ? 'unificado' : sensor) : ''}_${stamp(range.start)}_a_${stamp(range.end)}${step > 0 ? `_prom${step}s` : ''}`;
    if (kind === 'csv') saveBlob(`${base}.csv`, new Blob(['\ufeff' + csvOf(rows)], { type: 'text/csv;charset=utf-8' }));
    else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.slice(0, 1048575)), 'Datos');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Campo', 'Valor'], ['AVISO', 'DATOS SIMULADOS, no provienen de sensores reales'], ['Sitio', st.siteName], ['device_id', st.id], ['Tipo', st.type],
        ['Latitud', st.lat], ['Longitud', st.lon], ['Desde (UTC)', new Date(range.start * 1000).toISOString()], ['Hasta (UTC)', new Date(range.end * 1000).toISOString()],
        ['Resolución', step > 0 ? `promedio cada ${step} s` : 'todas las muestras'], ['Muestras', data.length], ['Unidades', 'g'],
        ['Sismos simulados en el rango', SIM.quakes.filter((q) => q.t0 >= range.start - 120 && q.t0 <= range.end).map((q) => `M${q.M} ${q.scenario} ${new Date(q.t0 * 1000).toISOString()}`).join(' | ') || 'ninguno'],
      ]), 'Metadatos');
      XLSX.writeFile(wb, `${base}.xlsx`);
    }
    setText('exProgress', `Listo · ${rows.length.toLocaleString('es-MX')} filas`);
  } catch (err) {
    if (!ctrl.signal.aborted) alert(`No se pudo descargar: ${err.message}`); else setText('exProgress', 'Descarga cancelada');
  } finally { setTimeout(() => setExporting(false), 1200); exportCtrl = null; }
}

// ───────────────────────── simulador de sismos (interfaz) ─────────────────────────
function fillScenarios() {
  const net = $('qNet').value;
  $('qScenario').innerHTML = SIM.SCENARIOS[net].map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}
function launchQuake() {
  const net = $('qNet').value;
  const q = SIM.addQuake({ network: net, scenarioId: $('qScenario').value, M: Number($('qMag').value) });
  // Seleccionar el sitio más cercano (P-Alert en Tijuana) para ver llegar las ondas.
  const nearest = [...stations.values()].filter((s) => s.network === net && (net === 'guerrero' || s.kind === 'palert') && isOnline(s))
    .sort((a, b) => SIM.distKm(q.lat, q.lon, a.lat, a.lon) - SIM.distKm(q.lat, q.lon, b.lat, b.lon))[0];
  eewNetManual = false;
  setEewNet(net);
  const view = L.latLngBounds(NET[net].view).extend([q.lat, q.lon]);
  map.fitBounds(view, { padding: [30, 30] });
  if (nearest) { selectStation(nearest.id, { pan: false }); $('signalWin').value = '60'; }
  renderQuakeList();
}

// ───────────────────────── interfaz ─────────────────────────
function bind() {
  $('btnFit').addEventListener('click', fitAll);
  $('btnTij').addEventListener('click', () => fitNet('tijuana'));
  $('btnGro').addEventListener('click', () => fitNet('guerrero'));
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
    trig.sta = v('cfgSta', 1); trig.lta = Math.max(v('cfgLta', 20), trig.sta * 3);
    trig.on = v('cfgOn', 3.5); trig.off = Math.min(v('cfgOff', 1.5), trig.on - 0.1);
    for (const st of stations.values()) for (const b of st.sensors.values()) { b.d.n = 0; b.d.trig = false; }
  };
  ['cfgSta', 'cfgLta', 'cfgOn', 'cfgOff'].forEach((id) => $(id).addEventListener('change', readTrig));
  $('btnClearEvents').addEventListener('click', () => { allEvents.length = 0; for (const st of stations.values()) st.events.length = 0; slowRender(); });
  $('stationTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectStation(tr.dataset.id); });
  $('stationTable').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-id]'); if (tr) selectStation(tr.dataset.id); } });
  ['fNet', 'fKind', 'fStatus'].forEach((id) => $(id).addEventListener('change', () => { renderStationTable(); renderMap(); }));
  ['exStart', 'exEnd', 'exSensor', 'exStep'].forEach((id) => $(id).addEventListener('change', updateEstimate));
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => setRange(Number(b.dataset.range))));
  $('btnCsv').addEventListener('click', () => doExport('csv'));
  $('btnXlsx').addEventListener('click', () => doExport('xlsx'));
  $('btnCancel').addEventListener('click', () => exportCtrl?.abort());
  $('qNet').addEventListener('change', fillScenarios);
  $('qMag').addEventListener('input', () => setText('qMagOut', Number($('qMag').value).toFixed(1)));
  $('btnQuake').addEventListener('click', launchQuake);
  $('qAuto').addEventListener('change', (e) => { SIM.setAuto(e.target.checked); renderQuakeList(); });
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setEewNet(b.dataset.net, true)));
}

// ───────────────────────── arranque ─────────────────────────
async function boot() {
  initMap(); initCharts(); bind(); fillScenarios();
  SIM.stations.forEach((s, i) => { ensureStation(s.id).nextPollAt = Date.now() + i * 70; });
  const fromHash = decodeURIComponent(location.hash.slice(1));
  selectedId = stations.has(fromHash) ? fromHash : 'palert-tijuana-01';
  fitNet(stations.get(selectedId).network);
  setEewNet(stations.get(selectedId).network);
  setRange(600);
  await loadOpenApi();
  slowRender();

  setInterval(scheduler, 250);
  setInterval(() => { if (!document.hidden) { renderSignal(); renderQuakeLayers(); } }, 200);
  setInterval(() => { if (!document.hidden) renderEew(); }, 500);
  setInterval(() => { if (!document.hidden) slowRender(); }, 1500);
  scheduler();
}
boot();
