// The character catalog (style guide, "Catálogo"): every hair style, piece of clothing, headwear, accessory
// and piece of tactical gear, with the slots it takes, the color channels the player paints (P primary, S
// secondary, D detail) and its names. Shared by the client (editor, models) and the server (validation).
//
// Rules (style guide): two items in the same slot can't be worn together; an item that takes more than one
// slot (a full-face helmet: head + face) frees the others. Cosmetics never change the hitbox.
// `ready`: the item has a model. Items arrive in batches; the rest of the list is the plan.

/** Where items go. Clothes first, then the sockets accessories hang from. */
export const SLOTS = [
  'tronco', // shirt, sweater (the torso)
  'sobreposicao', // jacket or coat over the torso
  'baixo', // pants, shorts, skirt
  'calcado', // shoes
  'cabeca', // hat, cap, helmet
  'rosto', // glasses, mask
  'orelhas',
  'pescoco',
  'pulsoE',
  'pulsoD',
  'maos',
  'antebraco',
  'cotovelos',
  'ombro', // one shoulder: radio, flashlight, crossbody bag
  'ombros', // both: armored shoulder pads
  'colete', // vest, plate carrier
  'acessorioColete', // things clipped to the vest or the chest
  'peito', // suspenders, bandolier
  'costas', // backpack
  'cintura', // belt, pouch
  'coxaE',
  'coxaD',
  'joelhos',
  'pes', // a knife in the boot
  'pele', // tattoos
] as const;
export type Slot = (typeof SLOTS)[number];

/** Slots a look must always fill. */
export const REQUIRED_SLOTS: readonly Slot[] = ['tronco', 'baixo', 'calcado'];

/** Big pieces: their primary color can't be an accent (saturation rule). */
export const BIG_SLOTS: readonly Slot[] = ['tronco', 'sobreposicao', 'baixo'];

export type Category = 'cabelo' | 'barba' | 'camiseta' | 'blusa' | 'jaqueta' | 'calca' | 'short' | 'calcado' | 'cabeca' | 'acessorio' | 'tatico';
export type Channel = 'P' | 'S' | 'D';
/** Sleeve length of tops (the first-person arms show it). */
export type Sleeve = 'nenhuma' | 'curta' | 'longa';

export interface CatalogItem {
  id: string;
  category: Category;
  /** The first is where the look stores it; the others are taken too. */
  slots: Slot[];
  channels: Channel[];
  name: { pt: string; en: string };
  sleeve?: Sleeve;
  ready: boolean;
}

// One line per item: id | pt | en | slots (comma-separated) | channels | sleeve (n/c/l).
const TABLES: Record<Category, string> = {
  cabelo: `
raspado|Raspado|Shaved|||
buzzCut|Buzz cut|Buzz cut|||
militar|Militar alto e reto|High and tight|||
degrade|Degradê clássico|Classic fade|||
topete|Topete|Quiff|||
franjaReta|Franja reta curta|Short straight bangs|||
curto|Bagunçado curto|Messy short|||
moicano|Moicano espetado|Spiked mohawk|||
moicanoBaixo|Moicano baixo|Low mohawk|||
afroCurto|Afro curto|Short afro|||
blackPower|Afro volumoso|Big afro|||
trancasNago|Tranças nagô|Cornrows|||
dreadsCurtos|Dreads curtos|Short dreads|||
dreadsPresos|Dreads longos presos|Tied long dreads|||
cacheado|Cacheado médio|Medium curls|||
repartido|Repartido de lado|Side part|||
penteadoTras|Penteado para trás|Slicked back|||
undercut|Undercut com topo longo|Long-top undercut|||
medioDesfiado|Médio desfiado|Choppy medium|||
chanel|Chanel reto|Straight bob|||
franjaLateral|Médio com franja lateral|Side-swept medium|||
longo|Longo liso solto|Long straight|||
longoOndulado|Longo ondulado|Long wavy|||
raboAlto|Rabo de cavalo alto|High ponytail|||
rabo|Rabo de cavalo baixo|Low ponytail|||
coque|Coque alto|High bun|||
coqueDuplo|Coque duplo|Space buns|||
tranca|Trança única|Single braid|||
trancasBox|Tranças box longas|Long box braids|||
meioPreso|Meio preso|Half-up|||`,
  barba: `
barbaPorFazer|Barba por fazer|Stubble|||
bigode|Bigode|Mustache|||
cavanhaque|Cavanhaque|Goatee|||
barbaCurta|Barba curta|Short beard|||
barbaCheia|Barba cheia|Full beard|||
barbaLonga|Barba longa|Long beard|||`,
  camiseta: `
basica|Básica gola careca|Crew neck tee|tronco|PS|c
golaV|Gola V|V-neck tee|tronco|PS|c
polo|Gola polo|Polo shirt|tronco|PSD|c
henley|Henley|Henley|tronco|PD|c
oversized|Oversized|Oversized tee|tronco|PS|c
mangaDobrada|Manga dobrada|Rolled-sleeve tee|tronco|PS|c
raglan|Raglan|Raglan tee|tronco|PS|c
listrada|Listrada horizontal|Striped tee|tronco|PS|c
estampa|Estampa frontal|Graphic tee|tronco|PD|c
timeEsportivo|Time esportivo|Sports jersey|tronco|PSD|c
mangaLonga|Manga longa básica|Long-sleeve tee|tronco|PS|l
termica|Manga longa térmica|Thermal shirt|tronco|PS|l
segundaPele|Segunda pele tática|Tactical base layer|tronco|PS|l
camisetaTatica|Camiseta tática|Tactical tee|tronco|PSD|c
rasgada|Rasgada|Ripped tee|tronco|P|c
regataCavada|Regata cavada|Muscle tank|tronco|PS|n
regata|Regata básica|Tank top|tronco|P|n
regataCanelada|Regata canelada|Ribbed tank|tronco|P|n
cropped|Cropped|Crop top|tronco|PS|c
topEsportivo|Top esportivo|Sports top|tronco|PS|n
socialCurta|Camisa social manga curta|Short-sleeve dress shirt|tronco|PSD|c
socialLonga|Camisa social manga longa|Long-sleeve dress shirt|tronco|PSD|l
xadrezAberta|Camisa xadrez aberta|Open flannel shirt|tronco|PSD|l
havaiana|Camisa havaiana|Hawaiian shirt|tronco|PD|c
camisaJeans|Camisa jeans|Denim shirt|tronco|PS|l
flanela|Camisa de flanela fechada|Flannel shirt|tronco|PSD|c
bata|Bata de mangas largas|Peasant blouse|tronco|PS|l
mecanico|Uniforme de mecânico|Mechanic shirt|tronco|PSD|c
hoquei|Camiseta de hóquei (jersey)|Hockey jersey|tronco|PSD|l
coleteLa|Colete de lã sobre camisa|Sweater vest over shirt|tronco|PS|l`,
  blusa: `
moletomCanguru|Moletom canguru|Hoodie|tronco|PS|l
moletomCapuz|Moletom canguru com capuz|Hoodie, hood up|tronco,cabeca|PS|l
moletomZiper|Moletom com zíper|Zip hoodie|tronco|PSD|l
moletomSemCapuz|Moletom sem capuz|Crewneck sweatshirt|tronco|PS|l
moletomOversized|Moletom oversized|Oversized hoodie|tronco|PS|l
moletomCropped|Moletom cropped|Cropped hoodie|tronco|PS|l
universitario|Moletom universitário|College sweatshirt|tronco|PSD|l
bicolor|Moletom bicolor|Two-tone sweatshirt|tronco|PS|l
trico|Suéter tricô grosso|Chunky knit sweater|tronco|P|l
golaAlta|Suéter gola alta|Turtleneck|tronco|PS|l
sueterV|Suéter decote V|V-neck sweater|tronco|PS|l
natalino|Suéter natalino|Holiday sweater|tronco|PSD|l
cardiga|Cardigã aberto|Open cardigan|tronco|PD|l
cardigaLongo|Cardigã longo|Long cardigan|tronco|PS|l
pescador|Blusa de pescador|Fisherman sweater|tronco|P|l
fleeceMeioZiper|Fleece com meio zíper|Half-zip fleece|tronco|PSD|l
fleeceTatico|Fleece tático|Tactical fleece|tronco|PSD|l
termicaMontanha|Blusa térmica de montanha|Mountain thermal|tronco|PS|l
anorak|Anorak|Anorak|tronco|PSD|l
puloverMilitar|Pulôver militar|Military pullover|tronco|PS|l
sueterHoquei|Suéter de hóquei|Hockey sweater|tronco|PS|l
golaCanoa|Blusa de gola canoa|Off-shoulder top|tronco|P|l
ciganinha|Blusa ciganinha|Ruffle top|tronco|PS|c
poncho|Poncho de lã|Wool poncho|tronco|PSD|n
ciclista|Blusa de ciclista|Cycling jersey|tronco|PSD|c
agasalho|Agasalho de treino|Track jacket|tronco|PS|l
goleiro|Blusa de goleiro|Goalkeeper jersey|tronco|PS|l
tunica|Túnica|Tunic|tronco|PS|l
remendos|Suéter com remendos|Patched sweater|tronco|PS|l
balaclavaMoletom|Balaclava + moletom|Balaclava hoodie|tronco,cabeca,rosto|PS|l`,
  jaqueta: `
jaquetaJeans|Jaqueta jeans|Denim jacket|sobreposicao|PS|l
coleteJeans|Colete jeans sem mangas|Denim vest|sobreposicao|PD|n
couroMoto|Jaqueta de couro motociclista|Biker leather jacket|sobreposicao|PD|l
jaquetaAviador|Jaqueta de couro aviador|Leather flight jacket|sobreposicao|PS|l
bomber|Bomber|Bomber jacket|sobreposicao|PSD|l
cortaVento|Corta-vento|Windbreaker|sobreposicao|PS|l
pufferCurta|Puffer curta|Short puffer|sobreposicao|PS|l
pufferLonga|Puffer longa|Long puffer|sobreposicao|PS|l
coletePuffer|Colete puffer|Puffer vest|sobreposicao|PS|n
parka|Parka militar|Military parka|sobreposicao|PS|l
m65|Jaqueta de campo M65|M65 field jacket|sobreposicao|PS|l
softshell|Jaqueta tática softshell|Tactical softshell|sobreposicao|PSD|l
jaquetaCamuflada|Jaqueta de camuflagem|Camo jacket|sobreposicao|PD|l
blazer|Blazer|Blazer|sobreposicao|PS|l
paleto|Paletó de terno|Suit jacket|sobreposicao|PSD|l
trench|Trench coat|Trench coat|sobreposicao|PS|l
sobretudo|Sobretudo de lã|Wool overcoat|sobreposicao|P|l
shearling|Casaco de pastor (shearling)|Shearling coat|sobreposicao|PS|l
brim|Jaqueta de brim de trabalho|Work canvas jacket|sobreposicao|PS|l
varsity|Jaqueta varsity|Varsity jacket|sobreposicao|PSD|l
jaquetaCorrida|Jaqueta de corrida|Running jacket|sobreposicao|PSD|l
jaquetaChuva|Jaqueta de chuva|Rain jacket|sobreposicao|PS|l
capaPoncho|Capa de chuva poncho|Rain poncho|sobreposicao|P|n
jaquetaEsqui|Jaqueta de esqui|Ski jacket|sobreposicao|PSD|l
macacaoVoo|Macacão de voo (parte de cima)|Flight suit top|sobreposicao|PSD|l
guardaPo|Guarda-pó|Duster coat|sobreposicao|P|l
chef|Jaqueta de chef|Chef jacket|sobreposicao|PD|l
jaleco|Jaleco|Lab coat|sobreposicao|PD|l
coletePesca|Colete de pesca|Fishing vest|sobreposicao|PS|n
capaCapuz|Capa com capuz|Hooded cape|sobreposicao,cabeca|PS|n`,
  calca: `
calcaJeans|Jeans reta|Straight jeans|baixo|PS|
jeansSkinny|Jeans skinny|Skinny jeans|baixo|PS|
jeansRasgada|Jeans rasgada|Ripped jeans|baixo|PS|
jeansDobrada|Jeans com barra dobrada|Cuffed jeans|baixo|PS|
jeans90|Jeans larga anos 90|Baggy 90s jeans|baixo|PS|
cargoTatica|Cargo tática|Tactical cargo pants|baixo|PS|
calcaCargo|Cargo casual|Casual cargo pants|baixo|PS|
combate|Calça de combate|Combat pants|baixo|PSD|
calcaCamuflada|Calça camuflada|Camo pants|baixo|PD|
chino|Chino|Chinos|baixo|P|
social|Calça social|Dress pants|baixo|PD|
calcaTerno|Calça de terno|Suit pants|baixo|P|
calcaMoletom|Moletom jogger|Joggers|baixo|PS|
calcaAgasalho|Calça de agasalho|Track pants|baixo|PS|
legging|Legging|Leggings|baixo|PS|
calcaTrabalho|Calça de trabalho|Work pants|baixo|PS|
jardineira|Macacão jardineira (parte de baixo)|Overalls|baixo|PSD|
calcaCouro|Calça de couro|Leather pants|baixo|P|
calcaMoto|Calça de motociclista|Moto pants|baixo|PS|
pantalona|Pantalona|Wide-leg pants|baixo|P|
linho|Calça de linho|Linen pants|baixo|P|
calcaXadrez|Calça xadrez|Plaid pants|baixo|PS|
calcaEsqui|Calça de esqui|Ski pants|baixo|PS|
pijama|Calça de pijama|Pajama pants|baixo|PS|
montaria|Calça de montaria|Riding breeches|baixo|P|
enfermagem|Calça de enfermagem|Scrub pants|baixo|P|
paraquedista|Calça de paraquedista|Parachute pants|baixo|PS|
caminhada|Calça de caminhada|Hiking pants|baixo|PS|
bocaSino|Calça boca de sino|Flared pants|baixo|P|
escolar|Calça de uniforme escolar|School uniform pants|baixo|PS|`,
  short: `
bermudaJeans|Bermuda jeans|Denim shorts|baixo|P|
shortJeans|Short jeans curto|Short denim shorts|baixo|PS|
bermudaCargo|Bermuda cargo|Cargo shorts|baixo|PS|
bermudaTatica|Bermuda tática|Tactical shorts|baixo|PSD|
shortMoletom|Short de moletom|Sweat shorts|baixo|PS|
shortCorrida|Short de corrida|Running shorts|baixo|PS|
bermudaEsportiva|Short de basquete|Basketball shorts|baixo|PS|
shortFutebol|Short de futebol|Soccer shorts|baixo|PSD|
bermudaPraia|Bermuda de surf|Board shorts|baixo|PD|
bermudaChino|Bermuda chino|Chino shorts|baixo|P|
bermudaXadrez|Bermuda xadrez|Plaid shorts|baixo|PS|
shortCiclista|Short de ciclista|Bike shorts|baixo|PS|
shortLutador|Short de lutador|Fight shorts|baixo|PS|
bermudaTrabalho|Bermuda de trabalho|Work shorts|baixo|PS|
shortCinturaAlta|Short cintura alta|High-waist shorts|baixo|PD|
saiaJeans|Saia jeans curta|Denim skirt|baixo|PS|
saiaLapis|Saia lápis|Pencil skirt|baixo|P|
saiaPregas|Saia plissada|Pleated skirt|baixo|PS|
saiaRodada|Saia midi rodada|Midi circle skirt|baixo|P|
saiaLonga|Saia longa|Long skirt|baixo|P|
saiaXadrez|Saia xadrez|Plaid skirt|baixo|PS|
saiaCouro|Saia de couro|Leather skirt|baixo|PD|
kilt|Saia tática (kilt utilitário)|Utility kilt|baixo|PSD|
saiaEnvelope|Saia envelope|Wrap skirt|baixo|PS|
saiaShort|Saia-short|Skort|baixo|P|
saiaTenis|Saia de tênis|Tennis skirt|baixo|PS|
shortMeiaCalca|Short com meia-calça|Shorts with tights|baixo|PS|
bermudaJoelheira|Bermuda com joelheira|Shorts with knee pads|baixo|PS|
shortBanho|Short de banho|Swim shorts|baixo|PD|
bermudaLinho|Bermuda de linho|Linen shorts|baixo|P|`,
  calcado: `
tenis|Tênis casual|Sneakers|calcado|PSD|
tenisCorrida|Tênis de corrida|Running shoes|calcado|PSD|
canoAlto|Tênis cano alto|High-tops|calcado|PSD|
skate|Tênis skate|Skate shoes|calcado|PS|
tenisBasquete|Tênis de basquete|Basketball shoes|calcado|PSD|
slipOn|Tênis slip-on|Slip-ons|calcado|PS|
bota|Coturno militar|Combat boots|calcado|PS|
botaTatica|Bota tática|Tactical boots|calcado|PS|
botaDeserto|Bota de deserto|Desert boots|calcado|PS|
botaTrilha|Bota de trilha|Hiking boots|calcado|PSD|
botaTrabalho|Bota de trabalho|Work boots|calcado|PS|
botaMoto|Bota de motociclista|Biker boots|calcado|PD|
botaCauboi|Bota de caubói|Cowboy boots|calcado|PS|
botaChuva|Bota de chuva|Rain boots|calcado|P|
botaNeve|Bota de neve|Snow boots|calcado|PS|
chelsea|Chelsea boot|Chelsea boots|calcado|PS|
botaCanoLongo|Bota de cano longo|Knee-high boots|calcado|P|
sapatoSocial|Sapato social|Dress shoes|calcado|PS|
mocassim|Mocassim|Loafers|calcado|P|
sapatoTrabalho|Sapato de trabalho|Work shoes|calcado|P|
sapatilha|Sapatilha|Flats|calcado|PD|
papete|Sandália papete|Sport sandals|calcado|PS|
chinelo|Chinelo|Flip-flops|calcado|PS|
chuteira|Chuteira|Cleats|calcado|PSD|
lona|Tênis de lona clássico|Canvas sneakers|calcado|PS|
galocha|Galocha de trabalho|Work galoshes|calcado|P|
botaSalto|Bota de salto|Heeled boots|calcado|P|
tamanco|Tamanco|Clogs|calcado|PS|
plataforma|Tênis plataforma|Platform sneakers|calcado|PS|
descalco|Pés descalços|Barefoot|calcado||`,
  cabeca: `
bone|Boné de aba curva|Curved-brim cap|cabeca|PS|
boneReto|Boné aba reta|Flat-brim cap|cabeca|PS|
bonePraTras|Boné para trás|Backwards cap|cabeca|PS|
boneTatico|Boné tático|Tactical cap|cabeca|PSD|
gorroLa|Gorro de lã|Wool beanie|cabeca|PS|
gorro|Gorro com pompom|Pom-pom beanie|cabeca|PSD|
touca|Touca justa|Skullcap|cabeca|P|
cauboi|Chapéu de caubói|Cowboy hat|cabeca|PS|
palha|Chapéu de palha|Straw hat|cabeca|PS|
panama|Chapéu panamá|Panama hat|cabeca|PS|
fedora|Fedora|Fedora|cabeca|PS|
bucket|Bucket hat|Bucket hat|cabeca|PS|
boonie|Boonie militar|Boonie hat|cabeca|PS|
boina|Boina|Beret|cabeca|P|
bandanaCabeca|Bandana na cabeça|Head bandana|cabeca|PS|
faixaCabeca|Faixa de cabeça|Headband|cabeca|PS|
capaceteMilitar|Capacete militar|Military helmet|cabeca|PS|
capaceteTatico|Capacete tático|Tactical helmet|cabeca|PSD|
capaceteVisao|Capacete tático com visão noturna|Night-vision helmet|cabeca,rosto|PSD|
motoAberto|Capacete de moto aberto|Open-face moto helmet|cabeca|PSD|
motoFechado|Capacete de moto fechado|Full-face moto helmet|cabeca,rosto|PSD|
capaceteObra|Capacete de obra|Hard hat|cabeca|P|
capaceteBike|Capacete de bicicleta|Bike helmet|cabeca|PSD|
capacetePiloto|Capacete de piloto de avião|Pilot helmet|cabeca,rosto|PSD|
headset|Headset|Headset|orelhas|PS|
protetorAuricular|Protetor auricular tático|Tactical ear protection|orelhas|PS|
shemagh|Capuz de guerrilha (shemagh)|Shemagh|cabeca,pescoco|PS|
chapeuChef|Chapéu de chef|Chef hat|cabeca|P|
pescadorOculos|Chapéu de pescador com óculos|Fisherman hat with goggles|cabeca|PSD|
coroaFlores|Coroa de flores|Flower crown|cabeca|PSD|`,
  acessorio: `
aviador|Óculos de sol aviador|Aviator sunglasses|rosto|PS|
escuros|Óculos de sol quadrado|Square sunglasses|rosto|PS|
redondos|Óculos de grau redondo|Round glasses|rosto|P|
balistico|Óculos balístico|Ballistic glasses|rosto|PS|
oculosEsqui|Óculos de esqui|Ski goggles|rosto|PS|
mascaraCirurgica|Máscara cirúrgica|Surgical mask|rosto|P|
bandanaRosto|Bandana no rosto|Face bandana|rosto|PS|
mascaraGas|Máscara de gás|Gas mask|rosto|PSD|
balaclava|Balaclava|Balaclava|rosto,cabeca|P|
mascaraHoquei|Máscara de hóquei|Hockey mask|rosto|PS|
tapaOlho|Tapa-olho|Eye patch|rosto|P|
argola|Brinco de argola|Hoop earrings|orelhas|P|
piercings|Piercings|Piercings|rosto|P|
corrente|Corrente no pescoço|Neck chain|pescoco|P|
dogTag|Plaquinha de identificação (dog tag)|Dog tags|pescoco|P|
cachecol|Cachecol|Scarf|pescoco|PS|
lencoPescoco|Lenço de pescoço|Neckerchief|pescoco|PS|
gravata|Gravata|Tie|pescoco|P|
relogio|Relógio|Watch|pulsoE|PSD|
micangas|Pulseiras|Bracelets|pulsoD|PD|
couro|Pulseira de couro|Leather cuff|pulsoD|P|
luvasSemDedos|Luvas sem dedos|Fingerless gloves|maos|PS|
luvasTaticas|Luvas táticas|Tactical gloves|maos|PS|
luvasTrabalho|Luvas de trabalho|Work gloves|maos|PS|
mochilaEscolar|Mochila escolar|School backpack|costas|PSD|
mochilaTrilha|Mochila de trilha|Hiking backpack|costas|PSD|
bolsaTransversal|Bolsa transversal|Crossbody bag|ombro|PS|
pochete|Pochete|Fanny pack|cintura|PS|
cinto|Cinto com fivela|Buckle belt|cintura|PD|
suspensorios|Suspensórios|Suspenders|peito|PD|
tatuagens|Tatuagens|Tattoos|pele|P|`,
  tatico: `
coletePlacas|Colete de placas|Plate carrier|colete|PS|
portaCarregadores|Colete porta-carregadores|Magazine vest|colete|PS|
assaltoPesado|Colete de assalto pesado|Heavy assault vest|colete|PS|
chestRig|Colete leve (chest rig)|Chest rig|colete|PS|
coleteImprensa|Colete de imprensa|Press vest|colete|PD|
coletePolicia|Colete de polícia|Police vest|colete|PSD|
cinturao|Cinturão de combate|Battle belt|cintura|PS|
coldre|Coldre de perna|Leg holster|coxaD|PS|
bolsaPerna|Bolsa de perna|Leg pouch|coxaE|PS|
primeirosSocorros|Bolsa de primeiros socorros|First-aid pouch|cintura|PD|
portaGranadas|Porta-granadas|Grenade pouches|acessorioColete|PS|
radioOmbro|Rádio no ombro|Shoulder radio|ombro|PS|
mochilaAssalto|Mochila de assalto|Assault pack|costas|PS|
mochilaRadio|Mochila de rádio|Radio pack|costas|PS|
hidratacao|Kit de hidratação|Hydration pack|costas|PS|
joelheiras|Joelheiras|Knee pads|joelhos|PS|
cotoveleiras|Cotoveleiras|Elbow pads|cotovelos|PS|
ombreiras|Ombreiras blindadas|Armored shoulder pads|ombros|PS|
protetorPescoco|Protetor de pescoço|Neck guard|pescoco|PS|
protetorVirilha|Protetor de virilha|Groin protector|cintura|PS|
patches|Patches de velcro|Velcro patches|acessorioColete|PD|
lanternaOmbro|Lanterna no ombro|Shoulder flashlight|ombro|PS|
canivete|Canivete no colete|Vest knife|acessorioColete|PS|
facaBota|Faca na bota|Boot knife|pes|PS|
bandoleira|Bandoleira|Bandolier|peito|PSD|
ghillie|Poncho camuflado (ghillie)|Ghillie poncho|costas,cabeca|PS|
capaTatica|Capa de chuva tática|Tactical rain cape|costas|P|
rapel|Corda de rapel|Rappel rope|cintura|PS|
mapaBussola|Mapa e bússola|Map and compass|antebraco|PS|`,
};

/**
 * Items with a model (procedural or GLB), one list per batch. 'all' = the whole category. Grows with every
 * batch.
 */
const READY_LISTS: Record<string, readonly string[] | { all: Category }> = {
  cabelo: { all: 'cabelo' },
  barba: { all: 'barba' },
  camiseta: { all: 'camiseta' },
  blusa: { all: 'blusa' },
  jaqueta: { all: 'jaqueta' },
  calca: { all: 'calca' },
  short: { all: 'short' },
  calcado: { all: 'calcado' },
  cabeca: [
    'bone', 'boneReto', 'bonePraTras', 'boneTatico', 'gorroLa', 'gorro', 'touca', 'cauboi', 'palha', 'panama', 'fedora', 'bucket', 'boonie', 'boina',
    'bandanaCabeca', 'faixaCabeca', 'capaceteMilitar', 'capaceteTatico', 'capaceteVisao', 'motoAberto', 'motoFechado', 'capaceteObra', 'capaceteBike',
    'capacetePiloto', 'headset', 'protetorAuricular', 'shemagh', 'chapeuChef', 'pescadorOculos', 'coroaFlores',
  ],
  // Face and ear accessories (glasses, masks, earrings, piercings).
  rosto: [
    'aviador', 'escuros', 'redondos', 'balistico', 'oculosEsqui', 'mascaraCirurgica', 'bandanaRosto', 'mascaraGas', 'balaclava', 'mascaraHoquei', 'tapaOlho',
    'argola', 'piercings',
  ],
  // The other accessories (neck, wrists, hands, bags, belts, tattoos).
  acessorio: [
    'relogio',
    'micangas',
    'couro',
    'corrente',
    'dogTag',
    'cachecol',
    'lencoPescoco',
    'gravata',
    'luvasSemDedos',
    'luvasTaticas',
    'luvasTrabalho',
    'mochilaEscolar',
    'mochilaTrilha',
    'bolsaTransversal',
    'pochete',
    'cinto',
    'suspensorios',
    'tatuagens',
  ],
  tatico: { all: 'tatico' },
};

const SLEEVES: Record<string, Sleeve> = { n: 'nenhuma', c: 'curta', l: 'longa' };

function parse(): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const [category, table] of Object.entries(TABLES) as [Category, string][]) {
    for (const line of table.trim().split('\n')) {
      const [id, pt, en, slots, channels, sleeve] = line.split('|');
      out.push({
        id,
        category,
        slots: category === 'cabelo' || category === 'barba' ? [] : (slots.split(',') as Slot[]),
        channels: channels.split('') as Channel[],
        name: { pt, en },
        sleeve: sleeve ? SLEEVES[sleeve] : undefined,
        ready: false,
      });
    }
  }
  return out;
}

export const CATALOG: readonly CatalogItem[] = parse();
for (const list of Object.values(READY_LISTS)) {
  for (const it of CATALOG) if ('all' in list ? it.category === list.all : list.includes(it.id)) it.ready = true;
}
const byId = new Map(CATALOG.map((i) => [i.id, i]));

export const catalogItem = (id: string): CatalogItem | undefined => byId.get(id);

/** Items of a category (only the ones with a model, unless `all`). */
export function catalogOf(category: Category, all = false): CatalogItem[] {
  return CATALOG.filter((i) => i.category === category && (all || i.ready));
}

/** Items that go in a slot (as their first slot). */
export function catalogForSlot(slot: Slot, all = false): CatalogItem[] {
  return CATALOG.filter((i) => i.slots[0] === slot && (all || i.ready));
}
