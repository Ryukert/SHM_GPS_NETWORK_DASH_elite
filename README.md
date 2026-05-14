# Red Nacional SHM-GPS Elite — Exportación por nodo y rango horario

Dashboard web estático para simular una red nacional de nodos SHM-IoT georreferenciados en México.

## Funciones principales

- Mapa nacional con más de 650 nodos simulados dispersos en México.
- Filtros por región, tipo de estructura y estado operativo.
- Selección de nodo desde el mapa o desde la tabla.
- Panel de telemetría del nodo seleccionado.
- Selector de día y hora inicial/final para descarga.
- Selector de intervalo de exportación: 1 s, 5 s, 10 s, 30 s, 1 min o 5 min.
- Descarga de datos del nodo seleccionado en CSV o Excel XLSX.
- El Excel incluye hoja de historial y hoja de metadatos del nodo.
- Proyecto estático compatible con Vercel.

## Estructura

```text
assets/
index.html
main.css
main.js
vercel.json
README.md
README_DEPLOY.md
```

## Vercel

Framework Preset: Other / Static
Build Command: echo "static deploy"
Output Directory: .
Install Command: vacío

## Nota

Los datos son simulados para demostración. La estructura está lista para conectar posteriormente con Supabase, Firebase o una API propia y consultar datos reales por `device_id`, `fecha_inicio` y `fecha_final`.
