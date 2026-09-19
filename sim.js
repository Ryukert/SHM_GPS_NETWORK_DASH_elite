// ═══════════════════════════════════════════════════════════════════════════
// SIMULADOR de la red SHM / P-Alert — todo se genera en el navegador.
//
// Imita la API Retriever (/dispositivos, /registros, /openapi.json) con el mismo
// formato de registro que manda la Raspberry, para que el panel funcione igual
// que con datos reales:
//   { rs, sensor_type, data_mode, x_value, y_value, z_value (en g), raw_data, device_id, session_id }
//
// La señal es una función determinista del tiempo: pedir el mismo rango dos veces
// devuelve exactamente los mismos datos (como una base de datos real).
// Incluye ruido ambiental, el modo de vibración de cada edificio, muestras perdidas,
// retraso de transmisión y sismos con ondas P y S que llegan según la distancia.
//
// Nombres y ubicaciones de planteles: APROXIMADOS, solo para la demostración.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  const VP = 6.5, VS = 3.7;             // km/s
  const BOOT = Date.now() / 1000;
  const K0 = Math.floor(BOOT) - 7200;   // base para índices enteros pequeños

  // ── Sitios ──
  // amp = amplificación del suelo; f0 = frecuencia fundamental del edificio (Hz).
  // Planteles COBACH donde se instalarán los sensores (coordenadas de Google Maps).
  // clave, nombre, lat, lon, amplificación del suelo, frecuencia del edificio (Hz)
  const TIJUANA_SITES = [
    ['lapresa', 'COBACH Plantel La Presa', 32.4395287, -116.9259885, 1.15, 3.4],
    ['lapresa_ext', 'COBACH Extensión La Presa · Parajes del Valle', 32.5140318, -116.7457632, 1.00, 3.7],
    ['florido', 'COBACH El Florido', 32.4633484, -116.8756854, 0.95, 4.2],
    ['sigloxxi', 'COBACH Siglo XXI', 32.4858367, -117.0508718, 1.25, 3.8],
    ['lamesa', 'COBACH La Mesa', 32.4597458, -116.9335433, 1.05, 2.9],
    ['nuevatij', 'COBACH Nueva Tijuana', 32.4816663, -116.9257064, 1.00, 4.4],
    ['vizcaino', 'COBACH Mtro. Rubén Vizcaíno', 32.5125840, -116.9694802, 1.20, 3.1],
    ['tijuana', 'COBACH Plantel Tijuana', 32.4708013, -116.8420676, 0.95, 3.6],
    ['rosarito', 'COBACH Primer Ayuntamiento Playas de Rosarito', 32.3843751, -117.0591394, 1.45, 4.0],
  ];
  // Guerrero. En Chilpancingo se concentran estaciones en las zonas de mayor efecto
  // sísmico: el valle aluvial del río Huacapa (suelo blando, amplifica más) frente a
  // los lomeríos del sur y norte (suelo más firme).
  // clave, nombre, lat, lon, amplificación del suelo, frecuencia del edificio (Hz), tipo de suelo
  const GUERRERO_SITES = [
    ['chilpo_mercado', 'Mercado Central · Chilpancingo', 17.5643028, -99.5081892, 1.95, 2.4, 'Valle del Huacapa · suelo blando'],
    ['chilpo_central', 'Central de autobuses · Chilpancingo', 17.5621099, -99.5102206, 1.85, 3.0, 'Valle del Huacapa · suelo blando'],
    ['chilpo_prepa1', 'Preparatoria 1 UAGro · Chilpancingo', 17.5554969, -99.5043507, 1.70, 3.4, 'Valle del Huacapa · suelo blando'],
    ['chilpo_cu', 'Centro Universitario UAGro · Chilpancingo', 17.5369204, -99.4956120, 1.35, 2.8, 'Transición · suelo medio'],
    ['chilpo_palacio', 'Palacio de Gobierno · Chilpancingo', 17.5285524, -99.4947584, 1.30, 2.2, 'Transición · suelo medio'],
    ['chilpo_tec', 'Tecnológico de Chilpancingo', 17.5310885, -99.4981823, 1.25, 3.6, 'Transición · suelo medio'],
    ['chilpo_hmn', 'Hospital de la Madre y el Niño · Chilpancingo', 17.5250282, -99.4919723, 1.15, 2.6, 'Lomerío sur · suelo firme'],
    ['chilpo_hae', 'Hospital de Alta Especialidad · Chilpancingo', 17.6057850, -99.5202839, 1.05, 2.9, 'Lomerío norte · suelo firme'],
    ['zumpango', 'Zumpango del Río · Eduardo Neri', 17.6441702, -99.5282520, 1.15, 3.5, 'Valle · suelo medio'],
    ['tlacotepec', 'UTyP Sierra de Guerrero · Tlacotepec', 17.7903, -99.9783, 1.00, 5.1, 'Suelo firme'],
    ['tixtla', 'Edificio escolar · Tixtla', 17.5670, -99.3970, 1.15, 4.0, 'Valle lacustre'],
    ['chilapa', 'Edificio escolar · Chilapa', 17.5950, -99.1780, 1.05, 3.7, 'Suelo medio'],
    ['acapulco_cost', 'Edificio Costera · Acapulco', 16.8580, -99.8850, 1.60, 1.8, 'Suelo blando costero'],
    ['acapulco_ren', 'Edificio Renacimiento · Acapulco', 16.8900, -99.8000, 1.40, 3.1, 'Suelo medio'],
    ['iguala', 'Edificio escolar · Iguala', 18.3450, -99.5390, 1.10, 3.5, 'Suelo medio'],
    ['taxco', 'Edificio histórico · Taxco', 18.5560, -99.6050, 0.85, 4.6, 'Roca'],
    ['zihua', 'Edificio escolar · Zihuatanejo', 17.6410, -101.5520, 1.35, 2.9, 'Suelo blando costero'],
    // Costa Grande
    ['petatlan', 'Ayuntamiento · Petatlán', 17.5380572, -101.2743865, 1.45, 3.8, 'Costa Grande · aluvión'],
    ['atoyac', 'Palacio Municipal · Atoyac de Álvarez', 17.2122957, -100.4333019, 1.50, 3.4, 'Costa Grande · aluvión'],
    ['tecpan', 'Ayuntamiento · Tecpan de Galeana', 17.2225884, -100.6323171, 1.55, 3.0, 'Costa Grande · aluvión (brecha de Guerrero)'],
    ['coyuca', 'Ayuntamiento · Coyuca de Benítez', 17.0089236, -100.0893920, 1.60, 3.2, 'Llanura lagunar · suelo blando'],
    // Costa Chica
    ['sanmarcos', 'Ayuntamiento · San Marcos', 16.7974033, -99.3894101, 1.50, 3.6, 'Costa Chica · aluvión'],
    ['cruzgrande', 'Ayuntamiento · Cruz Grande', 16.7226580, -99.1240728, 1.55, 3.9, 'Costa Chica · aluvión'],
    ['ayutla', 'Casa de los Pueblos · Ayutla de los Libres', 16.9652512, -99.0974341, 1.20, 4.0, 'Piedemonte · suelo medio'],
    ['marquelia', 'Edificio Municipal · Marquelia', 16.5835909, -98.8170222, 1.60, 4.2, 'Costa Chica · suelo blando'],
    ['sanluis', 'San Luis Acatlán', 16.8083768, -98.7378846, 1.25, 3.8, 'Piedemonte · suelo medio'],
    ['ometepec', 'Ayuntamiento · Ometepec', 16.6851991, -98.4042872, 1.20, 3.3, 'Lomerío · suelo firme'],
    ['cuaji', 'Ayuntamiento · Cuajinicuilapa', 16.4736061, -98.4213903, 1.50, 4.1, 'Costa Chica · aluvión'],
    // Montaña, Norte y Tierra Caliente
    ['tlapa', 'Tlapa de Comonfort', 17.5484975, -98.5705890, 1.25, 3.7, 'Valle · suelo medio'],
    ['olinala', 'Ayuntamiento · Olinalá', 17.7785416, -98.7411054, 0.95, 4.4, 'Roca'],
    ['teloloapan', 'Edificio Municipal · Teloloapan', 18.3676220, -99.8727894, 1.00, 4.3, 'Roca'],
    ['altamirano', 'Ayuntamiento · Ciudad Altamirano', 18.3622584, -100.6680743, 1.30, 3.1, 'Valle del Balsas · aluvión'],
  ];

  const stations = [];
  // El SHM es UNA unidad: 3 sensores montados juntos en la misma tarjeta, que miden
  // lo mismo. Solo difieren en su ruido propio y en pequeños errores de calibración.
  const SHM_SENSORS = ['mpu9250_1', 'mpu9250_2', 'lsm6dsox'];
  const SENSOR_NOISE = [1.25, 1.25, 0.6];      // el LSM6DSOX es menos ruidoso que los MPU9250
  const INSTALL_GAIN = 1.5;                     // la unidad está en un nivel alto del edificio

  function addSite(net, city, row, i) {
    const [key, name, lat, lon, amp, f0, soil] = row;
    stations.push({
      id: `shm-${net}-${String(i + 1).padStart(2, '0')}`, site: `${net}:${key}`, siteName: name,
      name: `${name} · SHM`, city, lat, lon, network: net, kind: 'shm', type: 'SHM unificado (3 sensores internos)',
      fs: 150, sensors: SHM_SENSORS, amp, f0, soil: soil || '',
      // sesgo (g) y error de ganancia de cada sensor interno
      bias: SHM_SENSORS.map((_, si) => [(((i + si) * 37) % 11 - 5) * 0.0006, (((i + si) * 53) % 9 - 4) * 0.0005, (((i + si) * 29) % 7 - 3) * 0.0008]),
      gainErr: SHM_SENSORS.map((_, si) => 1 + ((((i * 3 + si * 5) % 7) - 3) * 0.006)),
      noise: 0.00018 + 0.00008 * ((i * 7) % 3), modeAmp: 0.00025 + 0.0001 * (i % 4),
      drop: 0.01 + 0.01 * (i % 3), lag: net === 'tijuana' ? 1.4 : 2.0, seed: stations.length * 101 + 7,
    });
    if (net === 'tijuana') {
      stations.push({
        id: `palert-tijuana-${String(i + 1).padStart(2, '0')}`, site: `${net}:${key}`, siteName: name,
        name: `${name} · P-Alert`, city, lat, lon, network: net, kind: 'palert', type: 'P-Alert (alerta temprana)',
        fs: 100, sensors: ['palert'], amp, f0: 0, soil: soil || '', bias: [[0, 0, 0]], gainErr: [1],
        noise: 0.00030, modeAmp: 0, drop: 0.003, lag: 0.6, seed: stations.length * 101 + 7,
      });
    }
  }
  TIJUANA_SITES.forEach((r, i) => addSite('tijuana', 'Tijuana, Baja California', r, i));
  GUERRERO_SITES.forEach((r, i) => addSite('guerrero', r[1].includes('Chilpancingo') ? 'Chilpancingo, Guerrero' : 'Guerrero', r, i));

  // Casos para que el panel muestre problemas reales de operación:
  const byId = Object.fromEntries(stations.map((s) => [s.id, s]));
  const bySite = (net, key, kind) => stations.find((x) => x.site === `${net}:${key}` && x.kind === kind);
  bySite('tijuana', 'tijuana', 'shm').offlineAt = BOOT - 2.2 * 3600;   // Plantel Tijuana: sin conexión desde hace 2 h
  bySite('tijuana', 'lamesa', 'palert').offlineAt = BOOT + 600;        // La Mesa: se cae a los 10 min
  bySite('guerrero', 'zihua', 'shm').drop = 0.38;                      // Zihuatanejo: internet inestable
  bySite('guerrero', 'tixtla', 'shm').faulty = { si: 1, after: BOOT + 240 }; // Tixtla: el mpu9250_2 falla a los 4 min

  // ── Escenarios de sismo (epicentros aproximados) ──
  const SCENARIOS = {
    tijuana: [
      { id: 'coronado', name: 'Falla Coronado Bank (mar, frente a Playas)', lat: 32.33, lon: -117.38, depth: 10 },
      { id: 'rosarito', name: 'Falla de Rosarito', lat: 32.28, lon: -117.07, depth: 8 },
      { id: 'local', name: 'Falla local bajo Tijuana', lat: 32.50, lon: -116.96, depth: 7 },
      { id: 'tecate', name: 'Zona de Tecate', lat: 32.56, lon: -116.62, depth: 9 },
      { id: 'mexicali', name: 'Valle de Mexicali (Cerro Prieto)', lat: 32.40, lon: -115.25, depth: 8 },
    ],
    guerrero: [
      { id: 'acapulco', name: 'Costa de Acapulco (subducción)', lat: 16.62, lon: -99.85, depth: 20 },
      { id: 'tecpan', name: 'Brecha de Guerrero · Tecpan', lat: 17.00, lon: -100.65, depth: 18 },
      { id: 'intraplaca', name: 'Intraplaca bajo Chilpancingo', lat: 17.42, lon: -99.62, depth: 55 },
      { id: 'costachica', name: 'Costa Chica · Ometepec', lat: 16.40, lon: -98.45, depth: 20 },
      { id: 'petatlan', name: 'Petatlán · Zihuatanejo', lat: 17.30, lon: -101.45, depth: 16 },
    ],
  };

  const quakes = [];

  // ── utilidades ──
  function h32(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be59b, 0xc2b2ae35);
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const gauss = (a, b) => (h32(a, b) + h32(a, b + 977) + h32(a, b + 1931) - 1.5) * 1.41;
  function distKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // PGA en gal: log10(PGA) = 0.5 M − 1.5 log10(R) + 1.25   (relación simple de demostración)
  const pgaGal = (M, R) => Math.min(900, 10 ** (0.5 * M - 1.5 * Math.log10(Math.max(R, 5)) + 1.25));

  function stationQuakes(st) {
    if (!st._q || st._qVersion !== quakes.length) {
      st._q = quakes.filter((q) => q.network === st.network || distKm(q.lat, q.lon, st.lat, st.lon) < 400).map((q) => {
        const d = distKm(q.lat, q.lon, st.lat, st.lon);
        const R = Math.hypot(d, q.depth);
        return { q, R, tP: q.t0 + R / VP, tS: q.t0 + R / VS, A: (pgaGal(q.M, R) / 981) * st.amp,
          tauP: 0.8 + 0.25 * (q.M - 3), tauS: 1.6 + 0.9 * (q.M - 3) + R / 90, ph: h32(st.seed, q.seed) * 6.283 };
      });
      st._qVersion = quakes.length;
    }
    return st._q;
  }

  // ── muestra k del sensor si de la estación ──
  function sample(st, k, si) {
    const t = k / st.fs, n = k - K0 * st.fs, sd = st.seed * 13 + si * 1009;
    const gain = st.kind === 'shm' ? INSTALL_GAIN : 1;
    const nz = st.noise * (st.kind === 'shm' ? SENSOR_NOISE[si] : 1);
    // Movimiento real del punto donde está la unidad: igual para los 3 sensores.
    let x = 0, y = 0, z = 1;
    if (st.modeAmp) {
      const w = 2 * Math.PI * st.f0 * t;
      const env = 0.7 + 0.3 * Math.sin(2 * Math.PI * t / 23 + st.seed);
      x += st.modeAmp * gain * env * Math.sin(w);
      y += st.modeAmp * gain * env * 0.7 * Math.sin(w * 1.07 + 1);
    }
    for (const w of stationQuakes(st)) {
      if (t < w.tP || t > w.tS + 8 * w.tauS) continue;
      const dp = t - w.tP;
      const envP = Math.min(1, dp / 0.15) * Math.exp(-dp / w.tauP);
      const cP = Math.sin(2 * Math.PI * 7.5 * dp + w.ph) + 0.5 * Math.sin(2 * Math.PI * 11.3 * dp + 2 * w.ph);
      z += 0.42 * w.A * envP * cP;
      x += 0.12 * w.A * envP * cP; y += 0.10 * w.A * envP * cP;
      if (t >= w.tS) {
        const ds = t - w.tS;
        const envS = Math.min(1, ds / 0.45) * Math.exp(-ds / w.tauS);
        const g1 = Math.sin(2 * Math.PI * 2.1 * ds + w.ph) * 0.65 + Math.sin(2 * Math.PI * 3.7 * ds + 1.3 * w.ph) * 0.35;
        const g2 = Math.sin(2 * Math.PI * 2.5 * ds + 2.1 * w.ph) * 0.6 + Math.sin(2 * Math.PI * 1.6 * ds + 0.7 * w.ph) * 0.4;
        let bx = 0, by = 0;
        if (st.kind === 'shm') {   // respuesta del edificio en su modo fundamental
          const envB = Math.min(1, ds / 1.2) * Math.exp(-ds / (w.tauS * 1.6));
          bx = (gain - 1) * 0.9 * envB * Math.sin(2 * Math.PI * st.f0 * ds + w.ph);
          by = (gain - 1) * 0.7 * envB * Math.sin(2 * Math.PI * st.f0 * 1.07 * ds + 2 * w.ph);
        }
        x += w.A * (envS * g1 + bx);
        y += w.A * (envS * g2 * 0.85 + by);
        z += 0.3 * w.A * envS * g1;
      }
    }
    // Lo que reporta cada sensor: movimiento × ganancia + sesgo + ruido propio.
    const g = st.gainErr[si], bs = st.bias[si];
    x = x * g + bs[0] + nz * gauss(n, sd);
    y = y * g + bs[1] + nz * gauss(n, sd + 5000);
    z = z * g + bs[2] + nz * gauss(n, sd + 9000);
    if (st.faulty && st.faulty.si === si && t > st.faulty.after) {   // sensor dañado: se deriva y mete picos
      const age = t - st.faulty.after;
      x += Math.min(0.08, age * 0.0004); z -= Math.min(0.05, age * 0.00025);
      if (h32(n, sd + 777) < 0.01) y += 0.02 * (h32(n, sd + 778) - 0.5);
    }
    return [x, y, z];
  }
  const dropped = (st, k, si) => h32(k - K0 * st.fs, st.seed * 31 + si) < st.drop;
  const dataEnd = (st) => Math.min(Date.now() / 1000 - st.lag, st.offlineAt ?? Infinity);
  const dataStart = () => BOOT - 3 * 3600;

  function record(st, k, si) {
    const [x, y, z] = sample(st, k, si);
    const t = k / st.fs;
    const tag = st.kind === 'palert' ? 'PALERT' : 'SHM2';
    return {
      rs: new Date(Math.floor(t * 1000)).toISOString().replace('Z', '') + String(Math.min(999, Math.floor(((t * 1000) % 1) * 1000))).padStart(3, '0') + 'Z',
      sensor_type: st.sensors[si], data_mode: 'continuo',
      x_value: +x.toFixed(7), y_value: +y.toFixed(7), z_value: +z.toFixed(7),
      raw_data: `${tag},${Math.round(t * 1e6)},${k - K0 * st.fs}`,
      device_id: st.id, session_id: `sim_${Math.floor(BOOT)}`,
    };
  }
  const parseT = (s) => (s ? Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1')) / 1000 : NaN);

  function registros(p) {
    const st = byId[p.device_id];
    if (!st) return { registros: [] };
    const limit = Math.min(5000, Number(p.limit) || 1000);
    let skip = Number(p.offset) || 0;
    const orden = p.orden || 'asc';
    const end = Math.min(dataEnd(st), p.fecha_fin ? parseT(p.fecha_fin) : Infinity);
    const start = Math.max(dataStart(), p.fecha_inicio ? parseT(p.fecha_inicio) : end - 86400);
    const sis = st.sensors.map((_, i) => i).filter((i) => !p.sensor_type || st.sensors[i] === p.sensor_type);
    const out = [];
    if (!(end >= start) || !sis.length) return { registros: out };
    const kA = Math.ceil(start * st.fs), kB = Math.floor(end * st.fs);
    if (orden === 'desc') {
      for (let k = kB; k >= kA && out.length < limit; k--) {
        for (let j = sis.length - 1; j >= 0; j--) {
          const si = sis[j];
          if (dropped(st, k, si)) continue;
          if (skip > 0) { skip--; continue; }
          out.push(record(st, k, si));
          if (out.length >= limit) break;
        }
      }
    } else {
      // salto rápido del offset: casi todas las muestras existen
      for (let k = kA; k <= kB && out.length < limit; k++) {
        for (const si of sis) {
          if (dropped(st, k, si)) continue;
          if (skip > 0) { skip--; continue; }
          out.push(record(st, k, si));
          if (out.length >= limit) break;
        }
      }
    }
    return { registros: out };
  }

  // ── sismos ──
  let seedCounter = 1;
  function addQuake({ network, scenarioId, M, delay = 0.3, auto = false }) {
    const list = SCENARIOS[network];
    const sc = list.find((s) => s.id === scenarioId) || list[0];
    const jitter = auto ? 0.08 : 0;
    const q = {
      id: `q${seedCounter}`, seed: seedCounter++ * 7919, network, scenario: sc.name,
      lat: sc.lat + (Math.random() - 0.5) * jitter, lon: sc.lon + (Math.random() - 0.5) * jitter,
      depth: sc.depth, M: Math.round(M * 10) / 10, t0: Date.now() / 1000 + delay, auto,
    };
    quakes.push(q);
    return q;
  }
  let autoOn = true;
  let nextAuto = BOOT + 55;   // da tiempo a que STA/LTA se calibre
  function autoTick() {
    const now = Date.now() / 1000;
    if (!autoOn || now < nextAuto) return;
    const network = Math.random() < 0.55 ? 'tijuana' : 'guerrero';
    const list = SCENARIOS[network];
    const sc = list[Math.floor(Math.random() * list.length)];
    const M = network === 'guerrero' ? 4.0 + Math.random() * 1.6 : 3.4 + Math.random() * 1.5;
    addQuake({ network, scenarioId: sc.id, M, auto: true });
    nextAuto = now + 100 + Math.random() * 140;
  }
  setInterval(autoTick, 2000);

  const OPENAPI = { paths: { '/registros': { get: { parameters: [
    ...['fecha_inicio', 'fecha_fin', 'device_id', 'sensor_type', 'data_mode', 'orden', 'offset'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
    { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 5000, default: 1000 } },
  ] } } } };

  window.SIM = {
    VP, VS, stations, byId, SCENARIOS, quakes, distKm, pgaGal,
    handle(path, params) {
      if (path === '/dispositivos') return { dispositivos: stations.map((s) => s.id) };
      if (path === '/openapi.json') return OPENAPI;
      if (path === '/registros') return registros(params);
      return null;
    },
    addQuake,
    setAuto(v) { autoOn = !!v; if (autoOn) nextAuto = Math.min(nextAuto, Date.now() / 1000 + 60); },
    getAuto: () => autoOn,
    nextAutoIn: () => Math.max(0, nextAuto - Date.now() / 1000),
  };
})();
