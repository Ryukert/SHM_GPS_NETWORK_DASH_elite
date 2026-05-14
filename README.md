# SHM GPS Network Nacional Elite

Dashboard web estático para simular una red nacional de sensores SHM-IoT con georreferenciación GPS en México.

## Incluye

- Mapa nacional de México con Leaflet + OpenStreetMap.
- Agrupamiento de marcadores con Leaflet MarkerCluster.
- Más de 650 nodos simulados y dispersos en el territorio nacional distribuidos por estados y regiones.
- Filtros por región, tipo de estructura y estado operativo.
- RMS, frecuencia dominante, frecuencia de muestreo, batería y GPS fix.
- Eventos nacionales recientes.
- Gráficas de aceleración y RMS con Chart.js.
- Exportación CSV.
- Listo para Vercel como proyecto estático.

## Despliegue en Vercel

Sube el contenido de esta carpeta a GitHub e impórtalo en Vercel.

Configuración recomendada:

- Framework Preset: Other / Static
- Root Directory: ./
- Build Command: vacío o `echo "static deploy"`
- Output Directory: .
- Install Command: vacío


Actualización: esta versión distribuye nodos en todo México mediante polígonos aproximados de cobertura territorial, no solo alrededor de capitales.
