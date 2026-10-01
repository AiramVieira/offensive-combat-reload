# Mapas, texturas e desempenho

Guia para quem vai construir mapas e props do Offensive Combat. Existem dois caminhos, e os dois usam a mesma biblioteca de superfícies, os mesmos lotes estáticos e a mesma física:

| Caminho | Quando usar | Onde |
| --- | --- | --- |
| **Código** (`MapBuilder`) | Blockout rápido com caixas, paredes com vãos, escadas e telhados | [client/world/blockoutMap.ts](../client/world/blockoutMap.ts) |
| **Blender → glTF (.glb)** | Qualquer forma que não seja caixa: prédios, props, terreno, arte final | `public/maps/*.glb` (mapa inteiro) ou `public/models/*.glb` (props) |

Para ver um mapa .glb, abra o jogo com `?mapa=`: `http://localhost:5173/?mapa=/maps/arena_teste.glb`.

---

## 1. Texturas

### Como funcionam

Toda superfície estática do mapa usa uma das **superfícies da biblioteca** ([client/world/surfaces.ts](../client/world/surfaces.ts)). Cada superfície tem:

- **um único material** compartilhado pelo mapa todo. A cor de cada peça vem de um *tint* por vértice, então tijolo vermelho e tijolo amarelo são o mesmo material. Isso economiza draw calls.
- **uma textura que se repete a cada N metros.** As UVs são geradas em metros, então a densidade de pixels é igual em qualquer parede, sem mapeamento UV manual.
- **um material de física**, que decide o som de passos e de impacto.

| Superfície | Uso | Repete a cada | Física |
| --- | --- | --- | --- |
| `tijolo` | muros, prédios | 1,6 m | concreto |
| `reboco` | fachadas de casa (lambri horizontal) | 1,8 m | concreto |
| `madeira` | cercas, escadas, caixotes | 1,2 m | madeira |
| `piso` | assoalho | 1,8 m | madeira |
| `telhado` | telhas | 1,2 m | madeira |
| `concreto` | barreiras, bordas, lajes | 2 m | concreto |
| `calcada` | calçadas | 2 m | concreto |
| `asfalto` | rua | 3 m | concreto |
| `grama` | chão | 2,5 m | grama |
| `azulejo` | piscina, banheiros | 1 m | azulejo |
| `metal` | carros, placas, hidrantes | 2 m | metal |
| `vidro` | vidros | 2 m | vidro |
| `papel` | paredes de papel (shoji), com a treliça de madeira pintada | 1,8 m | papel |
| `pedra` | lajotas de jardim, caminhos, pedestais | 2,4 m | concreto |
| `pintura` | cor lisa, sem textura | — | concreto |

Hoje as texturas são **procedurais**, pintadas em canvas no carregamento ([client/world/textures.ts](../client/world/textures.ts)), como placeholder no estilo "pintado à mão". Elas são claras e quase sem cor de propósito: o tint dá o matiz.

### Trocar por uma textura de verdade (sem mexer em código)

1. Coloque o arquivo em `public/textures/` (por exemplo `tijolo.jpg`).
2. Registre em [public/textures/manifest.json](../public/textures/manifest.json):

```json
{
  "tijolo": { "arquivo": "tijolo.jpg", "metros": 1.6 },
  "telhado": { "arquivo": "telhado.ktx2", "metros": 1.2, "tingir": false }
}
```

3. Recarregue a página. Todas as paredes de tijolo do jogo usam o arquivo novo.

| Campo | Significado |
| --- | --- |
| `arquivo` | Nome do arquivo em `public/textures/`: `.png`, `.jpg`, `.webp` ou `.ktx2` |
| `metros` | Quantos metros uma repetição cobre (opcional; o padrão é o da tabela acima) |
| `tingir` | `false` quando a textura já tem as cores finais: ignora o tint das peças. O padrão `true` multiplica a textura pelo tint, e nesse caso use texturas claras ou em tons de cinza |

**Regras para a textura:**
- Deve ser **repetível** (seamless): a borda direita continua na esquerda e a de cima na de baixo.
- Tamanho em **potência de 2**: 512×512 para detalhes pequenos, 1024×1024 no máximo.
- Estilo **pintado à mão**, com pouco ruído fotográfico (seção 2 do documento de design): o inimigo precisa se destacar do fundo.
- Para produção, prefira **KTX2**: ocupa de 4 a 6 vezes menos memória de vídeo que PNG/JPG. Para converter, use o `toktx` do [KTX-Software](https://github.com/KhronosGroup/KTX-Software):
  `toktx --t2 --encode etc1s --genmipmap tijolo.ktx2 tijolo.png`. O transcodificador já está em `public/basis/`.

### Textura exclusiva de um objeto

Para um objeto com arte própria (uma placa com letreiro, um carro modelado, um mural), não use a biblioteca. No Blender, dê ao objeto um material com **Image Texture** e faça o mapeamento UV normalmente. A textura vai dentro do .glb, o jogo mantém as UVs e só troca o shading para o toon do jogo.

---

### Paredes com portas e janelas (mapas feitos em código)

`b.wall(...)` recebe os vãos como `[início, fim, base, topo]` e **aceita vãos empilhados**, como uma porta sob uma janela ou janelas nos dois andares. A parede é cortada em colunas nas bordas de cada vão, e cada coluna fica maciça em tudo, menos nos vãos que a cobrem. Com a opção `frame`, cada vão ganha moldura (e peitoril nas janelas) sem estreitar o buraco. A textura usa coordenadas do mundo, então tábuas e tijolos continuam de um pedaço para o outro.

Regras de medida que o jogo checa automaticamente:
- **Porta:** pelo menos **1,6 m** de largura e **2,3 m** de altura. O jogador é um cilindro de 0,7 m por 1,8 m.
- **Janela do térreo** que deve dar para atravessar pulando agachado: peitoril a até **0,9 m** e topo a **2,3 m** ou mais.
- Todo vão fica registrado em `map.openings`. O teste de estrutura passa um raio por cada vão e tenta atravessar cada porta andando.

### Peças orientais

[client/world/oriental.ts](../client/world/oriental.ts) tem as peças do "Jardim do Dragão" ([client/world/dragonGarden.ts](../client/world/dragonGarden.ts)), prontas para outros mapas:

- `pavilion(b, spec)`: pavilhão de vários andares. Cada andar escolhe as paredes (`estuque`, `papel` ou `madeira`, inclusive por lado), portas e janelas, varanda com guarda-corpo (com colunas quando avança sobre o chão), beiral de telhas por baixo da laje (`skirt`, o visual de pagode) e escada interna com o vão na laje de cima. O último andar ganha o telhado curvo. Devolve as alturas dos pisos e os pontos para pendurar lanternas.
- `curvedRoof(b, opts)`: telhado chinês côncavo com as pontas levantadas, de um retângulo de beiral até uma cumeeira (telhado de quatro águas), um ponto (pirâmide, com o pináculo dourado) ou outro retângulo (beiral sem topo).
- `paperWall`, `moonGateWall` (portão lua cortado em fatias), `railing`, `column`, `wallCap`.
- Natureza: `rock` (pedra com colisão convexa), `pine` (pinheiro de nuvens; cerejeira com outras cores), `bonsai`, `bamboo`, `stoneLantern`.
- `dragonGeometry(caminho, raio, cores)`: dragão em volta de qualquer curva, com cabeça, chifres, bigodes, crista e patas; devolve a posição da boca.
- Animados: `Lanterns` (lanternas penduradas que balançam com tiros), `Gong`, `FireBreath`, `Koi`.

Pedras e árvores usam `seeded(semente)`, nunca `Math.random`: a colisão precisa ser igual em todos os clientes da sessão.

### Mapas por sessão

Os mapas jogáveis estão em [shared/maps.ts](../shared/maps.ts). Cada sessão online leva o id do mapa, e o servidor mantém uma sessão fixa por mapa. Para adicionar um mapa: registre o id ali, crie o `build...Map` em `client/world/` e ligue o id na escolha do mapa em [client/main.ts](../client/main.ts).

### Piadas do cenário sincronizadas

Hidrantes, o caminhão de sorvete, os flamingos, as lanternas, o gongo e o dragão são registrados com `props.register('nome:indice', efeito)`, e isso devolve o `onShot` do colisor. Online, disparar uma piada avisa o servidor, que repassa aos outros, e todos veem o mesmo. Para criar uma nova, é o mesmo padrão; veja os hidrantes em [blockoutMap.ts](../client/world/blockoutMap.ts) e [hydrant.ts](../client/world/hydrant.ts).

## 2. Blender → .glb

### Escala e orientação

- **1 unidade do Blender = 1 metro.** Jogador: 1,8 m de altura, olhos a 1,65 m, cilindro de 0,35 m de raio.
- O exportador glTF converte Z-up do Blender para Y-up sozinho; deixe **+Y Up** marcado.
- A **frente** de spawns, bonecos e props é o eixo **+Y do Blender**. Com rotação 0, o objeto "olha" para longe de você na vista frontal (Numpad 1).

### Convenções de nome

| Nome do objeto | O que vira no jogo |
| --- | --- |
| `COL_nome` | Colisão invisível, feita de **malha de triângulos** |
| `COL_nome_BOX` | Colisão em **caixa** (a mais barata; use sempre que der) |
| `COL_nome_CONVEX` | Colisão **convexa** (envolve a forma, sem buracos) |
| `SPAWN_A_01`, `SPAWN_B_01`, `SPAWN_FFA_01` | Ponto de nascimento (use um *Empty*). O mata-mata livre (online e contra bots) usa os `SPAWN_FFA_*`; sem eles, usa A + B. Coloque 16 a 20 espalhados. |
| `DUMMY_01` | Boneco de treino |
| `KILLVOLUME` | Cair abaixo da altura deste objeto mata |
| `GAG_LATIDO` (ou outro `GAG_*`) | Gatilho de piada ambiental, ligado no código do mapa |
| qualquer nome com `NOCOL` | Visível, sem colisão (folhagem, fios, detalhes pequenos) |

**Materiais:** nomeie `MAT_<superfície>` para usar a biblioteca, por exemplo `MAT_tijolo`, `MAT_telhado`, `MAT_madeira`. A **Base Color** do material vira o tint. O sufixo `.001` que o Blender adiciona em cópias é ignorado. Materiais com outros nomes mantêm a própria textura.

**Colisão automática:** se o arquivo **não** tem nenhum `COL_`, toda malha visível ganha colisão por malha de triângulos. Isso é ótimo para blockout. Quando o mapa amadurecer, crie `COL_` simplificados: a partir do primeiro, **só** eles colidem.

### Propriedades personalizadas (Object Properties → Custom Properties)

| Propriedade | Em | Valores |
| --- | --- | --- |
| `fisica` | malhas e `COL_` | `wood`, `metal`, `concrete`, `grass`, `glass`, `tile`, `paper`: som de passos e impacto. `wood`, `glass` e `paper` são **atravessados por tiros** quando finos (até 40 cm, 10 cm e 10 cm no caminho da bala, veja `penetracao` no JSON da arma; o papel tira só 5% do dano). Cercas, portas e paredes de madeira devem usar `wood`; caixotes grossos param o tiro sozinhos. |
| `nocol` | malhas | `true`: sem colisão |
| `uv_proprio` | malhas com `MAT_` | `true`: usa as UVs do Blender em vez da projeção automática em metros |
| `eixo`, `amplitude`, `velocidade` | `DUMMY_*` | patrulha: `eixo` = `x` ou `z`, `amplitude` em metros, `velocidade` em rad/s |

### Exportação

**File → Export → glTF 2.0 (.glb)** com:
- Format: **glTF Binary (.glb)**
- Include: **Custom Properties** ✔ (sem isso, `fisica`, `eixo` etc. se perdem)
- Transform: **+Y Up** ✔
- Mesh: **Apply Modifiers** ✔, UVs ✔, Normals ✔
- Compression: deixe desligado no Blender e otimize depois (abaixo)

Coloque o arquivo em `public/maps/` (mapa inteiro) ou `public/models/` (prop).

### Usando o arquivo

- **Mapa inteiro:** abra `?mapa=/maps/seu_mapa.glb`. O arquivo precisa de pelo menos um `SPAWN_A_*` (ou `SPAWN_FFA_*`).
- **Prop dentro de um mapa feito em código:**

```ts
const gltf = await gltfLoader(renderer).loadAsync('/models/casinha_cachorro.glb');
addGltfToMap(gltf, b, { position: new THREE.Vector3(36, 0, 14.5), yaw: 0, scale: 1.6 });
```

Veja o exemplo em [blockoutMap.ts](../client/world/blockoutMap.ts), procurando `casinha_cachorro`.

### Exemplos prontos

`bun run exemplos:glb` regenera, a partir de [tools/gerar-props-exemplo.mjs](../tools/gerar-props-exemplo.mjs):
- `public/models/casinha_cachorro.glb`: prop com `MAT_madeira`, `MAT_telhado`, `COL_casinha_BOX` e `GAG_LATIDO` (o cachorro late quando alguém passa).
- `public/maps/arena_teste.glb`: mapa inteiro com chão, muros, plataforma com rampas, caixotes, spawns, bonecos (um patrulhando) e `KILLVOLUME`.

Eles fazem o papel de arquivos exportados do Blender; abra-os no Blender (File → Import → glTF) para ver a estrutura.

---

## 3. Desempenho

### O que o jogo já faz

- **Um material por superfície**, com cor por vértice. A cor não multiplica materiais.
- **Lotes estáticos:** a geometria parada é fundida por material em células de 40 m. Poucos draw calls, e as células fora da câmera não são desenhadas.
- **Colisão simples:** caixas e formas convexas quando possível; malha de triângulos só onde precisa.
- **Escadas:** degraus só visuais, colisão em rampa lisa. Subir e descer é suave e nunca engancha.
- **Sombras:** só a luz do sol projeta. O chão recebe mas não projeta. O mapa de sombras é redesenhado a cada quadro na qualidade Alta, a cada 2 na Média e fica desligado na Baixa.
- **Qualidade automática:** reduz a resolução (até 50%) e depois as sombras quando o FPS cai abaixo de 45.

### Metas por mapa (seção 3 do documento de design)

| Item | Meta | "Rua dos Vizinhos" hoje | "Jardim do Dragão" hoje |
| --- | --- | --- | --- |
| Draw calls por quadro | < 300 | ~150 com sombras | ~130–210 com sombras |
| Triângulos visíveis | < 500 mil | ~50 mil | ~180–280 mil |
| Tempo de construção do mapa | — | ~50–90 ms | ~180–210 ms |
| Texturas | < 256 MB | 12 texturas procedurais de 512×512 (~16 MB com mipmaps) | as mesmas, mais `papel` e `pedra` |

Aperte **F3** no jogo para ver FPS, draw calls, triângulos, tempo de CPU e a GPU em uso.

### Regras para quem modela

1. **Reutilize superfícies da biblioteca** em vez de criar materiais novos. Cada material diferente custa pelo menos um draw call.
2. **Colisão mais simples que o visual:** uma parede cheia de detalhes colide como `COL_parede_BOX`.
3. **Detalhes pequenos sem colisão** (`NOCOL`): calhas, fios, maçanetas.
4. **Até ~50 mil triângulos por mapa pequeno** nesta fase. Props repetidos (caixotes, cercas) devem ter poucos polígonos.
5. **Otimize o .glb antes de colocar no jogo:**

```bash
bunx @gltf-transform/cli optimize entrada.glb public/maps/saida.glb --compress meshopt --texture-compress ktx2
```

   Isso funde vértices repetidos, comprime a malha (Meshopt, que o jogo já decodifica) e converte texturas embutidas para KTX2 (esta parte precisa do `toktx` instalado; sem ele, use `--texture-compress webp`).

6. **Sombras pré-calculadas (lightmaps)**, previstas na seção 10 do documento: calcule no Blender em um segundo canal de UV e exporte a imagem junto. O suporte do lado do jogo ainda não está pronto.

### Se o jogo estiver lento

Quase sempre é o navegador desenhando **sem placa de vídeo**. O menu mostra um aviso e o F3 mostra o renderizador (SwiftShader, llvmpipe ou "Basic Render" indicam software). No Chrome ou Edge, ative "Usar aceleração gráfica quando disponível" em `chrome://settings/system` e reinicie. Medido nesta máquina: **~1.700 FPS** com a RTX 3070 Ti contra **5–10 FPS** por software, com o mesmo mapa.
