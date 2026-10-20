import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must run before any src/ module is imported: env.ts reads this at load time.
process.env.CARECIRCLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'carecircle-test-'));
