#!/usr/bin/env bun
// One command for the whole Docker stack (nginx + game server + PostgreSQL + Redis): opens Docker if it is
// closed, builds and starts everything, waits for the game to answer and prints the addresses to share.
// `bun link` in the project folder makes it a global command; without it, `bun run offensive [comando]`.
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const USAGE = `Uso: offensive [comando]
  (nada) ou subir   constrói e sobe tudo (nginx, servidor, banco e Redis) e mostra os endereços
  parar             desliga tudo (as contas continuam no banco)
  logs              acompanha o log do servidor do jogo
  status            containers e endereços
  firewall          libera a porta no firewall do Windows (pede administrador)
Porta pública: variável PORTA (padrão 8080).`;

const ROOT = join(import.meta.dir, '..');
const PORT = process.env.PORTA ?? '8080';
const WINDOWS = process.platform === 'win32';
const FIREWALL_RULE = 'Offensive Combat';

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/** Runs a command in the project folder with its output on this terminal; resolves to the exit code. */
const run = (cmd: string[]) => Bun.spawn(cmd, { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] }).exited;
const succeeds = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: ROOT, stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;

async function ensureDocker() {
  if (!Bun.which('docker')) fail('Docker não encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/');
  if (succeeds(['docker', 'info'])) return;
  // Docker Desktop's own CLI: the app runs apart from this process (it outlives the command) and the call
  // returns once the engine answers.
  console.log('O Docker está fechado; abrindo o Docker Desktop (pode levar um minuto)...');
  if ((await run(['docker', 'desktop', 'start', '--timeout', '180'])) === 0 && succeeds(['docker', 'info'])) return;
  fail(process.platform === 'linux' ? 'O Docker está parado. Inicie com: sudo systemctl start docker' : 'O Docker não subiu. Abra o Docker Desktop e tente de novo.');
}

/** Through nginx, GET /api/me without a session is the game server's 401: everything is answering. */
async function gameAnswers(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/me`, { signal: AbortSignal.timeout(2000) })).status === 401) return true;
    } catch {
      /* nginx or the game still starting */
    }
    await Bun.sleep(1000);
  }
  return false;
}

/** This machine's addresses, skipping the virtual adapters of WSL, Docker and VMs. */
function addresses(): string {
  const lines = [`  ${'Neste PC:'.padEnd(16)} http://localhost:${PORT}`];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/vEthernet|WSL|Docker|VirtualBox|VMware|Loopback|^(lo|docker\d*|br-.*|veth.*)$/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) lines.push(`  ${`${name}:`.padEnd(16)} http://${a.address}:${PORT}`);
  }
  return lines.join('\n');
}

const firewallOpen = () =>
  succeeds(['powershell', '-NoProfile', '-Command', `if (Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`]);

async function up() {
  await ensureDocker();
  console.log(`Construindo e subindo nginx, servidor, banco e Redis (porta ${PORT})...\n`);
  if ((await run(['docker', 'compose', 'up', '-d', '--build'])) !== 0) fail('O docker compose falhou (veja a saída acima).');
  process.stdout.write('\nEsperando o jogo responder...');
  if (!(await gameAnswers())) {
    console.log();
    await run(['docker', 'compose', 'logs', '--tail', '30', 'jogo']);
    fail('O jogo não respondeu pelo nginx em 60 s. O log do servidor está acima.');
  }
  console.log(' ok.\n\nOffensive Combat no ar. Mande para os colegas um destes endereços:');
  console.log(addresses());
  if (WINDOWS && !firewallOpen()) console.log('\nSe os colegas não conseguirem abrir a página, libere a porta: offensive firewall');
  console.log('\nDesligar: offensive parar   ·   Log do servidor: offensive logs');
}

async function firewall() {
  if (!WINDOWS) fail('Só no Windows. No Linux, libere a porta no ufw ou no firewalld.');
  if (firewallOpen()) return console.log(`A regra "${FIREWALL_RULE}" já existe no firewall.`);
  // Creating a rule needs an administrator: Start-Process -Verb RunAs shows the UAC prompt. The inner
  // command goes base64-encoded, so no quoting survives two PowerShell command lines.
  const rule = `New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow`;
  const encoded = Buffer.from(rule, 'utf16le').toString('base64');
  await run(['powershell', '-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`]);
  if (!firewallOpen()) fail('A regra não foi criada (o pedido de administrador foi recusado?).');
  console.log(`Porta ${PORT} liberada no firewall do Windows (regra "${FIREWALL_RULE}").`);
}

const commands: Record<string, () => Promise<unknown>> = {
  subir: up,
  parar: () => run(['docker', 'compose', 'down']),
  logs: () => run(['docker', 'compose', 'logs', '-f', 'jogo']),
  status: async () => {
    await run(['docker', 'compose', 'ps']);
    console.log(`\n${addresses()}`);
  },
  firewall,
};

if (!/^\d{1,5}$/.test(PORT)) fail(`PORTA inválida: ${PORT}`);
const [name = 'subir'] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.log(USAGE);
  process.exit(['ajuda', '--help', '-h'].includes(name) ? 0 : 1);
}
const result = await command();
if (typeof result === 'number') process.exit(result);
