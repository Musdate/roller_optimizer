# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fuente de verdad

**`RULES.md` especifica toda la lógica** (fórmula del poder final, regla de
duplicados de bonus, orden lexicográfico de optimización, mapeo de niveles de la
API, contrato de la API, unidades). Si un cambio afecta el comportamiento, se
edita `RULES.md` primero y luego el código para que coincida. Las secciones están
numeradas y el código las referencia (p. ej. "ver RULES.md §7").

Texto visible para el usuario: español neutro (no voseo) — "tienes", no "tenés".

## Comandos

### Backend (`backend/`, Python 3.11+)

```bash
python -m venv .venv                                   # en la raíz del repo
.venv/Scripts/pip install -r backend/requirements.txt  # Windows
.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload   # correr (cwd = backend/)
```

Tests (cwd = `backend/`):

```bash
../.venv/Scripts/python -m pytest -q
../.venv/Scripts/python -m pytest -q tests/test_optimizer.py::test_hit_exacto_con_bonus   # un solo test
```

`tests/test_optimizer.py` incluye fuzz que compara el solver contra fuerza bruta;
`test_catalog.py` y `test_paste.py` cubren el mapeo de la API y el parser.

### Frontend (`frontend/`, Node 18+)

```bash
npm install
npm run dev        # http://localhost:5173, proxy /api -> :8000
npm run build      # tsc (typecheck) && vite build -> dist/
```

No hay ESLint; `npm run build` es la verificación (falla si `tsc` no pasa).

### Docker (build de producción, raíz del repo)

```bash
docker build -t roller-opt . && docker run -p 8080:8000 roller-opt   # http://localhost:8080
```

Un solo `Dockerfile`: compila el frontend y lo copia a `backend/static/`, que
FastAPI sirve en `/` (la API queda en `/api`). Deploy detallado en `DEPLOY.md`.

## Arquitectura

Monorepo de dos piezas. En producción es **una sola imagen**: FastAPI sirve el
build estático de Vite y la API bajo el mismo origen (rutas relativas `/api`, sin
CORS real).

### Backend — capa delgada sobre lógica pura

- **`app/optimizer.py`** — lógica pura (solo depende de `ortools`). Modelo CP-SAT
  exacto con linealización manual del producto `poder × bonus`. Resuelve en **2
  pasadas**: (1) maximizar `F`, (2) fijar `F ≥ F*` y minimizar `B·W − P` para
  obtener menor bonus y, como desempate, mayor poder bruto. Antes: atajo si todo
  el inventario cabe, y heurística voraz que sirve de *hint* y de *fallback*
  garantizado (el resultado nunca es peor que la voraz). El poder se **escala**
  para no desbordar `int64` con objetivos peta/exahash (poder hacia arriba,
  objetivo hacia abajo → nunca se pasa del objetivo real); recálculo final con
  enteros exactos de Python + `_trim_overshoot` como red de seguridad.
- **`app/catalog.py`** — catálogo de mineros desde `api.rollercoincalculator.app`
  (endpoint de *merges*). **Los niveles de la API están desfasados +1**: su nivel
  1 es el nivel 2 del juego, y el nivel base sale de los `requiredItems` (ver
  RULES.md §6.0). El repo trae un **snapshot completo** en
  `app/data/catalog_seed.json` (se versiona, ~1.8 MB) que se usa al arrancar. La
  API limita agresivamente; una recarga completa tarda ~15-20 min. **No se
  recarga sola por antigüedad**: `refresh()` es manual (`POST /api/catalog/refresh`),
  corre en un hilo, y hace *merge* (un refresh parcial nunca borra datos). Caché
  en `backend/.cache/catalog.json` (7 días, efímera).
- **`app/main.py`** — endpoints FastAPI, sin lógica propia. `/api/optimize` tiene
  un **lock global no-bloqueante**: solo 1 optimización a la vez, el resto recibe
  429 al toque (el solver satura CPU en un VPS chico). También sirve
  `backend/static/` en `/` si existe.
- **`app/models.py`** — schemas Pydantic. Los números que exceden `2^53`
  (poderes) viajan como **string** en el JSON.
- **`app/paste.py`** — parser del texto que se copia del inventario de
  RollerCoin. El número de nivel que muestra esa web **no** es nuestro `level`;
  el match contra el catálogo es por nombre + poder/bonus más cercano.

### Frontend — React + Zustand, sin router

- **`src/App.tsx` + `src/components/NavBar.tsx`** — navbar de 2 pestañas
  ("Optimizador de Sala" / "Estrategia 12h"); la activa se guarda en
  `localStorage` (`roller-view`). El *polling* de catálogo sigue vivo en ambas.
- **Vista "Estrategia 12h"** (`src/components/Estrategia12h.tsx` +
  `src/estrategia12h.ts` lógica pura + `src/estrategia12h.css`) — port React de la
  app vanilla `barras-12h`: rastrea las barras de 12 h de los 15 minijuegos.
  Estado propio en `localStorage` (clave `ronda12-data-v3`), independiente del
  store del optimizador. Estilos con prefijo `s12-` sobre la paleta del optimizador.

- **`src/store.ts`** — **todo el estado del optimizador** vive acá (Zustand con
  `persist` a `localStorage`, clave `roller-optimizer`): inventario, objetivo, nº de salas, y
  la **sala modelada por posición** (`roomSlots`: 1 entrada por celda física
  0..95; un minero de 2 celdas ocupa un par alineado a estante). `reconcileRoomSlots`
  repara `roomSlots` contra los `inRoom` del inventario. Cada modelo tiene
  `quantity` (tengo), `inRoom` (puestas en sala) y `planned` (planeo adquirir);
  `selectOptimizeList` manda `quantity + planned` al optimizador. Los selectores
  al final del archivo derivan las distintas vistas.
- **`src/calc.ts`** y **`src/power.ts`** — la fórmula `F = P·(10000+B)/10000` y
  el parseo/formato de hashrate con `BigInt`. **`calc.ts` duplica la fórmula de
  `optimizer.py`** — mantener en sync. Unidad interna en todos lados: **GH/s**
  (entero). La UI solo muestra/acepta GH, TH, PH, EH, ZH (factor 1000).
- **`src/api.ts`** — cliente HTTP; extrae el `detail` de los errores de FastAPI.
- **`src/App.tsx`** — hace *polling* de `/api/health` para mostrar el progreso de
  una recarga de catálogo y resincronizar el inventario guardado contra el
  catálogo actual (los datos del ítem se congelan al agregarlo).

### Comparación de resultado (RULES.md §5.7)

Tras optimizar, el resultado se compara con la sala actual (`inRoom`) y solo se
ofrece como mejora si el poder final **redondeado a como se muestra** (unidad + 3
decimales) sube, o si a poder mostrado igual usa menos bonus — no por diferencias
sub-visibles en GH/s exactos.
