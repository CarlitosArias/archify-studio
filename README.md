# Archify Studio

Editor de diagramas que reutiliza el **motor de Archify**: escribes un **JSON simple**
(nodos + `"origen -> destino: etiqueta"`) en un panel de texto y, al lado, ves en vivo
el **HTML/SVG que Archify genera** — la misma salida que exportas. Sin canvas ni
arrastre: describes la estructura, el auto-layout de Archify la dibuja bonita.

Derivado de Archify (tt-a1i/archify, MIT). El motor está vendorizado en `engine/`.

## Enfoque: editor JSON + preview en vivo

El formato simple oculta el JSON verboso de Archify (lane/col/pos/mainPath/viewBox):
un traductor (`backend/simple.mjs`) infiere el layout por tipo y expande al spec real,
que el motor compila a HTML. Soporta los 5 tipos: architecture, workflow, sequence,
dataflow, lifecycle.

```json
{
  "type": "architecture",
  "title": "Mi App Web",
  "nodes": [
    { "id": "api", "label": "API", "type": "backend", "sub": "FastAPI :8000" }
  ],
  "links": ["users -> api: HTTPS", "api -> db: SQL"],
  "groups": [{ "label": "AWS us-west-2", "wraps": ["api", "db"] }]
}
```

## Arquitectura

```
frontend (Vite + React)                     backend (Fastify)                 engine (Archify)
  editor de texto JSON simple      ──POST /api/render-simple/:type──►  simple.mjs expande → spec
  iframe con el HTML de Archify     ◄──────── HTML ──────────────────  → deliver → HTML autocontenido
  Guardar/Cargar (Mis diagramas)   ──── /api/diagrams (SQLite) ─────  persiste el JSON simple
```

- **engine/**: copia autónoma del bundle Archify. El núcleo de layout es JS puro (sin
  deps npm de runtime). `renderers/workflow/workflow-compiler.mjs` exporta
  `compileWorkflow({ workflow, qualityProfile })` → `{ ok, svg, receipt }`, donde
  `receipt` es geometría pura: `viewBox`, `nodes[{id,x,y,width,height,lane,col}]`,
  `edges[{id,from,to,points:[[x,y]…]}]`, `labels[]`.
- **backend/** (puerto 4319, 127.0.0.1): traduce el JSON simple al spec de Archify
  (`simple.mjs`) y genera el HTML vía el CLI. Endpoints `POST /render-simple/:type`
  (HTML inline para el preview), `POST /export-simple/:type` (descargable),
  `GET/POST/PUT/DELETE /diagrams` (persistencia en SQLite, archivo local), `GET /health`.
  La persistencia es autocontenida: `node:sqlite` (Node 22+) crea `backend/archify.db`
  al arrancar, sin servidor ni configuración. Si el archivo no se puede crear, el editor
  funciona igual (layout/render/export); solo se desactiva "Mis diagramas".
- **frontend/** (puerto 5319, 127.0.0.1): editor de texto JSON a la izquierda, iframe
  con el HTML de Archify a la derecha (se re-renderiza 600ms tras dejar de escribir).
  Sin canvas: describes la estructura, el auto-layout de Archify la dibuja.

## Formato JSON simple (referencia)

Campos comunes a los 5 tipos:

- `type` — architecture | workflow | sequence | dataflow | lifecycle
- `title` — título del diagrama
- `nodes` — `[{ id, label, type, sub?, tag? }]`. `type` es la categoría visual del nodo
  (frontend, backend, database, cloud, security, messagebus, external; en lifecycle:
  start, active, waiting, decision, success, failure, neutral, external). `sub` = sublabel;
  `tag` = insignia corta sobre el nodo.
- `links` — aristas como texto: `"origen -> destino: etiqueta {variant}"`. La etiqueta y
  la variante son opcionales. Variantes: `{emphasis}` (resaltada), `{dashed}` (punteada),
  `{security}` (acento de seguridad), y roles `{async} {return} {error}` (color según rol).
- `cards` — tarjetas de leyenda al pie: `[{ dot, title, items:[...] }]`. `dot`: cyan,
  emerald, rose, etc. Aplican a los 5 tipos.

Agrupadores/segmentos por tipo (opcionales):

- **architecture** → `groups: [{ label, kind?, wraps:[ids] }]` (caja punteada; kind region|security-group).
- **workflow** → `phases: [{ id, label, fromCol, toCol, variant? }]` (bandas por columnas 0–5) y `groups`.
- **dataflow** → `stages: [...]` + `stage`/`stageLabel` por nodo (ver abajo).
- **sequence** → `segments: ["Petición", "Resolución", ...]` (bandas horizontales del eje temporal).
- lifecycle → sin agrupación de caja (los estados van en una línea; máx 5).

> El **template de cada tipo** (botón "Cargar ejemplo" o selector) trae TODAS sus
> capacidades cargadas, para ver de un vistazo qué se puede hacer y borrar lo que no uses.

### Agrupación (difiere por tipo)

- **architecture** → `groups: [{ label, kind?, wraps: [ids] }]` — caja punteada que
  envuelve los nodos listados en `wraps`. `kind`: `region` (defecto) o `security-group`.
- **workflow** → `groups: [{ label, lane, fromCol, toCol, variant? }]` — banda dentro
  de un carril; `variant: "dashed"` la hace punteada.
- **dataflow** → `stages` (columnas etiquetadas), ver abajo.
- sequence / lifecycle → no tienen agrupación de este tipo.

### dataflow: stages (columnas) y cómo asignar nodos

`stages` es la lista ordenada de columnas ("01 / Producers", "02 / Transport", …).
Cada nodo cae en una columna de tres formas (en orden de prioridad):

1. **`stage` explícito** (índice, 0 = primera columna) — control total.
2. **`stageLabel` explícito** (texto que coincide con una etiqueta de `stages`).
3. **Inferencia automática** — si el nodo no trae ninguno, su columna = su distancia
   desde el inicio siguiendo la cadena de `links` (los nodos sin predecesor → columna 0).

Ejemplo: dos productores forzados en "Producers" (columna 0):

```json
{
  "type": "dataflow",
  "title": "Order Event Stream",
  "stages": ["Producers", "Transport", "Processors", "Consumers"],
  "nodes": [
    { "id": "checkout", "label": "Checkout API", "type": "backend", "stage": 0 },
    { "id": "billing",  "label": "Billing API",  "type": "backend", "stage": 0 },
    { "id": "bus",      "label": "Event Bus",    "type": "messagebus", "sub": "Kafka", "stage": 1 },
    { "id": "proc",     "label": "Stream Processor", "type": "backend", "stage": 2 },
    { "id": "dw",       "label": "Warehouse",    "type": "database", "stage": 3 }
  ],
  "links": [
    "checkout -> bus: order.created",
    "billing -> bus: invoice.issued",
    "bus -> proc: consume",
    "proc -> dw: agregados"
  ]
}
```

`stage: 0` en Checkout y Billing los mantiene juntos en "01 / Producers" aunque no
tengan predecesor entre sí. Equivalente con etiqueta: `"stageLabel": "Producers"`.

## Correr en local

Sin configuración previa: la persistencia es SQLite (archivo local, `node:sqlite`).
Requiere **Node 22+** (SQLite nativo).

```bash
# 1) backend  — crea backend/archify.db solo al arrancar
cd backend && npm install && npm run dev      # http://127.0.0.1:4319

# 2) frontend (otra terminal)
cd frontend && npm install && npm run dev     # http://127.0.0.1:5319
```

El frontend proxya `/api/*` al backend (ver `frontend/vite.config.mjs`).
El archivo `backend/archify.db` guarda "Mis diagramas"; para cambiar su ruta define
`DATABASE_FILE` en `backend/.env` (opcional). Si el archivo no se puede crear, el editor
funciona igual y solo se desactiva "Mis diagramas".

## Despliegue (producción)

En producción el backend sirve el `dist/` del frontend en el MISMO origen, así que no
hay dos servidores ni proxy: un solo proceso Node en un puerto.

### Con Docker (recomendado)

Un solo comando con Compose:

```bash
docker compose up --build
# abre http://localhost:4319
```

O manualmente:

```bash
docker build -t archify-studio .
docker run -p 4319:4319 -v archify-data:/data archify-studio
# abre http://localhost:4319
```

El `Dockerfile` es multi-stage: compila el frontend (`vite build`) y luego corre solo el
backend sirviendo la API + el `dist/`. La BD SQLite vive en el volumen `/data` (persiste
entre reinicios). Variables: `HOST` (default 0.0.0.0 en el contenedor), `PORT` (4319),
`DATABASE_FILE` (`/data/archify.db`), `CORS_ORIGIN` (ver abajo).

### Sin Docker

```bash
cd frontend && npm ci && npm run build     # genera frontend/dist
cd ../backend && npm ci --omit=dev
HOST=0.0.0.0 PORT=4319 node server.mjs     # sirve API + dist en el mismo puerto
```

### CORS

- **Mismo origen** (backend sirve el frontend): NO definas `CORS_ORIGIN` — no se necesita
  y la API no acepta orígenes externos (seguro por defecto).
- **Frontend en otro dominio**: define `CORS_ORIGIN=https://tu-front.example` (lista
  separada por comas para varios). Solo esos orígenes podrán llamar la API.

## Roadmap

- **Fase 0** — ciclo editar→re-layout→pintar con `workflow`. ✅ hecha
- **Fase 1** — interacción real: CRUD de nodos/aristas, editar labels/sublabels/tipo/lane/col,
  selección en el lienzo y panel lateral de edición. ✅ hecha. El editor coloca nodos nuevos en
  celdas (lane,col) libres y clampa col a 0–5 para respetar el schema; los diagnósticos de
  compilación se muestran en la barra superior sin perder el último layout válido. Export al HTML
  interactivo de Archify vía `POST /export/workflow` (botón "⬇ Exportar HTML"): el backend invoca
  `deliver` a un temp y devuelve el HTML autocontenido como descarga. ✅ Fase 1 completa.
- **Fase 2** — soporte de `architecture` ✅. Se refactorizó `engine/renderers/architecture/render-architecture.mjs`
  para exponer `compileArchitecture({architecture, qualityProfile})` (misma forma que `compileWorkflow`),
  con el CLI preservado tras un guard `isMain`. El backend expone `/layout/:type` y `/export/:type`
  genéricos; el frontend tiene un selector workflow/architecture. Además:
  - **Arrastrar nodos** ✅: soltar un nodo lo re-homea por intención — en workflow ajusta su (lane,col)
    a la celda más cercana; en architecture actualiza su `pos`. El auto-layout recalcula tras soltar.
  - **Persistencia local** ✅: Guardar/Cargar por tipo en localStorage, más importar/exportar el JSON del
    spec (⬆ Importar / ⬇ JSON). "Cargar ejemplo" restablece el seed.
  - `sequence`, `dataflow` y `lifecycle` ✅: mismo refactor del motor (cada `render-<tipo>.mjs`
    expone `compileSequence` / `compileDataflow` / `compileLifecycle`, CLI preservado). El backend
    los registra en la tabla de compiladores y el frontend los pinta vía `TYPE_CONFIG` (tabla que
    mapea, por tipo, las claves de nodos/aristas del spec y del receipt). Los 5 tipos: layout + export
    HTML verificados. **Creación de nodos ampliada a los 5 tipos**, cada uno generando los campos de
    layout que su schema exige para compilar: workflow (lane/col en celda libre), architecture (libre +
    drag de `pos`), sequence (participant + ensancha `meta.viewBox`, message con `y` incremental),
    dataflow (nodo en un stage con predecesor en (stage-1, misma row) + flow corto que no cruza el
    grid), lifecycle (state en lane con banda propia main/terminal, col libre). Cuando una edición no
    compila, el diagnóstico de Archify se muestra y el usuario ajusta desde el panel.
- **Fase 3** — persistencia multiusuario + hosting.
  - **3a persistencia server-side** ✅: SQLite embebido (`better-sqlite3`). Tabla `diagrams` (ver
    `backend/schema.sql`), auto-creada idempotente por `initDb()` al arrancar. Endpoints CRUD
    `GET/POST/PUT/DELETE /diagrams` en `backend/db.mjs`. El archivo `backend/archify.db` se crea solo
    (ruta configurable con `DATABASE_FILE`); no requiere ninguna BD externa. Si el disco no deja crear
    el archivo, la persistencia se desactiva y `/diagrams` responde 503 (layout/export siguen
    funcionando). El frontend tiene un desplegable "Mis diagramas" (Guardar server-side POST/PUT,
    Cargar, Eliminar);
  - **3b auth/multiusuario** — descartado. El objetivo no es login: es que cualquiera pueda **clonar
    el repo y correrlo** sin configurar una BD externa. La app es de un solo espacio de trabajo por
    despliegue; `owner_id` queda como columna latente por si algún día se necesita.
  - **3c hosting** ✅: despliegue local con Docker (`docker compose up --build`, puerto 4319, volumen
    `archify-data`), pensado para correr en tu propio homelab por LAN.

## Notas de diseño

- El HTML final de Archify sigue siendo el entregable "bonito"; el editor produce el JSON
  tipado que lo alimenta. La edición es sobre estructura, no sobre píxeles.
- Tensión de fondo: draw.io es free-form (coordenadas absolutas); Archify es auto-layout
  (calcula coordenadas, rechaza cruces). Este proyecto elige que el auto-layout mande, a
  cambio de diagramas que siempre se ven bien.

## Créditos y licencia

**Archify Studio se construye sobre [Archify](https://github.com/tt-a1i/archify)**, un
generador de diagramas de código abierto (MIT). Archify es el **motor**: convierte un JSON
tipado en el HTML/SVG autocontenido que ves en el preview y exportas. Vive sin modificar en
[`engine/`](engine/), con su licencia y avisos de terceros intactos
([`engine/LICENSE`](engine/LICENSE), [`engine/THIRD_PARTY_NOTICES.md`](engine/THIRD_PARTY_NOTICES.md)).

Este repositorio **añade** sobre ese motor: el formato JSON simple y su traductor
(`backend/simple.mjs`), el backend Fastify que orquesta el motor, el editor web (Vite + React)
con preview en vivo, la persistencia SQLite y el despliegue contenedorizado. Archify Studio no
modifica el motor: lo consume como dependencia.

- Trabajo derivado (backend/frontend/despliegue): MIT — ver [`LICENSE`](LICENSE).
- Motor Archify (`engine/`): MIT © tt-a1i (Archify) · Cocoon AI.
- Detalle completo de atribución: [`NOTICE`](NOTICE).
