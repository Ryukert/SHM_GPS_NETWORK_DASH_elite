// Función serverless de Vercel: reenvía peticiones a la API Retriever (UABC) desde el
// servidor, no desde el navegador. Es necesaria porque esa API no manda encabezados CORS
// (Access-Control-Allow-Origin), así que un fetch() directo desde el navegador queda
// bloqueado en silencio. Server-to-server no tiene esa restricción: CORS solo la aplican
// los navegadores.
const REAL_API_BASE = 'https://retriever-1031456939583.us-west2.run.app';
const ALLOWED_PATHS = new Set(['/dispositivos', '/registros', '/openapi.json']);

export default async function handler(req, res) {
  const { path, ...rest } = req.query;
  if (!path || !ALLOWED_PATHS.has(path)) {
    res.status(400).json({ error: 'Ruta no permitida', allowed: Array.from(ALLOWED_PATHS) });
    return;
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach(vv => params.append(k, vv));
    else params.append(k, v);
  }
  const qs = params.toString();
  const url = `${REAL_API_BASE}${path}${qs ? '?' + qs : ''}`;
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'No se pudo conectar con la API real', detail: String(err && err.message || err) });
  }
}
