import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/db/migrate.ts';
import { configure } from '../src/db/index.ts';
import { DB_PATH, ensureDirs } from '../src/lib/env.ts';

ensureDirs();
const db = configure(new DatabaseSync(DB_PATH));
const ran = migrate(db);
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'schema up to date');
const n = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type IN ('table','index')").get() as { n: number };
console.log(`${n.n} schema objects in ${DB_PATH}`);
db.close();
