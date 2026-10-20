import { DatabaseSync } from 'node:sqlite';
import { configure, db } from '../src/db/index.ts';
import { migrate } from '../src/db/migrate.ts';
import { DB_PATH, ensureDirs } from '../src/lib/env.ts';
import { registerUser } from '../src/lib/accounts.ts';
import { newId } from '../src/lib/ids.ts';
import { nowIso } from '../src/lib/time.ts';

let migrated = false;

/** Applies migrations once per worker, then truncates between tests. */
export function resetDb(): void {
  if (!migrated) {
    ensureDirs();
    const boot = configure(new DatabaseSync(DB_PATH));
    migrate(boot);
    boot.close();
    migrated = true;
  }
  const d = db();
  d.exec('PRAGMA foreign_keys = OFF');
  const tables = d
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'
       AND name NOT LIKE 'document_search%'`,
    )
    .all() as { name: string }[];
  for (const t of tables) d.exec(`DELETE FROM "${t.name}"`);
  d.exec("DELETE FROM document_search");
  d.exec('PRAGMA foreign_keys = ON');
}

let n = 0;
export function makeUser(name = 'Test Person') {
  n += 1;
  const email = `user${n}.${process.pid}@example.test`;
  const result = registerUser({ email, password: 'correct horse battery staple', fullName: name });
  if (!result.ok) throw new Error(result.error);
  return { ...result.user, password: 'correct horse battery staple' };
}

/** A self-managed care profile owned by `userId`. */
export function makeProfile(userId: string, displayName = 'Self', isSelf = true): string {
  const id = newId('prf');
  db()
    .prepare(
      `INSERT INTO care_profiles
       (id, owner_user_id, display_name, relationship, is_self, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(id, userId, displayName, isSelf ? 'self' : 'parent', isSelf ? 1 : 0, nowIso(), nowIso());
  return id;
}
