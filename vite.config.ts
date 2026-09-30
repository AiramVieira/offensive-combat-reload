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
    // The game server runs separately in dev (npm run server); proxy its WebSocket to keep one origin.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
});
