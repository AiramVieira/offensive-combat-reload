# Personagens: sistema modular e como fazer peças no Blender

Os personagens seguem o "Guia de Estilo de Personagens — Jogo FPS": **low poly facetado semirrealista** (7 cabeças, 1,80 m), cores sólidas de uma paleta única, rosto feito de faces (sem textura desenhada). São um **corpo base com esqueleto** mais **peças que usam o mesmo esqueleto** (roupas, cabelos, barbas) e **itens rígidos presos em sockets** (chapéus, óculos, pulseiras, armas). Enquanto não houver arquivos GLB, tudo é gerado em código (`client/character/body.ts` e `client/character/pieces/`) **no mesmo formato de um GLB exportado do Blender**. Trocar uma peça procedural por um modelo de verdade é só apontar a `url` dela no registro.

## Arquitetura

| Arquivo | O que faz |
| --- | --- |
| [client/character/rig.ts](../client/character/rig.ts) | Esqueleto canônico: nomes dos ossos, T-pose, regiões do corpo e sockets. |
| [shared/catalog.ts](../shared/catalog.ts) | O catálogo inteiro do guia (336 itens): slots que cada item ocupa, canais de cor (P, S, D), nomes em pt/en e `ready` (já tem modelo). Compartilhado com o servidor, que só aceita itens prontos. |
| [shared/appearance.ts](../shared/appearance.ts) e [shared/palette.ts](../shared/palette.ts) | Aparência v2 (itens por slot com até 3 cores; a v1 é convertida ao ler), regras de slot (um item que ocupa vários slots tira os outros; parte de cima, de baixo e calçado são obrigatórios) e a paleta: toda cor salva é encaixada nas famílias do guia, sem acento na cor principal das peças grandes. |
| [client/character/registry.ts](../client/character/registry.ts) | `AssetRegistry`: cada item com slot, `url` do GLB ou gerador procedural, regiões que esconde, socket, grip e canais de cor. Item novo = registrar aqui. |
| [client/character/character.ts](../client/character/character.ts) | `Character`: carrega o corpo, `equip(slot, id)` (rebind por nome de osso), sockets, esconder regiões, `setColor`, `setEyes`, `setBuild`, `setPcd`, `toJSON()`/`Character.fromJSON()`, `bake()`, `dispose()`. |
| [client/character/palette.ts](../client/character/palette.ts) | Atlas de paleta 256×256 (células 16×16 com degradê vertical), famílias de cor do guia, `Paint` (célula fixa ou tint × valor). |
| [client/character/material.ts](../client/character/material.ts) | `MeshStandardMaterial` com flat shading, roughness 0,85, atlas em `NearestFilter` sem mipmaps, AO na cor de vértice, tint por canal (primário, secundário, detalhe, pele, cabelo, olhos, equipe) e regiões escondidas. |
| [client/character/animator.ts](../client/character/animator.ts) | Animação procedural em duas camadas: pernas com pés plantados (alvo de cada pé no chão + IK de dois ossos, passada sincronizada com a velocidade em qualquer direção, agachar e deslizar com os pés no chão, giro no lugar depois de 60° de torção) e tronco (pitch dividido 30/40/30 em coluna, peito e cabeça, rifle nas duas mãos por IK em quadril, ADS e corrida), com camadas por cima: recuo, recarga, faca, granada, reação a tiro, pouso. Os números de "sensação" ficam em `ANIM`. Se o corpo GLB trouxer clipes, `Character.play('walk')` usa o `AnimationMixer`. |
| [client/character/body.ts](../client/character/body.ts) | Corpo base facetado: torso de seção quadrada, deltoides, mãos com dedos em escadinha e morph de punho, pés com sola, cabeça com maxilar, nariz em planos, orelha em 2 planos, olhos de 3 faces e sobrancelhas. `BodyParts` expõe as mesmas superfícies para as roupas. |
| [client/character/pieces/](../client/character/pieces/) e [builder.ts](../client/character/builder.ts) | Peças geradas em código (roupas com borda de espessura e dobras, cabelos em blocos, barbas, chapéus, óculos) e o construtor de malha facetada. |
| [client/character/pieces/tops.ts](../client/character/pieces/tops.ts) | As 30 camisetas, regatas e camisas: uma tabela de especificações (barra, manga curta ou longa até o punho, folga, tipo de gola, punho, pintura por face) e um kit de detalhes presos ao torso pela superfície do corpo (`BodyParts.torsoSurface`, que acompanha os morphs de biotipo): remendos que seguem a curva do peito (listras, estampa, números de camisa em 7 segmentos, carcela), aberturas na cor da pele (gola V, gola U, rasgos, cava funda), caixas (bolsos, lapelas, botões, velcro na manga) e golas planas (pontas de colarinho, lapelas abertas). |
| [client/character/pieces/kit.ts](../client/character/pieces/kit.ts) | O kit de detalhes presos ao torso, compartilhado por camisetas, blusas e jaquetas. |
| [client/character/pieces/sweaters.ts](../client/character/pieces/sweaters.ts) | As 30 blusas (moletons, suéteres, cardigãs, fleeces, poncho, túnica): capuz abaixado e levantado, bolso canguru, zíper, punhos e barra canelados, tricô em faces, letras e árvore de natal em remendos, saia da túnica entre as pernas. |
| [client/character/pieces/jackets.ts](../client/character/pieces/jackets.ts) | As 30 jaquetas, casacos e coletes por cima da parte de cima: frentes abertas com espessura nas bordas, lapelas, golas (de pé, ribana, pelo, capuz), acolchoado de puffer, casacos longos com duas abas forradas que seguem cada coxa e fenda atrás, capas. |
| [client/character/pieces/bottoms.ts](../client/character/pieces/bottoms.ts) | As 60 calças, bermudas, shorts e saias: cada perna é um tubo próprio com a silhueta do item (skinny, reta, larga, boca de sino, montaria), bolsos e joelheiras na superfície do pano, saias que seguem as coxas e a canela, jardineira com peitilho e alças. |
| [client/character/pieces/shoes.ts](../client/character/pieces/shoes.ts) | Os 30 calçados sobre uma "forma" que segue o pé: sola em camadas no chão, salto, cabedal, colarinho ou cano de bota (estufado ou por dentro da calça), cadarços, tiras e fivelas; descalço é uma peça vazia. |
| [client/character/pieces/headwear.ts](../client/character/pieces/headwear.ts) e [rigid.ts](../client/character/pieces/rigid.ts) | Bonés, gorros, chapéus, capacetes, fones, shemagh, coroa de flores; óculos, máscaras, balaclava, tapa-olho, brincos e piercings. Peças rígidas no espaço do osso da cabeça; o que envolve o pescoço é skinned. |
| [client/character/pieces/accessories.ts](../client/character/pieces/accessories.ts) | Correntes, plaquinhas, cachecol, lenço, gravata, luvas (a mão do corpo inflada, com o morph de punho; também na primeira pessoa), mochilas, bolsa, pochete, cinto, suspensórios, tatuagens. |
| [client/character/pieces/tactical.ts](../client/character/pieces/tactical.ts) | Os 29 itens táticos: coletes (por fora das jaquetas), cinturão, coldre, bolsas, mochilas, joelheiras, cotoveleiras, ombreiras, bandoleira, ghillie, capa, corda de rapel, mapa. Os acessórios de colete têm placa e alça próprias, então funcionam com ou sem colete. |
| [client/character/pieces/hair.ts](../client/character/pieces/hair.ts) | Os 30 cabelos e os 6 pelos faciais, montados com blocos: `cap` (casca sobre o crânio com linha do cabelo em bicos), `scalp` (raspados), `curtain` (cortina caindo da parte mais larga do crânio, com espessura e pontas em zigue-zague ou onda), `fringe` (franja), `ball`, `tie` (elástico na cor de detalhe), `braid` (tranças e dreads por `strand`) e mechas. Com chapéu, o cabelo é refeito "achatado" e o topo (região 17) some. Cabelo comprido segue a cabeça em cima e o peito embaixo, para não atravessar as costas. |
| [client/dev/characterLab.ts](../client/dev/characterLab.ts) | Laboratório (`/tools/lab-personagens.html` no `npm run dev`): fileira de visuais para comparar com as referências, com contagem de triângulos e draw calls. `?hairs=1&page=0\|1&yaw=` mostra os cabelos em grade, 15 por página, com os triângulos de cada um (`&hat=` para testar com chapéu); `?items=<categoria>` faz o mesmo com qualquer categoria do catálogo (`&sex=m\|f`, `&build=gordo`, `&zoom=1` para o peito de perto, `&anim=<pose>`). `?sheet=<id>` é a ficha de inspeção: a peça num corpo, de 5 ângulos, em várias poses (`&poses=idle,walk,run,crouch,aimUp,…`, `&hair=`, `&beard=`, `&with=slot:id`). `?faces=<traço>` mostra cada valor de um traço do rosto. |
| [client/render/viewmodel.ts](../client/render/viewmodel.ts) e [viewmodelArms.ts](../client/render/viewmodelArms.ts) | Primeira pessoa: rifle e braços facetados do próprio personagem (pele, manga longa ou braço nu, mão fechada pelo morph de punho, PCD). Camadas com molas amortecidas ([springs.ts](../client/render/springs.ts)): sway, bob no passo, recuo visual, pouso, inclinação no strafe; ADS com ease-out. Todos os números em `VM_FEEL`. |
| [client/ui/tuning.ts](../client/ui/tuning.ts) | F6 no jogo: painel com um slider para cada número de `VM_FEEL` (primeira pessoa) e `ANIM` (terceira pessoa), ao vivo, com "Copiar JSON" para colar de volta no código. |
| [client/entities/avatar.ts](../client/entities/avatar.ts) | Adaptador para o jogo: converte a `Appearance` salva no banco num `CharacterConfig`, faz o bake e anima. |

**Slots:** os do catálogo (`tronco`, `sobreposicao`, `baixo`, `calcado`, `cabeca`, `rosto`, `orelhas`, `pescoco`, `pulsoE`, `pulsoD`, `maos`, `antebraco`, `cotovelos`, `ombro`, `ombros`, `colete`, `acessorioColete`, `peito`, `costas`, `cintura`, `coxaE`, `coxaD`, `joelhos`, `pes`, `pele`) mais `body`, `hair`, `beard` e as armas (`weapon_R`, `weapon_L`, `weapon_back`). Item novo: a linha dele em `shared/catalog.ts`, o id na lista do lote em `READY_LISTS`, a entrada no arquivo da categoria em [client/character/items/](../client/character/items/) (com o gerador ou a `url` do GLB) e, se for procedural, o gerador no mapa `*_GENERATORS` do módulo dele em `pieces/`.

**Rosto:** além do estilo e da cor dos olhos (6 estilos: redondo, amendoado, marcante, caído, puxado, grande), o visual guarda `rosto` com formato (oval, quadrado, redondo, longo, coração), sobrancelhas, nariz, boca, orelhas e marcas (sardas, cicatriz, pinta), tudo em faces pintadas. O formato do rosto mexe só abaixo das sobrancelhas; tudo que é montado sobre a cabeça (barbas, cabelo, máscaras, óculos, capacetes) ganha morphs `rosto_<formato>` gerados automaticamente (`withFaceMorphs` em body.ts), então qualquer peça veste qualquer rosto. Olhos e sobrancelhas foram aumentados para ler a 15 m (guia).

**Armas vistas pelos outros:** em terceira pessoa o personagem segura os modelos do nível equipado ([client/entities/heldWeapons.ts](../client/entities/heldWeapons.ts), os mesmos da primeira pessoa, fundidos num mesh): o rifle na mão e nas costas, a faca na mão durante o golpe (o rifle vai para as costas e o braço faz o corte) e a granada na mão esquerda ao preparar, com o arremesso animado quando a granada sai. A troca de equipamento chega aos outros jogadores na hora (`playerLoadout`).

**Camadas:** `hides` esconde regiões do corpo debaixo da peça (a pele nunca atravessa); `over` esconde regiões das peças de camadas abaixo (cabelo e barba < roupas < calçado < jaqueta < acessórios e tático) usadas junto. Jaquetas fechadas escondem o tronco da peça de baixo; mochilas e capuz levantado escondem o cabelo que cai nas costas (região `hairBack`) (a jaqueta sobre as mangas da camiseta, a bota sobre a barra da calça, a máscara sobre a barba, a balaclava sobre o cabelo). Cabelo e barba têm regiões próprias (`hair`, `beard`, `hairTop`).

**Desempenho:** geometrias ficam em cache e são compartilhadas. No jogo, cada personagem é "bakeado" (`Character.bake()`): corpo, rosto, roupas, cabelo e acessórios viram **um único SkinnedMesh** com as cores finais nos vértices (célula × tint × AO) e sem os triângulos escondidos; os morphs das mãos (`punho_L`, `punho_R`) continuam vivos. Sobra 1 draw call por personagem mais o rifle, com 3,5 a 4,5 mil triângulos já vestido (orçamento do guia: 4.500). Qualquer mudança desfaz o bake sozinha.

**LOD (guia: LOD1 e LOD2):** o bake gera três malhas num `THREE.LOD`, que o renderizador troca pela distância (LOD1 a partir de 20 m, LOD2 a partir de 45 m, 10% de histerese). Os níveis distantes são as mesmas peças geradas de novo com menos detalhe (`withLod` em [builder.ts](../client/character/builder.ts)): tubos com ¾ e ½ dos lados e um anel sim, outro não; sem faixas de espessura no LOD2; peças anexadas menores que um botão (LOD1) ou um bolso (LOD2) somem; remendos do kit somem no LOD2; mãos com dedos de um segmento (LOD1) e dois dedos largos (LOD2); a cabeça sem os traços do rosto no LOD2; cascas de cabelo com menos fileiras. Na prática o LOD1 fica em ~60% e o LOD2 em ~35% dos triângulos. Peça GLB usa a própria malha nos três níveis até ter LODs próprios. Laboratório: `?lod=1|2` mostra o nível, e a contagem dos três aparece em cada visual e em cada peça da grade.

**Checklist automático (guia, por item):** `?audit=1` (ou `&category=<c>`) gera cada peça pronta nos dois corpos e nos três níveis e confere orçamento da categoria, geometria quebrada (NaN, faces degeneradas), partes fora do corpo, canais de cor fora do catálogo, entrada no registro e se os níveis distantes são mais leves ([client/dev/audit.ts](../client/dev/audit.ts)). O que é de olho (silhueta, dobras, espessura nas bordas, leitura a 10 m) se confere nas grades `?items=<categoria>`.

**Configuração salva:** o banco guarda a `Appearance` (validada no servidor por `shared/appearance.ts`). No editor, "Copiar JSON" mostra o `CharacterConfig` equivalente, e "Exportar GLB" baixa o personagem inteiro (esqueleto, pesos, morphs e máscaras) como `.glb`, o que serve de ponto de partida no Blender.

## Hitboxes

A hitbox nunca é a malha: são 15 formas simples presas aos ossos ([client/entities/hitboxes.ts](../client/entities/hitboxes.ts)), iguais para todos os corpos. Um esqueleto de proporções padrão faz a mesma pose do personagem visível (andar, agachar, mirar, recarregar) e cada collider segue o seu osso a cada atualização ([client/entities/rig.ts](../client/entities/rig.ts)). Roupa, cabelo e chapéu nunca mudam a hitbox; altura e biotipo também não (são só visuais); o modo PCD tira a forma do membro que falta.

| Zona | Forma | Osso | Multiplicador (rifle) |
| --- | --- | --- | --- |
| Cabeça | Esfera de 12 cm × 1,12 | `head` | 2,5× |
| Pescoço | Cápsula curta | `neck` | 1,5× |
| Peito | Cápsula horizontal | `chest` | 1,0× |
| Abdômen | Cápsula horizontal | `spine` | 1,0× |
| Quadril | Cápsula horizontal | `hips` | 0,9× |
| Braços | Cápsula por segmento | `upperArm`, `forearm` | 0,75× |
| Mãos | Esfera pequena | `hand` | 0,5× |
| Coxas | Cápsula | `thigh` | 0,75× |
| Canelas e pés | Cápsula | `shin` | 0,6× |

A virilha é uma caixa presa ao osso `hips`: um tiro no quadril, abdômen ou coxa que cai dentro dela vira `virilha` (mata na hora). Os multiplicadores ficam no JSON de cada arma (`multiplicadores`). F4 no jogo mostra as hitboxes; no laboratório, `?hitbox=1&probe=1` desenha as formas e dispara raios de verdade contra os colliders.

## Preparar um GLB compatível no Blender

### 1. Esqueleto

Use **exatamente estes nomes de ossos**, com esta hierarquia, em **T-pose**, olhando para **-Z** no jogo (o exportador glTF do Blender converte o eixo; no Blender o personagem olha para **-Y**, com os pés na origem):

```
root
└─ hips
   ├─ spine ─ chest ─┬─ neck ─ head
   │                 ├─ shoulder_L ─ upperArm_L ─ forearm_L ─ hand_L
   │                 └─ shoulder_R ─ upperArm_R ─ forearm_R ─ hand_R
   ├─ thigh_L ─ shin_L ─ foot_L
   └─ thigh_R ─ shin_R ─ foot_R
```

- As posições de referência estão em `BONES` ([rig.ts](../client/character/rig.ts)): quadril a 0,92 m, ombros a 1,34 m, cabeça (base do crânio) a 1,48 m, personagem médio com cerca de 1,80 m.
- **Rotação zero em repouso:** aplique a pose de repouso (Pose → Apply → Apply Pose as Rest Pose) com os ossos alinhados como no esqueleto canônico. A animação procedural escreve os ângulos contando com isso. Um rig com eixos diferentes precisa trazer os próprios clipes.
- **Um só armature** para o corpo e todas as peças. O jeito mais fácil é exportar o esqueleto do jogo ("Exportar GLB" no editor), importar no Blender e modelar em cima dele.

### 2. Pesos de skin

- No máximo **4 ossos por vértice**, com pesos normalizados (Weights → Normalize All, depois Limit Total = 4).
- Roupas: copie os pesos do corpo (Data Transfer → Vertex Data → Vertex Groups, "Nearest Face Interpolated"), para a peça deformar igual à pele de baixo.
- Saias e peças soltas: o quadril com transição para as coxas de cada lado, como no gerador procedural.

### 3. Atributos que o jogo lê

Crie **Color Attributes** ou atributos genéricos no Blender e exporte com "Include → Custom Properties / Attributes":

| Atributo | Tipo | Conteúdo |
| --- | --- | --- |
| `_TINT` | float por vértice | De onde vem o matiz da face: 0 = a cor da célula do atlas; 1 primária, 2 secundária, 3 detalhe (cores que o jogador escolhe para a peça); 4 pele, 5 cabelo, 6 olhos, 7 equipe. Faces com tint usam a linha neutra do atlas (linha 0, cinza de 100% a 10%), e o shader multiplica pela cor escolhida. |
| `_MASK` | cor (RGB, por vértice) | Alternativa antiga ao `_TINT`: vermelho = primária, verde = secundária, azul = detalhe. O jogo converte para `_TINT`. |
| Color Attribute (`COLOR_0`) | cor por vértice | Oclusão de ambiente (bake de AO no Blender, 16 a 32 amostras, distância 0,1 m), no máximo 25% mais escura. |
| `_REGION` | float por vértice | Região do corpo (tabela abaixo). O jogo esconde regiões inteiras: a pele sob a roupa, ou um membro ausente no modo PCD. |

Regiões: 0 cabeça · 1 pescoço · 2 peito · 3 barriga · 4 pelve · 5 braço esq. · 6 antebraço esq. · 7 mão esq. · 8 braço dir. · 9 antebraço dir. · 10 mão dir. · 11 coxa esq. · 12 canela esq. · 13 pé esq. · 14 coxa dir. · 15 canela dir. · 16 pé dir. · 17 topo do cabelo (some sob chapéu) · 18 tornozelo esq. · 19 tornozelo dir. (a bota cobre a barra da calça) · 20 barba (some sob máscara) · 21 resto do cabelo (some sob balaclava ou capuz) · 22 cabelo caído nas costas (some sob mochila) · 31 nunca esconder.

**UV no atlas de paleta:** cada face tem o UV encolhido para um ponto dentro de uma célula 16×16 do atlas de `palette.ts`: no topo da célula para faces voltadas para cima, na base para faces voltadas para baixo. Use flat shading, faces de no mínimo 3 cm e nenhum triângulo mais fino que 1:6.

- A peça também leva `_REGION`: é assim que a calça some na perna ausente do modo PCD.
- Sem `_MASK`, a peça usa a textura ou a cor do material do Blender, sem troca de cor.

### 4. Biotipo (morph targets)

Crie duas shape keys com os nomes **`gordo`** e **`magro`** no corpo e **também em cada roupa** (a roupa precisa acompanhar). Exporte com "Shape Keys" ativado. A altura não precisa de shape key: o jogo escala o corpo inteiro. As mãos (e luvas) levam também **`punho_L`** e **`punho_R`**: a mão fechada, usada para segurar a arma.

### 5. Rosto

O rosto é parte do corpo, feito de faces pintadas (guia): olho = 3 faces (branco sujo, íris com `_TINT` 6 e um ponto de brilho) mais a linha escura da pálpebra; sobrancelha = um quadrilátero com `_TINT` 5 numa célula 20% mais escura; nariz com ponte e ponta em planos distintos e a face de baixo mais escura; boca = linha escura entre os lábios. O estilo de olho (`redondo`, `amendoado`, `marcante`) escolhe a variante do corpo.

### 6. Itens rígidos (chapéu, óculos, pulseira, arma)

- Malha comum (sem skin), com a origem no ponto de encaixe.
- No registro: `socket` (`head`, `back`, `hand_R`, `hand_L`, `wrist_L`, `wrist_R`) e `grip` (posição e rotação em relação ao socket).
- Armas com o cano para **-Z** e o cabo na origem.

### 7. Exportar

- File → Export → glTF 2.0, formato **glb**. Marque: Selected Objects, Apply Modifiers, Skinning, Shape Keys e Attributes. Deixe "Animation" só no corpo, se ele trouxer clipes (`idle`, `walk`, `run`).
- Orçamento (guia): corpo 1.800 + cabeça 500, cabelo 300 a 800, parte de cima 400 a 900, parte de baixo 300 a 700, calçado 200 a 400, acessório 50 a 300; personagem completo até 4.500.
- Coloque o arquivo em `public/models/personagens/` e aponte a `url` do item no [registry.ts](../client/character/registry.ts), por exemplo `{ id: 'jaqueta', slot: 'torso', url: '/models/personagens/jaqueta.glb', hides: ['chest', 'belly'], channels: { secondary: 'shade', detail: '#ffffff' } }`.
