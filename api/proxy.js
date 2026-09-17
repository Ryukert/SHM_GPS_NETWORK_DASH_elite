// Función serverless de Vercel: reenvía peticiones a la API Retriever desde el servidor.
// Es necesaria porque esa API no manda encabezados CORS, así que un fetch() directo desde
// el navegador queda bloqueado. Entre servidores no existe esa restricción.
const REAL_API_BASE = 'https://retriever-1031456939583.us-west2.run.app';
const ALLOWED_PATHS = new Set(['/dispositivos', '/registros', '/openapi.json']);
const TIMEOUT_MS = 25000;

export default async function handler(req, res) {
  const { path, ...rest } = req.query;
  if (!path || !ALLOWED_PATHS.has(path)) {
    res.status(400).json({ error: 'Ruta no permitida', allowed: Array.from(ALLOWED_PATHS) });
    return;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((vv) => params.append(k, vv));
    else params.append(k, v);
  }
  const qs = params.toString();
  const url = `${REAL_API_BASE}${path}${qs ? '?' + qs : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // openapi.json casi no cambia: se puede guardar un rato; los datos nunca.
    res.setHeader('Cache-Control', path === '/openapi.json' ? 'public, max-age=300' : 'no-store');
    res.send(body);
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'La API real tardó demasiado en responder' : 'No se pudo conectar con la API real',
      detail: String((err && err.message) || err),
    });
  } finally {
    clearTimeout(timer);
  }
}
