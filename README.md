# Red SHM + P-Alert — versión SIMULADA

Demostración del panel de monitoreo con una red simulada. **Ningún dato proviene de sensores reales.**

## Qué se simula

| Zona | Sitios | Instrumentos |
|---|---|---|
| Tijuana | 10 planteles COBACH | En cada plantel, 1 unidad SHM y 1 P-Alert (1 sensor en el suelo a 100 Hz), trabajando al mismo tiempo |
| Guerrero | 10 edificios (Tlacotepec, Chilpancingo, Tixtla, Chilapa, Acapulco, Iguala, Taxco, Zihuatanejo) | 1 unidad SHM en cada uno |

**El SHM es un sensor unificado:** una sola unidad con 3 sensores montados juntos (mpu9250_1, mpu9250_2 y lsm6dsox a 150 Hz) que miden el mismo movimiento. El panel los combina en una sola señal por ciclo y hace todo el análisis (RMS, PGA, espectro, STA/LTA, detección) sobre ella. Los sensores individuales solo se usan para diagnosticar la salud de la unidad.

### Cómo se combinan los 3 sensores

Un promedio simple (como el archivo GCDC de la Raspberry) tiene dos problemas:

1. **Picos falsos cuando falta un sensor.** Cada sensor tiene un pequeño desfase de calibración (10–20 mg es normal). Si en un ciclo se pierde la muestra de uno, el promedio de los otros dos salta varios mg.
2. **Un sensor dañado contamina la señal.** Si uno se deriva 80 mg, el promedio se mueve 27 mg.

Por eso el panel:

- Estima continuamente el desfase de cada sensor respecto a la mediana de los tres y lo compensa antes de promediar.
- Descarta en cada ciclo el sensor que se aparta más de 40 mg de los otros dos, o cuyo desfase ya supera 80 mg.
- Promedia los sensores que quedan.
- Muestra en "Salud de la transmisión" el desfase y la diferencia dinámica de cada sensor, y avisa si alguno se está descartando.

La descarga "SHM unificado" usa la misma lógica.

Nombres y coordenadas de los planteles son **aproximados**, solo para la demostración.

La señal incluye ruido propio y pequeños errores de calibración de cada sensor, el modo de vibración de cada edificio, muestras perdidas,
retraso de transmisión y sismos con onda P (6.5 km/s) y onda S (3.7 km/s) que llegan a cada sitio según su distancia.

Para mostrar problemas de operación hay tres casos preparados:
- SHM de COBACH Cerro Colorado: sin conexión desde hace 2 horas.
- SHM de Zihuatanejo: pierde cerca del 38 % de las muestras.
- P-Alert de COBACH La Mesa: se desconecta a los 10 minutos de abrir la página.
- SHM de Tixtla: a los 4 minutos su sensor interno mpu9250_2 empieza a derivarse; el panel lo detecta porque ya no coincide con los otros dos.

## Cómo usarla

1. Abre `index.html` (funciona con doble clic o subiéndola a Vercel como sitio estático; necesita internet solo para el mapa y las librerías).
2. Espera unos 30 s a que la detección STA/LTA se calibre.
3. En **Simulador de sismos** elige zona, escenario y magnitud, y presiona **Simular sismo**.
4. Observa en el mapa el avance de las ondas, en la señal la llegada de la P y la S, y en **Alerta temprana** la estimación de la red y la cuenta regresiva de la onda S en cada sitio.

Con "Sismos pequeños automáticos" activado se generan sismos de M3.4 a M5.6 cada 2 a 4 minutos.

## Cómo estima la red

1. Cada estación detecta la llegada de la onda con STA/LTA.
2. Con 3 o más sitios, busca en una rejilla el epicentro que mejor explica los tiempos de llegada de la onda P.
3. La magnitud se obtiene invirtiendo la aceleración pico medida en cada sitio.
4. Con epicentro y magnitud calcula, para cada sitio, la intensidad esperada y cuánto falta para la onda S.

El panel compara la estimación contra el valor real del simulador (error de localización y de magnitud).
La atenuación es una relación simple de demostración, no un modelo calibrado para Baja California ni para Guerrero.

## Archivos

- `sim.js`: el simulador. Imita la API Retriever (`/dispositivos`, `/registros`, `/openapi.json`) con el mismo formato de registro que manda la Raspberry.
- `main.js`: el panel (el mismo análisis que la versión real, más P-Alert, localización y simulador).
- `main.css`, `index.html`, `assets/`.
