# Reglas del Optimizador de Sala — RollerCoin

Este documento es la **fuente de verdad** de la lógica. El código (backend y
frontend) debe respetar exactamente lo que está aquí. Si algo cambia, se cambia
primero acá.

---

## 1. Contexto

En RollerCoin cada minero aporta:

- un **poder** (hashrate, en `GH/s`), y
- un **bonus** (un porcentaje).

El objetivo de la app: dada una **liga objetivo** (o un poder final tope
personalizado) y el **inventario de mineros** del usuario, encontrar la **mejor
combinación** de mineros para colocar en la sala sin pasarse de liga.

---

## 2. Definiciones

| Término | Definición |
|---|---|
| **Poder bruto** (`P`) | Suma del poder de todos los mineros colocados, sin aplicar ningún bonus. Unidad: **GH/s** (como la API). |
| **Bonus total** (`B`) | Suma de los bonus de los mineros colocados, con la regla de duplicados (ver §4). Se expresa en **puntos base** (bp): `10000 bp = 100%`. |
| **Poder final** (`F`) | El poder bruto con el bonus global aplicado. |
| **Modelo** | Un minero concreto identificado por `(nombre, nivel)`. Tiene un `id` único y estable (ver §6.0). Dos niveles del mismo minero son **modelos distintos**. |
| **Slot** | Espacio de la sala. Un minero ocupa `width` celdas (1 o 2). |

---

## 3. Fórmula del poder final

El bonus se aplica **globalmente** sobre el poder bruto total (no por minero):

```
F = P * (10000 + B) / 10000
```

- `P` = suma de poderes brutos (entero, `GH/s`).
- `B` = bonus total en bp (ver §4).
- La división es **entera** (se trunca hacia abajo), consistente con el juego.

Ejemplo: `P = 1000`, `B = 2500` (25%) → `F = 1000 * 12500 / 10000 = 1250`.

---

## 4. Regla de duplicados (bonus)

> Los bonus se van sumando, **pero si coloco exactamente el mismo minero (mismo
> modelo, misma rareza/nivel incluido), solo se cuenta el bonus de 1**.

- El bonus de un **modelo** se cuenta **una sola vez**, sin importar cuántas
  copias de ese modelo se coloquen.
- El **poder bruto sí suma** por cada copia colocada.
- Modelos distintos (incluido el mismo minero en otro nivel) **cada uno aporta su
  bonus**.

Formalmente, si `S` es el conjunto de mineros colocados y `models(S)` el conjunto
de modelos distintos presentes:

```
P(S) = Σ_{minero j ∈ S}         power(j)
B(S) = Σ_{modelo m ∈ models(S)} bonus(m)
```

Clave de deduplicación: el **`id` del modelo** (equivale a `nombre + nivel`; ver §6.0).

---

## 5. Qué optimizar

### 5.1 Restricción dura (techo)

```
F(S) ≤ tope
```

**No se puede pasar del tope.** Puede quedar por debajo, nunca por encima. El
tope de una liga es el `minPower` de la liga siguiente **menos 1 GH/s** (§6.3);
con "Personalizado" es el número que ingresa el usuario. La liga más alta
(Legend) no tiene tope.

### 5.2 Piso (margen)

```
piso = tope − ⌊tope · margen_bp / 10000⌋
```

- `margen` es un **porcentaje del tope** (input "Margen", default **1%**; se
  manda en bp: `1% = 100`). Porcentaje y no un valor fijo porque los topes van
  de TH/s a miles de EH/s.
- **Ventana** = `piso ≤ F(S) ≤ tope`. Una sala dentro de la ventana está "cerca
  del tope"; dentro de ella importa el poder bruto (el bonus de los hámsters /
  freon aplica sobre el bruto y no cuenta para la liga — eso se calcula en la
  vista Freon, esta vista no lo usa).
- Sin tope (Legend) no hay piso: `piso = 0`.
- El piso es una **preferencia**, no una restricción dura: si ninguna
  combinación llega al piso, se usa el criterio de respaldo (§5.3).

### 5.3 Orden de prioridad (lexicográfico)

**Si alguna combinación entra en la ventana**, entre las que entran se elige,
**en este orden**:

1. **Mayor poder bruto `P(S)`**, sin importar dónde quede `F(S)` dentro de la
   ventana.
2. A igualdad de `P(S)`, **mayor poder final `F(S)`**.
3. A igualdad de `F(S)`, **menos mineros** (`Σ count`).
4. A igualdad de mineros, **menos merges** (solo con merges activados, §5.9).

**Respaldo — si ninguna llega al piso** (el inventario no da), entre todas las
combinaciones con `F(S) ≤ tope`:

1. **Mayor poder final `F(S)`** (lo más cerca posible del tope).
2. A igualdad de `F(S)`, **menor bonus total `B(S)`**.
3. A igualdad de `B(S)`, **mayor poder bruto `P(S)`**.
4. A igualdad de `P(S)`, **menos mineros**.
5. A igualdad de mineros, **menos merges** (solo con merges activados).

Cualquier combinación dentro de la ventana es mejor que cualquiera fuera.

> Racional: la liga la decide `F`, pero lo que rinde el bonus extra de la otra
> vista es el bruto; bajar un poco `F` sin salir de la ventana a cambio de más
> bruto conviene. El respaldo es el criterio anterior: acercarse al tope y
> gastar el menor bonus posible. Menos mineros libera celdas y son menos
> mineros que mantener. Un merge no se puede deshacer, así que el último
> criterio evita mergear copias que no cambian la sala.
>
> Sin margen (`margin_bp` ausente en la API) se usa directamente el respaldo:
> es el comportamiento histórico, que conservan los tests.

### 5.4 Límite (Salas → celdas)

- La UI pide el **nº de salas** (1–4). Celdas totales = `96 + (salas−1)·144`
  (1ª sala 96, cada sala a partir de la 2ª aporta 144)
  → 1 sala = **96**, 2 = **240**, 3 = **384**, 4 = **528**.
- El label es solo "Salas" (sin el nº de celdas).
- Se usa **`slot_mode: "cells"`**: `Σ use[m]·width[m] ≤ celdas`. Un minero ocupa
  `width` celdas (casi todos los de merge son `width 2`). Se comprobó que contar
  celdas **no** afecta el rendimiento del solver (mismos tiempos que contar
  mineros).
- Es un **máximo**, no hay que llenarlo.
- **Liga objetivo (UI)**: selector con **"Personalizado" como primera opción**
  y después las ligas de §6.3. "Personalizado" muestra el input numérico +
  selector **PH/s, EH/s, ZH/s** de antes. Se persisten liga, modo y margen. Si
  no hay liga elegida, se preselecciona la que contiene el poder personalizado
  guardado. No se muestra la conversión de unidades debajo del input.
- Debajo, el rango de búsqueda: **"La búsqueda será entre 49.500 y 49.999
  EH/s"** (piso y tope). El tope se muestra **truncado** a 3 decimales, no
  redondeado: el de Platinum I (`50 EH/s − 1 GH/s`) redondeado se vería como
  50.000, que ya es la liga siguiente. Si las dos cifras tienen la misma unidad,
  se muestra una sola vez al final. Sin tope: "Sin tope: se busca el mayor
  poder bruto."
- **Margen (UI)**: input numérico en %, default **1**, rango 0–100 (§5.2).
- `time_limit_s` fijo en **300 s** (5 min, no expuesto). Ver §5.10.

### 5.5 "Mi inventario" y "Sala" (independientes, como en el juego)

"Mi inventario" y la sala son **dos listas separadas**, igual que en RollerCoin
(lo puesto en la sala no aparece en el inventario del juego):

- `quantity` = copias en **Mi inventario** (el banco). **Solo cambia** al pegar
  el inventario (§5.8), con la **X** de la fila, con **"vaciar"** o agregando
  (catálogo, arrastrar un minero del catálogo sobre el panel). Nada de la sala
  ni del optimizador lo toca.
- `inRoom` = copias en la **Sala**. Independiente de `quantity` (puede ser
  mayor, menor o sin inventario).
- `simUsed` (interno, no se muestra) = copias **de Mi inventario que la
  simulación ya usó**: puestas en la sala desde el inventario o consumidas por
  un merge al "usar como sala". `0 ≤ simUsed ≤ quantity`. Existe para no
  contarlas dos veces: la app **simula** los movimientos; cuando se hacen en el
  juego, se vuelve a pegar el inventario y a sincronizar la sala.
- Copias que tengo para optimizar: `(quantity − simUsed) + inRoom + planned`.
- Persistido en `localStorage`. Migración de datos viejos (donde `quantity`
  incluía lo puesto): `quantity ← quantity − inRoom`, `simUsed = 0`.
- Panel **"Mi inventario"**: filas con `quantity > 0`; columnas Minero, Poder,
  Bonus y **Tengo** (`quantity`). **Sin** columna "Sala".
- **X** de una fila: con 1 copia la elimina; con más, **pregunta cuántas
  eliminar en la misma fila** (no con un diálogo del navegador): campo numérico
  1…N (default 1) + "eliminar" / "cancelar"; Enter confirma, Escape cancela. Baja `quantity` (y acota `simUsed`); si el modelo queda sin
  inventario, sin sala y sin planeado, desaparece.
- Panel **"En sala"**: muestra poder/bonus/final de lo colocado y **celdas
  usadas / capacidad** (`roomsToCells(salas)`), en rojo si se pasa.
- Las cabeceras de las tablas quedan fijas (`position: sticky`) al hacer scroll.
- **Poner en la sala** desde Mi inventario (arrastrar o clic): solo si quedan
  copias sin usar (`quantity − simUsed > 0`); `inRoom += 1`, `simUsed += 1`. El
  inventario **no** cambia.
- **Poner en la sala desde el catálogo** (arrastrar a una celda): `inRoom += 1`
  sin tocar el inventario.
- **Sacar de la sala** (`removeFromRoom()`: botón **"Quitar de la sala"** de la
  card de detalle, zona **"Suelta aquí"**, o soltarlo sobre "Mi inventario"):
  `inRoom −= 1`. Si había copias del inventario usadas (`simUsed > 0`), esa copia
  deja de estar usada (`simUsed −= 1`); si no, la copia se elimina. **Nunca pasa
  a "Mi inventario"**. Un modelo sin inventario, sin sala y sin planeado
  desaparece.
- Arrastrar un minero de la sala **sobre otro minero de la sala** los
  **intercambia** de lugar (`reorderRoomSlot`). Si los dos ocupan 1 celda se
  cambian esas celdas; si alguno ocupa 2, se cambian los estantes completos (un
  minero de 1 celda que compartía estante con el arrastrado viaja con él).
  Soltarlo en una celda libre lo mueve ahí, como antes.
- Botón **"vaciar la sala"** (icono de escoba, junto al de sincronizar en "Mi
  sala"): `clearRoom()` — vacía la sala de una: `inRoom = 0`, `simUsed = 0`,
  `roomSlots` vacío. No toca el inventario. Sin confirmación.
- **Sincronizar la sala real** ("recargar sala", §6): `inRoom` = lo que dice el
  juego, `simUsed = 0` (la sala ya es la real). No toca el inventario.
- **Exportar / importar** (botones arriba del todo, junto al título): guardan y
  restauran **todo** el estado en un JSON `{ version, rooms, inventory: [...] }`
  — cada ítem lleva `quantity`, `inRoom`, `simUsed` y `planned`, así que cubre
  sala, inventario y nueva adquisición. `version: 2`; al importar una `version`
  1 (o sin versión) se aplica la misma migración que a `localStorage`.
  Importar **reemplaza** el estado actual (pide confirmación). Se acepta
  también el formato viejo (array plano = solo inventario).

### 5.6 "Nueva adquisición" (mineros que planeo obtener)

- Campo `planned` por modelo: copias que **planeo adquirir** pero aún no tengo.
  Un modelo puede ser solo planeado (`quantity: 0, planned: n`) — no aparece en
  "Mi inventario", solo en el panel **"Nueva adquisición"**.
  Se añade desde el catálogo con el botón **"nuevo"**.
- **Al optimizar**, el inventario que se envía usa copias efectivas
  `(quantity − simUsed) + inRoom + planned` (`selectOptimizeList`, §5.5). O sea, el optimizador razona como
  si ya tuvieras lo planeado.

### 5.7 Resultado: diff contra la sala actual

Tras optimizar, el resultado se compara con la sala actual (`inRoom`):

- Cada pick que **no estaba** en la sala lleva tag verde **"Nuevo"** (o
  **"+N Nuevos"** si el `count` del pick es mayor a 1).
- Un pick que **ya estaba** en la sala pero cuyo `count` sube respecto a las
  copias puestas (`inRoom`) lleva tag verde **"+N nuevo(s)"**
  (N = `count − inRoom`).
- Un pick que **ya estaba** en la sala pero cuyo `count` baja respecto a
  `inRoom` lleva tag rojo **"−N sale(n)"** (N = `inRoom − count`).
- No hay tag de "comprar": las copias planeadas que usa el resultado ya se ven
  en "Nuevo" / "+N nuevos".
- Abajo, sección **"Sale de la sala"**: modelos con `inRoom > 0` cuyo `count`
  en los picks es menor a `inRoom` (0 si no están). De las
  `sale = inRoom − count` copias que salen, las que consume un merge del
  resultado (`min(sale, copias consumidas)`) llevan el tag de merge **"Usar N en
  el merge"**; el resto, tag rojo **"Quitar N de sala"**. Si hay de los dos, se
  muestran ambos. Al lado se ve cuántas hay puestas ("N en sala").
- **"Ya optimizada".** El resultado se compara con la sala actual. Primero, por
  **dónde cae cada una** respecto a la ventana de §5.2 (con el tope y piso del
  resultado):
  - la sala actual **pasa el tope** → el resultado siempre mejora;
  - una entra en la ventana y la otra no → gana la que entra;
  - si las dos están en el mismo caso, se sigue en cascada; el **primer
    criterio que difiere decide** (si mejora se ofrece, si empeora no), y si
    todos son iguales no se ofrece.

  **Las dos en la ventana:**
  1. poder bruto **redondeado a como se muestra**: mayor es mejor;
  2. poder final **redondeado a como se muestra**: mayor es mejor;
  3. cantidad de mineros (`Σ count` vs `Σ inRoom`): **menor** es mejor — libera
     celdas y son menos mineros que mantener;
  4. merges: **menos** es mejor (la sala actual tiene 0), o sea, a igualdad de
     todo lo anterior un resultado con merges no se ofrece.

  **Las dos bajo el piso (respaldo):**
  1. poder final **redondeado a como se muestra**: mayor es mejor;
  2. bonus usado: **menor** es mejor;
  3. poder bruto de mineros (GH/s exactos): **mayor** es mejor;
  4. cantidad de mineros: **menor** es mejor;
  5. merges: **menos** es mejor.

  Una diferencia de poder que igual se ve como el mismo número (p. ej. las dos
  salas en `49.999 EH/s`) no cuenta: comparar el valor exacto en GH/s haría
  proponer cambios por mejoras de ~`1e-4` invisibles. "Como se muestra" es en
  la **unidad de la liga** (§5.9), la misma de la tabla comparativa.
- Tabla de comparación (Actual / Optimizada, con delta): filas **"Poder
  final"**, **"Poder mineros"** y **"Bonus"** siempre; fila **"Mineros"** solo
  si la cantidad cambia. Los poderes y sus deltas van en la **unidad de la
  liga** (§5.9), con 3 decimales.
- Botón **"usar como sala"**: `applyRoom(counts, merges)` — fija `inRoom =
  count` de cada pick (0 para el resto). **No cambia "Mi inventario"**
  (`quantity`): solo lleva la cuenta en `simUsed` (§5.5). Por modelo:
  1. De las copias que **salen de la sala**, las que consume un merge van al
     merge; del resto, primero se liberan las que venían del inventario
     (`simUsed −=`) y las demás se eliminan. Ninguna pasa a "Mi inventario".
  2. Lo que el merge consume y no salió de la sala se toma del inventario sin
     usar (`simUsed +=`) y, si falta, de lo planeado (`planned −=`).
  3. Las copias que **entran a la sala** salen, en orden, de lo que producen los
     merges, del inventario sin usar (`simUsed +=`) y de lo planeado
     (`planned −=`).

  Si la sala ya coincide con el resultado, en vez del botón se muestra
  **"✓ es tu sala actual"**.
- La tabla del resultado permite **seleccionar 1 fila** (clic) solo para
  resaltarla; no tiene ningún efecto.

### 5.8 Pegar inventario desde RollerCoin

- Botón **"pegar inventario"** (arriba). Abre un `<textarea>`; se pega el listado
  de mineros copiado de rollercoin.com y se manda a `POST /api/inventory/parse`.
- Backend [`app/paste.py`](backend/app/paste.py): parte el texto por `Miner
  details`, y de cada bloque saca nombre, celdas, poder (`40.000 Ph/s` → GH/s),
  bonus (`22 %` → bp) y cantidad.
- **El nº de nivel que muestra la web de RollerCoin en el inventario NO es
  nuestro `level`** (la web cuenta merges: su "1" = nuestro nivel 2, su "5" =
  nuestro nivel 6, el minero base no lleva número). Por eso el match contra el
  catálogo es **por nombre + poder/bonus más cercano** (`_best_match`, error
  relativo < 0.15), ignorando ese número. Si casa, se usan los datos exactos del
  catálogo (id, poder, bonus, celdas, imagen). Si no casa, se guarda como ítem
  "sin catálogo" con `id = "paste:<slug>:<lvl>"`.
- El frontend muestra una previsualización y dos acciones:
  **"reemplazar inventario"** (los modelos ausentes en el texto quedan en 0) o
  **"sumar a lo que tengo"** (`quantity += pegado`). Solo tocan "Mi
  inventario": la sala (`inRoom`), `planned` y el nº de salas no cambian;
  `simUsed` se acota a la nueva `quantity`.

### 5.9 Merges

- Receta de RollerCoin: **2 copias del modelo nivel N + piezas + costo → 1 copia
  de nivel N+1** del mismo minero. El optimizador **ignora piezas y costo**
  (se asume que se tienen); solo cuenta las copias.
- Toggle **"permitir merges"** en el panel Optimizar (apagado por defecto, no se
  persiste). Apagado, el optimizador se comporta igual que sin merges.
- Las copias que se pueden mergear son las efectivas (`quantity + planned`,
  §5.6): da igual si están en la sala o en el banco.
- Se permiten cadenas: 4× nivel 1 → 2× nivel 2 → 1× nivel 3. El nivel siguiente
  sale del catálogo por `(nombre, nivel + 1)`; puede ser un modelo que no está en
  el inventario. Ítems sin catálogo (custom, `paste:`) no se mergean.
- El solver decide qué merges hacer con el mismo orden de §5.3 (un merge solo
  aparece si mejora `F`, `B` o `P`).
- **Descartar a mano**: cada fila de "Merges a hacer" tiene un botón
  **"descartar"** que agrega el **paso final** de esa cadena
  (`modelo origen → nivel siguiente`) a la lista de descartados; al
  re-optimizar puede aparecer la cadena hasta el nivel anterior. **No re-optimiza**: se pueden descartar varios y
  después optimizar. La fila descartada queda atenuada con botón **"deshacer"**
  y aparece el aviso "optimiza de nuevo para aplicar los descartes". Es por
  escalón: descartar nivel 4 → 5 sigue permitiendo 3 → 4.
- La lista se persiste en `localStorage` (`excludedMerges` en el store, por
  navegador) y se muestra bajo el toggle en un **desplegable cerrado**
  ("Merges descartados (N)"); cada descartado tiene una ✕ para reactivarlo. Se
  manda como `excluded_merges` y esos modelos no se enlazan con su nivel
  siguiente.
- Resultado: caja **"Merges a hacer"** (antes de la tabla de la sala, con
  fondo propio). **Una fila por minero** (la cadena completa de merges): sprite
  del nivel final, nombre, tag **"N merge"** (total de merges de la cadena),
  aporte (ver abajo) y botón "descartar". Los pasos intermedios no se
  muestran: esos niveles no quedan en la sala.

  **"¿cuánto aportan?"** (un solo botón en el encabezado de la caja, bajo
  demanda): calcula el aporte de **todos** los merges, **uno tras otro** (el
  servidor corre un trabajo a la vez). Mientras tanto, cada fila muestra "en
  espera", "calculando…" o su valor, y el botón muestra el avance (`2/4`). Una
  fila con error tiene su propio "reintentar". Para cada merge lanza un
  trabajo de optimización (§5.10) con el **mismo pedido** del resultado, más el
  paso final de esa cadena en `excluded_merges` (lo mismo que quita
  "descartar") y `primary_only: true` (solo la pasada principal, §7.3), con
  `time_limit_s = 60`. La fila muestra:

  ```
  aporte = P(resultado) − P(óptimo sin ese merge)
  ```

  = cuánto **poder bruto de mineros pierde la sala optimizada si no se hace
  ese merge**. Ya descuenta que las copias consumidas quizá estaban puestas y
  que la copia nueva desplaza a otro minero, así que es la respuesta a "¿me
  conviene?". El tooltip agrega el cambio de poder final. Si la
  re-optimización no se demostró óptima, se muestra con "≈". El valor se
  muestra **siempre en la unidad de la liga**: la unidad del `minPower` de la
  liga elegida, como mínimo PH (Bronze y Silver → PH, Gold I → PH, desde Gold
  II → EH, desde Titan I → ZH); con "Personalizado", la unidad elegida en el
  selector del tope (PH, EH o ZH). Con 3 decimales, así que un aporte chico puede
  verse como `+0.000 EH/s`. Mientras calcula,
  la fila muestra "calculando…"; como es un trabajo más, si hay otro corriendo
  devuelve el 429 de siempre y se muestra el error en la fila. Los aportes de
  varios merges **no se suman** (interactúan entre sí). No se muestra ningún
  otro cálculo de ganancia de merges.

  Los picks que salen de un merge llevan tag **"merge"**.
- **"usar como sala"** simula los merges sin tocar "Mi inventario" (§5.7): las
  copias consumidas salen de la sala, del inventario sin usar (`simUsed`) o de
  lo planeado, y las producidas entran directo a la sala. Se puede deshacer con
  el toast de deshacer.

### 5.10 Progreso y detener

La optimización corre como un **trabajo en segundo plano** en el backend (§8):
el frontend lo inicia, consulta su estado cada ~1 s y lo puede detener.

- **Tope duro de 5 min** (`time_limit_s = 300`) para todo el trabajo.
- Mientras corre, el panel muestra la pasada en curso ("poder bruto", "poder
  final", "menos mineros" o "respaldo") y el tiempo `m:ss / máx 5:00` con su
  barra. En las pasadas que maximizan poder, además, en la unidad de la liga
  (§5.9) y sin jerga del solver:

  ```
  Mejor sala encontrada: 14.003 EH/s de poder bruto        (o "de poder final")
  El máximo posible es 15.341 EH/s o menos · seguro al 91.3 %
  [barra al 91.3 %]
  ```

  "El máximo posible" es la cota del solver (ninguna combinación la supera) y
  "seguro al" = `mejor / cota`, truncado a 1 decimal: sube hacia 100 % y al
  llegar la pasada queda demostrada óptima.
- Botón **"Detener"**: corta la búsqueda y se queda con la mejor solución
  encontrada. Si se detiene durante la primera pasada,
  las siguientes (desempate
  y merges) igual corren con un límite corto (`_POLISH_S = 3 s` cada una). El
  resultado sale como `feasible` salvo que ya estuviera demostrado (§7.3).
- Sin detener, el trabajo termina cuando la pasada 1 se demuestra óptima (o a
  los 5 min) más, como mucho, 10 s por cada desempate (§7.3).
- **Heartbeat**: si nadie consulta el estado del trabajo en `15 s` (se cerró la
  pestaña), se detiene solo, igual que con el botón.
- Solo corre **1 trabajo a la vez** en todo el servidor (§8); mientras tanto,
  iniciar otro devuelve 429.

---

## 6. Datos de la API

Fuente: `https://api.rollercoincalculator.app/api/Merges`
(paginado; `PageRequest.PageIndex`, `PageRequest.PageSize` hasta 1000; filtro
`Name`) + `https://api.rollercoincalculator.app/api/Merges/get-by-miner-name`
(un llamado por nombre, devuelve toda la escalera + `requiredItems`).

### 6.0 Niveles: la API está desfasada +1

La API es de **merges**, así que su `resultItemLevel` **arranca en 1, pero ese
"1" es el nivel 2 del juego**. El **nivel base** (nivel 1 real del juego) nunca
aparece como `resultItem`: solo vive dentro de `requiredItems` del recipe de
nivel API 1 (como ingrediente `type: "miners"`, `level: 0`).

Por eso el catálogo:

1. toma los resultados del listado masivo (`api_level` 1..5);
2. por cada nombre llama `get-by-miner-name` y extrae de `requiredItems` los
   mineros `type:"miners"` que falten (principalmente el `level: 0` base);
3. **expone `level = api_level + 1`** → base = **1**, api 1 = 2, … api 5 = **6**.

Iconos de nivel: `frontend/public/miner-levels/level_<N>.webp` para `N = 1..6`
(numerales romanos I–VI; todos con ratio 1.38, se escalan por `height`). Van a la
izquierda del nombre, pequeños (~11 px de alto).

Ejemplo `10k Crust`:

| level (juego) | api_level | power (GH/s) | bonus |
|---|---|---|---|
| 1 (base) | 0 | 750 000 | 1.00% |
| 2 | 1 | 2 000 000 | 2.50% |
| 3 | 2 | 5 500 000 | 5.00% |
| 4 | 3 | 15 000 000 | 12.00% |
| 5 | 4 | 40 000 000 | 22.00% |
| 6 | 5 | 100 000 000 | 45.00% |

Clave de deduplicación de bonus: el `id` del ítem (`resultItemId` para 1..5,
`itemId` del `requiredItem` para el base). Cada `(nombre, nivel)` tiene un `id`
único y estable.

Campos usados de cada item:

| Campo API | Uso |
|---|---|
| `resultItemId` / `requiredItems[].itemId` | clave del modelo (dedup) |
| `resultItemName` | nombre |
| `resultItemLevel` | nivel API (1–5). Nivel de juego = `+1` (ver §6.0) |
| `resultItemPower` | **poder bruto** del minero, en **`GH/s`** (entero exacto). Ej: `10k Crust` L1 = `2000000` → 2.000.000 GH/s = 2 PH/s. |
| `resultItemPercent` | **bonus en bp**. `fracción = resultItemPercent / 10000`. Ej: `14 → 0.14%`, `6000 → 60%`, `20000 → 200%`. |
| `resultItemWidth` | celdas que ocupa (1 o 2) |
| `resultItemFileName`, `resultItemImageVersion` | imagen: `cdn.rollercoincalculator.app/miners/<fileName>.png?v=<version>` |

⚠️ **Apóstrofos en `fileName`**: el CDN quita los apóstrofos del nombre
(`Captain's Fortune` → `captains_fortune.png`), pero para los niveles de *merge*
la API a veces devuelve `resultItemFileName` con la comilla tipográfica `’`
intacta → URL 404. `_image_url()` los saca (`'` `’` `ʼ` `` ` ``). Afectaba a 4
mineros (Captain's Fortune, Devil's Ember, Hashbeard's Ship, King's Legacy); el
seed se parcheó en sitio.

**Excepción:** algunos archivos del CDN **sí conservan** la comilla tipográfica.
Verificado contra el CDN para los 77 nombres con comilla del catálogo: solo
**Corsair's Oath** (`corsair’s_oath.png`, URL-encoded `corsair%E2%80%99s_oath`).
Van en `_CDN_KEEPS_APOSTROPHE` y `_image_url()` los devuelve así en vez de sacar
la comilla.

**Las imágenes son sprite sheets** (los mineros están animados en el juego):
6 frames en horizontal, cada frame de `58·width × 50` px
(width-1 → `348×50`, width-2 → `696×50`). El componente `MinerSprite` del
frontend muestra 1 frame y anima con `steps(6)`.

Observaciones verificadas (2026-09-03):

- ~6990 recetas (result items), ~1444 nombres. Con los base: **~7461 modelos**,
  niveles de juego 1–6.
- Cada `id` es único y sus stats son consistentes entre recetas.
- El escalado de bonus `/ 10000` está confirmado en el código del calculador
  (`RoomPowerSimulator`: `globalBonusPercent / 10000`).

### 6.1 Caché y rate-limit

- La API **limita agresivamente (429)**. El fetch usa: `_CONCURRENCY = 1`,
  limitador global `~3 req/s`, pausa de 20 s cada 60 pedidos y backoff
  exponencial que honra `Retry-After`. Carga completa (~1450
  `get-by-miner-name`): **~15–20 min**.
- El repo trae un **snapshot** en `backend/app/data/catalog_seed.json` que se usa
  al arrancar (instantáneo). El backend cachea en `backend/.cache/catalog.json`
  por 7 días.
- **`refresh()` hace merge**: parte de lo que ya había, así que un refresh
  parcial (algún 429 que no se recuperó) **nunca borra** datos previos.
- **`refresh()` es incremental**: solo escala los nombres que no tienen su nivel
  base. Con el seed completo eso son los mineros que RollerCoin agregó desde el
  snapshot (~1 nombre por día) → **segundos**, no minutos. `refresh(full=True)`
  re-escala los ~1450 nombres y es la única pasada larga.
- **Puesta al día automática al arrancar** (`autosync_async`, lanzada desde el
  `lifespan` de FastAPI): hace un `refresh()` incremental con tope
  `_AUTOSYNC_MAX_NAMES = 50`. Si faltan más nombres que ese tope, no hace el
  paso lento (deja el listado masivo mezclado y nada más): esa descarga la
  decide el usuario. Existe porque en un hosting con **disco efímero** (Render
  duerme el servicio por inactividad y levanta un contenedor nuevo) se pierde
  `.cache/catalog.json` y el catálogo retrocede al seed de la imagen.
- **No** se recarga sola por antigüedad. `/api/health` informa `catalog_stale` y
  `catalog_missing_base` (nombres sin su nivel 1 → fetch incompleto). El usuario
  actualiza con `POST /api/catalog/refresh` (botón "actualizar" en la UI, que
  primero chequea con `/api/catalog/check` y solo trae si falta algo) o fuerza
  la pasada larga con `?full=true` ("recarga completa").

### 6.2 Limitaciones conocidas

- El endpoint `Merges` solo trae mineros **crafteables (merge)**. Mineros de
  tienda / eventos que no se craftean pueden faltar.
- Mitigación: el frontend permite agregar **mineros personalizados** a mano
  (nombre, poder, bonus, width).

### 6.3 Ligas

- Endpoint: `GET https://api.rollercoincalculator.app/api/League` → lista de
  ligas con `{ id, title, level, minPower, imageUrl, currencies, ... }`.
  `minPower` está en **GH/s** (Platinum II = `50000000000` = 50 EH/s). Se usan
  solo `level`, `title`, `minPower` e `imageUrl`.
- `tope(L) = minPower(L+1) − 1` (con `50 EH/s` exactos ya se sube de liga). La
  última (Legend) no tiene tope.
- Snapshot versionado en `backend/app/data/leagues_seed.json` (22 ligas, Bronze
  I … Legend). El backend refresca desde la API como mucho **1 vez cada 24 h**
  (en memoria); si falla (429 incluido) sigue con lo último que tenía.

---

## 7. Modelo matemático (implementación)

Se resuelve con **OR-Tools CP-SAT** (exacto, entero).

### 7.1 Variables

- `use[m] ∈ [0, min(disp[m], max_slots)]` — copias del modelo `m` colocadas.
  `disp[m] = qty[m] + ⌊disp[prev(m)] / 2⌋` con merges (§5.9), `qty[m]` sin ellos.
- `k[m] ∈ [0, ⌊disp[m] / 2⌋]` — merges de `m` a su nivel siguiente (solo con
  merges activados y si el nivel siguiente existe en el catálogo).
- `y[m] ∈ {0,1}` — 1 si `use[m] ≥ 1`.
  - `use[m] ≥ 1  ⇔  y[m] = 1`
- `P_s` — poder bruto (escalado, ver §7.4).
- `B ∈ [0, ΣbonusMax]` — bonus total en bp.
- `z[m] ∈ [0, M]` — linealización de `P_s · y[m]`.

### 7.2 Restricciones

```
Σ_m use[m]            ≤ max_slots          (modo miners)
Σ_m use[m] · width[m] ≤ max_slots          (modo cells)

use[m] + 2·k[m] ≤ qty[m] + k[prev(m)]     (copias: propias + merges que llegan
                                          − las que se mergean; sin merges, use ≤ qty)

P_s = Σ_m use[m] · power_s[m]
B   = Σ_m y[m] · bonus_bp[m]               (dedup: una vez por modelo)

z[m] ≤ P_s
z[m] ≤ M · y[m]
z[m] ≥ P_s − M · (1 − y[m])

F = 10000 · P_s + Σ_m bonus_bp[m] · z[m]   (= P_s · (10000 + B))
F ≤ 10000 · tope_s
F ≥ 10000 · piso_s                          (solo en modo ventana, §7.3)
```

`piso_s = ⌈piso / S⌉`. Como `power_s` se redondea hacia arriba, el `F` real puede
quedar hasta `~1e-10` relativo bajo el piso: despreciable, y el piso es una
preferencia (§5.2).

Sin tope (Legend), el tope efectivo es la cota `F` de usar **todas** las copias
alcanzables (`final_power(Σ power·disp, Σ bonus)`), para no inflar la escala.

### 7.3 Objetivo (pasadas)

**Modo ventana** (con `margin_bp`), con la restricción `F ≥ 10000 · piso_s`:

1. `maximize P_s` → `P*_s`. Si es **infactible** (nada llega al piso) o no
   encuentra ninguna solución, se descarta la restricción del piso y se pasa al
   modo respaldo.
2. añadir `P_s ≥ P*_s`; `maximize F` → `F*`.
3. añadir `F ≥ F*`; pasada de **mineros y merges** (abajo).

**Modo respaldo** (sin `margin_bp`, o si el piso no se alcanza):

1. `maximize F`  → `F*`
2. añadir `F ≥ F*`; `minimize (B · W − P_s)` con `W = poder_disponible_s + 1`
   (así 1 bp de bonus pesa más que todo el poder bruto → primero menor bonus,
   después mayor poder bruto, en una sola pasada).
3. fijar `B = B*`, `P_s ≥ P*_s`; pasada de **mineros y merges** (abajo). Es
   una pasada aparte y no un peso más en la 2 porque multiplicar `B · W` otra
   vez puede desbordar `int64`.

Con `primary_only` (para "¿cuánto aporta?", §5.9) se corre únicamente la
pasada 1 del modo que corresponda.

**Pasada de mineros y merges** (la 3 de los dos modos, siempre corre):
`minimize Σ use[m] · (K + 1) + Σ k[m]` con `K = Σ ⌊disp[m] / 2⌋` (la cota de
merges), así un minero menos pesa más que cualquier diferencia de merges: primero
menos mineros y después menos merges, en una sola pasada. Sin merges activados
`Σ k` no existe y queda `minimize Σ use[m]`. Los números son chicos (cantidades),
no hay riesgo de desbordar.

**Tiempo:** hay un solo plazo para todo el trabajo (`time_limit_s`). La pasada 1
usa lo que quede; las de desempate (2 y 3) usan lo que quede con un mínimo de
`_POLISH_S` (3 s) y un **máximo de `_TIEBREAK_S` (10 s)**. Arrancan con la
solución anterior como *hint* y suelen encontrar su mejor valor al instante, pero
con muchos empates exactos de poder bruto (poderes redondos: 1e7, 5e6…)
*demostrarlo* puede no terminar nunca (medido con un inventario real de 155
modelos: el valor aparece en 0.1 s y la demostración no termina en 90 s). Si no
terminan, queda su mejor valor o el de la pasada anterior. Detener (§5.10) corta la pasada en curso con
`solver.stop_search()` y las que siguen corren con `_POLISH_S`.

Antes de las pasadas:

- **Atajo:** si todas las copias del inventario caben en la sala y ni así se
  supera el tope → se usa todo el inventario (óptimo trivial en los dos modos:
  es el mayor `P` y el mayor `F` posibles; de un modelo sin poder, solo bonus,
  va 1 copia porque las demás no suman). No aplica si hay algún merge
  posible: mergear sube poder y bonus, así que todavía puede haber una sala
  mejor.
- **Heurística voraz:** llena con los mineros de mayor poder sin pasar del
  tope. Se usa como *hint* del solver y como *fallback* si el solver no
  encuentra nada. El resultado final nunca es peor que esta heurística (según
  el orden de §5.3, ventana incluida).

Después: recálculo con enteros exactos de Python (sin escala), red de seguridad
`_trim_overshoot`, y verificación `F ≤ tope`. El resultado informa `in_window`
(si `piso ≤ F ≤ tope` con los valores exactos).

`relative_gap_limit = 1e-6` en las pasadas que maximizan `P` o `F` (con 50 EH/s
son 0.00005 EH/s, bajo lo que se muestra). La pasada 2 del respaldo y las de
merges corren con gap `0` (hasta el óptimo o el límite de tiempo): el objetivo
de la 2 está dominado por `B · W`, y un gap relativo ahí dejaba el poder bruto
hasta ~`gap · B` veces `W` por debajo del óptimo (≈3% con 300% de bonus) → cada
nueva optimización "mejoraba" el poder bruto de la anterior. `status`:

| status | significado |
|---|---|
| `optimal` | óptimo demostrado (dentro de `1e-6`) en todas las pasadas |
| `optimal_primary` | la pasada 1 (criterio principal: mayor bruto en la ventana, o mayor `F` en el respaldo) está demostrada; algún desempate no terminó de demostrarse. UI: "óptimo demostrado · desempate sin demostrar" (verde) |
| `feasible` | solución válida pero el solver no llegó a *demostrar* que es la óptima dentro del límite de tiempo. UI: "válida · óptimo no demostrado" |
| `infeasible` / `unknown` | no debería ocurrir (la selección vacía siempre es válida) |

Tiempo típico: 0.1–4 s para inventarios de 15–90 modelos distintos.

### 7.4 Escalado (evitar overflow int64)

El término `Σ bonus_bp[m] · z[m]` puede desbordar `int64` con objetivos grandes
(peta/exahash). Se escala solo el poder:

```
S          = max(1, ceil(objetivo · n_modelos · bonus_max_por_modelo / 4e18))
             (y como mínimo ceil(objetivo · bonusMaxTotal / 1e17))
power_s[m] = ceil(power[m] / S)      # redondeo hacia ARRIBA
objetivo_s = floor(objetivo / S)     # redondeo hacia ABAJO
B                                    # exacto, sin escalar
```

Redondear el poder hacia arriba y el objetivo hacia abajo garantiza que la
solución **nunca** supere el objetivo real. La holgura introducida es
despreciable (`~ 1e-10` relativo).

### 7.5 Rendimiento

- Inventarios reales: ~20–60 modelos distintos → resuelve en < 1 s por pasada.
- Límite de tiempo total configurable (default 10 s en la API; la UI manda 300).
- Si el inventario tuviera cientos de modelos distintos, puede degradar; se
  puede subir el time limit o pre-filtrar.
- **Workers:** `num_workers` sale de la variable de entorno `OPT_WORKERS`
  (default 8). En un host con fracción de CPU (Render free/starter) conviene
  `OPT_WORKERS=1` o `2`: 8 workers compitiendo por menos de un núcleo rinden
  mucho peor.

---

## 8. Contrato de la API (backend)

- `GET  /api/health`
- `GET  /api/catalog?search=<txt>&limit=<n>` — catálogo de modelos (desde
  RollerCoin, cacheado 24 h).
- `POST /api/catalog/refresh[?full=true]` — trae los mineros que falten (con
  `full=true`, re-baja el catálogo entero). Corre en segundo plano.
- `GET  /api/catalog/check` — chequeo rápido contra RollerCoin:
  `{remote_names, local_names, new_count, new_names, pending, eta_seconds}`.
- `POST /api/inventory/parse` — body `{ "text": "<pegado de RollerCoin>" }` →
  `{ items: [{id,name,level,power,bonus_bp,width,quantity,image,matched}],
  skipped: [] }`. Ver §5.8.
- `GET  /api/leagues` — ligas (§6.3):
  `[{ level, title, min_power, max_power, image }]`; `min_power`/`max_power`
  como string (GH/s), `max_power` = tope (`null` en la última).
- `POST /api/optimize` — **inicia** un trabajo (§5.10) y responde al toque
  `{ "job_id": "..." }`. 429 si ya hay uno corriendo. Body:

```jsonc
{
  "target_final_power": "5000000000000",   // string (puede exceder 2^53); null = sin tope
  "margin_bp": 100,                         // §5.2 (opcional; ausente = solo respaldo)
  "primary_only": false,                    // §5.9 "¿cuánto aporta?" (opcional)
  "max_slots": 48,                          // 48 | 72 | otro
  "slot_mode": "miners",                    // "miners" | "cells"
  "time_limit_s": 300,                      // (0, 300]
  "allow_merges": false,                    // §5.9 (opcional, default false)
  "excluded_merges": [],                    // §5.9: ids de origen descartados
  "inventory": [
    { "id": "631f...", "name": "Leap, The Frogo", "level": 1,
      "power": "105", "bonus_bp": 14, "width": 1, "quantity": 3 }
  ]
}
```

- `GET  /api/optimize/{job_id}` — estado del trabajo (cuenta como heartbeat):

```jsonc
{
  "state": "running" | "done" | "error",
  "elapsed_s": 12.3,
  "time_limit_s": 300,
  "phase": "raw" | "final" | "tiebreak" | "miners" | "fallback" | "",
  "best": "4999000000",     // mejor valor de la pasada en curso (GH/s; "" si no hay)
  "bound": "5010000000",    // cota del solver (GH/s; "" si no hay)
  "stopping": false,
  "result": { ... },        // solo con state = "done" (ver abajo)
  "error": ""               // solo con state = "error"
}
```

  404 si el trabajo no existe (expiró: se guardan 10 min después de terminar).
- `POST /api/optimize/{job_id}/stop` — detiene la búsqueda (§5.10). Idempotente.

Resultado (`result`):

```jsonc
{
  "status": "optimal" | "optimal_primary" | "feasible" | "infeasible",   // §7.3
  "picks": [ { "id": "...", "name": "...", "level": 1, "count": 5,
               "power": "105", "bonus_bp": 14, "width": 1,
               "image": "" } ],          // image: del catálogo ("" si no hay)
  "merges": [ { "from_id": "...", "from_name": "...", "from_level": 1,
                "from_power": "750000", "count": 1,              // merges: consume 2·count, produce count
                "to": { "id": "...", "name": "...", "level": 2, "power": "...",
                        "bonus_bp": 250, "width": 2, "image": "..." } } ],
  "raw_power": "525",
  "bonus_bp": 14,
  "final_power": "525",
  "target_final_power": "5000000000000", // tope (null si no hay)
  "floor_power": "4950000000000",        // piso (§5.2; "0" sin margen o sin tope)
  "in_window": false,                    // piso ≤ final_power ≤ tope (siempre false sin margen)
  "headroom": "4999999999475",       // tope - final_power (null sin tope)
  "headroom_pct": 99.99,             // final / tope · 100 (0 sin tope)
  "slots_used": 5,
  "cells_used": 5,
  "scale": 1
}
```

Números que pueden exceder `2^53` viajan como **string**. El frontend usa
`BigInt`.

### 8.1 Unidades

- **Interno / API:** siempre `GH/s` (enteros exactos, tal como los da RollerCoin
  en `resultItemPower`).
- **Visualización / entrada en la UI:** solo **GH, TH, PH, EH, ZH** (factor 1000
  entre cada una). Un número sin sufijo se interpreta como **GH**. Valores por
  debajo de `0.001` de la unidad elegida se muestran como `~0 GH/s` (el valor
  exacto en GH/s va en el tooltip).

---

## 9. Decisiones abiertas / a confirmar

1. ~~48/72 = mineros o celdas~~ → **resuelto**: celdas (`slot_mode: "cells"`),
   1 sala = 96, 2 = 144.
2. **Deduplicación por nivel.** Asumido: el bonus se deduplica solo si coinciden
   nombre **y** nivel (mismo `id`). Confirmado por el enunciado
   ("misma rareza incluso").
3. **Numeración de niveles.** Se expone `nivel de juego = api_level + 1`
   (base = 1, merges 2–6). Iconos `level_2..6.webp` lo respaldan.
4. **Celdas salas 3 y 4.** Asumido: cada sala extra aporta 144 (como la 2ª) →
   384 / 528. El usuario confirmó sala 1 = 96 y sala 2 = +144 (240 total).
5. **Redondeo del poder final.** Asumido: división entera hacia abajo, igual que
   el juego. Verificar contra un caso real en la sala.
6. **Mineros no-merge.** Por ahora se cubren con entrada manual.
7. **¿El objetivo es por juego o por sala?** No afecta al algoritmo; el usuario
   ingresa el número que quiera.

---

## 10. Calculadora Freon (vista aparte)

Vista independiente del optimizador: no toca el inventario ni la sala, solo
calcula el bonus que aporta la máquina de Freon. Datos tomados de la planilla
`Freon.xlsx` del usuario. Implementación: `frontend/src/freon.ts` (lógica pura)
y `frontend/src/components/CalculadoraFreon.tsx` (UI).

### 10.1 Módulos

Seis módulos, cada uno con 4 niveles (I…IV). El nivel I es el de partida y es
gratis; subir cuesta **10 / 25 / 100 RLT** (acumulado por módulo: 135 RLT;
los seis al máximo: 810 RLT).

| Módulo | Qué hace | I | II | III | IV |
| --- | --- | --- | --- | --- | --- |
| Ham Platforms | hámsters trabajando | — | 1 | 2 | 3 |
| Ham Efficiency | bonus por punto de stat | 1% | 2% | 3% | 5% |
| Duty Time | tiempo de trabajo | 6 h | 12 h | 18 h | 24 h |
| Freon Leak Amount | merma por ronda | -9% | -7% | -5% | -3% |
| Freon Leak Time | duración de la ronda | 6 h | 12 h | 18 h | 24 h |
| Freon Efficiency | freon extra al cargar | — | +2.5% | +5% | +10% |

### 10.2 Nivel de la máquina

El nivel sale de la **cantidad de mejoras compradas** (suma de los niveles de
los seis módulos, 0…18) y fija cuánto Freon se puede almacenar:

| Nivel | Mejoras | Límite de Freon | Bonus máx. por Freon |
| --- | --- | --- | --- |
| I | 0 | 5.000 | 50% |
| II | 6 | 50.000 | 500% |
| III | 12 | 150.000 | 1500% |
| IV | 18 | 500.000 | 5000% |

### 10.3 Fórmula

**100 Freon = 1% de bonus.** El bonus total se suma al bonus de la sala, así
que se expresa en bp igual que el resto de la app (§3):

```
freon_efectivo = min( floor(freon_cargado × (1 + extra%)), límite_del_nivel )
bonus_freon_bp = freon_efectivo × 100 / 100        # 100 freon = 1% = 100 bp
bonus_ham_bp   = Σ stat_i × bp_por_stat            # solo los primeros N hámsters,
                                                   # N = slots de Ham Platforms
bonus_pico_bp  = bonus_freon_bp + bonus_ham_bp   # mientras el turno está activo
F = P · (10000 + bonus_pico_bp) / 10000            # misma fórmula que §3
```

Ese es el **pico**. Lo que rinde a lo largo del día sale de §10.4.

`bp_por_stat` es 100 / 200 / 300 / 500 según Ham Efficiency (1% = 100 bp), así
que el bonus de hámsters siempre queda en bp enteros.

**Cuidado con las celdas de la planilla**: están guardadas como fracción con
formato de porcentaje. `0.01` en Ham Efficiency se muestra como **1%**, no como
0.01%. Lo mismo con la columna "Max Bonus" de las ramas: guarda `45` y `50`,
que se leen **4500%** (hámsters) y **5000%** (freon).

Referencia de la planilla: con Ham Platforms IV, Ham Efficiency IV y tres
hámsters de 300 de stat, la rama de hámsters aporta 4500% (3 × 300 × 5%); los
500.000 Freon del nivel IV aportan 5000%.

### 10.4 Ciclo de los hámsters y poder equivalente

Los hámsters **no** trabajan todos los días: hacen un turno de `duty_time`
(6/12/18/24 h) y después **descansan 24 h fijas**. El ciclo completo es
`duty_time + 24`, así que la fracción del tiempo en que el bonus está activo es:

| Duty Time | Turno | Ciclo | Activo |
| --- | --- | --- | --- |
| I | 6 h | 30 h | 20.0% |
| II | 12 h | 36 h | 33.3% |
| III | 18 h | 42 h | 42.9% |
| IV | 24 h | 48 h | 50.0% |

El minado de RollerCoin es proporcional al hashrate, así que en vez de calcular
cripto se calcula el **poder constante equivalente**: el hashrate fijo que mina
lo mismo que el ciclo real de encendido/apagado. Es un poder, no una cantidad
acumulada — no se multiplica por días ni por meses. Como el bonus es aditivo (§3), promediar el bonus de los
hámsters equivale a promediar el poder:

```
bonus_ham_efectivo = bonus_ham × duty_time / (duty_time + 24)
bonus_efectivo     = bonus_freon + bonus_ham_efectivo
poder_equivalente  = poder_final_sala + poder_bruto × bonus_efectivo / 10000
```

`poder_final_sala` ya trae el bonus de la sala, por eso el aporte del freon se
suma aparte sobre el poder bruto. Ese `poder_equivalente` es el número que se
pega en una calculadora de profit externa: ella devuelve el minado diario y
mensual ya correcto, sin tener que replicarla.

**Supuesto**: el bonus del freon cargado aplica de forma continua (la merma
sigue corriendo igual) y solo el aporte de los hámsters es intermitente. Si
resulta que el freon también se corta fuera del turno, el factor del ciclo pasa
a aplicarse a `bonus_efectivo` completo.

### 10.5 Merma

El Freon se pierde cada ronda: `restante = freon × (1 − merma%)^rondas`, con
`rondas = floor(duty_time / leak_time)`. La calculadora solo lo muestra como
referencia (cuánto Freon queda al terminar el turno de los hámsters); el bonus
que informa es el del momento de cargar.
