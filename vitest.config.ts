// Server tests (npm test). They need the database and Redis from docker compose (docker compose up -d
// banco redis) and use their own database (oc_teste) and Redis db 1, recreated on every run.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['server/tests/globalSetup.ts'],
    // One game server per file, all on the same database: run the files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
