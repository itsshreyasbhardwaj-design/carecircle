import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Each worker gets its own process, so each gets its own database file
    // (tests/setup.ts makes a fresh temp directory per worker).
    pool: 'forks',
    // Argon2id is deliberately expensive — 19 MiB and ~0.5s per hash. Left
    // unbounded, a dozen workers hashing at once starve each other and the
    // account suite times out. Four keeps the suite CPU-bound but predictable.
    maxWorkers: 4,
    testTimeout: 60_000,
  },
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
});
