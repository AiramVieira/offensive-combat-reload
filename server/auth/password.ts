// E-mail and password: sign-up, sign-in (with rate limits and lockout), and password reset by e-mail.
// Wrong e-mail and wrong password give the same answer, and take about the same time.
import { cleanName, validEmail, validName, validPassword } from '@shared/account';
import { asSex } from '@shared/protocol';
import { activeBan, audit, createAccount, findAccountByEmail, getAccount, type AuditInfo } from '../accounts';
import { sendMail } from '../email';
import { clientIp, HttpError, publicOrigin, randomToken, sha256hex, userAgent } from '../http';
import { hit } from '../redis';
import { createSession, revokeAll, type Deps } from './sessions';

export const LIMITS = {
  /** Sign-in and sign-up attempts per IP per minute. */
  perIpPerMinute: 5,
  /** Consecutive failures that lock an account, and for how long. */
  failuresToLock: 10,
  lockSeconds: 900,
  /** Reset e-mails per account per hour. */
  resetsPerHour: 3,
  resetTtlSeconds: 86400,
};

/**
 * Argon2id through Bun.password, with the parameters the stored hashes were made with (19 MiB, 2 passes,
 * one lane: OWASP's minimum). Verifying reads them from the hash itself.
 */
const hash = (password: string) => Bun.password.hash(password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });

// A real hash to verify against when the e-mail doesn't exist, so both cases cost the same.
let dummyHash: Promise<string> | null = null;

const auditInfo = (req: Request): AuditInfo => ({ ip: clientIp(req), userAgent: userAgent(req) });

async function limitIp(deps: Deps, req: Request, bucket: string) {
  if ((await hit(deps.redis, `rl:${bucket}:ip:${clientIp(req)}`, 60)) > LIMITS.perIpPerMinute) throw new HttpError(429, 'muitas_tentativas');
}

const emailOf = (raw: unknown) => String(raw ?? '').trim().toLowerCase();

export async function register(deps: Deps, req: Request, body: Record<string, unknown>): Promise<string> {
  await limitIp(deps, req, 'cadastro');
  const email = emailOf(body.email);
  const senha = String(body.senha ?? '');
  const nome = cleanName(body.nome);
  if (!validEmail(email)) throw new HttpError(400, 'email_invalido');
  if (!validPassword(senha)) throw new HttpError(400, 'senha_invalida');
  if (!validName(nome)) throw new HttpError(400, 'nome_invalido');
  if (await findAccountByEmail(deps.db, email)) throw new HttpError(409, 'email_em_uso');
  const accountId = await createAccount(deps.db, { email, passwordHash: await hash(senha), name: nome, sex: asSex(body.sexo) });
  void audit(deps.db, accountId, 'register', auditInfo(req));
  return createSession(deps.db, req, accountId);
}

export async function login(deps: Deps, req: Request, body: Record<string, unknown>): Promise<string> {
  await limitIp(deps, req, 'login');
  const email = emailOf(body.email);
  const senha = String(body.senha ?? '');
  const info = auditInfo(req);
  const account = validEmail(email) && senha.length <= 1024 ? await findAccountByEmail(deps.db, email) : null;
  const lockKey = account ? `rl:login:conta:${account.id}` : null;
  const locked = lockKey ? Number(await deps.redis.get(lockKey)) >= LIMITS.failuresToLock : false;
  dummyHash ??= hash('senha-que-nao-existe');
  const ok = await Bun.password.verify(senha.slice(0, 1024), account?.password_hash ?? (await dummyHash)).catch(() => false);
  if (!account || !account.password_hash || !ok || locked || account.status === 'deleted') {
    if (account && lockKey && !locked) {
      const n = await deps.redis.multi().incr(lockKey).expire(lockKey, LIMITS.lockSeconds).exec();
      const fails = Number(n?.[0]?.[1] ?? 0);
      void audit(deps.db, account.id, fails >= LIMITS.failuresToLock ? 'lockout' : 'login_fail', info);
    }
    throw new HttpError(401, 'credenciais_invalidas');
  }
  await deps.redis.del(lockKey!);
  const ban = await activeBan(deps.db, account.id);
  if (ban) throw new HttpError(403, 'conta_suspensa', { ate: ban.expires_at?.toISOString() ?? null });
  void audit(deps.db, account.id, 'login_ok', info);
  return createSession(deps.db, req, account.id);
}

/** Always answers the same way, whether the e-mail exists or not. */
export async function requestReset(deps: Deps, req: Request, body: Record<string, unknown>) {
  await limitIp(deps, req, 'recuperar');
  const email = emailOf(body.email);
  if (!validEmail(email)) return;
  const account = await findAccountByEmail(deps.db, email);
  if (!account || account.status === 'deleted') return;
  if ((await hit(deps.redis, `rl:rec:conta:${account.id}`, 3600)) > LIMITS.resetsPerHour) return;
  const token = randomToken();
  await deps.redis.set(`rec:${sha256hex(token)}`, account.id, 'EX', LIMITS.resetTtlSeconds);
  void audit(deps.db, account.id, 'pwd_reset_request', auditInfo(req));
  const link = `${publicOrigin(req)}/#redefinir=${token}`;
  try {
    await sendMail({
      to: email,
      subject: 'Offensive Combat: redefinir sua senha',
      text: `Alguém pediu para redefinir a senha da sua conta no Offensive Combat.\n\nPara escolher uma senha nova, abra este link em até 24 horas (ele só funciona uma vez):\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`,
    });
  } catch (err) {
    void audit(deps.db, account.id, 'email_fail', auditInfo(req), (err as Error).message.slice(0, 200));
  }
}

export async function resetPassword(deps: Deps, req: Request, body: Record<string, unknown>) {
  const token = String(body.token ?? '');
  const senha = String(body.senha ?? '');
  if (!validPassword(senha)) throw new HttpError(400, 'senha_invalida');
  if (!token || token.length > 100) throw new HttpError(400, 'token_invalido');
  const accountId = await deps.redis.getdel(`rec:${sha256hex(token)}`);
  const account = accountId ? await getAccount(deps.db, accountId) : null;
  if (!account || account.status === 'deleted') throw new HttpError(400, 'token_invalido');
  await deps.db.query(
    `INSERT INTO password_credential (account_id, password_hash) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [account.id, await hash(senha)],
  );
  // The link reached the inbox: the e-mail is verified.
  await deps.db.query('UPDATE account SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [account.id]);
  await deps.redis.del(`rl:login:conta:${account.id}`);
  await revokeAll(deps, account.id);
  void audit(deps.db, account.id, 'pwd_reset', auditInfo(req));
}
