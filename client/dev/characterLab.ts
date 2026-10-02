// Character lab (dev only, tools/lab-personagens.html): a line-up of looks under the editor's lighting, for
// screenshots and side-by-side checks against the references. Query: ?view=full|head|hands|back, ?bake=0,
// ?anim=idle|aim|walk, ?yaw=<radians>.
import * as THREE from 'three';
import { BROW_STYLES, choice, defaultAppearance, EAR_STYLES, EYE_STYLES, FACE_MARKS, FACE_SHAPES, MOUTH_STYLES, NOSE_STYLES, sanitizeFace, wear, type Appearance } from '@shared/appearance';
import { catalogItem, catalogOf, type Category, type Slot } from '@shared/catalog';
import type { Sex } from '@shared/protocol';
import RAPIER from '@dimforge/rapier3d-compat';
import { bodyStats } from '@shared/appearance';
import { GROUP, groups } from '@shared/constants';
import type { HitRegion } from '@shared/weapons';
import { buildBody } from '../character/body';
import { withLod } from '../character/builder';
import { buildPiece } from '../character/pieces';
import { AssetRegistry } from '../character/registry';
import { Avatar } from '../entities/avatar';
import { audit, auditHtml } from './audit';
import { Viewmodel } from '../render/viewmodel';
import type { AvatarPose } from '../character/animator';
import { CharacterRig, type HitPose } from '../entities/rig';
import { showCustomizer } from '../ui/customize';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'full';
const bake = q.get('bake') !== '0';
const anim = q.get('anim') ?? 'idle';
const yaw = Number(q.get('yaw') ?? 0.35);

/** Puts an item on with its primary color (the others keep the item's defaults). */
function put(a: Appearance, slot: Slot, id: string, primary: string) {
  wear(a, slot, id, 'm');
  a.itens[slot] = choice(catalogItem(id)!, [primary, ...(a.itens[slot]?.cores.slice(1) ?? [])]);
}

type Look = { sex: Sex; name: string; set: (a: Appearance) => void };
const LOOKS: Look[] = [
  {
    sex: 'm',
    name: 'soldado',
    set: (a) => {
      a.cabelo = { id: 'curto', cor: '#45301f' };
      a.barba = 'barbaCheia';
      a.pele = '#e8bfa0';
      put(a, 'tronco', 'camisetaTatica', '#4a5a32');
      put(a, 'baixo', 'calcaCargo', '#a89a6e');
      put(a, 'calcado', 'bota', '#3a3d42');
    },
  },
  {
    sex: 'm',
    name: 'punk',
    set: (a) => {
      a.cabelo = { id: 'topete', cor: '#b3282d' };
      a.pele = '#d9a57e';
      a.olhosEstilo = 'marcante';
      put(a, 'tronco', 'regata', '#e8e2d6');
      put(a, 'baixo', 'calcaJeans', '#1f4f5a');
      put(a, 'calcado', 'tenis', '#1f2226');
      put(a, 'pulsoD', 'couro', '#1f2226');
    },
  },
  {
    sex: 'm',
    name: 'polo',
    set: (a) => {
      a.cabelo = { id: 'curto', cor: '#2b211d' };
      a.barba = 'bigode';
      a.pele = '#a96e45';
      a.olhosEstilo = 'amendoado';
      put(a, 'tronco', 'polo', '#1f2a44');
      put(a, 'baixo', 'calcaJeans', '#3a3d42');
      put(a, 'calcado', 'tenis', '#1f2226');
      put(a, 'cabeca', 'bone', '#9a4a2a');
    },
  },
  {
    sex: 'm',
    name: 'moletom',
    set: (a) => {
      a.cabelo = { id: 'blackPower', cor: '#151211' };
      a.pele = '#6e3f26';
      put(a, 'tronco', 'listrada', '#3a2a4f');
      put(a, 'baixo', 'bermudaJeans', '#1f4f5a');
      put(a, 'calcado', 'tenis', '#3a2a4f');
      put(a, 'rosto', 'escuros', '#1f2226');
    },
  },
  {
    sex: 'f',
    name: 'tatica',
    set: (a) => {
      a.cabelo = { id: 'longo', cor: '#2b211d' };
      a.pele = '#f3d4c0';
      a.olhosEstilo = 'amendoado';
      put(a, 'tronco', 'segundaPele', '#1f2226');
      put(a, 'baixo', 'calcaCargo', '#3e5878');
      put(a, 'calcado', 'bota', '#3a3d42');
    },
  },
  {
    sex: 'f',
    name: 'casual',
    set: (a) => {
      a.cabelo = { id: 'rabo', cor: '#b07f45' };
      a.pele = '#c48a5e';
      put(a, 'tronco', 'xadrezAberta', '#9c6a3a');
      put(a, 'baixo', 'saiaPregas', '#1f2a44');
      put(a, 'calcado', 'tenis', '#e8e2d6');
      put(a, 'cabeca', 'gorro', '#5e1f2a');
    },
  },
  {
    sex: 'f',
    name: 'casaco',
    set: (a) => {
      a.cabelo = { id: 'chanel', cor: '#151211' };
      a.pele = '#d9a57e';
      put(a, 'tronco', 'golaAlta', '#e8e2d6');
      put(a, 'sobreposicao', 'trench', '#a89a6e');
      put(a, 'baixo', 'jeansSkinny', '#1f2a44');
      put(a, 'calcado', 'chelsea', '#3b2a1e');
      put(a, 'rosto', 'escuros', '#1f2226');
    },
  },
  {
    sex: 'm',
    name: 'operador',
    set: (a) => {
      a.cabelo = { id: 'buzzCut', cor: '#2b211d' };
      a.barba = 'barbaCurta';
      a.pele = '#a96e45';
      put(a, 'tronco', 'segundaPele', '#5c6435');
      put(a, 'sobreposicao', 'm65', '#5c6435');
      put(a, 'baixo', 'cargoTatica', '#a89a6e');
      put(a, 'calcado', 'botaTatica', '#5e4330');
      put(a, 'cabeca', 'capaceteTatico', '#5c6435');
      put(a, 'colete', 'coletePlacas', '#4a5a32');
      put(a, 'maos', 'luvasTaticas', '#1f2226');
      put(a, 'joelhos', 'joelheiras', '#1f2226');
      put(a, 'costas', 'mochilaAssalto', '#4a5a32');
    },
  },
  // The owner's report (30/09): gordo body, afro, polo, skirt, round glasses; with and without the straw hat.
  ...[false, true].map(
    (hat): Look => ({
      sex: 'm',
      name: hat ? 'relato-chapeu' : 'relato',
      set: (a) => {
        a.biotipo = 'gordo';
        a.cabelo = { id: 'blackPower', cor: '#2f5fc9' };
        a.barba = hat ? 'barbaCheia' : 'bigode';
        a.pele = '#a96e45';
        put(a, 'tronco', 'polo', '#1f2226');
        put(a, 'baixo', 'saiaRodada', '#5c6435');
        put(a, 'calcado', 'bota', '#1f2a44');
        put(a, 'rosto', 'redondos', '#1f2226');
        if (hat) put(a, 'cabeca', 'palha', '#3e5878');
      },
    }),
  ),
];

// ?audit=1[&category=<c>]: the automated per-item checklist (audit.ts) as a table.
if (q.get('audit')) {
  document.body.style.cssText = 'overflow:auto;background:#1d1830;color:#f3efe6;font:12px/1.35 monospace;padding:12px';
  const style = document.createElement('style');
  style.textContent = 'table{border-collapse:collapse}td,th{border:1px solid #3a3350;padding:2px 6px;vertical-align:top;text-align:left}';
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.innerHTML = auditHtml(audit(q.get('category') as Category | null));
  document.body.appendChild(root);
  throw new Error('audit mode');
}

// ?editor=1[&tab=<tab>][&q=<search>]: the editor with a local look (no account; saving fails on purpose).
if (q.get('editor')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/client/styles.css';
  document.head.appendChild(link);
  document.body.style.overflow = 'auto';
  document.body.innerHTML = '<div class="home-card wide" style="margin:12px auto;background:#fff8ee"><div id="cz-root"></div></div>';
  const sex = (q.get('sex') as Sex) ?? 'm';
  showCustomizer(document.getElementById('cz-root')!, { look: defaultAppearance(sex), sex, setStatus: (m) => console.log(m), onClose: () => {} });
  const tab = q.get('tab');
  if (tab) document.querySelector<HTMLButtonElement>(`.cz-tabs button[data-tab="${tab}"]`)?.click();
  const search = q.get('q');
  if (search) {
    const input = document.querySelector<HTMLInputElement>('#cz-search')!;
    input.value = search;
    input.dispatchEvent(new Event('input'));
  }
  throw new Error('editor mode');
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x4b2a9a);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xc4d8ff, 0x5a4c40, 1.6));
const sun = new THREE.DirectionalLight(0xffe2bd, 2.8);
sun.position.set(2.5, 4, -3);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9db8ff, 0.8);
rim.position.set(-3, 2.5, 3);
scene.add(rim);

// ?view=fp[&anim=hip|ads|sprint|reload|walk|knife|cook][&only=<look>]: the first-person arms and rifle,
// with the game's viewmodel lights and FOV, after ~1 s of simulated frames.
if (view === 'fp') {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x6ec3ff);
  r.domElement.style.cssText = 'position:fixed;left:0;top:0';
  document.body.appendChild(r.domElement);
  const vmScene = new THREE.Scene();
  vmScene.add(new THREE.HemisphereLight(0xe8f6ff, 0x5a6a48, 1.6));
  const sunVm = new THREE.DirectionalLight(0xfff1d6, 1.8);
  sunVm.position.set(-1, 2, 1.5);
  vmScene.add(sunVm);
  const cam = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
  const vm = new Viewmodel(vmScene);
  const look = LOOKS.find((l) => l.name === (q.get('only') ?? 'soldado')) ?? LOOKS[0];
  const a = defaultAppearance(look.sex);
  look.set(a);
  vm.setBody(a, look.sex);
  for (let f = 0; f < 60; f++) {
    vm.update(1 / 60, {
      ads: anim === 'ads' ? Math.min(1, f / 12) : 0,
      sprint: anim === 'sprint' ? 1 : 0,
      grounded: true,
      speed: anim === 'walk' ? 3 : anim === 'sprint' ? 7 : 0,
      strafe: 0,
      mouseDX: 0,
      mouseDY: 0,
      reload: anim === 'reload' ? 0.2 : null,
      slide: 0,
      melee: anim === 'knife' ? Math.min(1, f / 60) * 0.3 : null,
      grenadeCook: anim === 'cook' ? f / 60 : null,
      grenadeThrow: null,
      crouch: 0,
    });
  }
  r.render(vmScene, cam);
  throw new Error('fp mode');
}

/** Camera height and distance of each framing. */
const FRAMES: Record<string, [number, number]> = { chest: [1.36, 1.6], upper: [1.22, 2.9], legs: [0.55, 3.4], feet: [0.12, 1.5], full: [0.92, 5.6] };
const FRAME_OF: Partial<Record<Category, string>> = { cabelo: 'head', barba: 'head', cabeca: 'head', camiseta: 'upper', blusa: 'upper', jaqueta: 'upper', calca: 'legs', short: 'legs', calcado: 'feet' };

/**
 * Poses an avatar like the game would after ~1 s: idle, unarmed walk/run, or armed (walk, run, sprint, crouch,
 * crouchWalk, slide, strafe, back, aimUp, aimDown, ads, reload, knife, cook, jump), facing `yaw0`.
 */
function posePreview(av: Avatar, pose: string, yaw0: number) {
  av.root.rotation.y = yaw0;
  if (pose === 'idle') {
    av.idle(!!q.get('rifle'), 0.6);
    return;
  }
  const fwd = (k: number) => ({ x: -Math.sin(yaw0) * k, z: -Math.cos(yaw0) * k });
  const right = (k: number) => ({ x: Math.cos(yaw0) * k, z: -Math.sin(yaw0) * k });
  const VEL: Record<string, { x: number; z: number }> = { walk: fwd(2.4), crouchWalk: fwd(1.6), run: fwd(6), sprint: fwd(7), strafe: right(2.4), back: fwd(-2.2) };
  const vel = VEL[pose] ?? { x: 0, z: 0 };
  const p: AvatarPose = {
    speed: Math.hypot(vel.x, vel.z),
    vel,
    yaw: yaw0,
    crouch: pose === 'crouch' || pose === 'crouchWalk',
    sprint: pose === 'sprint',
    slide: pose === 'slide',
    grounded: pose !== 'jump',
    pitch: pose === 'aimUp' ? 0.9 : pose === 'aimDown' ? -0.8 : 0,
    ads: pose === 'ads',
    reload: pose === 'reload',
    knife: pose === 'knife',
    cook: pose === 'cook',
  };
  // Stop at a wide stride (frame chosen so the legs are apart).
  for (let f = 0; f < 70; f++) av.pose(1 / 60, p);
}

/** Puts the common query options on a look: hair, beard, build, a hat and other items (&with=slot:id,…). */
function lookOptions(a: Appearance, sex: Sex) {
  const build = q.get('build');
  if (build) a.biotipo = build as Appearance['biotipo'];
  const hair = q.get('hair');
  if (hair) a.cabelo = { id: hair, cor: a.cabelo.cor };
  const beard = q.get('beard');
  if (beard !== null) a.barba = beard;
  const hat = q.get('hat');
  if (hat) wear(a, 'cabeca', hat, sex);
  for (const pair of q.get('with')?.split(',') ?? []) {
    const [ws, wid] = pair.split(':');
    if (ws && wid) wear(a, ws as Slot, wid, sex);
  }
  // The face: &olhos=<eye style>, &rosto=<shape>, &sobrancelhas=, &nariz=, &boca=, &orelhas=, &marcas=.
  if (q.get('olhos')) a.olhosEstilo = q.get('olhos') as Appearance['olhosEstilo'];
  a.rosto = sanitizeFace({ ...a.rosto, ...Object.fromEntries(FACE_FIELDS.filter(([k]) => q.get(k)).map(([k]) => [FACE_KEY[k], q.get(k)])) });
}

/** Face query options (lookOptions, ?faces=<field>) and their values. */
const FACE_FIELDS: [string, readonly string[]][] = [
  ['olhos', EYE_STYLES],
  ['rosto', FACE_SHAPES],
  ['sobrancelhas', BROW_STYLES],
  ['nariz', NOSE_STYLES],
  ['boca', MOUTH_STYLES],
  ['orelhas', EAR_STYLES],
  ['marcas', FACE_MARKS],
];
const FACE_KEY: Record<string, string> = { rosto: 'formato', sobrancelhas: 'sobrancelhas', nariz: 'nariz', boca: 'boca', orelhas: 'orelhas', marcas: 'marcas' };

// ?faces=<olhos|rosto|sobrancelhas|nariz|boca|orelhas|marcas>[&with=…][&hat=…][&beard=…]: every value of one face
// feature, one row each: masculine and feminine heads, front and ¾ (other features from the query).
const facesField = q.get('faces');
if (facesField) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x4b2a9a);
  r.domElement.style.cssText = 'position:fixed;left:0;top:0';
  document.body.appendChild(r.domElement);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xc4d8ff, 0x5a4c40, 1.6));
  const key = new THREE.DirectionalLight(0xffe2bd, 2.8);
  key.position.set(2.5, 4, -3);
  sc.add(key);
  const values = FACE_FIELDS.find(([k]) => k === facesField)?.[1] ?? [];
  const cells: [Sex, number][] = [['m', 0], ['m', 0.75], ['m', Math.PI / 2], ['f', 0], ['f', 0.75], ['f', Math.PI / 2]];
  const cw = innerWidth / cells.length;
  const ch = innerHeight / Math.max(1, values.length);
  const cam = new THREE.PerspectiveCamera(20, cw / ch, 0.05, 50);
  r.setScissorTest(true);
  r.autoClear = false;
  r.clear();
  values.forEach((value, row) => {
    for (const [col, [sex, yw]] of cells.entries()) {
      const a = defaultAppearance(sex);
      a.cabelo = { id: q.get('hair') ?? 'raspado', cor: a.cabelo.cor };
      lookOptions(a, sex);
      if (facesField === 'olhos') a.olhosEstilo = value as Appearance['olhosEstilo'];
      else a.rosto = sanitizeFace({ ...a.rosto, [FACE_KEY[facesField]]: value });
      const av = new Avatar(sc, a, sex, { bake: false });
      av.visible = true;
      posePreview(av, 'idle', yw);
      const x = col * cw;
      const y = innerHeight - (row + 1) * ch;
      r.setViewport(x, y, cw, ch);
      r.setScissor(x, y, cw, ch);
      // &dist=<m>: closer for details.
      const dist = Number(q.get('dist') ?? 1.1);
      cam.position.set(0, 1.66, -dist);
      cam.lookAt(0, 1.64, 0);
      r.render(sc, cam);
      av.dispose();
    }
  });
  const pre = document.createElement('pre');
  pre.id = 'info';
  pre.textContent = `${facesField}: ${values.join(' / ')}`;
  pre.style.cssText = 'position:fixed;left:8px;top:4px;color:#fff;font:12px monospace;margin:0';
  document.body.appendChild(pre);
  throw new Error('faces mode');
}

// ?sheet=<item id>[&sex=m|f][&build=…][&hair=…][&beard=…][&with=…][&poses=idle,walk,…][&frame=…]: one item on one
// body, from 5 angles (front, ¾, side, ¾ back, back) in several poses (default idle, walk, crouch, aimUp):
// the inspection sheet for clipping and shape.
const sheetId = q.get('sheet');
if (sheetId) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x4b2a9a);
  r.domElement.style.cssText = 'position:fixed;left:0;top:0';
  document.body.appendChild(r.domElement);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xc4d8ff, 0x5a4c40, 1.6));
  const key = new THREE.DirectionalLight(0xffe2bd, 2.8);
  key.position.set(2.5, 4, -3);
  sc.add(key);
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.8);
  fill.position.set(-3, 2.5, 3);
  sc.add(fill);
  const sex = (q.get('sex') as Sex | null) ?? 'm';
  const it = catalogItem(sheetId);
  const poses = (q.get('poses') ?? 'idle,walk,crouch,aimUp').split(',');
  const yaws = [0, 0.8, Math.PI / 2, 2.35, Math.PI];
  const cw = innerWidth / yaws.length;
  const ch = innerHeight / poses.length;
  const cam = new THREE.PerspectiveCamera(20, cw / ch, 0.05, 50);
  r.setScissorTest(true);
  r.autoClear = false;
  r.clear();
  const a = defaultAppearance(sex);
  if (it?.category === 'cabelo') a.cabelo = { id: it.id, cor: a.cabelo.cor };
  else if (it?.category === 'barba') a.barba = it.id;
  else if (it) wear(a, it.slots[0], it.id, sex);
  lookOptions(a, sex);
  const category = it?.category;
  const frame = q.get('frame') ?? (category === 'barba' ? 'head' : category ? (FRAME_OF[category] ?? 'full') : 'full');
  const av = new Avatar(sc, a, sex, { bake: false });
  av.visible = true;
  poses.forEach((pose, row) => {
    yaws.forEach((yw, col) => {
      posePreview(av, pose, yw);
      const x = col * cw;
      const y = innerHeight - (row + 1) * ch;
      r.setViewport(x, y, cw, ch);
      r.setScissor(x, y, cw, ch);
      const crouch = pose.startsWith('crouch') ? 0.3 : 0;
      const [cy, dist] = frame === 'head' ? [1.66 - crouch, 1.45] : (FRAMES[frame] ?? FRAMES.full);
      cam.position.set(0, cy - (frame === 'head' ? 0 : crouch * 0.5) + 0.03, -dist);
      cam.lookAt(0, cy - (frame === 'head' ? 0 : crouch * 0.5), 0);
      r.render(sc, cam);
    });
  });
  const pre = document.createElement('pre');
  pre.id = 'info';
  pre.textContent = `${it?.name.pt ?? sheetId} (${sex}${q.get('build') ? `, ${q.get('build')}` : ''}): ${poses.join(' / ')}`;
  pre.style.cssText = 'position:fixed;left:8px;top:4px;color:#fff;font:12px monospace;margin:0';
  document.body.appendChild(pre);
  throw new Error('sheet mode');
}

// ?hairs=1 or ?items=<category>[&page=0|1][&ids=a,b][&yaw=…][&anim=…][&hat=<id>][&hair=…][&sex=m|f][&build=gordo]
// [&frame=…][&with=slot:id,slot:id]: every item of a catalog category in a grid (15 per page), on alternating bodies (or
// only `sex`), with its name and triangle count.
const gridCategory = (q.get('hairs') ? 'cabelo' : q.get('items')) as Category | null;
if (gridCategory) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x4b2a9a);
  r.domElement.style.cssText = 'position:fixed;left:0;top:0';
  document.body.appendChild(r.domElement);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xc4d8ff, 0x5a4c40, 1.6));
  const key = new THREE.DirectionalLight(0xffe2bd, 2.8);
  key.position.set(2.5, 4, -3);
  sc.add(key);
  const page = Number(q.get('page') ?? 0);
  const hairGrid = gridCategory === 'cabelo';
  // &ids=a,b,c: only these items (any category, ready or not).
  const only = q.get('ids')?.split(',');
  const ids = only ? only.map((id) => catalogItem(id)!).filter(Boolean) : catalogOf(gridCategory, true).slice(page * 15, page * 15 + 15);
  const colors = hairGrid ? ['#45301f', '#151211', '#b07f45', '#8f3b20', '#2b211d'] : ['#9a4a2a', '#1f2a44', '#4a5a32', '#c9b38a', '#3a2a4f'];
  const cols = 5;
  const rowsN = 3;
  const labels: string[] = [];
  // One viewport per head (scissor), each camera framed on its own head.
  r.setScissorTest(true);
  r.autoClear = false;
  r.clear();
  const cw = innerWidth / cols;
  const ch = innerHeight / rowsN;
  const cam = new THREE.PerspectiveCamera(20, cw / ch, 0.05, 50);
  ids.forEach((it, i) => {
    const sex: Sex = (q.get('sex') as Sex | null) ?? (i % 2 ? 'f' : 'm');
    const a = defaultAppearance(sex);
    const slot = it.slots[0];
    // Options first (a &hair= is overridden by the hair grid's own item).
    lookOptions(a, sex);
    if (hairGrid) a.cabelo = { id: it.id, cor: colors[i % colors.length] };
    else {
      wear(a, slot, it.id, sex);
      a.itens[slot] = choice(it, [colors[i % colors.length], ...(a.itens[slot]?.cores.slice(1) ?? [])]);
    }
    const av = new Avatar(sc, a, sex, { bake: false });
    av.visible = true;
    // &anim=<pose> (see posePreview); &rifle=1: the rifle slung on the back.
    posePreview(av, anim, yaw);
    let tris = 0;
    for (const o of av.character.objectsOf(hairGrid ? 'hair' : slot)) o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh) tris += mesh.geometry.getAttribute('position').count / 3;
    });
    // The piece's far levels of detail (built on the side, same body).
    const def = AssetRegistry.get(it.id);
    const lodCounts = def?.generator ? [1, 2].map((l) => {
      const g = withLod(l, () => buildPiece(def.generator!, it.id, sex, false));
      return ((g.skinned?.getAttribute('position').count ?? 0) + (g.rigid?.getAttribute('position').count ?? 0)) / 3;
    }) : [];
    labels.push(`${it.name.pt} (${tris}${lodCounts.length ? ` / ${lodCounts.join(' / ')}` : ''})`);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cw;
    const y = innerHeight - (row + 1) * ch;
    r.setViewport(x, y, cw, ch);
    r.setScissor(x, y, cw, ch);
    // Long hair needs more room below.
    const long = ['longo', 'longoOndulado', 'trancasBox', 'tranca', 'franjaLateral', 'meioPreso', 'dreadsPresos', 'raboAlto', 'rabo'].includes(it.id);
    // Framing by category (&frame=head|chest|upper|legs|feet|full overrides; &zoom=1 is the chest up close).
    const frame = q.get('frame') ?? (q.get('zoom') ? 'chest' : (FRAME_OF[gridCategory] ?? 'full'));
    const [cy, dist] = frame === 'head' ? (long ? [1.55, 2.2] : [1.66, 1.45]) : (FRAMES[frame] ?? FRAMES.full);
    cam.position.set(0, cy + 0.03, -dist);
    cam.lookAt(0, cy, 0);
    r.render(sc, cam);
    av.dispose();
  });
  const pre = document.createElement('pre');
  pre.id = 'info';
  pre.textContent = labels.join(String.fromCharCode(10));
  pre.style.cssText = 'position:fixed;left:8px;top:4px;color:#fff;font:12px monospace;margin:0';
  document.body.appendChild(pre);
  throw new Error('grid mode');
}

let world: RAPIER.World | null = null;
if (q.get('hitbox')) {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}

// ?probe=1: real rays against the physics colliders (not the wireframes), reporting the zone they hit.
const rigs: { rig: CharacterRig; x: number; registry: Map<number, unknown> }[] = [];
const probeRegistry = new Map<number, unknown>();
const probeTargets = new Map<CharacterRig, unknown>();

const only = q.get('only');
const looks = only ? LOOKS.filter((l) => l.name === only) : LOOKS;
const spacing = view === 'full' || view === 'back' ? 0.95 : 0.6;
const info: string[] = [];
const avatars = looks.map((look, i) => {
  const a = defaultAppearance(look.sex);
  look.set(a);
  // The query's options on every look (&rosto=…, &beard=…, &with=…).
  lookOptions(a, look.sex);
  const av = new Avatar(scene, a, look.sex, { bake: false });
  av.visible = true;
  av.root.position.x = (i - (looks.length - 1) / 2) * spacing;
  av.root.rotation.y = view === 'back' ? Math.PI + yaw : yaw;
  // ?anim=…: ~1.3 s of animation at 60 fps so the gait and the smoothing settle (turn: the view turns 80°).
  const yaw0 = av.root.rotation.y;
  const fwd = (k: number) => ({ x: -Math.sin(yaw0) * k, z: -Math.cos(yaw0) * k });
  const right = (k: number) => ({ x: Math.cos(yaw0) * k, z: -Math.sin(yaw0) * k });
  const VEL: Record<string, { x: number; z: number }> = {
    walk: fwd(2.4),
    crouchWalk: fwd(1.6),
    run: fwd(6),
    sprint: fwd(7),
    strafe: right(2.4),
    back: fwd(-2.2),
    diag: { x: fwd(1.8).x + right(1.8).x, z: fwd(1.8).z + right(1.8).z },
  };
  const vel = VEL[anim] ?? { x: 0, z: 0 };
  const armed: AvatarPose = {
    speed: Math.hypot(vel.x, vel.z),
    vel,
    yaw: yaw0,
    crouch: anim === 'crouch' || anim === 'crouchWalk',
    sprint: anim === 'sprint',
    slide: anim === 'slide',
    grounded: anim !== 'jump',
    pitch: anim === 'aimUp' ? 0.6 : anim === 'aimDown' ? -0.6 : 0,
    ads: anim === 'ads',
    reload: anim === 'reload',
    knife: anim === 'knife',
    cook: anim === 'cook',
  };
  const kind: HitPose['kind'] = anim === 'idle' || anim === 'tpose' ? 'idle' : anim === 'unarmed' ? 'walk' : 'armed';
  let rig: CharacterRig | null = null;
  // ?hitbox=1: the hitboxes (magenta) and the groin zone (yellow) in the same pose, over the body.
  if (world) {
    const target = { name: look.name, position: new THREE.Vector3(), dead: false, health: 100, refineRegion: (_p: THREE.Vector3, r: HitRegion) => r, isBehind: () => false };
    rig = new CharacterRig(world, target, probeRegistry as never, bodyStats(a).missing);
    rig.setDebug(true);
    av.root.add(rig.debug);
    rigs.push({ rig, x: av.root.position.x, registry: probeRegistry });
    probeTargets.set(rig, target);
  }
  for (let f = 0; f < 80; f++) {
    const dt = 1 / 60;
    const p = anim === 'turn' ? { ...armed, yaw: yaw0 + Math.min(1, f / 40) * 1.4 } : armed;
    av.root.rotation.y = p.yaw!;
    const pose: HitPose = kind === 'idle' ? { kind: 'idle', t: f * dt } : kind === 'walk' ? { kind: 'walk', speed: 3 } : { kind: 'armed', pose: p };
    if (anim === 'tpose') {
      av.character.skeleton.pose();
      break;
    }
    if (pose.kind === 'idle') av.idle(false, pose.t);
    else if (pose.kind === 'walk') av.walk(dt, 3);
    else if (pose.kind === 'armed') av.pose(dt, pose.pose);
    rig?.follow(av.root.position, p.yaw!, true, pose, dt);
  }
  if (bake) av.character.bake();
  // &lod=1|2: show that baked level of detail (the counts list all three).
  const lod = q.get('lod');
  if (lod !== null) av.character.forceLod(Number(lod));
  const lods = av.character.lodTriangles().map(Math.round);
  info.push(`${look.name}: ${Math.round(av.character.triangles())} tris${lods.length ? ` (LOD ${lods.join(' / ')})` : ''}, ${av.character.drawCalls()} draw calls`);
  return av;
});

const camera = new THREE.PerspectiveCamera(view === 'full' || view === 'back' ? 22 : 18, innerWidth / innerHeight, 0.05, 50);
const width = looks.length * spacing;
if (view === 'shoulder') {
  camera.position.set(-0.6, 1.62, -0.9);
  camera.lookAt(0.15, 1.4, 0);
} else if (view === 'head') {
  camera.position.set(0, 1.68, -Math.max(1.2, width * 1.5));
  camera.lookAt(0, 1.66, 0);
} else if (view === 'hands') {
  camera.position.set(0, 1.0, -Math.max(1.2, width * 1.6));
  camera.lookAt(0, 0.95, 0);
} else {
  // Fit the line-up: whichever is tighter, its width or a body's height.
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(width / (2 * tan * camera.aspect), 1.95 / (2 * tan)) * 1.08;
  camera.position.set(0, 1.0, -dist);
  camera.lookAt(0, 0.92, 0);
}
if (world && q.get('probe')) {
  // Two steps: the kinematic bodies move to their feet, then the query pipeline sees them.
  world.step();
  world.step();
  const reg = probeRegistry as Map<number, { region: string }>;
  for (const { x } of rigs.slice(0, 1)) {
    void probeTargets;
    for (const [label, y, z0] of [['cabeça', 1.665, -2], ['pescoço', 1.5, -2], ['peito', 1.33, -2], ['abdômen', 1.12, -2], ['quadril', 0.93, -2], ['virilha?', 0.86, -2], ['coxa', 0.7, -2], ['canela', 0.3, -2]] as const) {
      // From the front (−Z) toward +Z, a little off center so the legs are hit.
      const dx = label === 'coxa' || label === 'canela' ? 0.095 : 0;
      // The bullets' filter (the movement blocker around the body doesn't stop them).
      const hit = world.castRay(new RAPIER.Ray({ x: x + dx, y, z: z0 }, { x: 0, y: 0, z: 1 }), 5, true, undefined, groups(GROUP.BULLET, GROUP.WORLD | GROUP.HITBOX));
      const region = hit ? reg.get(hit.collider.handle)?.region : undefined;
      const point = hit ? new THREE.Vector3(x + dx, y, z0 + hit.timeOfImpact) : null;
      const refined = region && point ? rigs[0].rig.refineRegion(point, region as HitRegion) : '';
      info.push(`raio ${label} (y=${y}): ${region ?? 'nada'}${refined && refined !== region ? ` → ${refined}` : ''}`);
    }
  }
}
// The bare body at each level of detail (before clothes hide parts of it).
info.push(`corpo m/f: ${(['m', 'f'] as Sex[]).map((sx) => [0, 1, 2].map((l) => buildBody(sx, {}, l).skin.getAttribute('position').count / 3).join(' / ')).join(' · ')}`);
renderer.render(scene, camera);
const pre = document.createElement('pre');
pre.id = 'info';
pre.textContent = info.join('\n');
pre.style.cssText = 'position:fixed;left:8px;top:4px;color:#fff;font:12px monospace;margin:0';
document.body.appendChild(pre);
void avatars;
