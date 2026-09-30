// Offensive Combat game server: accounts API + lobby + free-for-all sessions over WebSocket (section 14).
//
//   docker compose up -d banco redis   PostgreSQL and Redis (needed for accounts)
//   npm run server         API and WebSocket on :8787 (Vite's dev server proxies /api and /ws to it)
//   npm run build && npm start   one port for everything: serves dist/, the API and the WebSocket
//   HOST=127.0.0.1 PORT=8787     behind nginx (deploy/): only nginx is reachable from outside
import { NET } from '@shared/protocol';
import { startServer } from './app';

const PORT = Number(process.env.PORT ?? NET.port);
const HOST = process.env.HOST ?? '0.0.0.0';

const game = await startServer({ port: PORT, host: HOST }).catch((err) => {
  console.error(`[servidor] não subiu: ${(err as Error).message}`);
  console.error('[servidor] O banco e o Redis estão rodando? docker compose up -d banco redis');
  process.exit(1);
});
console.log(`[servidor] Offensive Combat em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${game.port}  (WebSocket ${NET.path}, API /api)`);

// Containers and process managers stop with SIGTERM: close sockets so players see "connection lost".
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    setTimeout(() => process.exit(0), 3000).unref();
    game.close().finally(() => process.exit(0));
  });
}
