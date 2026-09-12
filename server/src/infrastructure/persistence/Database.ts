import type { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// `node:sqlite` is resolved at runtime rather than with a static import:
// bundlers (Vitest/Vite included) still strip the `node:` prefix for this
// module and then fail to find it, because it is only exposed under the
// prefixed name. `createRequire` sidesteps that without a build plugin.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync: SqliteDatabase } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

/**
 * SQLite via Node's built-in `node:sqlite` (Node >= 22.5).
 *
 * Chosen over better-sqlite3/Prisma on purpose: no native build step and no
 * codegen, so `npm install && npm run dev` works on a clean machine with no
 * toolchain. The cost is a Node version floor, which is documented in README.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new SqliteDatabase(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS problems (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  definition  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id             TEXT PRIMARY KEY,
  problem_id     TEXT NOT NULL REFERENCES problems(id),
  learner_id     TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status         TEXT NOT NULL,
  format         TEXT NOT NULL,
  draft_json     TEXT NOT NULL,
  submission_json TEXT,
  evaluation_id  TEXT,
  failure_json   TEXT,
  failure_count  INTEGER NOT NULL DEFAULT 0,
  carried_focus  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_learner_problem
  ON attempts(learner_id, problem_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);

CREATE TABLE IF NOT EXISTS evaluations (
  id              TEXT PRIMARY KEY,
  attempt_id      TEXT NOT NULL UNIQUE REFERENCES attempts(id),
  rubric_version  TEXT NOT NULL,
  evaluator_id    TEXT NOT NULL,
  evaluator_kind  TEXT NOT NULL,
  evaluator_label TEXT NOT NULL,
  overall         REAL NOT NULL,
  summary         TEXT NOT NULL,
  next_focus      TEXT NOT NULL,
  criteria_json   TEXT NOT NULL,
  structural_json TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
`;

function migrate(db: DatabaseSync): void {
  db.exec(SCHEMA);
}
