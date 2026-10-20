import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration runner. Imported only by scripts/ and tests/ — never by app code, so
 * the Next bundle never has to resolve the migrations directory at runtime.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export function migrate(db: DatabaseSync): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, sha256 TEXT NOT NULL)`);
  const prior = new Map(
    (db.prepare('SELECT name, sha256 FROM schema_migrations').all() as { name: string; sha256: string }[])
      .map((r) => [r.name, r.sha256]),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    const seen = prior.get(file);
    if (seen) {
      if (seen !== sha) {
        throw new Error(
          `migration ${file} changed after being applied. Migrations are append-only: ` +
            `add a new file instead of editing this one.`,
        );
      }
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(name, applied_at, sha256) VALUES(?,?,?)')
        .run(file, new Date().toISOString(), sha);
      db.exec('COMMIT');
      ran.push(file);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return ran;
}
