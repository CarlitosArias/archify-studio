-- Archify Studio — esquema de persistencia (SQLite, sin servidor).
-- Se aplica idempotente al arrancar el backend (initDb). Seguro de re-correr.

CREATE TABLE IF NOT EXISTS diagrams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('workflow','architecture','sequence','dataflow','lifecycle')),
  spec        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_diagrams_type ON diagrams (type);
