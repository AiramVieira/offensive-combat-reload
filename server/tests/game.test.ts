// The game connection: single-use tickets, origin check, one connection per account, revocation, and
// progress earned only from kills the server validated.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { CLOSE, NET } from '@shared/protocol';
import type { GameServer } from '../app';
import { ticketKey } from '../api';
import { ban, mute, unmute } from '../moderacao';
import { Browser, Player, sleep, startTestServer } from './helpers';

let game: GameServer;
beforeAll(async () => {
  game = await startTestServer();
});
afterAll(async () => {
  await game?.close();
});

async function signedIn(name = 'Jogador') {
  const b = new Browser(game);
  await b.register(name);
  return b;
}

async function joinMain(b: Browser) {
  const p = await Player.connect(game, await b.ticket());
  p.send({ t: 'hello' });
  const welcome = await p.next('welcome');
  p.send({ t: 'join', session: 'principal' });
  const joined = await p.next('joined');
  return { p, welcome, joined };
}

describe('ticket do WebSocket', () => {
  it('vale uma vez só', async () => {
    const b = await signedIn();
    const ticket = await b.ticket();
    const p = await Player.connect(game, ticket);
    await expect(Player.connect(game, ticket)).rejects.toThrow('recusado');
    expect(await Player.refusal(game, ticket)).toBe(401);
    p.close();
  });

  it('vence em 30 s', async () => {
    const b = await signedIn();
    const ticket = await b.ticket();
    await game.deps.redis.pexpire(ticketKey(ticket), 1);
    await sleep(20);
    expect(await Player.refusal(game, ticket)).toBe(401);
  });

  it('recusa handshake vindo de outro site', async () => {
    const b = await signedIn();
    const ticket = await b.ticket();
    expect(await Player.refusal(game, ticket, 'http://site-malicioso.com')).toBe(403);
    // The refused handshake didn't spend the ticket, and the page's own origin still gets in.
    (await Player.connect(game, ticket)).close();
  });

  it('não gasta o ticket com um GET comum', async () => {
    const b = await signedIn();
    const ticket = await b.ticket();
    expect((await fetch(`http://127.0.0.1:${game.port}/ws?ticket=${ticket}`)).status).toBe(426);
    (await Player.connect(game, ticket)).close();
  });

  it('sem sessão não há ticket', async () => {
    expect((await new Browser(game).req('POST', '/api/ws-ticket')).status).toBe(401);
  });

  it('o nome vem da conta, não da mensagem', async () => {
    const b = await signedIn('Honesto');
    const p = await Player.connect(game, await b.ticket());
    p.send({ t: 'hello', name: 'Impostor', sex: 'f' });
    const w = await p.next('welcome');
    expect(w.name).toMatch(/^Honesto#\d{4}$/);
    p.close();
  });
});

describe('conexões da conta', () => {
  it('a conexão nova derruba a antiga', async () => {
    const b = await signedIn();
    const first = await Player.connect(game, await b.ticket());
    const second = await Player.connect(game, await b.ticket());
    expect(await first.waitClose()).toBe(CLOSE.replaced);
    expect(second.closed).toBeNull();
    second.close();
  });

  it('sair da conta encerra a partida', async () => {
    const b = await signedIn();
    const { p } = await joinMain(b);
    await b.req('POST', '/api/auth/sair');
    expect(await p.waitClose()).toBe(CLOSE.revoked);
  });

  it('banimento encerra a partida e bloqueia o login', async () => {
    const b = await signedIn('Trapaceiro');
    const { p, welcome } = await joinMain(b);
    await ban(game.deps, welcome.name, 'teste', '7d');
    expect(await p.waitClose()).toBe(CLOSE.revoked);
    expect((await b.req('GET', '/api/me')).status).toBe(401);
  });
});

describe('progresso', () => {
  it('o abate validado pelo servidor dá pontos à arma, XP à conta e estatísticas, gravados ao sair', async () => {
    const a = await signedIn('Atirador');
    const v = await signedIn('Alvo');
    const A = await joinMain(a);
    const V = await joinMain(v);
    const vId = V.joined.you;
    A.p.send({ t: 'respawn', p: [0, 0, 0], yaw: 0 });
    V.p.send({ t: 'respawn', p: [0, 0, 10], yaw: 0 });
    await A.p.next('spawned', (m) => m.id === A.joined.you);
    await A.p.next('spawned', (m) => m.id === vId);

    // A locked level is ignored: the server keeps level 1.
    A.p.send({ t: 'loadout', lo: { rifle: 7, faca: 1, granada: 1 } });

    // Headshots from 10 m, spaced by the rifle's fire rate, until the kill.
    const kill = A.p.next('kill', (m) => m.victim === vId, 8000);
    for (let i = 0; i < 8 && !A.p.msgs.some((m) => m.t === 'kill'); i++) {
      A.p.send({ t: 'hit', target: vId, region: 'cabeca', dist: 10 });
      await sleep(100);
    }
    const k = await kill;
    expect(k.kind).toBe('head');
    const points = k.awards.reduce((s, x) => s + x.value, 0);
    const prog = await A.p.next('progresso', (m) => m.armas.rifle.xp > 0);
    expect(prog.armas.rifle.xp).toBe(points);
    expect(prog.armas.rifle.equipado).toBe(1);
    expect(prog.conta.xp).toBe(25);

    A.p.send({ t: 'leave' });
    V.p.send({ t: 'leave' });
    await sleep(300);
    const profileA = await a.req('GET', '/api/perfil');
    expect(profileA.body.armas.rifle.xp).toBe(points);
    expect(profileA.body.xp).toBe(25);
    expect(profileA.body.totais.abates).toBe(1);
    expect(profileA.body.totais.cabeca).toBe(1);
    expect(profileA.body.participacoes[0]).toMatchObject({ sessao: 'Rua dos Vizinhos', abates: 1 });
    expect(profileA.body.participacoes[0].saida).not.toBeNull();
    const profileV = await v.req('GET', '/api/perfil');
    expect(profileV.body.totais.mortes).toBe(1);
    expect(profileV.body.armas.rifle.xp).toBe(0);
    A.p.close();
    V.p.close();
  });

  it('o placar mostra o nível da conta', async () => {
    const b = await signedIn('Placar');
    const { joined } = await joinMain(b);
    const me = joined.players.find((x) => x.id === joined.you)!;
    expect(me.nivel).toBe(1);
    expect(me.name).toMatch(/^Placar#\d{4}$/);
  });
});

describe('mapas', () => {
  it('cada mapa tem uma sala fixa, e a sala criada leva o mapa escolhido', async () => {
    const b = await signedIn('Cartografo');
    const p = await Player.connect(game, await b.ticket());
    p.send({ t: 'hello' });
    const welcome = await p.next('welcome');
    const fixed = welcome.sessions.filter((s) => s.permanent);
    expect(fixed.map((s) => [s.id, s.map]).sort()).toEqual([['jardim', 'jardim'], ['principal', 'rua']]);

    p.send({ t: 'create', name: 'Chá das cinco', map: 'jardim' });
    expect((await p.next('joined')).session).toMatchObject({ name: 'Chá das cinco', map: 'jardim', permanent: false });

    // A map the server doesn't know falls back to the default one.
    p.send({ t: 'create', name: 'Lugar nenhum', map: 'atlantida' as never });
    expect((await p.next('joined')).session.map).toBe('rua');
    p.close();
  });
});

describe('armas vistas pelos outros', () => {
  it('trocar o equipamento avisa os outros jogadores, que recebem o loadout validado', async () => {
    const a = await joinMain(await signedIn('Atirador'));
    const b = await joinMain(await signedIn('Observador'));
    a.p.send({ t: 'loadout', lo: { rifle: 1, faca: 1, granada: 1 } });
    const m = await b.p.next('playerLoadout', (x) => x.id === a.joined.you);
    expect(m.lo).toEqual({ rifle: 1, faca: 1, granada: 1 });
    // Levels the account hasn't unlocked never reach the others.
    a.p.send({ t: 'loadout', lo: { rifle: 9, faca: 7, granada: 3 } });
    const n = await b.p.next('playerLoadout', (x) => x.id === a.joined.you);
    expect(n.lo).toEqual({ rifle: 1, faca: 1, granada: 1 });
    a.p.close();
    b.p.close();
  });

  it('quem entra recebe o loadout de quem já está na partida', async () => {
    const a = await joinMain(await signedIn('Veterano'));
    const b = await joinMain(await signedIn('Novato'));
    const info = b.joined.players.find((p) => p.id === a.joined.you);
    expect(info?.lo).toBeDefined();
    a.p.close();
    b.p.close();
  });
});

describe('chat da sala', () => {
  it('a fala chega a todos da sala, inclusive a quem falou, já limpa', async () => {
    const a = await joinMain(await signedIn('Falante'));
    const b = await joinMain(await signedIn('Ouvinte'));
    a.p.send({ t: 'chat', text: '  oi‮   pessoal\n<3  ' });
    const heard = await b.p.next('chat', (m) => m.id === a.joined.you);
    expect(heard.text).toBe('oi pessoal <3');
    expect(heard.name).toBe(a.joined.players.find((p) => p.id === a.joined.you)!.name);
    expect((await a.p.next('chat', (m) => m.id === a.joined.you)).text).toBe('oi pessoal <3');
    // Too long is cut, empty is dropped.
    a.p.send({ t: 'chat', text: 'x'.repeat(500) });
    expect((await b.p.next('chat', (m) => m.id === a.joined.you)).text).toHaveLength(NET.chatMax);
    a.p.close();
    b.p.close();
  });

  it('quem manda rápido demais é segurado depois da rajada', async () => {
    const a = await joinMain(await signedIn('Spammer'));
    for (let i = 0; i <= NET.chatBurst; i++) a.p.send({ t: 'chat', text: `msg ${i}` });
    expect((await a.p.next('chatRefused')).reason).toBe('slow');
    a.p.close();
  });

  it('silenciar vale na partida em andamento, e dessilenciar devolve o chat', async () => {
    const a = await joinMain(await signedIn('Boquirroto'));
    const b = await joinMain(await signedIn('Paciente'));
    await mute(game.deps, a.welcome.name, 'teste', '1h');
    await sleep(200);
    a.p.send({ t: 'chat', text: 'xingamento' });
    expect((await a.p.next('chatRefused')).reason).toBe('muted');
    await unmute(game.deps, a.welcome.name);
    await sleep(200);
    a.p.send({ t: 'chat', text: 'desculpa' });
    expect((await b.p.next('chat', (m) => m.id === a.joined.you)).text).toBe('desculpa');
    expect(b.p.msgs.some((m) => m.t === 'chat' && m.text === 'xingamento')).toBe(false);
    a.p.close();
    b.p.close();
  });
});
