import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIAGRAM_TYPES = ['workflow', 'architecture', 'sequence', 'dataflow', 'lifecycle'];

let db = null;

export function isEnabled() {
  return db !== null;
}

export function initDb() {
  const configured = process.env.DATABASE_FILE || 'archify.db';
  const file = isAbsolute(configured) ? configured : join(HERE, configured);
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  db = database;
  return { file };
}

export function listDiagrams() {
  return db.prepare('SELECT id, name, type, updated_at FROM diagrams ORDER BY updated_at DESC').all();
}

export function getDiagram(id) {
  const row = db.prepare('SELECT id, name, type, spec, created_at, updated_at FROM diagrams WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, spec: JSON.parse(row.spec) };
}

export function createDiagram({ name, type, spec }) {
  if (!DIAGRAM_TYPES.includes(type)) throw new Error(`tipo inválido: ${type}`);
  const id = randomUUID();
  db.prepare('INSERT INTO diagrams (id, name, type, spec) VALUES (?, ?, ?, ?)').run(id, name, type, JSON.stringify(spec));
  return db.prepare('SELECT id, name, type, updated_at FROM diagrams WHERE id = ?').get(id);
}

export function updateDiagram(id, { name, spec }) {
  const current = db.prepare('SELECT id FROM diagrams WHERE id = ?').get(id);
  if (!current) return null;
  db.prepare(
    `UPDATE diagrams
       SET name = COALESCE(?, name),
           spec = COALESCE(?, spec),
           updated_at = datetime('now')
     WHERE id = ?`
  ).run(name ?? null, spec !== undefined ? JSON.stringify(spec) : null, id);
  return db.prepare('SELECT id, name, type, updated_at FROM diagrams WHERE id = ?').get(id);
}

export function deleteDiagram(id) {
  const info = db.prepare('DELETE FROM diagrams WHERE id = ?').run(id);
  return info.changes > 0;
}
