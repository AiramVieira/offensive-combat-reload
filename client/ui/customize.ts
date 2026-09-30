// Character editor (Perfil → Personalizar), in the spirit of The Sims' Create-a-Sim: a big 3D stage that
// zooms to the part being edited, category tabs, and every option as a thumbnail rendered from the
// character itself (in its current colors), with color swatches under each group. Shows what the look does
// in the game (health, eye height, hitbox, reload, speed) as you choose.
import * as THREE from 'three';
import {
  ARM_LOSSES,
  BUILDS,
  CATALOG,
  defaultAppearance,
  EYE_COLORS,
  HAIR,
  HAIR_COLORS,
  HEIGHTS,
  LEG_LOSSES,
  SKIN_TONES,
  bodyStats,
  hitboxSize,
  type Appearance,
  type Slot,
} from '@shared/appearance';
import { MOVE } from '@shared/constants';
import type { Sex } from '@shared/protocol';
import { Avatar, disposeAvatar } from '../entities/avatar';
import { api } from '../net/api';
import { errorText } from './auth';
import { getLang } from './strings';

/** Labels in pt-BR and en (the editor has many; they live here instead of strings.ts). */
const L: Record<string, [string, string]> = {
  title: ['Personalizar personagem', 'Customize character'],
  tabBody: ['Corpo', 'Body'],
  tabHair: ['Rosto e cabelo', 'Face & hair'],
  tabTop: ['Camiseta', 'Top'],
  tabBottom: ['Parte de baixo', 'Bottoms'],
  tabShoes: ['Sapatos', 'Shoes'],
  tabAcc: ['Acessórios', 'Accessories'],
  tabPcd: ['Modo PCD', 'PCD mode'],
  height: ['Altura', 'Height'],
  build: ['Biotipo', 'Build'],
  skin: ['Cor da pele', 'Skin color'],
  hairStyle: ['Cabelo', 'Hair'],
  hairColor: ['Cor do cabelo', 'Hair color'],
  eyeColor: ['Cor dos olhos', 'Eye color'],
  color: ['Cor', 'Color'],
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
  eye: ['Visão a', 'Eye at'],
  reload: ['Recarga', 'Reload'],
  speed: ['Velocidade', 'Speed'],
  hitbox: ['Hitbox', 'Hitbox'],
  dragHint: ['Arraste para girar · role para aproximar', 'Drag to rotate · scroll to zoom'],
  none: ['Nenhum', 'None'],
  noneF: ['Nenhuma', 'None'],
  pants: ['Calças', 'Pants'],
  shorts: ['Bermudas', 'Shorts'],
  skirts: ['Saias', 'Skirts'],
  pequeno: ['Pequeno', 'Short'],
  medio: ['Médio', 'Medium'],
  alto: ['Alto', 'Tall'],
  magro: ['Magro', 'Slim'],
  gordo: ['Gordo', 'Heavy'],
  camiseta: ['Camiseta', 'Top'],
  sapatos: ['Sapatos', 'Shoes'],
  chapeu: ['Chapéu', 'Hat'],
  oculos: ['Óculos', 'Glasses'],
  pulseira: ['Pulseira', 'Bracelet'],
  basica: ['Básica', 'Basic tee'],
  regata: ['Regata', 'Tank top'],
  polo: ['Polo', 'Polo'],
  calcaJeans: ['Jeans', 'Jeans'],
  calcaCargo: ['Cargo', 'Cargo'],
  calcaMoletom: ['Moletom', 'Sweatpants'],
  bermudaPraia: ['Praia', 'Board'],
  bermudaJeans: ['Jeans', 'Denim'],
  bermudaEsportiva: ['Esportiva', 'Sport'],
  saiaLapis: ['Lápis', 'Pencil'],
  saiaRodada: ['Rodada', 'Circle'],
  saiaPregas: ['Pregas', 'Pleated'],
  tenis: ['Tênis', 'Sneakers'],
  bota: ['Bota', 'Boots'],
  chinelo: ['Chinelo', 'Flip-flops'],
  bone: ['Boné', 'Cap'],
  palha: ['Palha', 'Straw hat'],
  gorro: ['Gorro', 'Beanie'],
  escuros: ['Escuros', 'Sunglasses'],
  redondos: ['Redondos', 'Round'],
  aviador: ['Aviador', 'Aviators'],
  couro: ['Couro', 'Leather'],
  micangas: ['Miçangas', 'Beads'],
  relogio: ['Relógio', 'Watch'],
  curto: ['Curto', 'Short'],
  topete: ['Topete', 'Quiff'],
  blackPower: ['Black power', 'Afro'],
  rabo: ['Rabo de cavalo', 'Ponytail'],
  longo: ['Longo', 'Long'],
  coque: ['Coque', 'Bun'],
  complete: ['Completo', 'Full'],
  bracoEsq: ['Sem braço esq.', 'No left arm'],
  bracoDir: ['Sem braço dir.', 'No right arm'],
  maoEsq: ['Sem mão esq.', 'No left hand'],
  maoDir: ['Sem mão dir.', 'No right hand'],
  pernaEsq: ['Sem perna esq.', 'No left leg'],
  pernaDir: ['Sem perna dir.', 'No right leg'],
};
const l = (key: string) => (L[key] ?? [key, key])[getLang() === 'en' ? 1 : 0];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clone = (a: Appearance): Appearance => JSON.parse(JSON.stringify(a));

/** Clothing colors offered as swatches (any color can still be picked). */
const CLOTH_COLORS = ['#f4f1ea', '#222226', '#7a8a96', '#b3312a', '#ff7a1a', '#ffd23f', '#2f9b6f', '#4a5a32', '#2f9bff', '#2d3b6b', '#3d5a8a', '#8a3a8a', '#d86aa8', '#6b4226', '#e2c07a', '#5a4a6a'];

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

function setupScene(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, -3);
  scene.add(sun);
}

/** What the look does in the game, in one line. */
function effectsText(a: Appearance): string {
  const b = bodyStats(a);
  const parts = [
    `${l('health')} ${b.maxHealth}`,
    `${l('eye')} ${(MOVE.eyeStand * b.scale).toFixed(2).replace('.', getLang() === 'en' ? '.' : ',')} m`,
    `${l('hitbox')} ${Math.round(hitboxSize(b) * 100)}%`,
  ];
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
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  show(look: Appearance, sex: Sex) {
    if (this.avatar) disposeAvatar(this.avatar);
    this.avatar = new Avatar(this.scene, look, sex);
    this.avatar.idle(false);
    this.avatar.visible = true;
    this.scale = bodyStats(look).scale;
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
      const a = new Avatar(this.scene, job.look, job.sex);
      a.idle(false);
      a.visible = true;
      a.root.rotation.y = job.focus === 'head' ? 0.25 : 0.4;
      // Full-body thumbnails share one framing, so heights compare; close-ups follow the height.
      const scale = job.focus === 'full' ? 1 : bodyStats(job.look).scale;
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

type Tab = 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'acc' | 'pcd';
const TABS: { id: Tab; icon: string; label: string; focus: Focus }[] = [
  { id: 'body', icon: '🧍', label: 'tabBody', focus: 'full' },
  { id: 'hair', icon: '💇', label: 'tabHair', focus: 'head' },
  { id: 'top', icon: '👕', label: 'tabTop', focus: 'torso' },
  { id: 'bottom', icon: '👖', label: 'tabBottom', focus: 'legs' },
  { id: 'shoes', icon: '👟', label: 'tabShoes', focus: 'feet' },
  { id: 'acc', icon: '🕶️', label: 'tabAcc', focus: 'head' },
  { id: 'pcd', icon: '♿', label: 'tabPcd', focus: 'full' },
];

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
  /** Hidden when there is nothing to color (no hat, no glasses...). */
  visible?: (a: Appearance) => boolean;
}

type Group = CardGroup | ColorGroup;

interface Options {
  look: Appearance;
  sex: Sex;
  setStatus(msg: string, error?: boolean): void;
  /** Closed (saved or not): back to the profile. */
  onClose(saved: boolean): void;
}

export function showCustomizer(root: HTMLElement, o: Options) {
  let look = clone(o.look);
  const sex = o.sex;
  let tab: Tab = 'body';
  const card = root.closest('.home-card');
  card?.classList.add('wide');

  root.innerHTML = `
    <div class="customizer">
      <div class="cz-stage">
        <canvas id="cz-canvas"></canvas>
        <p class="hint">${l('dragHint')}</p>
        <p class="cz-effects"><b>${l('effects')}:</b> <span id="cz-effects"></span></p>
        <div class="cz-actions">
          <button id="cz-save" class="small-btn">${l('save')}</button>
          <button id="cz-reset" class="link-btn">${l('reset')}</button>
          <button id="cz-cancel" class="link-btn">${l('cancel')}</button>
        </div>
      </div>
      <div class="cz-panel">
        <h3>${l('title')}</h3>
        <nav class="cz-tabs" role="tablist">
          ${TABS.map((tb) => `<button type="button" role="tab" data-tab="${tb.id}" title="${esc(l(tb.label))}"><span class="cz-icon">${tb.icon}</span><span>${esc(l(tb.label))}</span></button>`).join('')}
        </nav>
        <div id="cz-content" class="cz-content"></div>
      </div>
    </div>`;

  const stage = new Stage(root.querySelector<HTMLCanvasElement>('#cz-canvas')!);
  const thumbs = new Thumbnails();
  const content = root.querySelector<HTMLElement>('#cz-content')!;
  const effects = root.querySelector<HTMLElement>('#cz-effects')!;

  // --- Groups of each tab --------------------------------------------------------------------------------
  const pieceCards = (slot: Slot, focus: Focus, title: string, filter: (id: string) => boolean = () => true): CardGroup => ({
    title,
    focus,
    options: CATALOG[slot].filter(filter).map((id) => ({
      value: id,
      label: id ? l(id) : l(slot === 'pulseira' ? 'noneF' : 'none'),
      apply: (a) => (a.roupas[slot].id = id),
      selected: (a) => a.roupas[slot].id === id,
    })),
  });
  const pieceColor = (slot: Slot, title = l('color')): ColorGroup => ({
    title,
    colors: CLOTH_COLORS,
    get: (a) => a.roupas[slot].cor,
    set: (a, c) => (a.roupas[slot].cor = c),
    visible: (a) => !!a.roupas[slot].id,
  });

  const groups = (): Group[] => {
    switch (tab) {
      case 'body':
        return [
          { title: l('height'), focus: 'full', options: HEIGHTS.map((v) => ({ value: v, label: l(v), apply: (a) => (a.altura = v), selected: (a) => a.altura === v })) },
          { title: l('build'), focus: 'full', options: BUILDS.map((v) => ({ value: v, label: l(v), apply: (a) => (a.biotipo = v), selected: (a) => a.biotipo === v })) },
          { title: l('skin'), colors: SKIN_TONES, get: (a) => a.pele, set: (a, c) => (a.pele = c) },
        ];
      case 'hair':
        return [
          { title: l('hairStyle'), focus: 'head', options: HAIR[sex].map((v) => ({ value: v, label: l(v), apply: (a) => (a.cabelo.id = v), selected: (a) => a.cabelo.id === v })) },
          { title: l('hairColor'), colors: HAIR_COLORS, get: (a) => a.cabelo.cor, set: (a, c) => (a.cabelo.cor = c) },
          { title: l('eyeColor'), colors: EYE_COLORS, get: (a) => a.olhos, set: (a, c) => (a.olhos = c) },
        ];
      case 'top':
        return [pieceCards('camiseta', 'torso', l('camiseta')), pieceColor('camiseta')];
      case 'bottom':
        return [
          pieceCards('baixo', 'legs', l('pants'), (id) => id.startsWith('calca')),
          pieceCards('baixo', 'legs', l('shorts'), (id) => id.startsWith('bermuda')),
          pieceCards('baixo', 'legs', l('skirts'), (id) => id.startsWith('saia')),
          pieceColor('baixo'),
        ];
      case 'shoes':
        return [pieceCards('sapatos', 'feet', l('sapatos')), pieceColor('sapatos')];
      case 'acc':
        return [
          pieceCards('chapeu', 'head', l('chapeu')),
          pieceColor('chapeu', `${l('color')}: ${l('chapeu')}`),
          pieceCards('oculos', 'head', l('oculos')),
          pieceColor('oculos', `${l('color')}: ${l('oculos')}`),
          pieceCards('pulseira', 'torso', l('pulseira')),
          pieceColor('pulseira', `${l('color')}: ${l('pulseira')}`),
        ];
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
      const sec = content.querySelector<HTMLElement>(`.cz-colors[data-g="${gi}"]`);
      if (!sec) return;
      sec.classList.toggle('hidden', !!g.visible && !g.visible(look));
      sec.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.c === g.get(look))));
      sec.querySelector<HTMLInputElement>('input[type=color]')!.value = g.get(look);
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

  const renderContent = () => {
    thumbs.clearQueue();
    current = groups();
    content.innerHTML =
      (tab === 'pcd' ? `<p class="hint cz-pcd-hint">${l('pcdHint')}</p>` : '') +
      current
        .map((g, gi) =>
          'options' in g
            ? `<section><h4>${esc(g.title)}</h4><div class="cz-grid">${g.options
                .map(
                  (op, oi) =>
                    `<button type="button" class="cz-card" data-g="${gi}" data-o="${oi}" aria-pressed="${op.selected(look)}"><span class="cz-thumb"><img alt="" /></span><span class="cz-label">${esc(op.label)}</span></button>`,
                )
                .join('')}</div></section>`
            : `<section class="cz-colors ${g.visible && !g.visible(look) ? 'hidden' : ''}" data-g="${gi}"><h4>${esc(g.title)}</h4><div class="swatches">${g.colors
                .map((c) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-pressed="${c === g.get(look)}" title="${c}"></button>`)
                .join('')}<input type="color" value="${g.get(look)}" /></div></section>`,
        )
        .join('');
    content.querySelectorAll<HTMLButtonElement>('.cz-card').forEach((btn) => {
      btn.onclick = () => {
        const g = current[Number(btn.dataset.g)] as CardGroup;
        g.options[Number(btn.dataset.o)].apply(look);
        stage.focus(g.focus);
        changed();
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
      const picker = sec.querySelector<HTMLInputElement>('input[type=color]')!;
      picker.oninput = () => {
        g.set(look, picker.value);
        changed();
      };
    });
    loadThumbs();
  };

  const selectTab = (t: Tab) => {
    tab = t;
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
