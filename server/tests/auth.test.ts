// Accounts over HTTP: sign-up, sign-in, limits and lockout, sessions, origin check, password reset,
// names and deletion.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { GameServer } from '../app';
import { outbox } from '../email';
import { anonymizeExpired } from '../accounts';
import { Browser, startTestServer, uniqueEmail, uniqueIp } from './helpers';

let game: GameServer;
beforeAll(async () => {
  game = await startTestServer();
});
afterAll(async () => {
  await game?.close();
});

describe('cadastro e login', () => {
  it('cria a conta, abre a sessão e mostra Nome#1234', async () => {
    const b = new Browser(game);
    await b.register('Pimpolho');
    const me = await b.req('GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.body.tag).toMatch(/^Pimpolho#\d{4}$/);
    expect(me.body.nivel).toBe(1);
    expect(me.body.provedores).toEqual(['senha']);
  });

  it('marca o cookie HttpOnly e SameSite=Lax, e Secure só quando a página veio por https', async () => {
    const http = await new Browser(game).req('POST', '/api/auth/cadastro', { email: uniqueEmail(), senha: 'senha-boa-123', nome: 'Cookie' });
    const plain = http.headers.getSetCookie()[0];
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Lax');
    expect(plain).not.toContain('Secure');
    const https = await new Browser(game).req('POST', '/api/auth/cadastro', { email: uniqueEmail(), senha: 'senha-boa-123', nome: 'Cookie' }, { 'x-forwarded-proto': 'https' });
    expect(https.headers.getSetCookie()[0]).toContain('Secure');
  });

  it('dá o mesmo erro para senha errada e e-mail inexistente', async () => {
    const b = new Browser(game);
    const { email } = await b.register();
    const wrong = await new Browser(game).req('POST', '/api/auth/entrar', { email, senha: 'errada-errada' });
    const ghost = await new Browser(game).req('POST', '/api/auth/entrar', { email: uniqueEmail(), senha: 'errada-errada' });
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(wrong.body).toEqual({ erro: 'credenciais_invalidas' });
    expect(ghost.body).toEqual(wrong.body);
  });

  it('entra com a senha certa', async () => {
    const { email, password } = await new Browser(game).register();
    const b = new Browser(game);
    expect((await b.req('POST', '/api/auth/entrar', { email, senha: password })).status).toBe(204);
    expect((await b.req('GET', '/api/me')).status).toBe(200);
  });

  it('recusa a 6ª tentativa no mesmo minuto vinda do mesmo IP', async () => {
    const b = new Browser(game);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await b.req('POST', '/api/auth/entrar', { email: uniqueEmail(), senha: 'qualquer-coisa' })).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it('bloqueia a conta por 15 min depois de 10 falhas seguidas, com a mesma mensagem genérica', async () => {
    const { email, password } = await new Browser(game).register();
    for (let i = 0; i < 10; i++) {
      const b = new Browser(game); // a different IP each time: the account lock is what's being tested
      expect((await b.req('POST', '/api/auth/entrar', { email, senha: 'errada-errada' })).status).toBe(401);
    }
    const right = await new Browser(game).req('POST', '/api/auth/entrar', { email, senha: password });
    expect(right.status).toBe(401);
    expect(right.body).toEqual({ erro: 'credenciais_invalidas' });
  });

  it('valida e-mail, senha e nome no cadastro', async () => {
    const b = new Browser(game);
    expect((await b.req('POST', '/api/auth/cadastro', { email: 'nao-e-email', senha: 'senha-boa-123', nome: 'Ok' })).body.erro).toBe('email_invalido');
    expect((await b.req('POST', '/api/auth/cadastro', { email: uniqueEmail(), senha: 'curta', nome: 'Okay' })).body.erro).toBe('senha_invalida');
    b.ip = uniqueIp();
    expect((await b.req('POST', '/api/auth/cadastro', { email: uniqueEmail(), senha: 'senha-boa-123', nome: '<script>' })).body.erro).toBe('nome_invalido');
    const { email } = await new Browser(game).register();
    b.ip = uniqueIp();
    expect((await b.req('POST', '/api/auth/cadastro', { email: email.toUpperCase(), senha: 'senha-boa-123', nome: 'Outro' })).body.erro).toBe('email_em_uso');
  });
});

describe('sessão', () => {
  it('sair revoga a sessão', async () => {
    const b = new Browser(game);
    await b.register();
    const cookie = b.cookies.get('oc_sessao')!;
    expect((await b.req('POST', '/api/auth/sair')).status).toBe(204);
    b.cookies.set('oc_sessao', cookie); // an old copy of the cookie no longer works
    expect((await b.req('GET', '/api/me')).status).toBe(401);
  });

  it('recusa cookie forjado', async () => {
    const b = new Browser(game);
    b.cookies.set('oc_sessao', 'inventado');
    expect((await b.req('GET', '/api/me')).status).toBe(401);
  });

  it('recusa pedidos que mudam estado vindos de outro site', async () => {
    const b = new Browser(game, 'http://site-malicioso.com');
    const r = await b.req('POST', '/api/auth/entrar', { email: uniqueEmail(), senha: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.erro).toBe('origem_invalida');
    const noOrigin = await fetch(`http://127.0.0.1:${game.port}/api/auth/sair`, { method: 'POST' });
    expect(noOrigin.status).toBe(403);
  });
});

describe('recuperação de senha', () => {
  it('manda o link, troca a senha uma vez, verifica o e-mail e derruba as sessões antigas', async () => {
    const owner = new Browser(game);
    const { email } = await owner.register();
    const asker = new Browser(game);
    expect((await asker.req('POST', '/api/auth/recuperar', { email })).status).toBe(204);
    const mail = outbox.filter((m) => m.to === email).pop()!;
    const token = /#redefinir=([\w-]+)/.exec(mail.text)![1];
    expect((await asker.req('POST', '/api/auth/redefinir', { token, senha: 'senha-nova-456' })).status).toBe(204);
    expect((await asker.req('POST', '/api/auth/redefinir', { token, senha: 'outra-senha-789' })).body.erro).toBe('token_invalido');
    expect((await owner.req('GET', '/api/me')).status).toBe(401);
    expect((await new Browser(game).req('POST', '/api/auth/entrar', { email, senha: 'senha-nova-456' })).status).toBe(204);
    const { rows } = await game.deps.db.query('SELECT email_verified_at FROM account WHERE email = $1', [email]);
    expect(rows[0].email_verified_at).not.toBeNull();
  });

  it('responde igual para e-mail inexistente e limita a 3 e-mails por hora por conta', async () => {
    expect((await new Browser(game).req('POST', '/api/auth/recuperar', { email: uniqueEmail() })).status).toBe(204);
    const { email } = await new Browser(game).register();
    for (let i = 0; i < 5; i++) expect((await new Browser(game).req('POST', '/api/auth/recuperar', { email })).status).toBe(204);
    expect(outbox.filter((m) => m.to === email)).toHaveLength(3);
  });
});

describe('perfil', () => {
  it('não repete o número para o mesmo nome', async () => {
    const tags = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const b = new Browser(game);
      await b.register('Repetido');
      tags.add((await b.req('GET', '/api/me')).body.tag);
    }
    expect(tags.size).toBe(4);
  });

  it('a primeira troca de nome é livre; a segunda antes de 7 dias devolve cooldown_nome', async () => {
    const b = new Browser(game);
    await b.register('Primeiro');
    const first = await b.req('PATCH', '/api/perfil', { nome: 'Segundo' });
    expect(first.status).toBe(200);
    expect(first.body.tag).toMatch(/^Segundo#/);
    expect(first.body.nomeLiberaEm).not.toBeNull();
    const second = await b.req('PATCH', '/api/perfil', { nome: 'Terceiro' });
    expect(second.status).toBe(429);
    expect(second.body.erro).toBe('cooldown_nome');
  });

  it('não deixa equipar nível bloqueado', async () => {
    const b = new Browser(game);
    await b.register();
    expect((await b.req('PATCH', '/api/perfil', { equipado: { rifle: 5 } })).body.erro).toBe('nivel_bloqueado');
  });
});

describe('exclusão de conta', () => {
  it('bloqueia o online durante a carência, deixa cancelar e anonimiza depois de 30 dias', async () => {
    const b = new Browser(game);
    const { email } = await b.register('Saindo');
    expect((await b.req('DELETE', '/api/conta')).status).toBe(204);
    expect((await b.req('GET', '/api/me')).body.exclusaoEm).not.toBeNull();
    expect((await b.req('POST', '/api/ws-ticket')).body.erro).toBe('conta_em_exclusao');
    expect((await b.req('POST', '/api/conta/cancelar-exclusao')).status).toBe(204);
    expect((await b.req('POST', '/api/ws-ticket')).status).toBe(200);

    await b.req('DELETE', '/api/conta');
    await game.deps.db.query("UPDATE account SET deletion_requested_at = now() - interval '31 days' WHERE email = $1", [email]);
    expect(await anonymizeExpired(game.deps.db)).toBeGreaterThanOrEqual(1);
    expect((await b.req('GET', '/api/me')).status).toBe(401);
    expect((await new Browser(game).req('POST', '/api/auth/entrar', { email, senha: 'senha-boa-123' })).status).toBe(401);
    const { rows } = await game.deps.db.query(
      "SELECT a.email, p.display_name FROM account a JOIN player_profile p ON p.account_id = a.id WHERE a.status = 'deleted' AND p.display_name = 'Jogador excluído'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.email === null)).toBe(true);
  });
});
