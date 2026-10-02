# Offensive Combat (recriação em Three.js)

Homenagem de mecânicas ao FPS de navegador da U4iA Games. Esta é a **Fase 1 do roadmap**: protótipo offline de tiro.

Precisa só do [Bun](https://bun.com) 1.4 ou mais novo (o Node não é usado em nenhuma etapa):

```bash
bun install
docker compose up -d banco redis   # PostgreSQL + Redis das contas (uma vez; ficam rodando)
bun run dev:online   # servidor do jogo + Vite: http://localhost:5173
bun run dev          # só o cliente (treino offline funciona sem servidor)
bun test             # testes do servidor (usam o banco e o Redis acima)
bun run typecheck    # TypeScript 7 (o compilador nativo, em Go)
bun run build && bun start   # produção: jogo e servidor numa porta só, http://localhost:8787
docker compose up -d --build # produção com nginx, banco e Redis: http://localhost:8080
```

Para jogar com os colegas, `bun link` (uma vez, nesta pasta) cria o comando global **`offensive`**. De qualquer pasta, ele abre o Docker se estiver fechado, constrói e sobe tudo, espera o jogo responder e mostra os endereços para mandar (Radmin, Wi-Fi). Também tem `offensive parar`, `offensive logs`, `offensive status` e `offensive firewall`.

Para **publicar e jogar com amigos** (Radmin VPN, túnel, roteador ou servidor alugado, com nginx), veja **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## No celular

O jogo detecta sozinho se está num **PC** (teclado e mouse) ou no **navegador de um celular/tablet** (toque) — `?mobile=1` ou `?mobile=0` na URL força um dos dois. No celular:
- **Controles de toque** (no estilo do CoD Mobile, com ícones de linha minimalistas): arraste no lado esquerdo para andar (empurrando até a borda o personagem corre), arraste no lado direito para mirar, botão grande de tiro embaixo à direita (dá para arrastá-lo e mirar enquanto atira; há um segundo botão de tiro à esquerda) com o de mirar ao lado (tocar liga/desliga, ou segurar, nas configurações), pular e agachar no canto, recarregar, faca e granada (segure para preparar, solte para arremessar). Em cima: pausar, placar e tela cheia. A mira tem curva de resposta: arrastos lentos são precisos, rápidos viram mais. O HUD no celular é limpo (texto e barras finas, sem caixas) e o aparelho vibra de leve ao acertar (Android). O aviso de humilhar um corpo é tocado na própria caixa.
- **Configurações** (menu de pausa): sensibilidade do toque, tamanho e opacidade dos botões, **Ajustar botões** (arraste cada botão para onde preferir), segurar para mirar, **assistência de mira** (desligada por padrão; ligada, a mira desacelera sobre um inimigo e acompanha o movimento dele enquanto você mira, sem puxar a mira de longe) e tela cheia ao jogar.
- **Tela cheia**: ao tocar em Jogar o jogo entra em tela cheia e trava na horizontal (Android e iPad). No **iPhone**, o Safari não permite tela cheia em páginas: use **Compartilhar → Adicionar à Tela de Início**; aberto pelo ícone, o jogo já abre em tela cheia e na horizontal.
- A partida é jogada com o celular **deitado**; em pé aparece "Gire o celular". Os gráficos começam leves (sem sombras) e melhoram sozinhos se o aparelho aguentar 60 FPS.

## Controle (PS4, PS5, Xbox 360, Xbox One)

Funciona no navegador do **PC** (USB ou Bluetooth) e do **celular** (Bluetooth: Chrome no Android, Safari no iPhone/iPad), pela Gamepad API — é só ligar o controle e apertar um botão. O jogo reconhece se é PlayStation ou Xbox e mostra os botões certos nos avisos e na ajuda.
- **Na partida** (layout do CoD): L2/LT mira · R2/RT atira · L1/LB granada (segure para preparar) · R1/RB ou R3 faca · ✕/A pula · ◯/B agacha (tocar alterna; correndo, desliza) · □/X recarrega · △/Y humilhar · L3 corre · Options/Menu pausa · Touchpad/View placar. Analógico esquerdo anda, o direito mira (zona morta, curva de resposta e um giro mais rápido segurando no extremo). O controle vibra ao atirar, acertar e levar dano.
- **Nos menus**: D-pad ou analógico move o foco, ✕/A confirma (seleções trocam de opção, controles deslizantes andam com ←/→), ◯/B volta, L1/R1 trocam de aba (editor de personagem), o analógico direito rola as listas. Start/Options volta ao jogo da pausa.
- **Configurações**: sensibilidade do controle e **assistência de mira** (a mesma do celular: desligada por padrão; ligada, a mira desacelera sobre um inimigo e acompanha o movimento dele enquanto você mira, sem nunca puxar a mira de longe; nunca vale para o mouse).
- No PC, jogar com controle não prende o mouse; um clique no jogo devolve o controle ao mouse. No celular, os botões de toque somem enquanto o controle está em uso e voltam ao tocar na tela.

## Jogar online

Ao abrir o jogo, a **home** mostra a sua **conta** e três opções. O **sexo do personagem** é escolhido no **Perfil** (masculino ou feminino: a personagem tem cabelo com rabo de cavalo e silhueta própria; todos veem a escolha, online e nos corpos); sem conta, o personagem é o masculino.
- **Jogar online** (exige conta): lista as sessões abertas, com o mapa e quantos jogadores há em cada uma, e permite **criar** uma sessão com nome e mapa. Cada mapa tem uma sessão fixa que sempre existe ("Rua dos Vizinhos" e "Jardim do Dragão"). Cada sessão é um **mata-mata livre** de até 10 jogadores: todos contra todos.
- **Contra bots:** mata-mata livre offline contra 3 a 9 bots (fácil, normal ou difícil). Veja [Bots](#bots).
- **Treino offline:** o campo com os bonecos, sem servidor.

O seletor **Mapa** da home vale para os bots e o treino; online, o mapa é o da sessão. O mapa só é montado depois da escolha.

### Contas

Para jogar online é preciso entrar numa conta, com **e-mail e senha** ou com o **Discord**. Treino e contra bots funcionam sem conta, com todas as armas no nível 1.

- O jogador aparece como **Nome#1234**: nomes podem repetir, o número diferencia. A primeira troca de nome é livre; depois, uma a cada 7 dias.
- O **Perfil** (na home) tem a escolha do sexo do personagem e mostra o nível da conta, as estatísticas (abates, mortes, na cabeça, no pássaro, facadas, opressões, tempo jogado) e as últimas 10 participações. Ali também ficam "Vincular Discord", "Sair da conta" e "Excluir conta" (30 dias para desistir).
- A **conta tem nível** com XP próprio, ganho só online: 10 por minuto vivo, 25 por abate e 50 por opressão. Do nível n para o n+1 custa 1000 × n^1,5 ([shared/data/nivel_conta.json](shared/data/nivel_conta.json)). O placar (`Tab`) mostra o nível de cada um.
- "Esqueci a senha" manda um link válido por 24 h. Sem Gmail configurado, o link aparece no log do servidor.
- A sessão fica num cookie `HttpOnly` por 30 dias (renovados a cada uso); o navegador não guarda token nenhum. O WebSocket abre com um ticket de uso único válido por 30 s. A mesma conta só joga em um lugar por vez: entrar em outro derruba a conexão antiga.
- Configuração de e-mail, Discord, backup e moderação: [docs/DEPLOY.md](docs/DEPLOY.md#5-contas-banco-e-mail-e-discord).

### Personalizar o personagem

No **Perfil → Personalizar personagem** há um editor no estilo do "Criar um Sim": o boneco em 3D num palco (arraste para girar, role para aproximar), abas por categoria (Corpo, Rosto e cabelo, Camiseta, Parte de baixo, Sapatos, Acessórios, Modo PCD) e cada opção como uma miniatura renderizada do próprio personagem, nas cores atuais. A câmera aproxima da parte que está sendo editada. Online, cada jogador aparece como se personalizou, e o corpo caído também.

Os personagens usam um **sistema modular** ([client/character/](client/character/)): um corpo base com esqueleto, roupas e cabelos que compartilham o mesmo esqueleto, e itens presos em sockets (chapéu, óculos, pulseira, rifle). O estilo é anime low poly esguio (cabeça com cerca de 1/6 da altura, sombra pintada quente), com rosto pintado (3 estilos de olho). Hoje as peças são geradas em código, já no formato de GLB exportado do Blender; trocar por modelos de verdade é registrar a `url` do GLB. No jogo, cada personagem é mesclado num único mesh (2 draw calls). Detalhes e guia do Blender: [docs/PERSONAGENS.md](docs/PERSONAGENS.md).

- **Corpo:** altura (Pequeno, Médio, Alto), biotipo (Magro, Médio, Gordo) e cor da pele (8 tons ou qualquer cor).
- **Rosto:** estilo dos olhos (redondos, amendoados, marcantes) e cor dos olhos.
- **Cabelo:** 3 estilos masculinos (curto, topete, black power) e 3 femininos (rabo de cavalo, longo solto, coque), em qualquer cor.
- **Roupas** (3 de cada, para todos, cada peça com a cor que quiser): camiseta (básica, regata, polo); calça (jeans, cargo, moletom), bermuda (praia, jeans, esportiva) ou saia (lápis, rodada, de pregas); sapatos (tênis, bota, chinelo); chapéu (boné, palha, gorro); óculos (escuros, redondos, aviador); pulseira (couro, miçangas, relógio). Chapéu, óculos e pulseira são opcionais.
- **Modo PCD:** personagem sem o braço esquerdo ou direito, sem a mão esquerda ou direita, e/ou sem a perna esquerda ou direita. Aparece na terceira pessoa e também nas mãos da primeira pessoa: sem um braço, o rifle fica numa mão só; sem a mão direita, a faca vai para a esquerda; sem a esquerda, a granada vai para a direita.

O que muda no jogo ([shared/appearance.ts](shared/appearance.ts), aplicado no cliente e no servidor):

| Escolha | Efeito |
| --- | --- |
| Altura | O corpo, as hitboxes e a altura da visão escalam juntos: Pequeno 90% (visão a 1,49 m), Médio 100% (1,65 m), Alto 110% (1,81 m). Quem é alto vê mais longe por cima das coisas, mas é um alvo maior. |
| Biotipo | Gordo: **150 de vida** e tronco 30% mais largo. Magro: tronco 15% mais estreito. |
| Sem mão ou sem braço | A hitbox do braço some (ou encurta sem a mão); **recarrega 30% mais devagar**. |
| Sem perna | Só fica a hitbox do cotoco; **anda 25% mais devagar**. |

O editor mostra esses efeitos (vida, altura da visão, tamanho da hitbox, recarga e velocidade) enquanto você escolhe. O bloqueio de movimento (onde o personagem cabe) é igual para todos. Os bots ganham um visual aleatório, com os mesmos efeitos.

**Como os outros entram:** na mesma rede, eles abrem `http://<seu-ip>:5173` (o Vite mostra o endereço "Network"; no Windows, permita o Bun no firewall quando ele pedir). Pela internet, veja [docs/DEPLOY.md](docs/DEPLOY.md).

**No jogo:** `Tab` mostra o placar (pontos, abates, mortes, opressões, ping) e `Esc` → "Sair para o início" volta para a home.

### Nascimento (seção 6)

No mata-mata livre (online e contra bots) há **pontos de nascimento neutros** espalhados pelo mapa: 21 na Rua dos Vizinhos (térreo e andar de cima das casas, vãos entre as casas, fundos, quintais, pontas da rua, casa na árvore e torre) e 24 no Jardim do Dragão (salas e varandas dos pavilhões, os três andares do pagode, corredor, ilha, colina e pátios). O jogo nunca escolhe um ponto a menos de 2 m de alguém. Também evita pontos com inimigo a menos de 15 m ou com visão direta do lugar, e sorteia entre os três melhores. Contra bots, quem nasce fica **2 s protegido** (pisca e não recebe dano). A proteção acaba antes se a pessoa atirar.

### O que é do servidor e o que é do cliente

O servidor ([server/](server/)) é a autoridade sobre **contas, vida, dano, abates, pontos, progresso das armas, respawn e corpos oprimíveis**. Ele usa as mesmas regras de `shared/` que o cliente (dados das armas, níveis de granada, tabela de pontos). O cliente envia sua posição a 20 Hz e informa o que seus tiros, facadas e granadas acertaram. O servidor **confere cada informação** antes de aplicar: se os dois estão vivos, a cadência, a distância real entre os jogadores (com folga para a latência), o alcance, o raio da granada e a janela e distância da opressão. Os outros jogadores aparecem **interpolados 100 ms no passado** entre dois snapshots, com as mesmas hitboxes dos bonecos. O protocolo está em [shared/protocol.ts](shared/protocol.ts).

**Ainda não feito** (próxima etapa da seção 14): predição e reconciliação com o servidor simulando o movimento (hoje a posição é confiada ao cliente); compensação de lag (rewind das hitboxes no servidor); mensagens binárias; fim de partida (limite de abates e tempo) e votação de mapa.

## Progressão das armas

Cada abate rende pontos (o abate mais os bônus: tiro na cabeça, "no pássaro", facada pelas costas…) **só para a arma que matou**. Quem só usa o rifle só evolui o rifle; para evoluir a faca e a granada é preciso matar com elas. O progresso fica **na conta**, no servidor: os pontos só vêm de abates online que o servidor validou, e ele avisa o jogador a cada mudança. No campo de tiro e contra bots vale o nível equipado da conta, mas esses modos não dão pontos. Sem conta, as armas ficam no nível 1.

O **Arsenal**, no menu (início e pausa), mostra cada arma: nível equipado, barra de pontos até o próximo nível e todos os níveis (passe o mouse para ler o que cada um faz). Clique num nível liberado para equipá-lo; ao subir de nível, o novo é equipado automaticamente se você estava usando o seu melhor.

| Nível | Rifle (mira e acabamento; dano, pente, cadência e recuo melhoram a cada nível) | Faca (o alcance cresce a cada nível) | Granada |
|---|---|---|---|
| 1 | Rifle Padrão: mira de ferro | Faca de Cozinha | Granada de Fragmentação (explode no contato) |
| 2 | Remendado com Fita: ponto vermelho | Colher de Pau da Vó | **Mina Terrestre**: G planta; arma em 1 s e explode quando um inimigo pisa perto; some quando você renasce (continua no mapa enquanto você está morto); até 3 no mapa |
| 3 | da Tia do Zap: holográfica de carinha feliz, rosa | **Frango de Borracha** (grita a cada golpe) | **Dose Dupla**: um G lança duas granadas gastando uma carga |
| 4 | Pisca-Pisca de Natal: holográfica com lupa 1,5x | Baguete Amanhecida | |
| 5 | Tunado com Adesivo de Chama: luneta 2x | Peixe Congelado | |
| 6 | com Luneta do Vovô: luneta 3x, madeira e latão | Macarrão de Piscina | |
| 7 | Dourado Ostentação: luneta 4x, pente de 40 | Sabre de Luz Paraguaio | |

Pontos necessários: rifle 400 / 1000 / 1800 / 2800 / 4000 / 5500; faca 300 / 750 / 1350 / 2100 / 3000 / 4100; granada 500 / 1300. Com luneta, mirar mostra a visão da luneta. Tudo fica em [shared/data/progression.json](shared/data/progression.json). Online, o servidor aplica o dano, a cadência e o alcance do nível equipado e ignora níveis que a conta ainda não liberou.

## Bots

No modo **Contra bots**, cada bot é um jogador completo: usa o mesmo movimento, o mesmo Rifle Padrão (cadência, pente, recarga, dispersão e recuo), as mesmas hitboxes e as mesmas regras de pontos. Eles **caçam qualquer um**, incluindo os outros bots. Andam por uma malha de navegação (recast-navigation) gerada na hora a partir dos colisores do mapa. Só enxergam quem está no campo de visão e sem parede no meio, e percebem quem atira neles. Entre as reações: mirar com velocidade limitada, controlar o recuo, disparar em rajadas, dar facada de perto, recuar com pouca vida, perseguir até a última posição vista e dançar em cima dos corpos. A dificuldade muda o tempo de reação, a precisão, o campo de visão e a agressividade. `Tab` mostra o placar de todos, e `F4` mostra a malha de navegação. Por enquanto os bots existem só offline; bots nas sessões online precisam de simulação no servidor.

## O que existe na Fase 1

- **Mapa "Rua dos Vizinhos"** (80 × 60 m): três faixas, casas de dois andares atravessáveis com telhado de duas águas, rua com carros modelados (silhueta com caixas de roda, cabine com colunas e vidros, rodas com aro, para-choques, faróis e lanternas, placas Mercosul, retrovisores, pintura com reflexo), van de mudança e caminhão de sorvete com janela de atendimento, quintais com cercas, piscina vazia, casa na árvore, torre de 7 m e uma casinha de cachorro carregada de um .glb, guardada pela **Amora**, uma Chow Chow preta: ela acompanha com a cabeça quem se aproxima, e quem passa na frente da porta é **mordido e morre na hora** (offline, contra bots e online; os bots contornam a área). Escadas são sólidas por baixo (não dá para entrar no vão).
- **Mapa "Jardim do Dragão"** (80 × 60 m): jardim chinês com uma **casa de chá** de dois andares (paredes de papel, varanda em três lados e um **gongo** que toca quando leva tiro), um **pagode** de três andares com varanda em cada andar, mais dois pavilhões de dois andares com varanda, um **lago com carpas** e uma **fonte do dragão** na ilha (o dragão cospe **fogo** quando leva tiro), pontes em zigue-zague, ponte de pedra em arco, pedras de pisar, portão **paifang** no pátio oeste, **portão lua** no pátio leste, colina de pedras com um pavilhão no topo, corredor coberto com biombos de papel, fonte de três andares, bambus, pinheiros, cerejeiras, bonsais e lanternas de papel que **balançam com os tiros**. As **paredes de papel** são atravessadas pelas balas (perdem só 5% do dano).
- **Texturas e mapas do Blender:** biblioteca de superfícies (tijolo, madeira, telhado, reboco…) com texturas repetidas em metros e trocáveis por arquivo, e carregador glTF com as convenções `COL_`, `SPAWN_`, `MAT_`, `DUMMY_`. Veja **[docs/MAPAS.md](docs/MAPAS.md)**. Mapa de teste em `?mapa=/maps/arena_teste.glb`.
- **Controlador em primeira pessoa** (Rapier, passo fixo de 60 Hz, render interpolado): andar, correr, agachar, pular, degraus automáticos, dano de queda acima de 6 m, regeneração de vida. Valores da seção 4 do documento de design.
- **Rifle Padrão hitscan** 100% guiado por dados ([shared/data/weapons/rifle_padrao.json](shared/data/weapons/rifle_padrao.json)): cadência, pente/reserva, recarga tática/vazia, dispersão em 4 estados com acúmulo, padrão de recuo, mira (ADS) com zoom, atraso de saída do sprint, queda de dano por distância, multiplicador por região e **penetração**. O tiro atravessa superfícies finas de madeira (cercas, paredes da casa na árvore, guarda-corpos, escadas e pisos de madeira) com 60% do dano, e de vidro com 90%. O limite é de até 2 superfícies, e cada uma pode ter no máximo 40 cm de espessura no caminho da bala: um caixote, ou uma tábua atingida muito de lado, segura o tiro. Tiro na virilha mata mesmo através da madeira. Paredes de tijolo, reboco e concreto, e os carros, seguram o tiro.
- **Bonecos de treino** com hitboxes simples (cabeça, tronco, braços, pernas), alguns se movendo, regeneração de vida e respawn.
- **Faca (`F`)**: mata com um golpe, com investida curta até alvos a ~3 m; bônus de "Facada" e "Pelas costas" ([faca.json](shared/data/weapons/faca.json)).
- **"No pássaro!"**: tiro na virilha (zona marcada pela fivela do cinto) mata na hora, com faixa na tela e bônus.
- **Opressão (`E`)**: depois do abate, o corpo mostra um timer de 6 s; em cima dele, `E` faz a "Dancinha da Vitória" em terceira pessoa (sem poder atirar) e rende **150 pontos** (o triplo do valor original, porque você fica exposto dançando). Cada corpo só pode ser oprimido uma vez; só a morte interrompe a dança.
- **Granada (`G`)**: segure para tirar o pino e cozinhar. Se passar do pavio de 3 s, ela explode na sua mão. Solte para arremessar: depois de lançada, **o pavio deixa de contar e ela explode no primeiro contato** com qualquer coisa (chão, parede, carro ou a hitbox de alguém). Arremessar pulando leva a granada bem mais longe (velocidade ×1,35 mais o impulso do pulo; ~18 m contra ~9 m parado). O dano em área cai com a distância e é bloqueado por paredes, com **85 no centro**: mata qualquer um (inclusive você) com menos de 85 de vida. Há indicador de granada próxima no HUD. Online, o servidor só aceita a explosão num ponto que a granada poderia ter alcançado. Os valores ficam em [granada_frag.json](shared/data/weapons/granada_frag.json) (`impacto`, `bonusPulo`, `tempoMaximoVoo`).
- **Qualidade gráfica** (Automática/Baixa/Média/Alta) com resolução dinâmica, e aviso quando o navegador está renderizando sem GPU.
- **HUD** (retículo dinâmico, hitmarker, vida, munição, pop-ups de pontos, kill feed, tela de morte), menu inicial/pausa com configurações, sons procedurais em Web Audio, piadas ambientais (flamingos, caminhão de sorvete).
- **Depuração:** `F3` mostra FPS, GPU, escala de resolução, draw calls, velocidade, dispersão e TTK real × ideal; `F4` mostra as hitboxes (a zona da virilha em amarelo).

## Desempenho

Se o jogo rodar a ~10 FPS, o navegador provavelmente está desenhando sem placa de vídeo (o menu avisa e o `F3` mostra o renderizador). No Chrome/Edge, ative "Usar aceleração gráfica quando disponível" em `chrome://settings/system` e reinicie. Com GPU dedicada o jogo passa de 120 FPS.

## Estrutura

```
shared/   movimento, constantes, dados de armas, progressão, nível da conta e protocolo (cliente e servidor)
client/   core (loop, input), render, world (mapa, superfícies, glTF, física), entities, weapons, gameplay, audio, ui, net (API e WebSocket)
server/   app (Bun.serve: HTTP + WebSocket), api e auth/ (contas), accounts (SQL), session (partida), progress, migrations/, tests/
public/   textures/ (manifest.json), models/ e maps/ (.glb), basis/ (decodificador KTX2)
tools/    gerador dos .glb de exemplo (bun run exemplos:glb) e console de moderação (bun run admin)
docs/     MAPAS.md: como criar mapas, props e texturas; DEPLOY.md: publicar, contas, e-mail e Discord
```

## Decisões desta fase

- O colisor do jogador é um **cilindro**, não uma cápsula: o autostep do Rapier só funciona quando a normal de contato é horizontal, e a base arredondada da cápsula nunca gera isso em meios-fios.
- O movimento tem **dois passos por tick**: primeiro o deslocamento, com o personagem pairando 3 cm acima do chão, e depois ele assenta no piso medido por um "shape cast" do cilindro, com a inclinação vinda de um raio. O jeito antigo (velocidade vertical constante para baixo e o snap-to-ground do Rapier) colidia com o chão a distância ~0 em todo tick. Nas emendas entre peças de chão isso gerava normais inclinadas (solavancos e perda do "no chão"), e às vezes o controlador gastava o movimento horizontal inteiro nesse contato, travando o jogador por um tick. Uma varredura do mapa inteiro (260 mil ticks) caiu de 3.374 travas para 0.
- Escadas são degraus visuais com **colisão em rampa**; no chão inclinado o movimento segue o plano (velocidade constante subindo e descendo).
- O controlador do Rapier não se move se começar um passo dentro de outro colisor; o jogador é **empurrado para fora** de personagens sobrepostos, e bonecos só renascem com o lugar livre.
- Agachar fica só no **C**. `Ctrl` foi deixado de fora porque `Ctrl+W` fecha a aba do navegador fora do modo tela cheia.
- Os sons são sintetizados enquanto não houver arquivos de áudio; cada função corresponde a uma entrada futura do banco de sons.
- O servidor roda no **Bun**: um único `Bun.serve` atende a API, os arquivos e o WebSocket nativo. Cada sessão é um tópico do pub/sub do Bun, então o snapshot de cada tick é serializado uma vez por sala, não uma vez por jogador. As senhas usam `Bun.password` (Argon2id, com os mesmos parâmetros dos hashes já gravados).

## Próximo passo (Fase 2)

Arsenal completo a partir de arquivos de dados, ragdoll, bots nas sessões online (simulados no servidor) e fim de partida.
