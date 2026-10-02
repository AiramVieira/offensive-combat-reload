// Sign-in with Discord: OAuth 2 Authorization Code with PKCE. The Discord user id (immutable) is the key,
// never the e-mail. Linking to an existing account happens only on request, while signed in.
import { Discord } from 'arctic';
import { cleanName, validName } from '@shared/account';
import { activeBan, audit, createAccount, findAccountByDiscord, providers } from '../accounts';
import { CONFIG } from '../config';
import { clientIp, cookie, HttpError, publicOrigin, randomToken, readCookies, redirect, userAgent } from '../http';
import { authenticate, createSession, type Deps } from './sessions';

const STATE_COOKIE = 'oc_oauth';
const CALLBACK_PATH = '/api/auth/discord/retorno';

/** The registered return URL for the address the player is using, or null (the button is hidden then). */
function returnUrlFor(req: Request): string | null {
  if (!CONFIG.discord.clientId || !CONFIG.discord.clientSecret) return null;
  const here = publicOrigin(req);
  return CONFIG.discord.returns.find((u) => u === here + CALLBACK_PATH) ?? null;
}

export const discordAvailable = (req: Request) => returnUrlFor(req) !== null;

const client = (returnUrl: string) => new Discord(CONFIG.discord.clientId, CONFIG.discord.clientSecret, returnUrl);

/** GET /api/auth/discord[?vincular=1]: off to Discord. */
export async function startDiscord(deps: Deps, req: Request, url: URL): Promise<Response> {
  const returnUrl = returnUrlFor(req);
  if (!returnUrl) return redirect('/#erro=discord_indisponivel');
  const link = url.searchParams.get('vincular') === '1';
  if (link && !(await authenticate(deps.db, req))) return redirect('/#erro=nao_autorizado');
  const state = randomToken();
  const verifier = randomToken();
  const to = client(returnUrl).createAuthorizationURL(state, verifier, ['identify']);
  return redirect(to.toString(), { 'set-cookie': cookie(req, STATE_COOKIE, JSON.stringify({ state, verifier, link }), 600, '/api/auth/discord') });
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

/** GET /api/auth/discord/retorno: back from Discord with a code. */
export async function discordCallback(deps: Deps, req: Request, url: URL): Promise<Response> {
  const clear = cookie(req, STATE_COOKIE, '', 0, '/api/auth/discord');
  const fail = (code: string) => redirect(`/#erro=${code}`, { 'set-cookie': clear });
  const returnUrl = returnUrlFor(req);
  let saved: { state?: string; verifier?: string; link?: boolean } = {};
  try {
    saved = JSON.parse(readCookies(req)[STATE_COOKIE] ?? '{}');
  } catch {
    /* treated as a missing state below */
  }
  const code = url.searchParams.get('code');
  if (!returnUrl || !code || !saved.state || !saved.verifier || url.searchParams.get('state') !== saved.state) return fail('nao_autorizado');

  let user: DiscordUser;
  try {
    const tokens = await client(returnUrl).validateAuthorizationCode(code, saved.verifier);
    const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${tokens.accessToken()}` } });
    if (!r.ok) throw new Error(`users/@me ${r.status}`);
    user = (await r.json()) as DiscordUser;
    if (!user?.id) throw new Error('sem id');
  } catch (err) {
    console.error('[discord] troca do código falhou:', (err as Error).message);
    return fail('nao_autorizado');
  }
  const info = { ip: clientIp(req), userAgent: userAgent(req) };
  const existing = await findAccountByDiscord(deps.db, user.id);

  if (saved.link) {
    const s = await authenticate(deps.db, req);
    if (!s) return fail('nao_autorizado');
    // This Discord already belongs to an account (this one or another), or this account has a Discord.
    if (existing || (await providers(deps.db, s.accountId)).includes('discord')) return fail('discord_ja_vinculado');
    await deps.db.query("INSERT INTO auth_identity (account_id, provider, provider_subject) VALUES ($1, 'discord', $2)", [s.accountId, user.id]);
    void audit(deps.db, s.accountId, 'discord_link', info);
    return redirect('/#perfil', { 'set-cookie': clear });
  }

  if (existing) {
    if (existing.status === 'deleted') return fail('nao_autorizado');
    const ban = await activeBan(deps.db, existing.id);
    if (ban) return fail('conta_suspensa');
    void audit(deps.db, existing.id, 'discord_login', info);
    return redirect('/', { 'set-cookie': [clear, await createSession(deps.db, req, existing.id)] });
  }

  // First visit: a new account named after the Discord name; the player picks a game name right away
  // (the first change is free).
  const suggested = cleanName(user.global_name || user.username).slice(0, 16);
  const accountId = await createAccount(deps.db, { discordId: user.id, name: validName(suggested) ? suggested : 'Recruta', sex: 'm' });
  void audit(deps.db, accountId, 'register', info, 'discord');
  return redirect('/#escolher-nome', { 'set-cookie': [clear, await createSession(deps.db, req, accountId)] });
}

/** DELETE /api/auth/identidade/discord */
export async function unlinkDiscord(deps: Deps, req: Request, accountId: string) {
  const prov = await providers(deps.db, accountId);
  if (!prov.includes('discord')) throw new HttpError(404, 'nao_encontrado');
  if (!prov.includes('senha')) throw new HttpError(409, 'unica_forma_de_entrar');
  await deps.db.query("DELETE FROM auth_identity WHERE account_id = $1 AND provider = 'discord'", [accountId]);
  void audit(deps.db, accountId, 'discord_unlink', { ip: clientIp(req), userAgent: userAgent(req) });
}
