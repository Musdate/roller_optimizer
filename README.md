# Optimizador de Sala — RollerCoin

Encuentra la mejor combinación de mineros para una sala de RollerCoin: se acerca
lo más posible a un **poder final objetivo sin pasarse**, usando el **menor bonus**
y luego el **mayor poder bruto** posible.

La lógica y todas las reglas están en **[RULES.md](RULES.md)** (fuente de verdad).

## Estructura

```
backend/            FastAPI + OR-Tools (CP-SAT)
  app/optimizer.py    lógica pura del optimizador  (ver RULES.md §7)
  app/catalog.py      catálogo de mineros desde api.rollercoincalculator.app
  app/main.py         API HTTP
  tests/              casos + fuzz contra fuerza bruta
frontend/           React + TypeScript + Vite (front básico)
```

## Correr en local

Requisitos: Python 3.11+ y Node 18+.

### Backend

```bash
cd backend
python -m venv ../.venv
../.venv/Scripts/pip install -r requirements.txt      # Windows
# source ../.venv/bin/activate && pip install -r requirements.txt   # Linux/Mac
../.venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload
```

Primera llamada al catálogo: descarga ~7000 recetas de merge y las cachea 24 h en
`backend/.cache/catalog.json`.

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (proxy /api -> :8000)
```

## Tests

```bash
cd backend && ../.venv/Scripts/python -m pytest -q
```

## Deploy

Un solo `Dockerfile` (raíz): Vite compila el frontend y FastAPI lo sirve en `/`,
la API queda en `/api`. Pasos para Dokploy / Docker en **[DEPLOY.md](DEPLOY.md)**.

```bash
docker build -t roller-opt . && docker run -p 8080:8000 roller-opt
# http://localhost:8080
```

## API

Ver [RULES.md §8](RULES.md#8-contrato-de-la-api-backend). Resumen:

| Método | Ruta | |
|---|---|---|
| GET | `/api/health` | estado + tamaño de catálogo |
| GET | `/api/catalog?search=&limit=` | modelos de minero |
| POST | `/api/catalog/refresh` | fuerza recarga del catálogo |
| POST | `/api/inventory/parse` | parsea texto pegado del inventario de RollerCoin |
| POST | `/api/optimize` | corre el optimizador |

Los números que superan `2^53` (poder objetivo/bruto/final) viajan como **string**.
