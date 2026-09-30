// Home screen (section 5, flow steps 2-4): pick a name, then join an online session (quick play, list, or
// create one) or start offline training. Resolves with the chosen mode.
import { asSex, NET, type ServerMsg, type SessionInfo, type Sex } from '@shared/protocol';
import { Connection } from '../net/connection';
import { t } from './strings';

export type BotSkillName = 'facil' | 'normal' | 'dificil';

export type HomeChoice = { name: string; sex: Sex } & (
  | { mode: 'offline'; variant: 'range' }
  | { mode: 'bots'; count: number; skill: BotSkillName }
  | { mode: 'online'; conn: Connection; joined: Extract<ServerMsg, { t: 'joined' }> }
);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const NAME_KEY = 'oc.name';
const BOTS_KEY = 'oc.bots';
const SEX_KEY = 'oc.sex';

function loadSex(): Sex {
  try {
    return asSex(localStorage.getItem(SEX_KEY));
  } catch {
    return 'm';
  }
}

const FUNNY_NAMES = ['Recruta Pimpolho', 'Sargento Pastel', 'Cabo Chinelo', 'Mira Torta', 'Soldado Bolacha', 'Tenente Mingau', 'Capitão Pipoca', 'Zé Granada'];

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* storage unavailable */
  }
}

export function showHome(): Promise<HomeChoice> {
  const home = $('home');
  const nameInput = $<HTMLInputElement>('home-name');
  const status = $('home-status');
  const start = $('home-start');
  const lobby = $('home-lobby');
  const list = $('session-list');
  const createInput = $<HTMLInputElement>('session-new-name');

  $('home-name-label').textContent = t('yourName');
  $('home-sex-label').textContent = t('sexLabel');
  let sex = loadSex();
  const sexButtons = [...document.querySelectorAll<HTMLButtonElement>('.sex-btn')];
  const renderSex = () => {
    for (const b of sexButtons) b.setAttribute('aria-checked', String(b.dataset.sex === sex));
  };
  for (const b of sexButtons) {
    b.textContent = t(b.dataset.sex === 'f' ? 'sexFemale' : 'sexMale');
    b.onclick = () => {
      sex = asSex(b.dataset.sex);
      renderSex();
      try {
        localStorage.setItem(SEX_KEY, sex);
      } catch {
        /* storage unavailable */
      }
    };
  }
  renderSex();
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
  nameInput.maxLength = NET.nameMax;
  createInput.maxLength = NET.sessionNameMax;
  nameInput.value = loadName() || FUNNY_NAMES[(Math.random() * FUNNY_NAMES.length) | 0];

  home.classList.remove('hidden');
  start.classList.remove('hidden');
  lobby.classList.add('hidden');
  const setStatus = (msg: string, error = false) => {
    status.textContent = msg;
    status.classList.toggle('error', error);
  };
  setStatus('');

  const name = () => {
    const n = nameInput.value.trim().slice(0, NET.nameMax);
    return n;
  };

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
        home.classList.add('hidden');
        resolve({ mode: 'online', name: name(), sex, conn, joined });
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      } finally {
        busy = false;
      }
    };

    $('home-online').onclick = async () => {
      const n = name();
      if (!n) return setStatus(t('needName'), true);
      if (busy) return;
      busy = true;
      saveName(n);
      setStatus(t('connecting'));
      try {
        conn = await Connection.open();
        const welcomeP = conn.next('welcome');
        conn.send({ t: 'hello', name: n, sex });
        const welcome = await welcomeP;
        conn.on('sessions', (m) => renderList(m.list));
        conn.onClose = () => setStatus(t('disconnected'), true);
        renderList(welcome.sessions);
        start.classList.add('hidden');
        lobby.classList.remove('hidden');
        setStatus(t('connectedAs', { name: welcome.name }));
      } catch {
        setStatus(t('serverOffline'), true);
        conn = null;
      } finally {
        busy = false;
      }
    };

    $('home-offline').onclick = () => {
      const n = name() || FUNNY_NAMES[0];
      saveName(n);
      home.classList.add('hidden');
      resolve({ mode: 'offline', name: n, sex, variant: 'range' });
    };
    $('home-bots').onclick = () => {
      const n = name() || FUNNY_NAMES[0];
      saveName(n);
      const skill = skillSel.value as BotSkillName;
      const count = Number(countSel.value);
      try {
        localStorage.setItem(BOTS_KEY, JSON.stringify({ skill, count }));
      } catch {
        /* storage unavailable */
      }
      home.classList.add('hidden');
      resolve({ mode: 'bots', name: n, sex, count, skill });
    };

    $('session-create').onclick = () => join({ t: 'create', name: createInput.value });
    createInput.onkeydown = (e) => {
      if (e.key === 'Enter') join({ t: 'create', name: createInput.value });
    };
    nameInput.onkeydown = (e) => {
      if (e.key === 'Enter') $('home-online').click();
    };
    $('home-back').onclick = () => {
      conn?.close();
      conn = null;
      lobby.classList.add('hidden');
      start.classList.remove('hidden');
      setStatus('');
    };
  });
}
