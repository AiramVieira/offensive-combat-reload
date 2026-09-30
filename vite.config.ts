import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Reachable from other machines on the network, so friends can join your session.
    host: true,
    // The game server runs separately in dev (npm run server); proxy its API and WebSocket to keep one
    // origin (the session cookie and the Origin check both rely on it). xfwd passes the player's IP along.
    proxy: {
      '/api': { target: 'http://localhost:8787', xfwd: true },
      '/ws': { target: 'ws://localhost:8787', ws: true, xfwd: true },
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
