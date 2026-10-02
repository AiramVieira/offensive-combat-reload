// Starts the game server (restarting on changes) and Vite together: `bun run dev:online`.
// Friends on the same network open http://<your-ip>:5173 (Vite prints the Network address).

const run = (label: string, cmd: string[]) => {
  const child = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const prefix = async (stream: ReadableStream<Uint8Array>) => {
    // Lines can arrive split across chunks: keep the unfinished tail for the next one.
    const text = new TextDecoder();
    let rest = '';
    for await (const chunk of stream) {
      const lines = (rest + text.decode(chunk, { stream: true })).split(/\r?\n/);
      rest = lines.pop()!;
      for (const line of lines) if (line) console.log(`[${label}] ${line}`);
    }
    if (rest) console.log(`[${label}] ${rest}`);
  };
  void prefix(child.stdout);
  void prefix(child.stderr);
  void child.exited.then((code) => {
    console.log(`[${label}] saiu (${code})`);
    stop();
    process.exit(code);
  });
  return child;
};

// process.execPath is this same Bun; `bun x --bun` keeps Vite on Bun instead of Node.
const children = [run('jogo', [process.execPath, '--watch', 'server/index.ts']), run('vite', [process.execPath, 'x', '--bun', 'vite'])];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
