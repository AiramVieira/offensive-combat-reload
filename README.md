# Offensive Combat (recriação em Three.js)

Homenagem de mecânicas ao FPS de navegador da U4iA Games. Esta é a **Fase 1 do roadmap**: protótipo offline de tiro.

```bash
npm install
npm run dev:online   # servidor do jogo + Vite: http://localhost:5173
npm run dev          # só o cliente (treino offline funciona sem servidor)
npm run build && npm start   # produção: jogo e servidor numa porta só, http://localhost:8787
docker compose up -d --build # produção com nginx na frente: http://localhost:8080
```

Para **publicar e jogar com amigos** (Radmin VPN, túnel, roteador ou servidor alugado, com nginx), veja **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Jogar online

Ao abrir o jogo, a **home** pede seu nome e o **sexo do personagem** (masculino ou feminino: a personagem tem cabelo com rabo de cavalo e silhueta própria; todos veem a escolha, online e nos corpos) e mostra três opções:
- **Jogar online:** lista as sessões abertas ("Rua dos Vizinhos" sempre existe), com quantos jogadores há em cada uma, e permite **criar** uma sessão com nome. Cada sessão é um **mata-mata livre** de até 10 jogadores: todos contra todos.
- **Contra bots:** mata-mata livre offline contra 3 a 9 bots (fácil, normal ou difícil). Veja [Bots](#bots).
- **Treino offline:** o campo com os bonecos, sem servidor.

**Como os outros entram:** na mesma rede, eles abrem `http://<seu-ip>:5173` (o Vite mostra o endereço "Network"; no Windows, permita o Node no firewall quando ele pedir). Pela internet, veja [docs/DEPLOY.md](docs/DEPLOY.md).

**No jogo:** `Tab` mostra o placar (pontos, abates, mortes, humilhações, ping) e `Esc` → "Sair para o início" volta para a home.

### Nascimento (seção 6)

No mata-mata livre (online e contra bots) há **21 pontos de nascimento neutros** espalhados pelo mapa: térreo e andar de cima das casas, vãos entre as casas, fundos, quintais, pontas da rua, casa na árvore e torre. O jogo nunca escolhe um ponto a menos de 2 m de alguém. Também evita pontos com inimigo a menos de 15 m ou com visão direta do lugar, e sorteia entre os três melhores. Contra bots, quem nasce fica **2 s protegido** (pisca e não recebe dano). A proteção acaba antes se a pessoa atirar.

### O que é do servidor e o que é do cliente

O servidor ([server/](server/)) é a autoridade sobre **vida, dano, abates, pontos, respawn e corpos humilháveis**. Ele usa as mesmas regras de `shared/` que o cliente (dados das armas, níveis de granada, tabela de pontos). O cliente envia sua posição a 20 Hz e informa o que seus tiros, facadas e granadas acertaram. O servidor **confere cada informação** antes de aplicar: se os dois estão vivos, a cadência, a distância real entre os jogadores (com folga para a latência), o alcance, o raio da granada e a janela e distância da humilhação. Os outros jogadores aparecem **interpolados 100 ms no passado** entre dois snapshots, com as mesmas hitboxes dos bonecos. O protocolo está em [shared/protocol.ts](shared/protocol.ts).

**Ainda não feito** (próxima etapa da seção 14): predição e reconciliação com o servidor simulando o movimento (hoje a posição é confiada ao cliente); compensação de lag (rewind das hitboxes no servidor); mensagens binárias; fim de partida (limite de abates e tempo) e votação de mapa.

## Bots

No modo **Contra bots**, cada bot é um jogador completo: usa o mesmo movimento, o mesmo Rifle Padrão (cadência, pente, recarga, dispersão e recuo), as mesmas hitboxes e as mesmas regras de pontos. Eles **caçam qualquer um**, incluindo os outros bots. Andam por uma malha de navegação (recast-navigation) gerada na hora a partir dos colisores do mapa. Só enxergam quem está no campo de visão e sem parede no meio, e percebem quem atira neles. Entre as reações: mirar com velocidade limitada, controlar o recuo, disparar em rajadas, dar facada de perto, recuar com pouca vida, perseguir até a última posição vista e dançar em cima dos corpos. A dificuldade muda o tempo de reação, a precisão, o campo de visão e a agressividade. `Tab` mostra o placar de todos, e `F4` mostra a malha de navegação. Por enquanto os bots existem só offline; bots nas sessões online precisam de simulação no servidor.

## O que existe na Fase 1

- **Mapa "Rua dos Vizinhos"** (80 × 60 m): três faixas, casas de dois andares atravessáveis com telhado de duas águas, rua com carros modelados (silhueta com caixas de roda, cabine com colunas e vidros, rodas com aro, para-choques, faróis e lanternas, placas Mercosul, retrovisores, pintura com reflexo), van de mudança e caminhão de sorvete com janela de atendimento, quintais com cercas, piscina vazia, casa na árvore, torre de 7 m e uma casinha de cachorro carregada de um .glb, guardada pela **Amora**, uma Chow Chow preta: ela acompanha com a cabeça quem se aproxima, e quem passa na frente da porta é **mordido e morre na hora** (offline, contra bots e online; os bots contornam a área). Escadas são sólidas por baixo (não dá para entrar no vão).
- **Texturas e mapas do Blender:** biblioteca de superfícies (tijolo, madeira, telhado, reboco…) com texturas repetidas em metros e trocáveis por arquivo, e carregador glTF com as convenções `COL_`, `SPAWN_`, `MAT_`, `DUMMY_`. Veja **[docs/MAPAS.md](docs/MAPAS.md)**. Mapa de teste em `?mapa=/maps/arena_teste.glb`.
- **Controlador em primeira pessoa** (Rapier, passo fixo de 60 Hz, render interpolado): andar, correr, agachar, pular, degraus automáticos, dano de queda acima de 6 m, regeneração de vida. Valores da seção 4 do documento de design.
- **Rifle Padrão hitscan** 100% guiado por dados ([shared/data/weapons/rifle_padrao.json](shared/data/weapons/rifle_padrao.json)): cadência, pente/reserva, recarga tática/vazia, dispersão em 4 estados com acúmulo, padrão de recuo, mira (ADS) com zoom, atraso de saída do sprint, queda de dano por distância, multiplicador por região e **penetração**. O tiro atravessa superfícies finas de madeira (cercas, paredes da casa na árvore, guarda-corpos, escadas e pisos de madeira) com 60% do dano, e de vidro com 90%. O limite é de até 2 superfícies, e cada uma pode ter no máximo 40 cm de espessura no caminho da bala: um caixote, ou uma tábua atingida muito de lado, segura o tiro. Tiro na virilha mata mesmo através da madeira. Paredes de tijolo, reboco e concreto, e os carros, seguram o tiro.
- **Bonecos de treino** com hitboxes simples (cabeça, tronco, braços, pernas), alguns se movendo, regeneração de vida e respawn.
- **Faca (`F`)**: mata com um golpe, com investida curta até alvos a ~3 m; bônus de "Facada" e "Pelas costas" ([faca.json](shared/data/weapons/faca.json)).
- **"No pássaro!"**: tiro na virilha (zona marcada pela fivela do cinto) mata na hora, com faixa na tela e bônus.
- **Humilhação (`E`)**: depois do abate, o corpo mostra um timer de 6 s; em cima dele, `E` faz a "Dancinha da Vitória" em terceira pessoa (sem poder atirar) e rende **150 pontos** (o triplo do valor original, porque você fica exposto dançando). Cada corpo só pode ser humilhado uma vez; só a morte interrompe a dança.
- **Granada (`G`)**: segure para tirar o pino e cozinhar (pavio de 3 s), solte para arremessar. Projétil físico que quica e rola; dano em área que cai com a distância e é bloqueado por paredes; indicador de granada próxima no HUD. O dano no centro é de **85**: mata qualquer um (inclusive você) com menos de 85 de vida; os níveis ficam em [granada_frag.json](shared/data/weapons/granada_frag.json) para a progressão futura.
- **Qualidade gráfica** (Automática/Baixa/Média/Alta) com resolução dinâmica, e aviso quando o navegador está renderizando sem GPU.
- **HUD** (retículo dinâmico, hitmarker, vida, munição, pop-ups de pontos, kill feed, tela de morte), menu inicial/pausa com configurações, sons procedurais em Web Audio, piadas ambientais (flamingos, caminhão de sorvete).
- **Depuração:** `F3` mostra FPS, GPU, escala de resolução, draw calls, velocidade, dispersão e TTK real × ideal; `F4` mostra as hitboxes (a zona da virilha em amarelo).

## Desempenho

Se o jogo rodar a ~10 FPS, o navegador provavelmente está desenhando sem placa de vídeo (o menu avisa e o `F3` mostra o renderizador). No Chrome/Edge, ative "Usar aceleração gráfica quando disponível" em `chrome://settings/system` e reinicie. Com GPU dedicada o jogo passa de 120 FPS.

## Estrutura

```
shared/   movimento, constantes e dados de armas (serão usados também pelo servidor)
client/   core (loop, input), render, world (mapa, superfícies, glTF, física), entities, weapons, gameplay, audio, ui
public/   textures/ (manifest.json), models/ e maps/ (.glb), basis/ (decodificador KTX2)
tools/    gerador dos .glb de exemplo (npm run exemplos:glb)
docs/     MAPAS.md: como criar mapas, props e texturas
```

## Decisões desta fase

- O colisor do jogador é um **cilindro**, não uma cápsula: o autostep do Rapier só funciona quando a normal de contato é horizontal, e a base arredondada da cápsula nunca gera isso em meios-fios.
- O movimento tem **dois passos por tick**: primeiro o deslocamento, com o personagem pairando 3 cm acima do chão, e depois ele assenta no piso medido por um "shape cast" do cilindro, com a inclinação vinda de um raio. O jeito antigo (velocidade vertical constante para baixo e o snap-to-ground do Rapier) colidia com o chão a distância ~0 em todo tick. Nas emendas entre peças de chão isso gerava normais inclinadas (solavancos e perda do "no chão"), e às vezes o controlador gastava o movimento horizontal inteiro nesse contato, travando o jogador por um tick. Uma varredura do mapa inteiro (260 mil ticks) caiu de 3.374 travas para 0.
- Escadas são degraus visuais com **colisão em rampa**; no chão inclinado o movimento segue o plano (velocidade constante subindo e descendo).
- O controlador do Rapier não se move se começar um passo dentro de outro colisor; o jogador é **empurrado para fora** de personagens sobrepostos, e bonecos só renascem com o lugar livre.
- Agachar fica só no **C**. `Ctrl` foi deixado de fora porque `Ctrl+W` fecha a aba do navegador fora do modo tela cheia.
- Os sons são sintetizados enquanto não houver arquivos de áudio; cada função corresponde a uma entrada futura do banco de sons.

## Próximo passo (Fase 2)

Arsenal completo a partir de arquivos de dados, ragdoll, bots nas sessões online (simulados no servidor) e fim de partida.
