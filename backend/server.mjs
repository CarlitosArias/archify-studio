import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { compileWorkflow } from '../engine/renderers/workflow/workflow-compiler.mjs';
import { compileArchitecture } from '../engine/renderers/architecture/render-architecture.mjs';
import { compileSequence } from '../engine/renderers/sequence/render-sequence.mjs';
import { compileDataflow } from '../engine/renderers/dataflow/render-dataflow.mjs';
import { compileLifecycle } from '../engine/renderers/lifecycle/render-lifecycle.mjs';
import * as db from './db.mjs';
import { expand } from './simple.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(HERE, '..', 'engine');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 4319;
// CORS_ORIGIN vacío = mismo origen (el backend sirve el frontend); lista separada por comas para orígenes explícitos.
const CORS_ORIGIN = process.env.CORS_ORIGIN;

const COMPILERS = {
  workflow: (d, q) => compileWorkflow({ workflow: d, qualityProfile: q }),
  architecture: (d, q) => compileArchitecture({ architecture: d, qualityProfile: q }),
  sequence: (d, q) => compileSequence({ sequence: d, qualityProfile: q }),
  dataflow: (d, q) => compileDataflow({ dataflow: d, qualityProfile: q }),
  lifecycle: (d, q) => compileLifecycle({ lifecycle: d, qualityProfile: q })
};

const app = Fastify({
  logger: true,
  bodyLimit: 2 * 1024 * 1024,
  // En dev el proxy de Vite quita el prefijo /api; servido desde el mismo origen (prod)
  // no hay proxy, así que lo normalizamos ANTES del routing para que las rutas coincidan.
  rewriteUrl: (req) => {
    if (req.url.startsWith('/api/')) return req.url.slice(4);
    if (req.url === '/api') return '/';
    return req.url;
  }
});
await app.register(cors, {
  origin: CORS_ORIGIN ? CORS_ORIGIN.split(',').map((o) => o.trim()) : false
});

app.get('/health', async () => ({ ok: true, engine: 'archify', renderers: Object.keys(COMPILERS) }));

app.post('/layout/:type', async (request, reply) => {
  const { type } = request.params;
  const compile = COMPILERS[type];
  if (!compile) return reply.code(404).send({ ok: false, error: `tipo no soportado: ${type}` });

  const { diagram, qualityProfile = 'standard' } = request.body ?? {};
  if (!diagram || typeof diagram !== 'object') {
    return reply.code(400).send({ ok: false, error: 'body.diagram (objeto JSON) es requerido' });
  }

  const result = compile(diagram, qualityProfile);
  if (!result?.ok) {
    return reply.code(422).send({ ok: false, error: 'compilacion fallida', diagnostics: result?.diagnostics ?? [] });
  }
  return { ok: true, receipt: result.receipt, svg: result.svg };
});

const RENDER_CACHE = new Map();
const RENDER_CACHE_MAX = 100;
let renderInFlight = 0;
const RENDER_MAX_CONCURRENCY = 4;
const renderQueue = [];

const cacheKey = (type, diagram) => `${type}:${createHash('sha1').update(JSON.stringify(diagram)).digest('hex')}`;

function acquireRenderSlot() {
  if (renderInFlight < RENDER_MAX_CONCURRENCY) { renderInFlight++; return Promise.resolve(); }
  return new Promise((resolve) => renderQueue.push(resolve));
}
function releaseRenderSlot() {
  renderInFlight--;
  const next = renderQueue.shift();
  if (next) { renderInFlight++; next(); }
}

async function renderHtml(type, diagram) {
  const key = cacheKey(type, diagram);
  const cached = RENDER_CACHE.get(key);
  if (cached) { RENDER_CACHE.delete(key); RENDER_CACHE.set(key, cached); return cached; }

  await acquireRenderSlot();
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { spawn } = await import('node:child_process');
  const work = await mkdtemp(join(tmpdir(), 'archify-export-'));
  const specPath = join(work, 'spec.json');
  const outPath = join(work, 'diagram.html');
  try {
    await writeFile(specPath, JSON.stringify(diagram), 'utf8');
    const run = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['bin/archify.mjs', 'deliver', type, specPath, outPath, '--json'], { cwd: ENGINE_DIR });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (c) => resolve({ c, stderr }));
    });
    if (run.c !== 0) return { ok: false, detail: run.stderr.slice(0, 800) };
    const result = { ok: true, html: await readFile(outPath, 'utf8') };
    RENDER_CACHE.set(key, result);
    if (RENDER_CACHE.size > RENDER_CACHE_MAX) RENDER_CACHE.delete(RENDER_CACHE.keys().next().value);
    return result;
  } finally {
    await rm(work, { recursive: true, force: true });
    releaseRenderSlot();
  }
}

app.post('/export/:type', async (request, reply) => {
  const { type } = request.params;
  if (!COMPILERS[type]) return reply.code(404).send({ ok: false, error: `tipo no soportado: ${type}` });
  const { diagram } = request.body ?? {};
  if (!diagram || typeof diagram !== 'object') {
    return reply.code(400).send({ ok: false, error: 'body.diagram es requerido' });
  }
  const r = await renderHtml(type, diagram);
  if (!r.ok) return reply.code(422).send({ ok: false, error: 'deliver fallo', detail: r.detail });
  reply.header('Content-Type', 'text/html; charset=utf-8');
  reply.header('Content-Disposition', 'attachment; filename="diagram.html"');
  return reply.send(r.html);
});

// Traduce JSON simple -> spec Archify -> HTML inline para el preview del editor.
app.post('/render-simple/:type', async (request, reply) => {
  const { type } = request.params;
  if (!COMPILERS[type]) return reply.code(404).send({ ok: false, error: `tipo no soportado: ${type}` });
  const { simple } = request.body ?? {};
  if (!simple || typeof simple !== 'object') return reply.code(400).send({ ok: false, error: 'body.simple es requerido' });
  let spec;
  try {
    spec = expand({ ...simple, type });
  } catch (e) {
    return reply.code(422).send({ ok: false, error: e.message });
  }
  const r = await renderHtml(type, spec);
  if (!r.ok) return reply.code(422).send({ ok: false, error: 'el diagrama no compila', detail: r.detail });
  reply.header('Content-Type', 'text/html; charset=utf-8');
  return reply.send(r.html);
});

app.post('/export-simple/:type', async (request, reply) => {
  const { type } = request.params;
  if (!COMPILERS[type]) return reply.code(404).send({ ok: false, error: `tipo no soportado: ${type}` });
  const { simple } = request.body ?? {};
  if (!simple || typeof simple !== 'object') return reply.code(400).send({ ok: false, error: 'body.simple es requerido' });
  let spec;
  try {
    spec = expand({ ...simple, type });
  } catch (e) {
    return reply.code(422).send({ ok: false, error: e.message });
  }
  const r = await renderHtml(type, spec);
  if (!r.ok) return reply.code(422).send({ ok: false, error: 'el diagrama no compila', detail: r.detail });
  reply.header('Content-Type', 'text/html; charset=utf-8');
  reply.header('Content-Disposition', 'attachment; filename="diagram.html"');
  return reply.send(r.html);
});

app.get('/seed/:type', async (request, reply) => {
  const { type } = request.params;
  const seeds = {
    workflow: 'seed.workflow.json',
    architecture: 'seed.architecture.json',
    sequence: 'seed.sequence.json',
    dataflow: 'seed.dataflow.json',
    lifecycle: 'seed.lifecycle.json'
  };
  if (!seeds[type]) return reply.code(404).send({ ok: false, error: `sin seed para ${type}` });
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(join(HERE, seeds[type]), 'utf8');
  return JSON.parse(raw);
});

const requireDb = (reply) => {
  if (db.isEnabled()) return true;
  reply.code(503).send({ ok: false, error: 'persistencia no disponible (no se pudo abrir la base SQLite)' });
  return false;
};

app.get('/diagrams', async (_req, reply) => {
  if (!requireDb(reply)) return;
  return { ok: true, diagrams: await db.listDiagrams() };
});

app.get('/diagrams/:id', async (request, reply) => {
  if (!requireDb(reply)) return;
  const row = await db.getDiagram(request.params.id);
  if (!row) return reply.code(404).send({ ok: false, error: 'no encontrado' });
  return { ok: true, diagram: row };
});

app.post('/diagrams', async (request, reply) => {
  if (!requireDb(reply)) return;
  const { name, type, spec } = request.body ?? {};
  if (!name || !type || !spec) {
    return reply.code(400).send({ ok: false, error: 'name, type y spec son requeridos' });
  }
  if (!COMPILERS[type]) return reply.code(400).send({ ok: false, error: `tipo no soportado: ${type}` });
  try {
    return { ok: true, diagram: await db.createDiagram({ name, type, spec }) };
  } catch (e) {
    return reply.code(400).send({ ok: false, error: String(e.message ?? e) });
  }
});

app.put('/diagrams/:id', async (request, reply) => {
  if (!requireDb(reply)) return;
  const { name, spec } = request.body ?? {};
  const row = await db.updateDiagram(request.params.id, { name, spec });
  if (!row) return reply.code(404).send({ ok: false, error: 'no encontrado' });
  return { ok: true, diagram: row };
});

app.delete('/diagrams/:id', async (request, reply) => {
  if (!requireDb(reply)) return;
  const removed = await db.deleteDiagram(request.params.id);
  if (!removed) return reply.code(404).send({ ok: false, error: 'no encontrado' });
  return { ok: true };
});

const DIST_DIR = join(HERE, '..', 'frontend', 'dist');
if (existsSync(DIST_DIR)) {
  await app.register(fastifyStatic, { root: DIST_DIR });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/diagrams') && !req.url.startsWith('/render') &&
        !req.url.startsWith('/export') && !req.url.startsWith('/layout') && !req.url.startsWith('/seed')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ ok: false, error: 'no encontrado' });
  });
}

try {
  try {
    const { file } = db.initDb();
    app.log.info(`SQLite listo (persistencia activa): ${file}`);
  } catch (e) {
    app.log.warn(`SQLite no disponible (${e.message}): persistencia deshabilitada, layout/render/export siguen activos`);
  }
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Archify Studio backend en http://${HOST}:${PORT}${existsSync(DIST_DIR) ? ' (sirviendo frontend/dist)' : ''}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
