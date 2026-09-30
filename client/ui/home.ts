// Home screen (section 5, flow steps 2-4): the account (sign in / sign up / profile, where the character's
// body is chosen), then an online session (account required), bots or offline training. Resolves with the chosen mode.
import type { MeResponse, ProfileResponse } from '@shared/account';
import { CLOSE, NET, type ServerMsg, type SessionInfo, type Sex } from '@shared/protocol';
import { api, fetchMe, fetchProfile } from '../net/api';
import { Connection } from '../net/connection';
import { errorText, showAuth, type AuthView } from './auth';
import { showProfile } from './profile';
import { t } from './strings';

export type BotSkillName = 'facil' | 'normal' | 'dificil';

export type HomeChoice = { name: string; sex: Sex; account: ProfileResponse | null } & (
  | { mode: 'offline'; variant: 'range' }
  | { mode: 'bots'; count: number; skill: BotSkillName }
  | { mode: 'online'; conn: Connection; joined: Extract<ServerMsg, { t: 'joined' }> }
);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BOTS_KEY = 'oc.bots';
/** Keys of the pre-account era: name, body and progression now live in the account (Resposta P5). */
const OLD_KEYS = ['oc.name', 'oc.sex', 'oc.profile'];

const FUNNY_NAMES = ['Recruta Pimpolho', 'Sargento Pastel', 'Cabo Chinelo', 'Mira Torta', 'Soldado Bolacha', 'Tenente Mingau', 'Capitão Pipoca', 'Zé Granada'];

/** Why the server closed the game connection, for the player. */
export function closeReason(code: number) {
  return code === CLOSE.revoked ? t('sessionEnded') : code === CLOSE.replaced ? t('connectedElsewhere') : t('disconnected');
}

export function showHome(): Promise<HomeChoice> {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  const home = $('home');
  const status = $('home-status');
  const views = { start: $('home-start'), auth: $('home-auth'), profile: $('home-profile'), lobby: $('home-lobby') };
  const list = $('session-list');
  const createInput = $<HTMLInputElement>('session-new-name');
  const show = (v: keyof typeof views) => {
    for (const [k, el] of Object.entries(views)) el.classList.toggle('hidden', k !== v);
  };

  $('acct-guest').textContent = t('accountGuest');
  $('acct-login').textContent = t('signIn');
  $('acct-register').textContent = t('signUp');
  $('acct-profile').textContent = t('profile');
  $('home-online').textContent = t('playOnline');
  $('home-offline').textContent = t('playOffline');
  $('home-bots').textContent = t('playBots');
  $('bot-skill-label').textContent = t('botSkill');
  $('bot-count-label').textContent = t('botCount');
  const skillSel = $<HTMLSelectElement>('bot-skill');
  const countSel = $<HTMLSelectElement>('bot-count');
  skillSel.innerHTML = ([['facil', 'skillEasy'], ['normal', 'skillNormal'], ['dificil', 'skillHard']] as const).map(([v, k]) => `<option value="${v}">${t(k)}</option>`).join('');
  countSel.innerHTML = [3, 5, 7, 9].map((n) => `<option value="${n}">${n}</option>`).join('');
  let prefs = { skill: 'normal', count: 7 };
  try {
    prefs = { ...prefs, ...JSON.parse(localStorage.getItem(BOTS_KEY) ?? '{}') };
  } catch {
    /* storage unavailable */
  }
  skillSel.value = prefs.skill;
  countSel.value = String(prefs.count);
  $('home-lobby-title').textContent = t('sessions');
  $('session-create').textContent = t('createSession');
  $('home-back').textContent = t('back');
  createInput.placeholder = t('sessionNamePlaceholder');
  createInput.maxLength = NET.sessionNameMax;

  home.classList.remove('hidden');
  show('start');
  const setStatus = (msg: string, error = false) => {
    status.textContent = msg;
    status.classList.toggle('error', error);
  };
  setStatus('');

  // --- Account ------------------------------------------------------------------------------------------
  let me: MeResponse | null = null;
  let discord = false;
  /** The character's body comes from the profile; without an account it is the default one. */
  let sex: Sex = 'm';
  const guestName = FUNNY_NAMES[(Math.random() * FUNNY_NAMES.length) | 0];

  const renderAccount = () => {
    $('home-account-in').classList.toggle('hidden', !me);
    $('home-account-out').classList.toggle('hidden', !!me);
    if (me) {
      $('acct-tag').textContent = me.tag;
      $('acct-level').textContent = t('levelShort', { level: me.nivel });
    }
    sex = me?.sexo ?? 'm';
  };

  const loadAccount = async () => {
    const r = await fetchMe();
    me = r.me;
    renderAccount();
    return r;
  };

  const authOpts = {
    get discord() {
      return discord;
    },
    get sex() {
      return sex;
    },
    setStatus,
    onSignedIn: async () => {
      await loadAccount();
      setStatus('');
      show('start');
    },
    onCancel: () => {
      setStatus('');
      show('start');
    },
  };
  const openAuth = (view: AuthView, extra: { resetToken?: string; currentName?: string } = {}) => {
    show('auth');
    showAuth(views.auth, view, { ...authOpts, ...extra });
  };
  const openProfile = () => {
    show('profile');
    void showProfile(views.profile, {
      discord,
      setStatus,
      onAccountChanged: async () => {
        await loadAccount();
        if (me) openProfile();
        else show('start');
      },
      onBack: () => show('start'),
    });
  };

  $('acct-login').onclick = () => openAuth('login');
  $('acct-register').onclick = () => openAuth('register');
  $('acct-profile').onclick = () => openProfile();

  // Links coming back from the e-mail or from Discord land here with a #fragment.
  const hash = location.hash.slice(1);
  if (hash) history.replaceState(null, '', location.pathname + location.search);
  void Promise.all([loadAccount(), api<{ discord: boolean }>('GET', '/api/auth/provedores').then((r) => (discord = r.discord)).catch(() => {})]).then(([r]) => {
    if (hash.startsWith('redefinir=')) openAuth('reset', { resetToken: decodeURIComponent(hash.slice('redefinir='.length)) });
    else if (hash === 'escolher-nome' && me) openAuth('name', { currentName: me.tag.replace(/#\d+$/, '') });
    else if (hash === 'perfil' && me) openProfile();
    else if (hash.startsWith('erro=')) setStatus(errorText(decodeURIComponent(hash.slice(5))), true);
    else if (r.offline) setStatus(t('errOffline'));
  });

  const playerName = () => me?.tag ?? guestName;
  const account = async () => (me ? await fetchProfile().catch(() => null) : null);

  return new Promise((resolve) => {
    let conn: Connection | null = null;
    let busy = false;

    const renderList = (sessions: SessionInfo[]) => {
      list.innerHTML = '';
      if (!sessions.length) {
        list.innerHTML = `<li class="empty">${t('noSessions')}</li>`;
        return;
      }
      for (const s of sessions) {
        const li = document.createElement('li');
        const full = s.players >= s.max;
        li.innerHTML = `<span class="s-name"></span><span class="s-count">${s.players}/${s.max}</span><button class="small-btn" ${full ? 'disabled' : ''}>${full ? t('full') : t('join')}</button>`;
        li.querySelector('.s-name')!.textContent = s.name;
        li.querySelector('button')!.addEventListener('click', () => join({ t: 'join', session: s.id }));
        list.appendChild(li);
      }
    };

    const join = async (msg: { t: 'join'; session: string } | { t: 'create'; name: string }) => {
      if (!conn || busy) return;
      busy = true;
      setStatus(t('joining'));
      try {
        const joinedP = conn.next('joined');
        conn.send(msg);
        const joined = await joinedP;
        const acct = await account();
        home.classList.add('hidden');
        resolve({ mode: 'online', name: playerName(), sex, account: acct, conn, joined });
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      } finally {
        busy = false;
      }
    };

    $('home-online').onclick = async () => {
      if (busy) return;
      if (!me) await loadAccount();
      if (!me) {
        openAuth('login');
        return setStatus(t('needAccount'));
      }
      if (me.exclusaoEm) return setStatus(t('errPendingDeletion'), true);
      busy = true;
      setStatus(t('connecting'));
      try {
        conn = await Connection.open();
        const welcomeP = conn.next('welcome');
        conn.send({ t: 'hello' });
        const welcome = await welcomeP;
        conn.on('sessions', (m) => renderList(m.list));
        conn.onClose = (code) => setStatus(closeReason(code), true);
        renderList(welcome.sessions);
        show('lobby');
        setStatus(t('connectedAs', { name: welcome.name }));
      } catch (err) {
        setStatus(err instanceof Error && err.message === 'não foi possível conectar ao servidor' ? t('errOffline') : errorText(err), true);
        conn = null;
      } finally {
        busy = false;
      }
    };

    $('home-offline').onclick = async () => {
      const acct = await account();
      home.classList.add('hidden');
      resolve({ mode: 'offline', name: playerName(), sex, account: acct, variant: 'range' });
    };
    $('home-bots').onclick = async () => {
      const skill = skillSel.value as BotSkillName;
      const count = Number(countSel.value);
      try {
        localStorage.setItem(BOTS_KEY, JSON.stringify({ skill, count }));
      } catch {
        /* storage unavailable */
      }
      const acct = await account();
      home.classList.add('hidden');
      resolve({ mode: 'bots', name: playerName(), sex, account: acct, count, skill });
    };

    $('session-create').onclick = () => join({ t: 'create', name: createInput.value });
    createInput.onkeydown = (e) => {
      if (e.key === 'Enter') join({ t: 'create', name: createInput.value });
    };
    $('home-back').onclick = () => {
      if (conn) conn.onClose = () => {};
      conn?.close();
      conn = null;
      show('start');
      setStatus('');
    };
  });
}
