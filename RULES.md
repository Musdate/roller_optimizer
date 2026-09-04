# Reglas del Optimizador de Sala — RollerCoin

Este documento es la **fuente de verdad** de la lógica. El código (backend y
frontend) debe respetar exactamente lo que está aquí. Si algo cambia, se cambia
primero acá.

---

## 1. Contexto

En RollerCoin cada minero aporta:

- un **poder** (hashrate, en `GH/s`), y
- un **bonus** (un porcentaje).

El objetivo de la app: dado un **poder final objetivo** y el **inventario de
mineros** del usuario, encontrar la **mejor combinación** de mineros para colocar
en la sala.

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
F(S) ≤ objetivo
```

**No se puede pasar del objetivo.** Puede quedar por debajo, nunca por encima.

### 5.2 Sin piso mínimo

Cualquier `F(S) ≤ objetivo` es válido (incluida la combinación vacía, `F = 0`).
No hay un porcentaje mínimo del objetivo que haya que alcanzar.

### 5.3 Orden de prioridad (lexicográfico)

Entre todas las combinaciones válidas se elige, **en este orden**:

1. **Mayor poder final `F(S)`** (lo más cerca posible del objetivo sin pasarse).
2. A igualdad de `F(S)`, **menor bonus total `B(S)`**.
3. A igualdad de `B(S)`, **mayor poder bruto `P(S)`**.

> Racional: primero acercarse al objetivo; después, gastar el menor bonus posible
> (los mineros de bonus alto quedan libres para otras salas/juegos); y como
> desempate, quedarse con más poder bruto.

### 5.4 Límite de mineros (Salas)

- La UI pide el **nº de salas** (1–4). Mineros permitidos = `48 + (salas−1)·24`
  → 1 sala = **48**, 2 = **72**, 3 = **96**, 4 = **120**. (1ª sala 8×6 celdas;
  cada sala extra 8×3.)
- Es un **máximo**, no hay que llenarlo. El backend recibe `max_slots` ya
  calculado.
- **Modo de conteo**: siempre **`miners`** (`Σ 1 ≤ max`). El backend soporta
  `slot_mode: "cells"` (`Σ width ≤ max`, la grilla real) pero no está expuesto.
  ⚠️ Casi todos los mineros de merge son `width 2`: en RollerCoin real ocupan 2
  celdas, así que una sala de 48 celdas entra ~24 mineros width-2, no 48. La app
  usa la convención "1 minero = 1 slot" a pedido del usuario.
- **Poder objetivo (UI)**: input numérico + selector **PH/s, EH/s, ZH/s**.
  `time_limit_s` fijo en 8 s (no expuesto).

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

### 6.1 Caché

- Primera carga completa (masivo + ~1444 `get-by-miner-name`): la API limita a
  ~6 req/s → **~4 min**. Por eso el repo trae un **snapshot** en
  `backend/app/data/catalog_seed.json` que se usa al arrancar (instantáneo).
- El backend cachea en `backend/.cache/catalog.json` por 7 días.
- **No** se recarga sola por antigüedad (bloquearía requests). `/api/health`
  informa `catalog_stale`; el usuario recarga con `POST /api/catalog/refresh`
  (botón "recargar" en la UI, tarda ~4 min).

### 6.2 Limitaciones conocidas

- El endpoint `Merges` solo trae mineros **crafteables (merge)**. Mineros de
  tienda / eventos que no se craftean pueden faltar.
- Mitigación: el frontend permite agregar **mineros personalizados** a mano
  (nombre, poder, bonus, width).

---

## 7. Modelo matemático (implementación)

Se resuelve con **OR-Tools CP-SAT** (exacto, entero).

### 7.1 Variables

- `use[m] ∈ [0, min(qty[m], max_slots)]` — copias del modelo `m` colocadas.
- `y[m] ∈ {0,1}` — 1 si `use[m] ≥ 1`.
  - `use[m] ≥ 1  ⇔  y[m] = 1`
- `P_s` — poder bruto (escalado, ver §7.4).
- `B ∈ [0, ΣbonusMax]` — bonus total en bp.
- `z[m] ∈ [0, M]` — linealización de `P_s · y[m]`.

### 7.2 Restricciones

```
Σ_m use[m]            ≤ max_slots          (modo miners)
Σ_m use[m] · width[m] ≤ max_slots          (modo cells)

P_s = Σ_m use[m] · power_s[m]
B   = Σ_m y[m] · bonus_bp[m]               (dedup: una vez por modelo)

z[m] ≤ P_s
z[m] ≤ M · y[m]
z[m] ≥ P_s − M · (1 − y[m])

F = 10000 · P_s + Σ_m bonus_bp[m] · z[m]   (= P_s · (10000 + B))
F ≤ 10000 · objetivo_s
```

### 7.3 Objetivo (2 pasadas)

1. `maximize F`  → `F*`
2. añadir `F ≥ F*`; `minimize (B · W − P_s)` con `W = poder_disponible_s + 1`
   (así 1 bp de bonus pesa más que todo el poder bruto → primero menor bonus,
   después mayor poder bruto, en una sola pasada).

Antes de las pasadas:

- **Atajo:** si todas las copias del inventario caben en la sala y ni así se
  supera el objetivo → se usa todo el inventario (óptimo trivial).
- **Heurística voraz:** llena con los mineros de mayor poder sin pasar del
  objetivo. Se usa como *hint* del solver y como *fallback* si el solver no
  encuentra nada. El resultado final nunca es peor que esta heurística.

Después: recálculo con enteros exactos de Python (sin escala), red de seguridad
`_trim_overshoot`, y verificación `F ≤ objetivo`.

`relative_gap_limit = 1e-6`: el solver corta la demostración de optimalidad
cuando está a menos de `1e-6` relativo del óptimo (sobre objetivos de `~1e12`
eso es `< 1e6 GH/s`, despreciable). `status`:

| status | significado |
|---|---|
| `optimal` | óptimo demostrado (o dentro de `1e-6`) |
| `feasible` | se agotó el tiempo; es la mejor solución encontrada (en la práctica, holgura ínfima) |
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
- Límite de tiempo por pasada configurable (default 10 s).
- Si el inventario tuviera cientos de modelos distintos, puede degradar; se
  puede subir el time limit o pre-filtrar.

---

## 8. Contrato de la API (backend)

- `GET  /api/health`
- `GET  /api/catalog?search=<txt>&limit=<n>` — catálogo de modelos (desde
  RollerCoin, cacheado 24 h).
- `POST /api/catalog/refresh` — fuerza recarga del catálogo.
- `POST /api/optimize` — body:

```jsonc
{
  "target_final_power": "5000000000000",   // string (puede exceder 2^53)
  "max_slots": 48,                          // 48 | 72 | otro
  "slot_mode": "miners",                    // "miners" | "cells"
  "time_limit_s": 10,
  "inventory": [
    { "id": "631f...", "name": "Leap, The Frogo", "level": 1,
      "power": "105", "bonus_bp": 14, "width": 1, "quantity": 3 }
  ]
}
```

Respuesta:

```jsonc
{
  "status": "optimal" | "feasible" | "infeasible",
  "picks": [ { "id": "...", "name": "...", "level": 1, "count": 5,
               "power": "105", "bonus_bp": 14, "width": 1 } ],
  "raw_power": "525",
  "bonus_bp": 14,
  "final_power": "525",
  "target_final_power": "5000000000000",
  "headroom": "4999999999475",       // objetivo - final_power
  "headroom_pct": 99.99,
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

1. **48/72 = mineros o celdas.** Default actual: mineros.
2. **Deduplicación por nivel.** Asumido: el bonus se deduplica solo si coinciden
   nombre **y** nivel (mismo `id`). Confirmado por el enunciado
   ("misma rareza incluso").
6. **Numeración de niveles.** Se expone `nivel de juego = api_level + 1`
   (base = 1). Confirmar contra la sala real que el juego numera así.
3. **Redondeo del poder final.** Asumido: división entera hacia abajo, igual que
   el juego. Verificar contra un caso real en la sala.
4. **Mineros no-merge.** Por ahora se cubren con entrada manual.
5. **¿El objetivo es por juego o por sala?** No afecta al algoritmo; el usuario
   ingresa el número que quiera.
