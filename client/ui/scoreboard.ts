// Scoreboard (section 5, held on Tab): free-for-all standings of the session.
import type { PlayerInfo } from '@shared/protocol';
import { t } from './strings';

export class Scoreboard {
  private el = document.getElementById('scoreboard')!;
  private body = document.getElementById('scoreboard-body')!;
  private key = '';

  constructor() {
    document.getElementById('scoreboard-title')!.textContent = t('scoreboard');
    document.getElementById('scoreboard-head')!.innerHTML = ['#', t('player'), t('level'), t('points'), t('kills'), t('deaths'), t('humiliationsShort'), 'Ping'].map((h) => `<th>${h}</th>`).join('');
  }

  set visible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
  }

  update(players: Iterable<PlayerInfo>, me: number, sessionName: string) {
    const rows = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    const key = sessionName + JSON.stringify(rows);
    if (key === this.key) return;
    this.key = key;
    document.getElementById('scoreboard-session')!.textContent = sessionName;
    this.body.innerHTML = '';
    rows.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (p.id === me) tr.className = 'me';
      if (!p.alive) tr.classList.add('dead');
      // Bots and offline players have no account level.
      const cells = [String(i + 1), p.name, p.nivel ? String(p.nivel) : '—', String(p.score), String(p.kills), String(p.deaths), String(p.humiliations), `${p.ping} ms`];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      this.body.appendChild(tr);
    });
  }
}
