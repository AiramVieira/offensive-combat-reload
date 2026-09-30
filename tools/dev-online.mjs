// Starts the game server (with reload on changes) and Vite together: `npm run dev:online`.
// Friends on the same network open http://<your-ip>:5173 (Vite prints the Network address).
import { spawn } from 'node:child_process';

const run = (label, command) => {
  // One command string through the shell works on Windows (npx.cmd) and Unix alike.
  const child = spawn(command, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const prefix = (data) => String(data).split(/\r?\n/).filter(Boolean).forEach((line) => console.log(`[${label}] ${line}`));
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code) => {
    console.log(`[${label}] saiu (${code})`);
    process.exit(code ?? 0);
  });
  return child;
};

const children = [run('jogo', 'npx tsx watch server/index.ts'), run('vite', 'npx vite')];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
