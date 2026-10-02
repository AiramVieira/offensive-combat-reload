// PostgreSQL pool and migrations. Migrations are the numbered .sql files in server/migrations (the
// .down.sql files are manual rollbacks); each runs once, in a transaction, recorded in schema_migrations.
import { join } from 'node:path';
import pg from 'pg';

// Resolves to <repo>/server/migrations both from server/db.ts (dev) and from build/server.js (production).
const MIGRATIONS = join(import.meta.dir, '..', 'server', 'migrations');

export type Db = pg.Pool;
export type Queryable = pg.Pool | pg.PoolClient;

export function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => console.error('[banco] conexão ociosa falhou:', err.message));
  return pool;
}

export async function migrate(db: Db) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await Array.fromAsync(new Bun.Glob('*.sql').scan(MIGRATIONS))).filter((f) => /^\d+_.+\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await Bun.file(join(MIGRATIONS, file)).text();
    await transaction(db, async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`[banco] migration aplicada: ${file}`);
  }
}

export async function transaction<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
