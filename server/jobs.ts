// Housekeeping, at startup and every 24 h: monthly partitions of the auth audit table, and anonymizing
// accounts whose deletion grace period is over.
import { anonymizeExpired } from './accounts';
import type { Db } from './db';

const DAY_MS = 86400_000;

const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

/** Creates auth_event partitions for this month and the next two (no-op when they exist). */
export async function ensureAuditPartitions(db: Db) {
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + i;
    const from = monthStart(y, m);
    const to = monthStart(y, m + 1);
    const name = `auth_event_${from.slice(0, 7).replace('-', '')}`;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS ${name} PARTITION OF auth_event FOR VALUES FROM ('${from}') TO ('${to}')`);
    } catch (err) {
      // Rows of that month already landed in the default partition: they stay there.
      console.error(`[jobs] partição ${name}:`, (err as Error).message);
    }
  }
}

export async function runJobs(db: Db) {
  await ensureAuditPartitions(db);
  const n = await anonymizeExpired(db);
  if (n) console.log(`[jobs] ${n} conta(s) anonimizada(s)`);
}

/** Runs the jobs now and every day; returns a stop function. */
export function scheduleJobs(db: Db): () => void {
  const run = () => runJobs(db).catch((err) => console.error('[jobs]', (err as Error).message));
  void run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
