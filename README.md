# MIIDT – Red SHM-IoT GPS

Dashboard web estático para simular una red de sensores SHM-IoT georreferenciados.

## Características

- Mapa con OpenStreetMap + Leaflet.
- Nodos GPS simulados.
- RMS X/Y/Z, RMS global, frecuencia dominante y frecuencia de muestreo.
- Tabla de nodos.
- Gráficas en tiempo real con Chart.js.
- Exportación CSV.
- Listo para Vercel sin `npm install`.

## Despliegue en Vercel

1. Sube todos los archivos del proyecto a GitHub.
2. En Vercel selecciona **Add New Project**.
3. Importa el repositorio.
4. Vercel debe detectarlo como proyecto estático.
5. Deploy.

No usa Next.js, Tailwind ni PostCSS. Por eso evita el error de `tailwindcss` como plugin de PostCSS.

## Estructura

```text
index.html
main.css
main.js
assets/
vercel.json
README.md
```

## Próxima integración real

Para conectar nodos reales, reemplaza la función `tick()` y el arreglo `nodes` por lecturas desde:

- Supabase
- Firebase Realtime Database
- API propia en FastAPI
- WebSocket desde Raspberry Pi o PC
