// Account forms on the home card: sign in, sign up, forgot password, new password (from the e-mailed link)
// and choosing the in-game name (first Discord sign-in).
import { NAME_MAX, PASSWORD_MAX, type ApiErrorCode } from '@shared/account';
import type { Sex } from '@shared/protocol';
import { api, ApiError } from '../net/api';
import { t, type StringKey } from './strings';

export type AuthView = 'login' | 'register' | 'forgot' | 'reset' | 'name';

const ERRORS: Partial<Record<ApiErrorCode | 'offline', StringKey>> = {
  credenciais_invalidas: 'errCredentials',
  muitas_tentativas: 'errTooMany',
  conta_suspensa: 'errSuspended',
  conta_em_exclusao: 'errPendingDeletion',
  email_em_uso: 'errEmailUsed',
  email_invalido: 'errEmailInvalid',
  senha_invalida: 'errPasswordInvalid',
  nome_invalido: 'errNameInvalid',
  nome_esgotado: 'errNameTaken',
  token_invalido: 'errTokenInvalid',
  unica_forma_de_entrar: 'errOnlyLogin',
  discord_indisponivel: 'errDiscordUnavailable',
  discord_ja_vinculado: 'errDiscordLinked',
  nao_autorizado: 'errUnauthorized',
  offline: 'errOffline',
};

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** A message for an API error code (from an ApiError, or from a `#erro=` redirect). */
export function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : typeof err === 'string' ? err : null;
  if (code === 'cooldown_nome' && err instanceof ApiError && typeof err.extra.liberaEm === 'string') return t('errNameCooldown', { date: formatDate(err.extra.liberaEm) });
  const key = code ? ERRORS[code as ApiErrorCode] : undefined;
  return t(key ?? 'errGeneric');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const field = (id: string, label: StringKey, type: string, extra = '') =>
  `<label class="home-name"><span>${t(label)}</span><input id="${id}" type="${type}" spellcheck="false" ${extra} /></label>`;

interface Options {
  discord: boolean;
  sex: Sex;
  resetToken?: string;
  currentName?: string;
  setStatus(msg: string, error?: boolean): void;
  /** Signed in (or name saved): the home reloads the account. */
  onSignedIn(): void;
  onCancel(): void;
}

export function showAuth(root: HTMLElement, view: AuthView, o: Options) {
  const go = (v: AuthView) => showAuth(root, v, o);
  const discordBtn = o.discord ? `<a class="discord-btn" href="/api/auth/discord">${t('withDiscord')}</a>` : '';
  const views: Record<AuthView, string> = {
    login: `<h3>${t('signInTitle')}</h3>${discordBtn}
      ${field('auth-email', 'email', 'email', 'autocomplete="email" maxlength="254"')}
      ${field('auth-pass', 'password', 'password', `autocomplete="current-password" maxlength="${PASSWORD_MAX}"`)}
      <button id="auth-submit" class="big-btn">${t('signIn')}</button>
      <div class="auth-links"><button class="link-btn" data-go="forgot">${t('forgotLink')}</button><button class="link-btn" data-go="register">${t('noAccount')}</button></div>`,
    register: `<h3>${t('signUpTitle')}</h3>${discordBtn}
      ${field('auth-email', 'email', 'email', 'autocomplete="email" maxlength="254"')}
      ${field('auth-pass', 'password', 'password', `autocomplete="new-password" maxlength="${PASSWORD_MAX}"`)}
      <p class="hint">${t('passwordHint')}</p>
      ${field('auth-name', 'gameName', 'text', `autocomplete="nickname" maxlength="${NAME_MAX}"`)}
      <p class="hint">${t('nameHint')}</p>
      <button id="auth-submit" class="big-btn">${t('signUp')}</button>
      <div class="auth-links"><button class="link-btn" data-go="login">${t('haveAccount')}</button></div>`,
    forgot: `<h3>${t('forgotTitle')}</h3>
      ${field('auth-email', 'email', 'email', 'autocomplete="email" maxlength="254"')}
      <button id="auth-submit" class="big-btn">${t('send')}</button>
      <div class="auth-links"><button class="link-btn" data-go="login">${t('back')}</button></div>`,
    reset: `<h3>${t('resetTitle')}</h3>
      ${field('auth-pass', 'password', 'password', `autocomplete="new-password" maxlength="${PASSWORD_MAX}"`)}
      <p class="hint">${t('passwordHint')}</p>
      <button id="auth-submit" class="big-btn">${t('save')}</button>`,
    name: `<h3>${t('chooseNameTitle')}</h3>
      ${field('auth-name', 'gameName', 'text', `autocomplete="nickname" maxlength="${NAME_MAX}" value="${esc(o.currentName ?? '')}"`)}
      <p class="hint">${t('nameHint')}</p>
      <button id="auth-submit" class="big-btn">${t('save')}</button>`,
  };
  root.innerHTML = `<div class="auth-form">${views[view]}${view === 'login' || view === 'register' ? `<button class="link-btn" data-go="cancel">${t('back')}</button>` : ''}</div>`;
  o.setStatus('');

  const val = (id: string) => (root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim();
  const pass = () => root.querySelector<HTMLInputElement>('#auth-pass')?.value ?? '';
  const submit = root.querySelector<HTMLButtonElement>('#auth-submit')!;
  let busy = false;

  const run = async () => {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    try {
      if (view === 'login') {
        await api('POST', '/api/auth/entrar', { email: val('auth-email'), senha: pass() });
        o.onSignedIn();
      } else if (view === 'register') {
        await api('POST', '/api/auth/cadastro', { email: val('auth-email'), senha: pass(), nome: val('auth-name'), sexo: o.sex });
        o.onSignedIn();
      } else if (view === 'forgot') {
        await api('POST', '/api/auth/recuperar', { email: val('auth-email') });
        go('login');
        o.setStatus(t('resetSent'));
      } else if (view === 'reset') {
        await api('POST', '/api/auth/redefinir', { token: o.resetToken, senha: pass() });
        go('login');
        o.setStatus(t('resetDone'));
      } else {
        await api('PATCH', '/api/perfil', { nome: val('auth-name') });
        o.onSignedIn();
      }
    } catch (err) {
      o.setStatus(errorText(err), true);
    } finally {
      busy = false;
      submit.disabled = false;
    }
  };

  submit.onclick = run;
  root.querySelectorAll('input').forEach((i) => {
    // A handler returning false would cancel every keystroke: only act on Enter.
    i.onkeydown = (e) => {
      if (e.key === 'Enter') void run();
    };
  });
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => {
    b.onclick = () => (b.dataset.go === 'cancel' ? o.onCancel() : go(b.dataset.go as AuthView));
  });
  root.querySelector<HTMLInputElement>('input')?.focus();
}
