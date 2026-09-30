// Profile tab on the home card: Name#1234, account level, the character's body, stats, the last 10 online
// sessions, name change, Discord link, sign-out and account deletion.
import { NAME_MAX, type ProfileResponse } from '@shared/account';
import { api, fetchProfile } from '../net/api';
import { errorText, formatDate } from './auth';
import { t, type StringKey } from './strings';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}min` : `${m}min`;
}

interface Options {
  discord: boolean;
  setStatus(msg: string, error?: boolean): void;
  /** Signed out, deleted or name changed: the home reloads the account. */
  onAccountChanged(): void;
  onBack(): void;
}

export async function showProfile(root: HTMLElement, o: Options) {
  let p: ProfileResponse;
  try {
    p = await fetchProfile();
  } catch (err) {
    o.setStatus(errorText(err), true);
    return o.onBack();
  }
  const stats: [StringKey, string][] = [
    ['statKills', String(p.totais.abates)],
    ['statDeaths', String(p.totais.mortes)],
    ['statHead', String(p.totais.cabeca)],
    ['statGroin', String(p.totais.passaro)],
    ['statKnife', String(p.totais.facadas)],
    ['statBackstab', String(p.totais.pelasCostas)],
    ['statGrenade', String(p.totais.granadas)],
    ['statHumiliations', String(p.totais.opressoes)],
    ['statTime', duration(p.totais.segundosJogados)],
    ['statMatches', String(p.totais.participacoes)],
  ];
  const rows = p.participacoes
    .map(
      (x) =>
        `<tr><td>${esc(x.sessao)}</td><td>${formatDate(x.entrada)}</td><td>${x.abates}</td><td>${x.mortes}</td><td>${x.pontos}</td><td>+${x.xp}</td></tr>`,
    )
    .join('');
  const linked = p.provedores.includes('discord');
  const pct = Math.round((p.xpNoNivel / p.xpProximo) * 100);

  root.innerHTML = `
    <div class="profile">
      <div class="profile-head">
        <b class="profile-tag">${esc(p.tag)}</b>
        <span class="level-badge">${t('levelShort', { level: p.nivel })}</span>
      </div>
      <div class="xp-bar" title="${p.xpNoNivel} / ${p.xpProximo} XP"><div style="width:${pct}%"></div></div>
      <p class="hint">${p.xpNoNivel} / ${p.xpProximo} XP</p>
      ${p.exclusaoEm ? `<p class="profile-warn">${t('deletionPending', { date: formatDate(p.exclusaoEm) })}</p><button id="pf-cancel-del" class="small-btn">${t('cancelDeletion')}</button>` : ''}
      <h3>${t('sexLabel')}</h3>
      <div class="sex-toggle" role="radiogroup">
        ${(['m', 'f'] as const).map((s) => `<button type="button" class="sex-btn" role="radio" data-sex="${s}" aria-checked="${p.sexo === s}">${t(s === 'f' ? 'sexFemale' : 'sexMale')}</button>`).join('')}
      </div>
      <h3>${t('statsTitle')}</h3>
      <div class="stat-grid">${stats.map(([k, v]) => `<div><span>${t(k)}</span><b>${v}</b></div>`).join('')}</div>
      <h3>${t('recentTitle')}</h3>
      ${rows ? `<table class="part-table"><thead><tr><th></th><th></th><th>${t('statKills')}</th><th>${t('statDeaths')}</th><th>${t('points')}</th><th>XP</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="hint">${t('noParticipations')}</p>`}
      <h3>${t('changeName')}</h3>
      <div class="session-create">
        <input id="pf-name" type="text" spellcheck="false" maxlength="${NAME_MAX}" value="${esc(p.nome)}" ${p.nomeLiberaEm ? 'disabled' : ''} />
        <button id="pf-name-save" class="small-btn" ${p.nomeLiberaEm ? 'disabled' : ''}>${t('save')}</button>
      </div>
      <p class="hint">${p.nomeLiberaEm ? t('nameFreeAt', { date: formatDate(p.nomeLiberaEm) }) : t('nameRule')}</p>
      <div class="profile-actions">
        ${!linked && o.discord ? `<a class="discord-btn small" href="/api/auth/discord?vincular=1">${t('linkDiscord')}</a>` : ''}
        ${linked && p.provedores.includes('senha') ? `<button id="pf-unlink" class="link-btn">${t('unlinkDiscord')}</button>` : ''}
        <button id="pf-signout" class="link-btn">${t('signOut')}</button>
        ${p.exclusaoEm ? '' : `<button id="pf-delete" class="link-btn danger">${t('deleteAccount')}</button>`}
        <button id="pf-back" class="link-btn">${t('back')}</button>
      </div>
    </div>`;

  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`);
  const act = (fn: () => Promise<unknown>, after: () => void) => async () => {
    try {
      await fn();
      after();
    } catch (err) {
      o.setStatus(errorText(err), true);
    }
  };
  const refresh = () => showProfile(root, o);

  $('pf-back')!.onclick = () => o.onBack();
  root.querySelectorAll<HTMLButtonElement>('.sex-btn').forEach((b) => {
    b.onclick = () => {
      if (b.getAttribute('aria-checked') === 'true') return;
      void act(() => api('PATCH', '/api/perfil', { sexo: b.dataset.sex }), o.onAccountChanged)();
    };
  });
  $('pf-signout')!.onclick = act(() => api('POST', '/api/auth/sair'), o.onAccountChanged);
  $('pf-name-save')!.onclick = act(
    () => api('PATCH', '/api/perfil', { nome: root.querySelector<HTMLInputElement>('#pf-name')!.value }),
    () => {
      o.setStatus(t('saved'));
      o.onAccountChanged();
    },
  );
  const unlink = $('pf-unlink');
  if (unlink) unlink.onclick = act(() => api('DELETE', '/api/auth/identidade/discord'), refresh);
  const del = $('pf-delete');
  if (del)
    del.onclick = () => {
      if (confirm(t('deleteConfirm'))) void act(() => api('DELETE', '/api/conta'), o.onAccountChanged)();
    };
  const cancelDel = $('pf-cancel-del');
  if (cancelDel) cancelDel.onclick = act(() => api('POST', '/api/conta/cancelar-exclusao'), o.onAccountChanged);
}
