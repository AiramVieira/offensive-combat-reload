// Character customization: validation, the profile API, and what the look does online (health, and
// everyone seeing it, bodies included).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyStats, defaultAppearance, hitboxSize, randomAppearance, sanitizeAppearance, type Appearance } from '@shared/appearance';
import type { GameServer } from '../app';
import { Browser, Player, sleep, startTestServer } from './helpers';

describe('regras da aparência', () => {
  it('troca escolhas inválidas pelas padrão, sem aceitar nada fora do catálogo', () => {
    const bad = {
      altura: 'gigante',
      biotipo: 'gordo',
      pele: 'vermelho',
      cabelo: { id: 'rabo', cor: '#ABCDEF' },
      roupas: { camiseta: { id: '<script>', cor: '#123456' }, chapeu: { id: '', cor: '#000000' } },
      pcd: { braco: 'asa', perna: 'pernaDir' },
    };
    const a = sanitizeAppearance(bad, 'm');
    const d = defaultAppearance('m');
    expect(a.altura).toBe('medio');
    expect(a.biotipo).toBe('gordo');
    expect(a.pele).toBe(d.pele);
    // 'rabo' is a feminine style: a masculine body falls back to its own first style (the color stays).
    expect(a.cabelo).toEqual({ id: 'curto', cor: '#abcdef' });
    expect(a.roupas.camiseta).toEqual({ id: 'basica', cor: '#123456' });
    expect(a.roupas.chapeu.id).toBe('');
    expect(a.roupas.baixo).toEqual(d.roupas.baixo);
    expect(a.pcd).toEqual({ braco: '', perna: 'pernaDir' });
  });

  it('calcula os efeitos: gordo +50 de vida, sem mão recarrega 30% mais devagar, sem perna anda 25% mais devagar, altura escala tudo', () => {
    const d = defaultAppearance('f');
    expect(bodyStats(d)).toMatchObject({ scale: 1, width: 1, maxHealth: 100, reloadMul: 1, speedMul: 1 });
    const heavy = bodyStats({ ...d, biotipo: 'gordo' });
    expect(heavy.maxHealth).toBe(150);
    expect(hitboxSize(heavy)).toBeGreaterThan(1);
    const pcd = bodyStats({ ...d, pcd: { braco: 'maoDir', perna: 'pernaEsq' } });
    expect(pcd.reloadMul).toBe(1.3);
    expect(pcd.speedMul).toBe(0.75);
    expect(pcd.missing).toMatchObject({ handR: true, armR: false, legL: true });
    expect(hitboxSize(pcd)).toBeLessThan(1);
    expect(bodyStats({ ...d, pcd: { braco: 'bracoEsq', perna: '' } }).missing).toMatchObject({ armL: true, handL: true });
    expect(bodyStats({ ...d, altura: 'alto' }).scale).toBe(1.1);
    expect(bodyStats({ ...d, altura: 'pequeno' }).scale).toBe(0.9);
  });

  it('aparência aleatória dos bots é sempre válida', () => {
    for (let i = 0; i < 200; i++) {
      const sex = i % 2 ? 'f' : 'm';
      const a = randomAppearance(sex);
      expect(sanitizeAppearance(a, sex)).toEqual(a);
    }
  });
});

let game: GameServer;
beforeAll(async () => {
  game = await startTestServer();
});
afterAll(async () => {
  await game?.close();
});

async function account(name: string, look?: Partial<Appearance>) {
  const b = new Browser(game);
  await b.register(name);
  if (look) {
    const base = (await b.req('GET', '/api/perfil')).body.aparencia as Appearance;
    const r = await b.req('PATCH', '/api/perfil', { aparencia: { ...base, ...look } });
    if (r.status !== 200) throw new Error(`aparência: ${r.status}`);
  }
  return b;
}

describe('perfil', () => {
  it('começa com a aparência padrão, salva a nova e devolve já validada', async () => {
    const b = await account('Estiloso');
    const p = await b.req('GET', '/api/perfil');
    expect(p.body.aparencia).toEqual(defaultAppearance('m'));
    const look = { ...p.body.aparencia, altura: 'alto', roupas: { ...p.body.aparencia.roupas, baixo: { id: 'saiaRodada', cor: '#ff00aa' } } };
    const saved = await b.req('PATCH', '/api/perfil', { aparencia: look });
    expect(saved.status).toBe(200);
    expect(saved.body.aparencia.altura).toBe('alto');
    expect(saved.body.aparencia.roupas.baixo).toEqual({ id: 'saiaRodada', cor: '#ff00aa' });
  });

  it('trocar o sexo troca o cabelo que é do outro corpo e mantém o resto', async () => {
    const b = await account('Troca', { cabelo: { id: 'blackPower', cor: '#b3312a' }, altura: 'pequeno' });
    const r = await b.req('PATCH', '/api/perfil', { sexo: 'f' });
    expect(r.body.aparencia.cabelo).toEqual({ id: 'rabo', cor: '#b3312a' });
    expect(r.body.aparencia.altura).toBe('pequeno');
  });
});

describe('no online', () => {
  it('todos veem a aparência de quem entra; o corpo mantém a aparência; o gordo tem 150 de vida', async () => {
    const a = await account('Atirador');
    const v = await account('Grandao', { biotipo: 'gordo', pcd: { braco: 'maoEsq', perna: '' } });
    const pa = await Player.connect(game, await a.ticket());
    pa.send({ t: 'hello' });
    await pa.next('welcome');
    pa.send({ t: 'join', session: 'principal' });
    const ja = await pa.next('joined');

    const pv = await Player.connect(game, await v.ticket());
    pv.send({ t: 'hello' });
    await pv.next('welcome');
    pv.send({ t: 'join', session: 'principal' });
    const jv = await pv.next('joined');
    const vId = jv.you;

    // The newcomer sees everyone's look, and everyone sees the newcomer's.
    expect(jv.players.find((p) => p.id === ja.you)?.ap?.biotipo).toBe('medio');
    const joined = await pa.next('playerJoined', (m) => m.player.id === vId);
    expect(joined.player.ap?.biotipo).toBe('gordo');
    expect(joined.player.ap?.pcd.braco).toBe('maoEsq');

    pa.send({ t: 'respawn', p: [0, 0, 0], yaw: 0 });
    pv.send({ t: 'respawn', p: [0, 0, 10], yaw: 0 });
    await pa.next('spawned', (m) => m.id === vId);

    // One body shot: 150 minus the damage, not 100 minus it.
    pa.send({ t: 'hit', target: vId, region: 'tronco', dist: 10 });
    const dmg = await pa.next('damage', (m) => m.target === vId);
    expect(dmg.health).toBe(150 - dmg.amount);

    const kill = pa.next('kill', (m) => m.victim === vId, 8000);
    for (let i = 0; i < 10 && !pa.msgs.some((m) => m.t === 'kill'); i++) {
      await sleep(110);
      pa.send({ t: 'hit', target: vId, region: 'tronco', dist: 10 });
    }
    const k = await kill;
    expect(k.corpse.ap?.biotipo).toBe('gordo');
    pa.close();
    pv.close();
  });
});
