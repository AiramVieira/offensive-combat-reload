// Fresh test database and Redis db before the run (bunfig.toml preloads this once, before any test file).
import pg from 'pg';
import { Redis } from 'ioredis';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';

const url = new URL(TEST_DATABASE_URL);
const dbName = url.pathname.slice(1);
const admin = new URL(TEST_DATABASE_URL);
admin.pathname = '/postgres';
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await c.query(`CREATE DATABASE ${dbName}`);
await c.end();
const r = new Redis(TEST_REDIS_URL);
await r.flushdb();
r.disconnect();
