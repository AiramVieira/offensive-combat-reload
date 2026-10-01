// The account API under /api. JSON in and out; every state-changing request must come from this site
// (Origin check) and carries the session cookie. Errors are { erro: code }.
import { cleanName, validName } from '@shared/account';
import { PROG_WEAPONS, type Loadout } from '@shared/progression';
import { asSex } from '@shared/protocol';
import { activeBan, audit, cancelDeletion, changeName, fullProfile, getAccount, me, requestDeletion, setEquipped, setSex } from './accounts';
import { discordAvailable, discordCallback, startDiscord, unlinkDiscord } from './auth/discord';
import { login, register, requestReset, resetPassword } from './auth/password';
import { authenticate, clearSessionCookie, revokeSession, type AuthSession, type Deps } from './auth/sessions';
import { clientIp, HttpError, json, originAllowed, randomToken, readJson, sha256hex, userAgent } from './http';
import { REVOCATION_CHANNEL } from './redis';

/** WebSocket tickets: single use, short-lived. */
export const TICKET_TTL_SECONDS = 30;
export const ticketKey = (ticket: string) => `ws:ticket:${sha256hex(ticket)}`;

type Handler = (ctx: Ctx) => Promise<Response>;

interface Ctx {
  deps: Deps;
  req: Request;
  url: URL;
  /** Set-Cookie headers to add to the response (session renewal). */
  cookies: string[];
  session: AuthSession | null;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function requireSession(ctx: Ctx): Promise<AuthSession> {
  const s = await authenticate(ctx.deps.db, ctx.req);
  if (!s) throw new HttpError(401, 'nao_autorizado');
  if (s.renewed) ctx.cookies.push(s.renewed);
  const ban = await activeBan(ctx.deps.db, s.accountId);
  if (ban) throw new HttpError(403, 'conta_suspensa', { ate: ban.expires_at?.toISOString() ?? null });
  ctx.session = s;
  return s;
}

const reply = (ctx: Ctx, status: number, body?: unknown, extraCookies: string[] = []) => {
  const cookies = [...ctx.cookies, ...extraCookies];
  return json(status, body, cookies.length ? { 'set-cookie': cookies } : {});
};

const info = (req: Request) => ({ ip: clientIp(req), userAgent: userAgent(req) });

const routes: Record<string, Handler> = {
  'GET /api/me': async (ctx) => {
    const s = await requireSession(ctx);
    return reply(ctx, 200, await me(ctx.deps.db, s.accountId));
  },

  'GET /api/auth/provedores': async (ctx) => reply(ctx, 200, { discord: discordAvailable(ctx.req) }),

  'POST /api/auth/cadastro': async (ctx) => {
    const setCookie = await register(ctx.deps, ctx.req, await readJson(ctx.req));
    return reply(ctx, 201, undefined, [setCookie]);
  },

  'POST /api/auth/entrar': async (ctx) => {
    const setCookie = await login(ctx.deps, ctx.req, await readJson(ctx.req));
    return reply(ctx, 204, undefined, [setCookie]);
  },

  'GET /api/auth/discord': async (ctx) => startDiscord(ctx.deps, ctx.req, ctx.url),
  'GET /api/auth/discord/retorno': async (ctx) => discordCallback(ctx.deps, ctx.req, ctx.url),

  'POST /api/auth/sair': async (ctx) => {
    const s = await authenticate(ctx.deps.db, ctx.req);
    if (s) {
      await revokeSession(ctx.deps, s);
      void audit(ctx.deps.db, s.accountId, 'logout', info(ctx.req));
    }
    return reply(ctx, 204, undefined, [clearSessionCookie(ctx.req)]);
  },

  'POST /api/auth/recuperar': async (ctx) => {
    await requestReset(ctx.deps, ctx.req, await readJson(ctx.req));
    return reply(ctx, 204);
  },

  'POST /api/auth/redefinir': async (ctx) => {
    await resetPassword(ctx.deps, ctx.req, await readJson(ctx.req));
    return reply(ctx, 204, undefined, [clearSessionCookie(ctx.req)]);
  },

  'DELETE /api/auth/identidade/discord': async (ctx) => {
    const s = await requireSession(ctx);
    await unlinkDiscord(ctx.deps, ctx.req, s.accountId);
    return reply(ctx, 204);
  },

  'GET /api/perfil': async (ctx) => {
    const s = await requireSession(ctx);
    return reply(ctx, 200, await fullProfile(ctx.deps.db, s.accountId));
  },

  'PATCH /api/perfil': async (ctx) => {
    const s = await requireSession(ctx);
    const body = await readJson(ctx.req);
    if (body.nome !== undefined) {
      const nome = cleanName(body.nome);
      if (!validName(nome)) throw new HttpError(400, 'nome_invalido');
      await changeName(ctx.deps.db, s.accountId, nome, info(ctx.req));
    }
    if (body.sexo !== undefined) await setSex(ctx.deps.db, s.accountId, asSex(body.sexo));
    if (body.equipado !== undefined) {
      const eq = (body.equipado ?? {}) as Partial<Record<string, unknown>>;
      const lo: Partial<Loadout> = {};
      for (const w of PROG_WEAPONS) if (eq[w] !== undefined) lo[w] = Number(eq[w]);
      await setEquipped(ctx.deps.db, s.accountId, lo);
    }
    return reply(ctx, 200, await fullProfile(ctx.deps.db, s.accountId));
  },

  'POST /api/ws-ticket': async (ctx) => {
    const s = await requireSession(ctx);
    const account = await getAccount(ctx.deps.db, s.accountId);
    if (account?.status === 'pending_deletion') throw new HttpError(403, 'conta_em_exclusao');
    const ticket = randomToken();
    await ctx.deps.redis.set(ticketKey(ticket), s.accountId, 'EX', TICKET_TTL_SECONDS);
    return reply(ctx, 200, { ticket });
  },

  'DELETE /api/conta': async (ctx) => {
    const s = await requireSession(ctx);
    await requestDeletion(ctx.deps.db, s.accountId);
    void audit(ctx.deps.db, s.accountId, 'delete_request', info(ctx.req));
    // Other devices are signed out; this one stays signed in so the player sees the date and can cancel.
    await ctx.deps.db.query('UPDATE session SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL', [s.accountId, s.sessionId]);
    // Live game connections close too: online play is blocked while the deletion is pending.
    await ctx.deps.redis.publish(REVOCATION_CHANNEL, s.accountId);
    return reply(ctx, 204);
  },

  'POST /api/conta/cancelar-exclusao': async (ctx) => {
    const s = await requireSession(ctx);
    await cancelDeletion(ctx.deps.db, s.accountId);
    void audit(ctx.deps.db, s.accountId, 'delete_cancel', info(ctx.req));
    return reply(ctx, 204);
  },
};

/** Answers /api/* requests; returns null for anything else. */
export async function handleApi(deps: Deps, req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/')) return null;
  const ctx: Ctx = { deps, req, url, cookies: [], session: null };
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) throw new HttpError(404, 'nao_encontrado');
    if (MUTATING.has(req.method) && !originAllowed(req)) throw new HttpError(403, 'origem_invalida');
    return await route(ctx);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { erro: err.code, ...err.extra }, ctx.cookies.length ? { 'set-cookie': ctx.cookies } : {});
    // Never log the request itself: it may carry cookies or passwords.
    console.error(`[api] ${req.method} ${url.pathname}:`, (err as Error).message);
    return json(500, { erro: 'erro_interno' });
  }
}
