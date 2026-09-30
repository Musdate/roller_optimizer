# Deploy

La app son **dos piezas**: backend FastAPI (`/api`) + frontend React (build
estático de Vite). El `Dockerfile` de la raíz las junta en **una sola imagen**:
Vite compila el frontend y FastAPI lo sirve en `/`. No hace falta nada más.

`frontend/src/api.ts` usa rutas relativas (`/api`), así que funciona en el mismo
origen sin configurar URLs ni CORS.

---

## Opción A — Dokploy, un solo contenedor (recomendada)

Ya tenés VPS + Dokploy, así que esto es lo más directo.

1. **Subí el repo a GitHub** (o GitLab). Ver "Git" abajo.
2. En Dokploy: **Create Project → Create Service → Application**.
3. **Provider**: GitHub (conectá la cuenta) → elegí el repo y la rama `main`.
4. **Build Type**: `Dockerfile`. Path: `./Dockerfile`. Contexto: `.` (la raíz).
5. **Port** (Network / Ports): `8000`.
6. **Deploy**. El primer build tarda unos minutos (compila el frontend + instala
   OR-Tools).

### Sin dominio propio

Dokploy te da un dominio gratis igual:

- En la pestaña **Domains** del servicio, "Generate Domain" crea algo tipo
  `mi-app-xxxx.<IP-DEL-VPS>.sslip.io` (sslip.io/traefik.me resuelven cualquier
  IP sin registrar nada) y Traefik le saca certificado **Let's Encrypt** →
  tenés HTTPS.
- O sin dominio: en **Ports** mapeá `8000` del contenedor a, por ej., `8080` del
  host y entrá por `http://<IP-DEL-VPS>:8080` (sin HTTPS).

Cuando compres un dominio, lo agregás en **Domains** y listo (apuntá un registro
A a la IP del VPS).

### Redeploy

Cada `git push` a `main` → en Dokploy tocás **Deploy** (o activás auto-deploy con
el webhook que te da). El seed del catálogo va dentro de la imagen; si alguien
tocó "recargar" en la UI, ese caché vive en `/app/.cache` y se pierde en el
redeploy (no pasa nada, el seed está completo). Si querés que persista, agregá un
**Volume** montado en `/app/.cache`.

---

## Opción A2 — Render (u otro PaaS con disco efímero)

Mismo `Dockerfile`, sin cambios: **Web Service → Docker**, puerto `8000`.

Lo que hay que saber: el disco del contenedor **no persiste**. En el plan free
Render duerme el servicio tras ~15 min sin tráfico y al despertarlo levanta un
contenedor nuevo, así que `/app/.cache/catalog.json` desaparece y el catálogo
vuelve al seed que viene en la imagen.

No hace falta disco ni storage externo: al arrancar, el backend hace una
**puesta al día automática** (`catalog.autosync_async()`, ver RULES.md §6.1) que
vuelve a bajar el catálogo (~9 páginas de `/api/Miner`, segundos) en segundo
plano y lo mezcla con el seed.

- Para que el seed de la imagen no envejezca, cada tanto corre
  `python scripts/build_seed.py` (cwd = `backend/`) y commitea
  `app/data/catalog_seed.json`.

**Variable de entorno recomendada:** `OPT_WORKERS=1` (o `2` en un plan con 1
CPU completa). Por defecto el solver usa 8 workers; con una fracción de CPU
compiten entre sí y rinden mucho peor (RULES.md §7.5). Con un inventario real de
155 modelos y 1 worker, la optimización termina en ~30 s con el bruto demostrado
óptimo.

**Variable de entorno requerida para "Excavación SFL":** `SFL_API_KEY` (API key
del API comunitario de Sunflower Land; requiere VIP y Bumpkin nivel 50+, se saca
en `sunflower-land.com/community-docs`). En local basta con `backend/.env`
(ignorado por git). Sin ella la pestaña responde 503 y el resto de la app sigue
igual (RULES.md §11.6).

---

## Opción B — `docker compose` a mano en el VPS (sin Dokploy)

```bash
git clone <repo> && cd optimizador_roller
docker build -t roller-opt .
docker run -d --name roller-opt --restart unless-stopped -p 8080:8000 roller-opt
```

Para HTTPS ponéle un Caddy/nginx delante. Es básicamente lo que hace Dokploy a
mano, así que usá A salvo que quieras sacarte Dokploy de encima.

---

## Opción C — frontend en un CDN + backend en el VPS

Si querés la UI en Cloudflare Pages / Vercel / Netlify (gratis, CDN):

1. **Backend** en el VPS con Dokploy, pero build solo del backend (necesitarías
   un `Dockerfile` que no copie `./static`, o `docker compose` con solo el
   servicio de la API). Exponelo con dominio → `https://api.tu-dominio`.
2. **CORS**: en `backend/app/main.py` cambiá `allow_origins=["*"]` por la URL del
   frontend.
3. **Frontend**: en el hosting estático, build command `npm run build`, output
   `frontend/dist`, y en `frontend/src/api.ts` cambiá `const BASE = "/api"` por
   `const BASE = "https://api.tu-dominio/api"`.

Más partes móviles y necesitás dominio. Solo vale la pena si te importa que la
UI esté en un CDN global.

---

## Recomendación

**Opción A.** Una imagen, un servicio, dominio + HTTPS gratis con sslip.io, y el
día que tengas dominio propio lo agregás sin tocar código.

---

## Git (primer push)

```bash
cd optimizador_roller
git add -A
git commit -m "Optimizador de sala RollerCoin"
git branch -M main
git remote add origin git@github.com:<usuario>/<repo>.git
git push -u origin main
```

Lo que **no** se sube (ya en `.gitignore`): `.venv/`, `node_modules/`,
`frontend/dist/`, `backend/.cache/`, `backend/static/`. Lo que **sí** y es
importante: `backend/app/data/catalog_seed.json` (1.8 MB, el catálogo completo).
