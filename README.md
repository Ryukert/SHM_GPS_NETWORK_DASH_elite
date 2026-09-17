# Red SHM-IoT en vivo — MIIDT / UAGro

Panel web que muestra en tiempo real los datos que las estaciones SHM envían al servidor,
leyéndolos de la **API Retriever** (`https://retriever-1031456939583.us-west2.run.app`).

## Qué muestra

- **Mapa y tabla de estaciones** con su estado: activa, observación, alerta o sin conexión, y el motivo.
- **Señal en tiempo real** que avanza sola (10 s a 2 min), por sensor o comparando los 3 sensores.
- **Espectro (FFT)** con ventana Hann y frecuencia dominante.
- **Detección de eventos STA/LTA** por sensor. Un evento se *confirma* cuando 2 o más sensores de la misma estación disparan a la vez; si dispara uno solo se marca como *aislado* (posible ruido).
- **Salud de la transmisión**: muestras por segundo, completitud y huecos, contados con el número de secuencia que viene en `raw_data`.
- **Descarga** de datos del servidor en CSV o Excel, con todas las muestras o promediadas (0.1 s a 1 min).

## Cómo interpreta los datos

| Dato | Detalle |
|---|---|
| Unidades | `x_value`, `y_value`, `z_value` llegan en **g**. El panel muestra **mg** (1 mg = 0.00981 m/s²). |
| Gravedad | Un eje trae ~1 g de gravedad. RMS, pico y STA/LTA se calculan **sin** esa componente. |
| Hora `rs` | La Raspberry guarda la hora local sin zona horaria. El panel detecta la diferencia con UTC (UTC−6 en Guerrero) y la aplica. |
| Muestreo | 150 Hz por sensor, 3 sensores → ~450 registros/s por estación. |

## Configuración

Todo está al inicio de `main.js`:

- `STATION_INFO`: nombre, ubicación, muestreo y zona horaria de cada estación. **Agrega aquí las estaciones nuevas** (la API no trae coordenadas).
- `CFG`: frecuencia de consulta, umbrales de observación/alerta (`PGA_WATCH_MG`, `PGA_ALERT_MG`), completitud mínima, tamaño de la FFT.

## Despliegue en Vercel

El panel necesita la función `api/proxy.js` porque la API Retriever no permite llamadas directas desde el navegador (CORS).
Por eso **no funciona abriendo `index.html` directo**: usa Vercel o, en local, `vercel dev`.

- Framework Preset: Other
- Build Command: vacío
- Output Directory: `.`

## Consumo

Con una estación transmitiendo, cada pestaña abierta hace unas 30 consultas por minuto al proxy
(una cada 2 s). Las estaciones sin datos recientes solo se revisan cada 30 s.
