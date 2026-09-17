# Cambios de esta versión

## Errores corregidos

1. **Todas las estaciones activas aparecían en "Alerta".** Los umbrales (0.2 y 0.5) comparaban el RMS en g *con la gravedad incluida* (~1 g), y además lo etiquetaban como m/s². Ahora se quita la gravedad y los umbrales usan el pico dinámico en mg.
2. **La señal mostraba solo 48 muestras** (un tercio de segundo a 150 Hz). Ahora muestra de 10 s a 2 min, reducida por columnas mín/máx para no perder picos.
3. **El panel se iba retrasando sin fin.** Pedía 1000 registros cada 4 s, pero la estación genera ~1800 en ese tiempo. Ahora pide cada 2 s, pagina hasta ponerse al día y lee el límite real de la API desde `openapi.json`.
4. **Descargas con la hora corrida 6 horas.** El rango se mandaba en UTC, pero `rs` está en hora local sin zona. Ahora se convierte al formato de cada estación.
5. **Descargas truncadas en silencio** a 50,000 registros (~2 min de datos). Ahora baja todo el rango por bloques, con progreso, estimación y botón de cancelar.
6. **STA/LTA calculado sobre la gravedad**, lo que casi impedía disparar, y recalculado sobre 10 min de datos cada 4 s. Ahora es recursivo, muestra por muestra, sobre la señal sin componente estática, y se reinicia tras huecos.
7. **Frecuencia dominante** con resolución de 0.4 Hz y solo en el eje X. Ahora es FFT de 2048 muestras (~0.07 Hz) sobre los 3 ejes.
8. **Fechas con 6 decimales** (`...11.123456`) no se leían en Safari.
9. Nombres de la API insertados como HTML sin escapar.
10. Marcadores del mapa recreados cada 4 s (se cerraban los popups).

## Quitado

- Filtros de región/tipo, tarjetas por región, batería, satélites y GPS: eran del modo simulado y la API no trae esos datos.

## Nuevo

- Salud de la transmisión: completitud exacta por número de secuencia, huecos y muestras por segundo.
- Confirmación de eventos por coincidencia entre sensores.
- Espectro, comparación de sensores, pausa, parámetros STA/LTA ajustables.
- Motivo del estado de cada estación.
- Descarga promediada y por sensor; enlace directo a una estación con `#device_id`.
