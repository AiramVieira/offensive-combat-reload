# Jogar com amigos: publicar o servidor

O jogo roda no navegador. Quem joga só precisa de um **endereço**. Quem hospeda roda duas peças:

- **nginx**: entrega o jogo (HTML, JS, texturas, modelos) e repassa a API `/api` e o WebSocket `/ws`.
- **servidor do jogo** (Node): contas, sessões, regras, vida, pontos.
- **PostgreSQL** (contas, perfis, progresso, estatísticas) e **Redis** (limites de tentativas, tickets do WebSocket, links de recuperação de senha).

No Docker as quatro peças sobem juntas. Contas, e-mail e Discord estão na [seção 5](#5-contas-banco-e-mail-e-discord).

O nginx não "abre" a sua máquina para a internet. Ele só organiza o acesso a uma porta. Para os amigos chegarem até essa porta, escolha um dos caminhos da seção 2.

---

## 1. Subir o pacote (Docker)

Pré-requisito: [Docker Desktop](https://www.docker.com/products/docker-desktop/) aberto.

```bash
docker compose up -d --build        # constrói e sobe nginx + servidor → http://localhost:8080
docker compose logs -f jogo         # acompanhar o servidor
docker compose up -d --build        # depois de mudar o código: reconstrói e reinicia
docker compose down                 # desligar tudo
```

- A porta pública é a **8080**. Para outra, use por exemplo `PORTA=80 docker compose up -d --build`. No PowerShell: `$env:PORTA=80; docker compose up -d --build`.
- Só o nginx fica exposto. O servidor do jogo roda na rede interna do Docker. O banco e o Redis ficam presos a `127.0.0.1` (portas 5442 e 6392), para desenvolvimento e backup.
- Os arquivos são: [Dockerfile](../Dockerfile), [docker-compose.yml](../docker-compose.yml) e [deploy/nginx/docker.conf](../deploy/nginx/docker.conf).

**Sem Docker**, na própria máquina: `docker compose up -d banco redis` (ou um PostgreSQL 18 e um Redis seus, com `DATABASE_URL` e `REDIS_URL`) e depois `npm ci && npm run build && npm start`, que sobe jogo e servidor numa porta só (8787), sem nginx.

---

## 2. Como os amigos chegam até você

### A) Radmin VPN, a mais simples

Você já usa o Radmin VPN, e ele cria uma "rede local" pela internet:

1. Seus amigos instalam o Radmin VPN e entram na **mesma rede** que você.
2. Você sobe o pacote (seção 1).
3. Eles abrem **`http://<seu IP do Radmin>:8080`**. O IP aparece na janela do Radmin, com formato `26.x.x.x`.

Não precisa mexer em roteador nem expor nada para a internet.

As contas funcionam por aqui em `http://`: o cookie de sessão só leva `Secure` em HTTPS. A senha trafega sem HTTPS, mas dentro do túnel cifrado do Radmin. Mesmo assim, avise os amigos para não repetir senhas de outros serviços. O "Entrar com Discord" só aparece se esse endereço estiver em `DISCORD_RETORNOS` (seção 5).

### B) Túnel da Cloudflare: internet, sem mexer no roteador

Funciona mesmo quando o provedor não deixa abrir portas (CGNAT, comum no Brasil):

```bash
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8080
```

Ele mostra um endereço `https://algo.trycloudflare.com`. É só mandar para os amigos. O jogo passa a usar `wss://` sozinho quando a página está em HTTPS. O endereço muda a cada vez que o túnel reinicia. Para um endereço fixo, é preciso uma conta e um domínio na Cloudflare.

### C) Abrir a porta no roteador

1. No roteador, redirecione a porta TCP **8080** (ou 80) para o IP do seu PC na rede de casa (por exemplo `192.168.15.3`), também na **8080**. Configure um IP fixo para o PC (reserva DHCP), senão o redirecionamento se perde quando o IP mudar.
2. No Windows, libere a porta no firewall (PowerShell como administrador):
   ```powershell
   New-NetFirewallRule -DisplayName "Offensive Combat" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
   ```
3. Mande para os amigos `http://<seu IP público>:8080`. O IP público aparece em [ipify.org](https://api.ipify.org).

**Verifique o CGNAT:** se o "IP WAN" mostrado no roteador for diferente do seu IP público, ou começar com `100.64`–`100.127` ou `10.`, o provedor está usando CGNAT e o redirecionamento não vai funcionar. Nesse caso use A ou B, ou peça um IP público ao provedor.

**Cuidados:** você está expondo o seu PC. Mantenha só a porta do nginx aberta, desligue com `docker compose down` quando não estiverem jogando, e tire a regra do roteador quando não for mais usar.

### D) Servidor alugado (VPS): endereço fixo e disponível 24h

Numa máquina Linux (Oracle Cloud Free, Hetzner, DigitalOcean…), com o Docker instalado:

```bash
git clone <seu repositório> offensive-combat && cd offensive-combat   # ou copie a pasta
PORTA=80 docker compose up -d --build
```

- Para ter **HTTPS com domínio**, aponte o domínio para o IP do servidor e coloque o certificado no nginx. Uma forma é usar o [deploy/nginx/offensive-combat.conf](../deploy/nginx/offensive-combat.conf) com `certbot --nginx`. Veja a opção sem Docker abaixo.
- **Sem Docker:** instale Node 22+ e nginx; faça `npm ci && npm run build` em `/var/www/offensive-combat`; ative o serviço [deploy/offensive-combat.service](../deploy/offensive-combat.service) (servidor preso a `127.0.0.1:8787`); copie [deploy/nginx/offensive-combat.conf](../deploy/nginx/offensive-combat.conf) para `/etc/nginx/conf.d/`. Os comandos estão no topo de cada arquivo.

---

## 3. O que o nginx deste pacote faz

- Entrega o jogo com **gzip** (o JavaScript de ~5 MB vai com ~1,8 MB) e **cache** de 1 ano para `/assets/` (os nomes têm hash). A página em si é sempre revalidada, então uma atualização chega a todos no próximo recarregamento.
- Repassa **`/api`** ao servidor do jogo, com o endereço (`Host` com a porta) e o esquema (`X-Forwarded-Proto`) que o jogador usou: o servidor confere a origem de cada pedido e marca o cookie como `Secure` em HTTPS. Entrar, criar conta e recuperar senha têm um limite extra de 10 pedidos por minuto por IP.
- Repassa **`/ws`** ao servidor do jogo, com as mensagens que o WebSocket precisa (`Upgrade`/`Connection`) e sem buffer. A conexão aceita até 1 h ociosa.
- Limita cada IP a **6 conexões de jogo** e cerca de 40 pedidos/s de arquivos. O servidor do jogo tem os próprios limites (mensagens por segundo, tamanho máximo, validação de cada acerto).
- Serve `.glb` e `.ktx2` com o tipo certo.

## 4. Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| Os amigos não abrem a página | Firewall do Windows, porta não redirecionada, ou CGNAT (use Radmin ou túnel) |
| A página abre mas diz "Servidor fora do ar" | O container `jogo` caiu (`docker compose logs jogo`) ou o nginx não está repassando `/ws` |
| Todo mundo em ~10 FPS | O navegador está sem aceleração de hardware (o menu avisa; veja o README) |
| Mudei o código e nada mudou | Rode `docker compose up -d --build` e recarregue a página |
| "Servidor fora do ar" logo na tela inicial | O servidor não conecta no banco ou no Redis: `docker compose up -d banco redis` e veja `docker compose logs jogo` |
| O botão "Entrar com Discord" não aparece | O endereço aberto no navegador não está em `DISCORD_RETORNOS`, ou faltam `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` |
| O link de recuperação não chega | Sem `SMTP_USUARIO`/`SMTP_SENHA_APP` o e-mail só aparece no log do servidor; com Gmail, confira a senha de app |
| Todo pedido de login devolve `origem_invalida` | O endereço da página não bate com o `Host` que chega ao servidor: use o nginx deste pacote (ele repassa `$http_host`) ou liste o endereço em `ORIGENS_PERMITIDAS` |

---

## 5. Contas: banco, e-mail e Discord

As configurações ficam num arquivo **`.env`** ao lado do `docker-compose.yml` (ele está no `.gitignore`: nunca faça commit dele). Sem o arquivo, tudo funciona com login por e-mail e senha, e os e-mails de recuperação aparecem no log do servidor.

```ini
# Senha do PostgreSQL (troque antes de expor o servidor)
PG_SENHA=troque-isto

# Outros endereços que podem chamar a API, além do próprio site (separados por vírgula)
ORIGENS_PERMITIDAS=

# Gmail: e-mail de recuperação de senha
SMTP_USUARIO=seu.email@gmail.com
SMTP_SENHA_APP=abcdabcdabcdabcd
SMTP_REMETENTE=seu.email@gmail.com

# Discord: "Entrar com Discord"
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=...
DISCORD_RETORNOS=https://jogo.seudominio.com/api/auth/discord/retorno,http://localhost:5173/api/auth/discord/retorno
```

**Gmail.** Ative a verificação em duas etapas na conta Google e crie uma **senha de app** em [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Use essa senha de 16 letras em `SMTP_SENHA_APP`, não a senha da conta. O Gmail envia até cerca de 500 e-mails por dia; o jogo manda no máximo 3 links de recuperação por hora por conta.

**Discord.** Em [discord.com/developers/applications](https://discord.com/developers/applications), crie um aplicativo. Em **OAuth2**, copie o Client ID e o Client Secret e adicione em **Redirects** cada endereço de onde o jogo é aberto, terminando em `/api/auth/discord/retorno`, exatamente como em `DISCORD_RETORNOS`. O botão do Discord só aparece nesses endereços. O Discord pode recusar URLs `http://` que não sejam `localhost`: pelo Radmin, use e-mail e senha.

**Backup.** Os dados ficam no volume `oc-pg`:

```bash
docker compose exec banco pg_dump -U oc oc > backup-oc.sql            # salvar
docker compose exec -T banco psql -U oc oc < backup-oc.sql            # restaurar num banco vazio
```

`docker compose down` mantém o volume; `docker compose down -v` **apaga todas as contas**.

**Moderação.** Banimentos e papéis de staff são feitos pelo console do servidor. O banimento derruba o jogador da partida na hora:

```bash
docker compose exec jogo node build/admin.mjs banir "Nome#1234" "motivo" 7d     # 7d, 12h, 30m ou permanente
docker compose exec jogo node build/admin.mjs desbanir "Nome#1234"
docker compose exec jogo node build/admin.mjs papel "Nome#1234" moderador        # --remover para tirar
docker compose exec jogo node build/admin.mjs sancoes "Nome#1234"
```

Em desenvolvimento, os mesmos comandos são `npm run admin -- banir "Nome#1234" "motivo" 7d`.

**Exclusão de conta (LGPD).** O jogador pede no Perfil e tem 30 dias para desistir. Depois disso, o servidor apaga e-mail, senha, vínculos e sessões, troca o nome por "Jogador excluído" e mantém só estatísticas e histórico. Isso roda na partida do servidor e a cada 24 h.
