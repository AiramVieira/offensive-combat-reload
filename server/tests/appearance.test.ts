// Character customization: validation, the profile API, and what the look does online (health, and
// everyone seeing it, bodies included).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyStats, DEFAULT_FACE, defaultAppearance, EYE_STYLES, FACE_SHAPES, hitboxSize, randomAppearance, sanitizeAppearance, sanitizeFace, wear, type Appearance } from '@shared/appearance';
import { CLOTH_COLORS } from '@shared/palette';
import { computeDamage, HIT_REGIONS, LETHAL_DAMAGE, WEAPONS } from '@shared/weapons';
import type { GameServer } from '../app';
import { Browser, Player, sleep, startTestServer } from './helpers';

describe('regras da aparência', () => {
  it('troca escolhas inválidas pelas padrão, sem aceitar nada fora do catálogo', () => {
    const bad = {
      altura: 'gigante',
      biotipo: 'gordo',
      pele: 'vermelho',
      cabelo: { id: 'rabo', cor: '#B3282D' },
      itens: { tronco: { id: '<script>', cores: ['#123456'] }, cabeca: { id: 'bone', cores: ['#5c6435'] }, rosto: { id: 'naoExiste', cores: [] } },
      pcd: { braco: 'asa', perna: 'pernaDir' },
    };
    const a = sanitizeAppearance(bad, 'm');
    const d = defaultAppearance('m');
    expect(a.v).toBe(2);
    expect(a.altura).toBe('medio');
    expect(a.biotipo).toBe('gordo');
    expect(a.pele).toBe(d.pele);
    // Any body can have any hair style (style guide); the color is the palette's.
    expect(a.cabelo).toEqual({ id: 'rabo', cor: '#b3282d' });
    // A required slot with an unknown item gets the default back; an optional one stays empty.
    expect(a.itens.tronco).toEqual(d.itens.tronco);
    expect(a.itens.cabeca?.id).toBe('bone');
    expect(a.itens.rosto).toBeUndefined();
    expect(a.pcd).toEqual({ braco: '', perna: 'pernaDir' });
  });

  it('converte a aparência antiga (versão 1) para os slots do catálogo', () => {
    const v1 = {
      altura: 'alto',
      biotipo: 'medio',
      pele: '#eec4a4',
      olhos: '#4a6fa5',
      olhosEstilo: 'marcante',
      cabelo: { id: 'curto', cor: '#3b2418' },
      roupas: {
        camiseta: { id: 'polo', cor: '#2d3b6b' },
        baixo: { id: 'saiaRodada', cor: '#ff00aa' },
        sapatos: { id: 'bota', cor: '#222226' },
        chapeu: { id: 'gorro', cor: '#2f9bff' },
        oculos: { id: '', cor: '#222226' },
        pulseira: { id: 'relogio', cor: '#6b4226' },
      },
      pcd: { braco: '', perna: '' },
    };
    const a = sanitizeAppearance(v1, 'm');
    expect(a.altura).toBe('alto');
    expect(a.olhosEstilo).toBe('marcante');
    // Saved before the face's features: the face it had (the defaults).
    expect(a.rosto).toEqual(DEFAULT_FACE);
    expect(Object.keys(a.itens).sort()).toEqual(['baixo', 'cabeca', 'calcado', 'pulsoE', 'tronco']);
    expect(a.itens.tronco?.id).toBe('polo');
    expect(a.itens.pulsoE?.id).toBe('relogio');
    // Old free colors snap to the palette (no accent on the primary color of a big piece).
    expect(CLOTH_COLORS).toContain(a.itens.baixo!.cores[0]);
    expect(a.itens.tronco!.cores).toHaveLength(3);
  });

  it('rosto: formato, olhos, sobrancelhas, nariz, boca, orelhas e marcas válidos; o resto volta ao padrão', () => {
    const ok = { formato: 'coracao', sobrancelhas: 'grossa', nariz: 'aquilino', boca: 'carnuda', orelhas: 'abano', marcas: 'sardas' };
    const a = sanitizeAppearance({ olhosEstilo: 'puxado', rosto: ok }, 'f');
    expect(a.olhosEstilo).toBe('puxado');
    expect(a.rosto).toEqual(ok);
    // Every value of every list is accepted.
    for (const formato of FACE_SHAPES) expect(sanitizeFace({ formato }).formato).toBe(formato);
    for (const olhosEstilo of EYE_STYLES) expect(sanitizeAppearance({ olhosEstilo }, 'm').olhosEstilo).toBe(olhosEstilo);
    // Unknown values, wrong types and extra fields: each feature falls back on its own, nothing extra is kept.
    const bad = sanitizeAppearance({ olhosEstilo: 'laser', rosto: { formato: 'triangulo', sobrancelhas: 42, nariz: 'aquilino', boca: null, orelhas: '<b>', marcas: ['pinta'], extra: 'x' } }, 'm');
    expect(bad.olhosEstilo).toBe('redondo');
    expect(bad.rosto).toEqual({ ...DEFAULT_FACE, nariz: 'aquilino' });
    expect(Object.keys(bad.rosto).sort()).toEqual(Object.keys(DEFAULT_FACE).sort());
    // Not an object at all.
    expect(sanitizeAppearance({ rosto: 'quadrado' }, 'm').rosto).toEqual(DEFAULT_FACE);
    expect(defaultAppearance('m').rosto).toEqual(DEFAULT_FACE);
  });

  it('aparência da versão 2 salva antes do rosto ganha o rosto padrão e mantém o resto', () => {
    const old = { ...defaultAppearance('m'), olhosEstilo: 'amendoado', altura: 'alto' } as Record<string, unknown>;
    delete old.rosto;
    const a = sanitizeAppearance(old, 'm');
    expect(a.rosto).toEqual(DEFAULT_FACE);
    expect(a.olhosEstilo).toBe('amendoado');
    expect(a.altura).toBe('alto');
    // Sanitizing again changes nothing (what the server stores is stable).
    expect(sanitizeAppearance(a, 'm')).toEqual(a);
  });

  it('um item que ocupa vários slots tira o que estava neles', () => {
    const a = defaultAppearance('m');
    wear(a, 'cabeca', 'bone', 'm');
    wear(a, 'rosto', 'escuros', 'm');
    expect(a.itens.cabeca?.id).toBe('bone');
    expect(a.itens.rosto?.id).toBe('escuros');
    // Taking the top off gives the default back (the top is required).
    wear(a, 'tronco', '', 'm');
    expect(a.itens.tronco).toEqual(defaultAppearance('m').itens.tronco);
    // An item stored under a slot that isn't its own is dropped.
    const wrong = sanitizeAppearance({ itens: { rosto: { id: 'bone', cores: [] } } }, 'm');
    expect(wrong.itens.rosto).toBeUndefined();
  });

  it('acentos não vão na cor principal das peças grandes; vão nas pequenas', () => {
    const a = sanitizeAppearance({ itens: { tronco: { id: 'basica', cores: ['#e0702a', '#e0702a'] }, cabeca: { id: 'bone', cores: ['#e0702a'] } } }, 'm');
    expect(a.itens.tronco!.cores[0]).not.toBe('#e0702a');
    expect(a.itens.tronco!.cores[1]).toBe('#e0702a');
    expect(a.itens.cabeca!.cores[0]).toBe('#e0702a');
  });

  it('altura e biotipo são só visuais; sem mão recarrega 30% mais devagar, sem perna anda 25% mais devagar', () => {
    const d = defaultAppearance('f');
    expect(bodyStats(d)).toMatchObject({ visualScale: 1, maxHealth: 100, reloadMul: 1, speedMul: 1 });
    // Same health and hitbox for every height and build (style guide).
    for (const biotipo of ['magro', 'gordo'] as const) {
      for (const altura of ['pequeno', 'alto'] as const) {
        const b = bodyStats({ ...d, biotipo, altura });
        expect(b.maxHealth).toBe(100);
        expect(hitboxSize(b)).toBe(1);
      }
    }
    const pcd = bodyStats({ ...d, pcd: { braco: 'maoDir', perna: 'pernaEsq' } });
    expect(pcd.reloadMul).toBe(1.3);
    expect(pcd.speedMul).toBe(0.75);
    expect(pcd.missing).toMatchObject({ handR: true, armR: false, legL: true });
    expect(hitboxSize(pcd)).toBeLessThan(1);
    expect(bodyStats({ ...d, pcd: { braco: 'bracoEsq', perna: '' } }).missing).toMatchObject({ armL: true, handL: true });
    // The visual height varies a little (the hitbox doesn't).
    expect(bodyStats({ ...d, altura: 'alto' }).visualScale).toBe(1.04);
    expect(bodyStats({ ...d, altura: 'pequeno' }).visualScale).toBe(0.96);
  });

  it('dano por zona da hitbox segue o guia: cabeça 2,5×, pescoço 1,5×, mãos 0,5×, virilha mata', () => {
    const rifle = WEAPONS.rifle_padrao;
    for (const r of HIT_REGIONS) if (r !== 'virilha') expect(rifle.multiplicadores[r]).toBeGreaterThan(0);
    const base = rifle.dano.max;
    expect(computeDamage(rifle, 5, 'cabeca')).toBe(Math.round(base * 2.5));
    expect(computeDamage(rifle, 5, 'pescoco')).toBe(Math.round(base * 1.5));
    expect(computeDamage(rifle, 5, 'peito')).toBe(base);
    expect(computeDamage(rifle, 5, 'maos')).toBe(Math.round(base * 0.5));
    expect(computeDamage(rifle, 5, 'canelas')).toBe(Math.round(base * 0.6));
    expect(computeDamage(rifle, 5, 'virilha')).toBe(LETHAL_DAMAGE);
  });

  it('aparência aleatória dos bots é sempre válida', () => {
    for (let i = 0; i < 200; i++) {
      const sex = i % 2 ? 'f' : 'm';
      const a = randomAppearance(sex);
      expect(sanitizeAppearance(a, sex)).toEqual(a);
    }
    // Bots vary the face too.
    const shapes = new Set(Array.from({ length: 60 }, () => randomAppearance('m').rosto.formato));
    expect(shapes.size).toBeGreaterThan(2);
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
    const look = { ...p.body.aparencia, altura: 'alto', itens: { ...p.body.aparencia.itens, baixo: { id: 'saiaRodada', cores: ['#5c6435'] } } };
    const saved = await b.req('PATCH', '/api/perfil', { aparencia: look });
    expect(saved.status).toBe(200);
    expect(saved.body.aparencia.altura).toBe('alto');
    expect(saved.body.aparencia.itens.baixo).toEqual({ id: 'saiaRodada', cores: ['#5c6435'] });
  });

  it('trocar o sexo mantém cabelo e roupas (tudo serve em qualquer corpo)', async () => {
    const b = await account('Troca', { cabelo: { id: 'blackPower', cor: '#b3282d' }, altura: 'pequeno' });
    const r = await b.req('PATCH', '/api/perfil', { sexo: 'f' });
    expect(r.body.aparencia.cabelo).toEqual({ id: 'blackPower', cor: '#b3282d' });
    expect(r.body.aparencia.altura).toBe('pequeno');
  });
});

describe('no online', () => {
  it('todos veem a aparência de quem entra; o corpo mantém a aparência; o gordo tem a mesma vida', async () => {
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

    // One chest shot: 100 minus the damage (the build is only a look).
    pa.send({ t: 'hit', target: vId, region: 'peito', dist: 10 });
    const dmg = await pa.next('damage', (m) => m.target === vId);
    expect(dmg.health).toBe(100 - dmg.amount);

    const kill = pa.next('kill', (m) => m.victim === vId, 8000);
    for (let i = 0; i < 10 && !pa.msgs.some((m) => m.t === 'kill'); i++) {
      await sleep(110);
      pa.send({ t: 'hit', target: vId, region: 'peito', dist: 10 });
    }
    const k = await kill;
    expect(k.corpse.ap?.biotipo).toBe('gordo');
    pa.close();
    pv.close();
  });
});
