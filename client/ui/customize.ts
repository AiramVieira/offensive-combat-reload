// Character editor (Perfil → Personalizar), in the spirit of The Sims' Create-a-Sim: a big 3D stage that
// zooms to the part being edited, category tabs over the whole catalog (shared/catalog.ts), a search box,
// every option as a thumbnail rendered from the character itself (in its current colors), and the palette's
// swatches for each color channel of what is worn (primary, secondary, detail). Shows what the look does in
// the game (health, eye height, hitbox, reload, speed) as you choose.
import * as THREE from 'three';
import {
  allowedColors,
  ARM_LOSSES,
  BEARDS,
  BUILDS,
  defaultAppearance,
  EYE_COLORS,
  EYE_STYLES,
  BROW_STYLES,
  EAR_STYLES,
  FACE_MARKS,
  FACE_SHAPES,
  MOUTH_STYLES,
  NOSE_STYLES,
  sanitizeFace,
  type Face,
  HAIR_COLORS,
  HAIR_STYLES,
  HEIGHTS,
  itemIn,
  LEG_LOSSES,
  SKIN_COLORS,
  bodyStats,
  randomAppearance,
  hitboxSize,
  wear,
  type Appearance,
} from '@shared/appearance';
import { catalogItem, catalogOf, CATALOG, type CatalogItem, type Category, type Channel, type Slot } from '@shared/catalog';
import type { Sex } from '@shared/protocol';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Avatar, appearanceToConfig, disposeAvatar } from '../entities/avatar';
import { api } from '../net/api';
import { errorText } from './auth';
import { getLang } from './strings';

/** Labels in pt-BR and en (the editor has many; they live here instead of strings.ts). */
const L: Record<string, [string, string]> = {
  title: ['Personalizar personagem', 'Customize character'],
  tabBody: ['Corpo', 'Body'],
  tabHair: ['Rosto e cabelo', 'Face & hair'],
  tabTop: ['Parte de cima', 'Tops'],
  tabBottom: ['Parte de baixo', 'Bottoms'],
  tabShoes: ['Calçados', 'Shoes'],
  tabHead: ['Cabeça', 'Headwear'],
  tabAcc: ['Acessórios', 'Accessories'],
  tabTactical: ['Tático', 'Tactical'],
  tabPcd: ['Modo PCD', 'PCD mode'],
  search: ['Buscar peça…', 'Search items…'],
  results: ['Resultados', 'Results'],
  noResults: ['Nada encontrado.', 'Nothing found.'],
  soon: ['As peças desta categoria chegam nas próximas atualizações.', 'Items in this category arrive in the next updates.'],
  height: ['Altura', 'Height'],
  build: ['Biotipo', 'Build'],
  skin: ['Cor da pele', 'Skin color'],
  hairStyle: ['Cabelo', 'Hair'],
  hairColor: ['Cor do cabelo e da barba', 'Hair & beard color'],
  beard: ['Barba', 'Facial hair'],
  eyeColor: ['Cor dos olhos', 'Eye color'],
  eyeStyle: ['Olhos', 'Eyes'],
  redondo: ['Redondos', 'Round'],
  amendoado: ['Amendoados', 'Almond'],
  marcante: ['Marcantes', 'Sharp'],
  caido: ['Caídos', 'Downturned'],
  puxado: ['Puxados', 'Upturned'],
  grande: ['Grandes', 'Big'],
  // The face (keys prefixed: some values repeat across features).
  faceShape: ['Formato do rosto', 'Face shape'],
  'formato.oval': ['Oval', 'Oval'],
  'formato.quadrado': ['Quadrado', 'Square'],
  'formato.redondo': ['Redondo', 'Round'],
  'formato.longo': ['Fino e longo', 'Long'],
  'formato.coracao': ['Coração', 'Heart'],
  brows: ['Sobrancelhas', 'Brows'],
  'sobrancelhas.reta': ['Retas', 'Straight'],
  'sobrancelhas.arqueada': ['Arqueadas', 'Arched'],
  'sobrancelhas.grossa': ['Grossas', 'Thick'],
  'sobrancelhas.fina': ['Finas', 'Thin'],
  nose: ['Nariz', 'Nose'],
  'nariz.reto': ['Reto', 'Straight'],
  'nariz.largo': ['Largo', 'Wide'],
  'nariz.aquilino': ['Aquilino', 'Aquiline'],
  'nariz.arrebitado': ['Arrebitado', 'Upturned'],
  mouth: ['Boca', 'Mouth'],
  'boca.media': ['Média', 'Medium'],
  'boca.fina': ['Lábios finos', 'Thin lips'],
  'boca.carnuda': ['Lábios carnudos', 'Full lips'],
  ears: ['Orelhas', 'Ears'],
  'orelhas.normal': ['Normais', 'Normal'],
  'orelhas.pequena': ['Pequenas', 'Small'],
  'orelhas.abano': ['De abano', 'Protruding'],
  marks: ['Marcas', 'Marks'],
  'marcas.nenhuma': ['Nenhuma', 'None'],
  'marcas.sardas': ['Sardas', 'Freckles'],
  'marcas.cicatriz': ['Cicatriz', 'Scar'],
  'marcas.pinta': ['Pinta', 'Beauty mark'],
  animIdle: ['Parado', 'Idle'],
  animWalk: ['Andar', 'Walk'],
  animRun: ['Correr', 'Run'],
  animDance: ['Dançar', 'Dance'],
  animAim: ['Mirar', 'Aim'],
  random: ['Aleatório', 'Random'],
  copyJson: ['Copiar JSON', 'Copy JSON'],
  copied: ['Configuração copiada (JSON).', 'Config copied (JSON).'],
  exportGlb: ['Exportar GLB', 'Export GLB'],
  exported: ['Modelo exportado (personagem.glb).', 'Model exported (personagem.glb).'],
  P: ['Cor principal', 'Main color'],
  S: ['Cor secundária', 'Secondary color'],
  D: ['Detalhe', 'Detail'],
  arm: ['Braço ou mão', 'Arm or hand'],
  leg: ['Perna', 'Leg'],
  pcdHint: [
    'Personagem sem um braço, uma mão ou uma perna. A hitbox fica menor; sem mão ou braço recarrega 30% mais devagar, sem perna anda 25% mais devagar. Aparece também nas mãos em primeira pessoa.',
    'A character missing an arm, a hand or a leg. Smaller hitbox; no hand or arm reloads 30% slower, no leg moves 25% slower. Also shown on the first-person hands.',
  ],
  save: ['SALVAR', 'SAVE'],
  cancel: ['Cancelar', 'Cancel'],
  reset: ['Restaurar padrão', 'Reset to default'],
  saved: ['Personagem salvo.', 'Character saved.'],
  effects: ['No jogo', 'In the game'],
  health: ['Vida', 'Health'],
  reload: ['Recarga', 'Reload'],
  speed: ['Velocidade', 'Speed'],
  hitbox: ['Hitbox', 'Hitbox'],
  dragHint: ['Arraste para girar · role para aproximar', 'Drag to rotate · scroll to zoom'],
  none: ['Nenhum', 'None'],
  pequeno: ['Pequeno', 'Short'],
  medio: ['Médio', 'Medium'],
  alto: ['Alto', 'Tall'],
  magro: ['Magro', 'Slim'],
  gordo: ['Gordo', 'Heavy'],
  complete: ['Completo', 'Full'],
  bracoEsq: ['Sem braço esq.', 'No left arm'],
  bracoDir: ['Sem braço dir.', 'No right arm'],
  maoEsq: ['Sem mão esq.', 'No left hand'],
  maoDir: ['Sem mão dir.', 'No right hand'],
  pernaEsq: ['Sem perna esq.', 'No left leg'],
  pernaDir: ['Sem perna dir.', 'No right leg'],
  // Groups of the catalog.
  camiseta: ['Camisetas e regatas', 'Tees & tanks'],
  blusa: ['Blusas e moletons', 'Sweaters & hoodies'],
  jaqueta: ['Jaquetas e casacos (por cima)', 'Jackets & coats (over)'],
  calca: ['Calças', 'Pants'],
  short: ['Shorts e bermudas', 'Shorts'],
  saia: ['Saias', 'Skirts'],
  calcado: ['Calçados', 'Shoes'],
  // Slots.
  tronco: ['Parte de cima', 'Top'],
  sobreposicao: ['Jaqueta', 'Jacket'],
  baixo: ['Parte de baixo', 'Bottoms'],
  cabeca: ['Cabeça', 'Head'],
  rosto: ['Rosto', 'Face'],
  orelhas: ['Orelhas', 'Ears'],
  pescoco: ['Pescoço', 'Neck'],
  pulsoE: ['Pulso esquerdo', 'Left wrist'],
  pulsoD: ['Pulso direito', 'Right wrist'],
  maos: ['Mãos', 'Hands'],
  antebraco: ['Antebraço', 'Forearm'],
  cotovelos: ['Cotovelos', 'Elbows'],
  ombro: ['Ombro', 'Shoulder'],
  ombros: ['Ombros', 'Shoulders'],
  colete: ['Colete', 'Vest'],
  acessorioColete: ['No colete', 'On the vest'],
  peito: ['Peito', 'Chest'],
  costas: ['Costas', 'Back'],
  cintura: ['Cintura', 'Waist'],
  coxaE: ['Coxa esquerda', 'Left thigh'],
  coxaD: ['Coxa direita', 'Right thigh'],
  joelhos: ['Joelhos', 'Knees'],
  pes: ['Pés', 'Feet'],
  pele: ['Pele', 'Skin'],
};
const l = (key: string) => (L[key] ?? [key, key])[getLang() === 'en' ? 1 : 0];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clone = (a: Appearance): Appearance => JSON.parse(JSON.stringify(a));

// --- Camera framing per part of the body ---------------------------------------------------------------

type Focus = 'full' | 'head' | 'torso' | 'legs' | 'feet';
/** Look-at height and distance, for an average body (scaled by the character's height). */
const FRAMES: Record<Focus, { y: number; dist: number }> = {
  full: { y: 0.95, dist: 5.4 },
  head: { y: 1.62, dist: 1.7 },
  torso: { y: 1.22, dist: 2.7 },
  legs: { y: 0.55, dist: 3.0 },
  feet: { y: 0.12, dist: 1.6 },
};

/**
 * Lighting that shows the facets (style guide): a strong warm key light and a weak cool hemisphere; the
 * temperature difference between lit and shadowed faces is what makes the style read.
 */
function setupScene(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xc4d8ff, 0x5a4c40, 1.6));
  const sun = new THREE.DirectionalLight(0xffe2bd, 2.8);
  sun.position.set(2.5, 4, -3);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9db8ff, 0.8);
  rim.position.set(-3, 2.5, 3);
  scene.add(rim);
}

/**
 * What the look does in the game, in one line. Height, build and clothes are only looks (same health, eye
 * and hitbox for everyone); only the PCD mode changes the hitbox, the reload and the speed.
 */
function effectsText(a: Appearance): string {
  const b = bodyStats(a);
  const parts = [`${l('health')} ${b.maxHealth}`, `${l('hitbox')} ${Math.round(hitboxSize(b) * 100)}%`];
  if (b.reloadMul !== 1) parts.push(`${l('reload')} +${Math.round((b.reloadMul - 1) * 100)}%`);
  if (b.speedMul !== 1) parts.push(`${l('speed')} −${Math.round((1 - b.speedMul) * 100)}%`);
  return parts.join(' · ');
}

/** The big stage: the character turning, the camera gliding to the part being edited. */
class Stage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private avatar: Avatar | null = null;
  private scale = 1;
  private yaw = 0.35;
  private zoom = 1;
  private focusName: Focus = 'full';
  private camY = FRAMES.full.y;
  private camDist = FRAMES.full.dist;
  private dragging = false;
  private idleSpin = true;
  private lastX = 0;
  private raf = 0;
  private last = performance.now();
  private anim: Anim = 'idle';
  private t = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    setupScene(this.scene);
    // A round floor under the feet.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), new THREE.MeshBasicMaterial({ color: 0x9fc6ea, transparent: true, opacity: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    canvas.onpointerdown = (e) => {
      this.dragging = true;
      this.idleSpin = false;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    };
    canvas.onpointerup = () => (this.dragging = false);
    canvas.onwheel = (e) => {
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.5, 1.8);
    };
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.idleSpin && !this.dragging) this.yaw += dt * 0.35;
      this.animate(dt);
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  show(look: Appearance, sex: Sex) {
    if (this.avatar) disposeAvatar(this.avatar);
    // Live (not baked): the editor rebuilds it on every change anyway.
    this.avatar = new Avatar(this.scene, look, sex, { bake: false });
    this.avatar.visible = true;
    this.scale = bodyStats(look).visualScale;
    this.animate(0);
  }

  play(a: Anim) {
    this.anim = a;
    this.t = 0;
  }

  private animate(dt: number) {
    const a = this.avatar;
    if (!a) return;
    this.t += dt;
    if (this.anim === 'walk') a.walk(dt, 3);
    else if (this.anim === 'run') a.walk(dt, 7);
    else if (this.anim === 'dance') a.dance(this.t % 3.6);
    else if (this.anim === 'aim') a.pose(dt, { speed: 0, crouch: false, pitch: 0, ads: true, reload: false, knife: false, cook: false });
    else a.idle(false, this.t);
  }

  focus(f: Focus) {
    this.focusName = f;
    this.zoom = 1;
  }

  private draw(dt: number) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // Glide toward the framing of the current part.
    const target = FRAMES[this.focusName];
    const k = 1 - Math.exp(-dt * 6);
    this.camY += (target.y * this.scale - this.camY) * k;
    this.camDist += (target.dist * this.zoom - this.camDist) * k;
    this.camera.position.set(0, this.camY + 0.08, -this.camDist);
    this.camera.lookAt(0, this.camY, 0);
    if (this.avatar) this.avatar.root.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    if (this.avatar) disposeAvatar(this.avatar);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

type Anim = 'idle' | 'walk' | 'run' | 'dance' | 'aim';
const ANIMS: [Anim, string][] = [
  ['idle', 'animIdle'],
  ['walk', 'animWalk'],
  ['run', 'animRun'],
  ['dance', 'animDance'],
  ['aim', 'animAim'],
];

/** Renders option thumbnails off screen, a few per frame, cached by look and framing. */
class Thumbnails {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private cache = new Map<string, string>();
  private queue: { key: string; look: Appearance; sex: Sex; focus: Focus; done: (url: string) => void }[] = [];
  private raf = 0;
  private disposed = false;

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(150, 150, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    setupScene(this.scene);
  }

  request(look: Appearance, sex: Sex, focus: Focus, done: (url: string) => void) {
    const key = `${sex}|${focus}|${JSON.stringify(look)}`;
    const hit = this.cache.get(key);
    if (hit) return done(hit);
    this.queue.push({ key, look: clone(look), sex, focus, done });
    if (!this.raf) this.raf = requestAnimationFrame(() => this.work());
  }

  private work() {
    this.raf = 0;
    if (this.disposed) return;
    const start = performance.now();
    // A few thumbnails per frame keeps the page responsive.
    while (this.queue.length && performance.now() - start < 24) {
      const job = this.queue.shift()!;
      const cached = this.cache.get(job.key);
      if (cached) {
        job.done(cached);
        continue;
      }
      const a = new Avatar(this.scene, job.look, job.sex, { bake: false });
      a.idle(false);
      a.visible = true;
      a.root.rotation.y = job.focus === 'head' ? 0.25 : 0.4;
      // Full-body thumbnails share one framing, so heights compare; close-ups follow the height.
      const scale = job.focus === 'full' ? 1 : bodyStats(job.look).visualScale;
      const fr = FRAMES[job.focus];
      const dist = job.focus === 'full' ? 5.6 : fr.dist * (job.focus === 'head' ? 0.85 : 0.8);
      this.camera.position.set(0, fr.y * scale + 0.06, -dist);
      this.camera.lookAt(0, fr.y * scale, 0);
      this.renderer.render(this.scene, this.camera);
      const url = this.renderer.domElement.toDataURL('image/png');
      disposeAvatar(a);
      this.cache.set(job.key, url);
      job.done(url);
    }
    if (this.queue.length) this.raf = requestAnimationFrame(() => this.work());
  }

  /** Forget pending thumbnails (the tab or the look changed). */
  clearQueue() {
    this.queue.length = 0;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// --- Editor -------------------------------------------------------------------------------------------------

type Tab = 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'head' | 'acc' | 'tactical' | 'pcd';
const TABS: { id: Tab; icon: string; label: string; focus: Focus }[] = [
  { id: 'body', icon: '🧍', label: 'tabBody', focus: 'full' },
  { id: 'hair', icon: '💇', label: 'tabHair', focus: 'head' },
  { id: 'top', icon: '👕', label: 'tabTop', focus: 'torso' },
  { id: 'bottom', icon: '👖', label: 'tabBottom', focus: 'legs' },
  { id: 'shoes', icon: '👟', label: 'tabShoes', focus: 'feet' },
  { id: 'head', icon: '🧢', label: 'tabHead', focus: 'head' },
  { id: 'acc', icon: '🕶️', label: 'tabAcc', focus: 'head' },
  { id: 'tactical', icon: '🎖️', label: 'tabTactical', focus: 'torso' },
  { id: 'pcd', icon: '♿', label: 'tabPcd', focus: 'full' },
];

/** Where the camera goes to show an item of a slot. */
const SLOT_FOCUS: Partial<Record<Slot, Focus>> = {
  tronco: 'torso',
  sobreposicao: 'torso',
  baixo: 'legs',
  calcado: 'feet',
  cabeca: 'head',
  rosto: 'head',
  orelhas: 'head',
  pescoco: 'head',
  cintura: 'legs',
  coxaE: 'legs',
  coxaD: 'legs',
  joelhos: 'legs',
  pes: 'feet',
};
const focusOf = (slot: Slot): Focus => SLOT_FOCUS[slot] ?? 'torso';

/** One group of thumbnail cards: each option is the current look with one thing changed. */
interface CardGroup {
  title: string;
  options: { value: string; label: string; apply: (a: Appearance) => void; selected: (a: Appearance) => boolean }[];
  focus: Focus;
}

interface ColorGroup {
  title: string;
  colors: readonly string[];
  get: (a: Appearance) => string;
  set: (a: Appearance, c: string) => void;
}

type Group = CardGroup | ColorGroup;

/** Accent-free search: lower case, no diacritics. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Options {
  look: Appearance;
  sex: Sex;
  setStatus(msg: string, error?: boolean): void;
  /** Closed (saved or not): back to the profile. */
  onClose(saved: boolean): void;
}

export function showCustomizer(root: HTMLElement, o: Options) {
  let look = clone(o.look);
  // A look saved before the face's features: the defaults.
  look.rosto = sanitizeFace(look.rosto);
  const sex = o.sex;
  let tab: Tab = 'body';
  let query = '';
  const card = root.closest('.home-card');
  card?.classList.add('wide');

  root.innerHTML = `
    <div class="customizer">
      <div class="cz-stage">
        <canvas id="cz-canvas"></canvas>
        <div class="cz-anims seg">${ANIMS.map(([a, k]) => `<button type="button" data-anim="${a}" aria-pressed="${a === 'idle'}">${l(k)}</button>`).join('')}</div>
        <p class="hint">${l('dragHint')}</p>
        <p class="cz-effects"><b>${l('effects')}:</b> <span id="cz-effects"></span></p>
        <div class="cz-actions">
          <button id="cz-save" class="small-btn">${l('save')}</button>
          <button id="cz-random" class="link-btn">🎲 ${l('random')}</button>
          <button id="cz-reset" class="link-btn">${l('reset')}</button>
          <button id="cz-cancel" class="link-btn">${l('cancel')}</button>
        </div>
        <div class="cz-actions cz-dev">
          <button id="cz-json" class="link-btn">${l('copyJson')}</button>
          <button id="cz-glb" class="link-btn">${l('exportGlb')}</button>
        </div>
      </div>
      <div class="cz-panel">
        <h3>${l('title')}</h3>
        <nav class="cz-tabs" role="tablist">
          ${TABS.map((tb) => `<button type="button" role="tab" data-tab="${tb.id}" title="${esc(l(tb.label))}"><span class="cz-icon">${tb.icon}</span><span>${esc(l(tb.label))}</span></button>`).join('')}
        </nav>
        <input id="cz-search" class="cz-search" type="search" placeholder="${esc(l('search'))}" />
        <div id="cz-content" class="cz-content"></div>
      </div>
    </div>`;

  const stage = new Stage(root.querySelector<HTMLCanvasElement>('#cz-canvas')!);
  const thumbs = new Thumbnails();
  const content = root.querySelector<HTMLElement>('#cz-content')!;
  const effects = root.querySelector<HTMLElement>('#cz-effects')!;
  const search = root.querySelector<HTMLInputElement>('#cz-search')!;
  search.oninput = () => {
    query = search.value;
    renderContent();
  };

  // --- Groups of each tab --------------------------------------------------------------------------------
  const nameOf = (i: CatalogItem) => (getLang() === 'en' ? i.name.en : i.name.pt);

  /** Applying a catalog item: hair and facial hair have their own fields, the rest goes in its slot. */
  const applyItem = (i: CatalogItem) => (a: Appearance) => {
    if (i.category === 'cabelo') a.cabelo.id = i.id;
    else if (i.category === 'barba') a.barba = i.id;
    else wear(a, i.slots[0], i.id, sex);
  };
  const isWorn = (i: CatalogItem) => (a: Appearance) =>
    i.category === 'cabelo' ? a.cabelo.id === i.id : i.category === 'barba' ? a.barba === i.id : itemIn(a, i.slots[0])?.id === i.id;

  /** Cards for catalog items; `none` adds an option that empties the slot. */
  const itemCards = (title: string, items: CatalogItem[], focus: Focus, none?: Slot): CardGroup => ({
    title,
    focus,
    options: [
      ...(none ? [{ value: '', label: l('none'), apply: (a: Appearance) => wear(a, none, '', sex), selected: (a: Appearance) => !itemIn(a, none) }] : []),
      ...items.map((i) => ({ value: i.id, label: nameOf(i), apply: applyItem(i), selected: isWorn(i) })),
    ],
  });

  /** Swatches for each channel of the item stored in a slot (only the palette colors that slot allows). */
  const slotColors = (slot: Slot): ColorGroup[] => {
    const c = look.itens[slot];
    const it = c && catalogItem(c.id);
    if (!it) return [];
    return it.channels.map((ch: Channel, i) => ({
      title: `${l(slot)} · ${l(ch)}`,
      colors: allowedColors(slot, i),
      get: (a) => a.itens[slot]?.cores[i] ?? '',
      set: (a, color) => {
        const cur = a.itens[slot];
        if (cur) cur.cores[i] = color;
      },
    }));
  };

  /** One section of cards per slot used by a category (accessories, tactical gear, headwear). */
  const bySlot = (category: Category): Group[] => {
    const items = catalogOf(category);
    const slots = [...new Set(items.map((i) => i.slots[0]))];
    return slots.flatMap((slot) => [itemCards(l(slot), items.filter((i) => i.slots[0] === slot), focusOf(slot), slot), ...slotColors(slot)]);
  };

  /** Cards for one feature of the face (shape, brows, nose, mouth, ears, marks), framed on the head. */
  const faceCards = <K extends keyof Face>(title: string, key: K, values: readonly Face[K][]): CardGroup => ({
    title: l(title),
    focus: 'head',
    options: values.map((v) => ({ value: v, label: l(`${key}.${v}`), apply: (a: Appearance) => (a.rosto = { ...a.rosto, [key]: v }), selected: (a: Appearance) => a.rosto[key] === v })),
  });

  const searchResults = (q: string): Group[] => {
    const n = norm(q);
    const items = CATALOG.filter((i) => i.ready && (norm(i.name.pt).includes(n) || norm(i.name.en).includes(n)));
    // One section per category, framed on the part of the body it dresses.
    const titles: Record<Category, string> = { cabelo: l('hairStyle'), barba: l('beard'), camiseta: l('camiseta'), blusa: l('blusa'), jaqueta: l('jaqueta'), calca: l('calca'), short: l('short'), calcado: l('calcado'), cabeca: l('tabHead'), acessorio: l('tabAcc'), tatico: l('tabTactical') };
    const cats = [...new Set(items.map((i) => i.category))];
    return cats.map((c) => {
      const list = items.filter((i) => i.category === c);
      const focus: Focus = c === 'cabelo' || c === 'barba' ? 'head' : focusOf(list[0].slots[0]);
      return itemCards(titles[c], list, focus);
    });
  };

  const groups = (): Group[] => {
    if (query.trim()) return searchResults(query);
    const nonEmpty = (gs: Group[]) => gs.filter((g) => !('options' in g) || g.options.some((op) => op.value));
    switch (tab) {
      case 'body':
        return [
          { title: l('height'), focus: 'full', options: HEIGHTS.map((v) => ({ value: v, label: l(v), apply: (a) => (a.altura = v), selected: (a) => a.altura === v })) },
          { title: l('build'), focus: 'full', options: BUILDS.map((v) => ({ value: v, label: l(v), apply: (a) => (a.biotipo = v), selected: (a) => a.biotipo === v })) },
          { title: l('skin'), colors: SKIN_COLORS, get: (a) => a.pele, set: (a, c) => (a.pele = c) },
        ];
      case 'hair':
        return [
          itemCards(l('hairStyle'), catalogOf('cabelo').filter((i) => HAIR_STYLES.includes(i.id)), 'head'),
          { title: l('hairColor'), colors: HAIR_COLORS, get: (a) => a.cabelo.cor, set: (a, c) => (a.cabelo.cor = c) },
          {
            title: l('beard'),
            focus: 'head',
            options: BEARDS.map((v) => ({ value: v, label: v ? nameOf(catalogItem(v)!) : l('none'), apply: (a: Appearance) => (a.barba = v), selected: (a: Appearance) => a.barba === v })),
          },
          faceCards('faceShape', 'formato', FACE_SHAPES),
          { title: l('eyeStyle'), focus: 'head', options: EYE_STYLES.map((v) => ({ value: v, label: l(v), apply: (a) => (a.olhosEstilo = v), selected: (a) => a.olhosEstilo === v })) },
          { title: l('eyeColor'), colors: EYE_COLORS, get: (a) => a.olhos, set: (a, c) => (a.olhos = c) },
          faceCards('brows', 'sobrancelhas', BROW_STYLES),
          faceCards('nose', 'nariz', NOSE_STYLES),
          faceCards('mouth', 'boca', MOUTH_STYLES),
          faceCards('ears', 'orelhas', EAR_STYLES),
          faceCards('marks', 'marcas', FACE_MARKS),
        ];
      case 'top':
        return nonEmpty([
          itemCards(l('camiseta'), catalogOf('camiseta'), 'torso'),
          itemCards(l('blusa'), catalogOf('blusa'), 'torso'),
          ...slotColors('tronco'),
          itemCards(l('jaqueta'), catalogOf('jaqueta'), 'torso', 'sobreposicao'),
          ...slotColors('sobreposicao'),
        ]);
      case 'bottom':
        return nonEmpty([
          itemCards(l('calca'), catalogOf('calca'), 'legs'),
          itemCards(l('short'), catalogOf('short').filter((i) => !i.id.startsWith('saia')), 'legs'),
          itemCards(l('saia'), catalogOf('short').filter((i) => i.id.startsWith('saia')), 'legs'),
          ...slotColors('baixo'),
        ]);
      case 'shoes':
        return nonEmpty([itemCards(l('calcado'), catalogOf('calcado'), 'feet'), ...slotColors('calcado')]);
      case 'head':
        return bySlot('cabeca');
      case 'acc':
        return bySlot('acessorio');
      case 'tactical':
        return bySlot('tatico');
      case 'pcd':
        return [
          { title: l('arm'), focus: 'torso', options: ARM_LOSSES.map((v) => ({ value: v, label: l(v || 'complete'), apply: (a) => (a.pcd.braco = v), selected: (a) => a.pcd.braco === v })) },
          { title: l('leg'), focus: 'legs', options: LEG_LOSSES.map((v) => ({ value: v, label: l(v || 'complete'), apply: (a) => (a.pcd.perna = v), selected: (a) => a.pcd.perna === v })) },
        ];
    }
  };

  // --- Rendering ---------------------------------------------------------------------------------------------
  let current: Group[] = [];

  const loadThumbs = () => {
    current.forEach((g, gi) => {
      if (!('options' in g)) return;
      g.options.forEach((op, oi) => {
        const variant = clone(look);
        op.apply(variant);
        const img = content.querySelector<HTMLImageElement>(`.cz-card[data-g="${gi}"][data-o="${oi}"] img`);
        if (img) thumbs.request(variant, sex, g.focus, (url) => (img.src = url));
      });
    });
  };

  const refreshSelection = () => {
    current.forEach((g, gi) => {
      if ('options' in g) {
        g.options.forEach((op, oi) => content.querySelector(`.cz-card[data-g="${gi}"][data-o="${oi}"]`)?.setAttribute('aria-pressed', String(op.selected(look))));
        return;
      }
      content.querySelectorAll<HTMLElement>(`.cz-colors[data-g="${gi}"] .swatch`).forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.c === g.get(look))));
    });
  };

  let thumbTimer = 0;
  /** The look changed: the stage now, the thumbnails (in the new colors) a moment later. */
  const changed = () => {
    stage.show(look, sex);
    effects.textContent = effectsText(look);
    refreshSelection();
    clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(() => {
      thumbs.clearQueue();
      loadThumbs();
    }, 200);
  };

  /** Rebuilds the panel (an item change may add or remove color channels), keeping the scroll. */
  const renderContent = () => {
    const scroll = content.scrollTop;
    thumbs.clearQueue();
    current = groups();
    const cards = current.filter((g) => 'options' in g) as CardGroup[];
    content.innerHTML =
      (tab === 'pcd' && !query.trim() ? `<p class="hint cz-pcd-hint">${l('pcdHint')}</p>` : '') +
      (query.trim() && !cards.some((g) => g.options.length) ? `<p class="hint">${l('noResults')}</p>` : '') +
      (!query.trim() && !current.length ? `<p class="hint">${l('soon')}</p>` : '') +
      current
        .map((g, gi) =>
          'options' in g
            ? g.options.length
              ? `<section><h4>${esc(g.title)}</h4><div class="cz-grid">${g.options
                  .map(
                    (op, oi) =>
                      `<button type="button" class="cz-card" data-g="${gi}" data-o="${oi}" aria-pressed="${op.selected(look)}"><span class="cz-thumb"><img alt="" /></span><span class="cz-label">${esc(op.label)}</span></button>`,
                  )
                  .join('')}</div></section>`
              : ''
            : `<section class="cz-colors" data-g="${gi}"><h4>${esc(g.title)}</h4><div class="swatches">${g.colors
                .map((c) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-pressed="${c === g.get(look)}" title="${c}"></button>`)
                .join('')}</div></section>`,
        )
        .join('');
    content.querySelectorAll<HTMLButtonElement>('.cz-card').forEach((btn) => {
      btn.onclick = () => {
        const g = current[Number(btn.dataset.g)] as CardGroup;
        g.options[Number(btn.dataset.o)].apply(look);
        stage.focus(g.focus);
        changed();
        renderContent();
      };
    });
    content.querySelectorAll<HTMLElement>('.cz-colors').forEach((sec) => {
      const g = current[Number(sec.dataset.g)] as ColorGroup;
      sec.querySelectorAll<HTMLButtonElement>('.swatch').forEach((sw) => {
        sw.onclick = () => {
          g.set(look, sw.dataset.c!);
          changed();
        };
      });
    });
    loadThumbs();
    content.scrollTop = scroll;
  };

  const selectTab = (t: Tab) => {
    tab = t;
    query = search.value = '';
    root.querySelectorAll<HTMLElement>('.cz-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    stage.focus(TABS.find((x) => x.id === t)!.focus);
    renderContent();
  };

  // --- Actions -------------------------------------------------------------------------------------------
  const close = (saved: boolean) => {
    clearTimeout(thumbTimer);
    stage.dispose();
    thumbs.dispose();
    card?.classList.remove('wide');
    o.onClose(saved);
  };

  root.querySelectorAll<HTMLButtonElement>('.cz-tabs button').forEach((b) => (b.onclick = () => selectTab(b.dataset.tab as Tab)));
  root.querySelector<HTMLButtonElement>('#cz-cancel')!.onclick = () => close(false);
  root.querySelectorAll<HTMLButtonElement>('.cz-anims button').forEach((b) => {
    b.onclick = () => {
      stage.play(b.dataset.anim as Anim);
      root.querySelectorAll('.cz-anims button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  root.querySelector<HTMLButtonElement>('#cz-random')!.onclick = () => {
    look = randomAppearance(sex);
    stage.show(look, sex);
    effects.textContent = effectsText(look);
    renderContent();
  };
  // The whole look as the character system's config (what a GLB pipeline or a tool would consume).
  root.querySelector<HTMLButtonElement>('#cz-json')!.onclick = async () => {
    const json = JSON.stringify(appearanceToConfig(look, sex), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      o.setStatus(l('copied'));
    } catch {
      console.log(json);
      o.setStatus(l('copied'));
    }
  };
  // Exports the live character (skeleton, skin weights, morphs, masks) as a GLB, in rest pose.
  root.querySelector<HTMLButtonElement>('#cz-glb')!.onclick = async () => {
    const holder = new THREE.Scene();
    const a = new Avatar(holder, look, sex, { bake: false });
    a.visible = true;
    a.character.skeleton.pose();
    const glb = (await new GLTFExporter().parseAsync(a.root, { binary: true })) as ArrayBuffer;
    a.dispose();
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'personagem.glb';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    o.setStatus(l('exported'));
  };
  root.querySelector<HTMLButtonElement>('#cz-reset')!.onclick = () => {
    look = defaultAppearance(sex);
    stage.show(look, sex);
    effects.textContent = effectsText(look);
    renderContent();
  };
  const save = root.querySelector<HTMLButtonElement>('#cz-save')!;
  save.onclick = async () => {
    save.disabled = true;
    try {
      await api('PATCH', '/api/perfil', { aparencia: look });
      o.setStatus(l('saved'));
      close(true);
    } catch (err) {
      o.setStatus(errorText(err), true);
      save.disabled = false;
    }
  };

  stage.show(look, sex);
  effects.textContent = effectsText(look);
  selectTab('body');
}
