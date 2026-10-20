import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ensureDirs } from '../lib/env.ts';

export type Row = Record<string, unknown>;

export function configure(db: DatabaseSync): DatabaseSync {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  return db;
}

// Next.js reloads modules in dev; keep one connection on the global object.
const g = globalThis as unknown as { __cc_db?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__cc_db) {
    ensureDirs();
    const conn = configure(new DatabaseSync(DB_PATH));
    const ready = conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    if (!ready) {
      throw new Error(
        'Database not migrated. Run `npm run migrate` before starting the app.',
      );
    }
    g.__cc_db = conn;
  }
  return g.__cc_db;
}

/** Run `fn` inside a transaction. Rolls back on any throw. */
export function tx<T>(fn: (d: DatabaseSync) => T): T {
  const d = db();
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* transaction already unwound */ }
    throw err;
  }
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as T[];
}
export function one<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...(params as never[])) as T | undefined;
}
export function run(sql: string, ...params: unknown[]): void {
  db().prepare(sql).run(...(params as never[]));
}
