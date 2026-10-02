// Staff console (Resposta P27 do plano de autenticação). Talks to the same database and Redis as the
// game server, so a ban also kicks the player out of a running match.
//
//   bun run admin banir "Nome#1234" "motivo" 7d        (7d, 12h, 30m ou permanente)
//   bun run admin desbanir "Nome#1234"
//   bun run admin papel "Nome#1234" moderador [--remover]
//   bun run admin sancoes "Nome#1234"
//
// In Docker: docker compose exec jogo bun build/admin.js banir "Nome#1234" "motivo" 7d
import { CONFIG } from '../server/config';
import { createDb, migrate } from '../server/db';
import { ban, ModerationError, sanctions, setRole, unban } from '../server/moderacao';
import { createRedis } from '../server/redis';

const USAGE = `Uso:
  admin banir <Nome#1234> <motivo> <7d|12h|30m|permanente>
  admin desbanir <Nome#1234>
  admin papel <Nome#1234> <admin|moderador> [--remover]
  admin sancoes <Nome#1234>`;

const fmt = (d: Date | null) => (d ? d.toLocaleString('pt-BR') : '—');

async function main() {
  const [cmd, tag, ...rest] = process.argv.slice(2);
  if (!cmd || !tag) {
    console.log(USAGE);
    return 1;
  }
  const deps = { db: createDb(CONFIG.databaseUrl), redis: createRedis(CONFIG.redisUrl) };
  try {
    await migrate(deps.db);
    switch (cmd) {
      case 'banir': {
        const [reason, duration] = rest;
        if (!reason || !duration) throw new ModerationError(USAGE);
        const until = await ban(deps, tag, reason, duration);
        console.log(`${tag} banido ${until ? `até ${fmt(until)}` : 'permanentemente'}. Sessões encerradas.`);
        break;
      }
      case 'desbanir':
        console.log(`${await unban(deps, tag)} banimento(s) ativo(s) revogado(s) de ${tag}.`);
        break;
      case 'papel': {
        const [role] = rest;
        if (!role) throw new ModerationError(USAGE);
        const remove = rest.includes('--remover');
        await setRole(deps, tag, role, remove);
        console.log(`${tag}: papel ${role} ${remove ? 'removido' : 'concedido'}.`);
        break;
      }
      case 'sancoes': {
        const r = await sanctions(deps, tag);
        console.log(`Papéis: ${r.roles.join(', ') || 'nenhum'}`);
        if (!r.sanctions.length) console.log('Nenhuma sanção.');
        for (const s of r.sanctions) console.log(`- ${s.type}: ${s.reason} | início ${fmt(s.starts_at)} | fim ${fmt(s.expires_at)}${s.revoked_at ? ` | revogada ${fmt(s.revoked_at)}` : ''}`);
        break;
      }
      default:
        throw new ModerationError(USAGE);
    }
    return 0;
  } catch (err) {
    if (err instanceof ModerationError) console.error(err.message);
    else console.error('Falhou:', (err as Error).message);
    return 1;
  } finally {
    deps.redis.disconnect();
    await deps.db.end();
  }
}

process.exit(await main());
