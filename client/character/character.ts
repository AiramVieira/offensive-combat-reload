// Character: a skinned base body plus pieces that share its skeleton.
// - The body and every skinned piece are SkinnedMeshes bound to the SAME skeleton; pieces from GLBs are
//   rebound bone by bone (by name) to the body's skeleton.
// - Rigid items (hats, glasses, bracelets, weapons) hang from sockets (Object3Ds under bones) with a grip.
// - Skin under clothes and PCD limbs are hidden with region bit masks (material uniform, no geometry edit).
// - Build is two morph targets (gordo, magro); height scales the whole body; the hands close with two more
//   (punho_L, punho_R).
// - The face is part of the body (painted faces): the eye style and the face's features pick the body variant,
//   the colors are tints; pieces over the head follow the face shape with morph targets (rosto_<shape>).
// - The whole look is a serializable config (toJSON / Character.fromJSON) for the database.
// - bake() merges everything into one SkinnedMesh with vertex colors (other players: 1 draw call + weapons).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ARM_LOSSES, BUILDS, DEFAULT_FACE, EFFECTS, EYE_STYLES, FACE_SHAPES, HEIGHTS, LEG_LOSSES, sanitizeFace, type ArmLoss, type Build, type EyeStyle, type Face, type Height, type LegLoss } from '@shared/appearance';
import { catalogItem } from '@shared/catalog';
import type { Sex } from '@shared/protocol';
import { buildBody, withFaceMorphs } from './body';
import { withLod } from './builder';
import { bakedMaterial, paintedMaterial, setChannels, setTints, type Channels, type CharacterTints, type PaintedMaterial } from './material';
import { paintColor, PRIMARY, SKIN, TINT, uvToCell, uvToGradient } from './palette';
import { buildPiece, buildStump, type PieceGeometry } from './pieces';
import { AssetRegistry, CHAR_SLOTS, type CharSlot, type ItemDef } from './registry';
import { createCanonicalSkeleton, regionBits, SOCKETS, type RegionName, type SocketName } from './rig';

export interface CharacterConfig {
  v: 1;
  sex: Sex;
  /** Item id per slot (null = nothing). The body slot is chosen from the sex when missing. */
  items: Partial<Record<CharSlot, string | null>>;
  /**
   * Colors: 'skin', 'hair', 'eyes', 'team', and one per slot for its primary channel ('tronco', 'baixo'...);
   * '<slot>.secondary' / '<slot>.detail' override the item's defaults.
   */
  colors: Record<string, string>;
  eyes: { style: EyeStyle };
  /** Face shape, brows, nose, mouth, ears, marks (missing: the defaults). */
  face?: Face;
  build: { height: Height; build: Build };
  pcd: { braco: ArmLoss; perna: LegLoss };
}

const DEFAULT_COLORS: Record<string, string> = { skin: '#e8bfa0', hair: '#45301f', eyes: '#4a6fa5', team: '#e8e2d6' };

/**
 * Layers, inside out: an item's `over` only hides regions of items in lower layers (hair and beard under
 * everything; clothes; shoes over the pants' hem; jackets over the top; then the gear worn over it all).
 */
function layerOf(slot: CharSlot): number {
  if (slot === 'hair' || slot === 'beard') return 0;
  if (slot === 'tronco' || slot === 'baixo' || slot === 'pele') return 1;
  if (slot === 'calcado') return 2;
  if (slot === 'sobreposicao') return 3;
  return 4;
}

/** Levels of detail baked for the game, and the distance (m) each one starts at. */
const LOD_LEVELS = [0, 1, 2] as const;
const LOD_DISTANCES = [0, 20, 45];

/** Morph targets that survive the bake (they change at runtime): the closed hands. */
const LIVE_MORPHS = ['punho_L', 'punho_R'] as const;

/** Rifle grip in the left hand (when the right one is missing): the right grip mirrored. */
const LEFT_GRIP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)));

// --- Caches (shared by every character) ----------------------------------------------------------------

const pieceCache = new Map<string, PieceGeometry>();
const stumpCache = new Map<string, THREE.BufferGeometry>();
const gltfCache = new Map<string, Promise<GLTF>>();
const loader = new GLTFLoader();

const loadGLB = (url: string) => {
  let p = gltfCache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
};

/** `flat`: the hair's version for under a hat (style guide: a flattened version when the head has an item). */
function proceduralPiece(item: ItemDef, sex: Sex, flat = false, lod = 0): PieceGeometry {
  const key = `${item.generator}|${item.id}|${sex}|${flat ? 'flat' : ''}|${lod}`;
  let g = pieceCache.get(key);
  if (!g) {
    // Pieces over the face get one morph per face shape (body.ts `withFaceMorphs`).
    g = withLod(lod, () => withFaceMorphs(() => buildPiece(item.generator!, item.id, sex, flat)));
    pieceCache.set(key, g);
  }
  return g;
}

type BakePart = { attrs: Record<string, Float32Array>; morphs: Record<string, Float32Array> };

/** The parts of a bake as one geometry (the hands' morphs kept, relative). */
function merge(parts: BakePart[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const concat = (get: (p: BakePart) => Float32Array, size: number) => {
    const total = parts.reduce((s, p) => s + get(p).length, 0);
    const arr = new Float32Array(total);
    let off = 0;
    for (const p of parts) {
      arr.set(get(p), off);
      off += get(p).length;
    }
    return new THREE.BufferAttribute(arr, size);
  };
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['skinIndex', 4], ['skinWeight', 4]] as const) merged.setAttribute(name, concat((p) => p.attrs[name], size));
  merged.morphAttributes.position = LIVE_MORPHS.map((name) => {
    const a = concat((p) => p.morphs[name], 3);
    a.name = name;
    return a;
  });
  merged.morphTargetsRelative = true;
  merged.computeBoundingSphere();
  return merged;
}

const shadeHex = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/**
 * GLB pieces may carry the channel as `_MASK` (r = primary, g = secondary, b = detail) instead of `_TINT`;
 * exporters write custom attributes with one or two underscores.
 */
function normalizeAttributes(geo: THREE.BufferGeometry) {
  for (const name of ['tint', 'mask', 'region']) {
    const alt = geo.getAttribute(`__${name}`);
    if (alt && !geo.getAttribute(`_${name}`)) geo.setAttribute(`_${name}`, alt);
  }
  const mask = geo.getAttribute('_mask') as THREE.BufferAttribute | undefined;
  if (mask && !geo.getAttribute('_tint')) {
    const t = new Float32Array(mask.count);
    for (let i = 0; i < mask.count; i++) {
      const r = mask.getX(i);
      const g = mask.getY(i);
      const b = mask.getZ(i);
      const m = Math.max(r, g, b);
      t[i] = m < 0.5 ? 0 : m === r ? TINT.primary : m === g ? TINT.secondary : TINT.detail;
    }
    geo.setAttribute('_tint', new THREE.BufferAttribute(t, 1));
  }
  if (!geo.getAttribute('color')) {
    const n = geo.getAttribute('position').count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
}

interface Piece {
  item: ItemDef;
  objects: THREE.Object3D[];
  materials: PaintedMaterial[];
  /** Region mask applied to this piece's own vertices. */
  kind: 'body' | 'hair' | 'piece';
  /** Hair built flat (a hat is on). */
  flat?: boolean;
}

export class Character {
  /** Placed by the game (position, yaw). */
  readonly root = new THREE.Group();
  /** Scaled by height; rotated by the fall animation. */
  readonly body = new THREE.Group();
  skeleton: THREE.Skeleton;
  readonly bones: Record<string, THREE.Bone> = {};
  readonly sockets = {} as Record<SocketName, THREE.Object3D>;
  /** Clips from a GLB body (idle, walk, run...); empty with the procedural body. */
  clips: THREE.AnimationClip[] = [];
  mixer: THREE.AnimationMixer | null = null;
  private config: CharacterConfig;
  private pieces = new Map<CharSlot, Piece>();
  private stumps: THREE.Object3D[] = [];
  private stumpMaterials: PaintedMaterial[] = [];
  private baked: THREE.LOD | null = null;
  /** How closed each hand is (0 relaxed … 1 fist). */
  private grip = { L: 0, R: 0 };
  /** Bumped by every change: a pending GLB load that finishes late is dropped. */
  private version = 0;

  constructor(config: CharacterConfig) {
    this.config = structuredClone(config);
    const { root, bones, skeleton } = createCanonicalSkeleton(this.config.sex);
    this.skeleton = skeleton;
    for (const b of bones) this.bones[b.name] = b;
    this.body.add(root);
    this.root.add(this.body);
    for (const [name, s] of Object.entries(SOCKETS)) {
      const o = new THREE.Object3D();
      o.name = `socket_${name}`;
      o.position.set(...(s.pos as [number, number, number]));
      this.bones[s.bone].add(o);
      this.sockets[name as SocketName] = o;
    }
    this.applyBuild();
    for (const slot of CHAR_SLOTS) void this.equip(slot, this.itemFor(slot));
  }

  static fromJSON(json: CharacterConfig | string): Character {
    return new Character(typeof json === 'string' ? JSON.parse(json) : json);
  }

  toJSON(): CharacterConfig {
    return structuredClone(this.config);
  }

  get sex(): Sex {
    return this.config.sex;
  }

  /** The body's build (the animator spreads the arms on a gordo body). */
  get bodyBuild(): Build {
    return this.config.build.build;
  }

  private itemFor(slot: CharSlot): string | null {
    if (slot === 'body') return this.config.items.body ?? (this.config.sex === 'f' ? 'corpo_f' : 'corpo_m');
    return this.config.items[slot] ?? null;
  }

  // --- Equipment ------------------------------------------------------------------------------------------

  /** Puts an item on a slot (null empties it). Procedural items apply at once; GLBs when loaded. */
  async equip(slot: CharSlot, itemId: string | null): Promise<void> {
    this.config.items[slot] = itemId;
    const version = ++this.version;
    this.unbake();
    this.remove(slot);
    const item = itemId ? AssetRegistry.get(itemId) : undefined;
    if (item?.url) {
      const gltf = await loadGLB(item.url);
      if (version !== this.version && this.config.items[slot] !== itemId) return;
      this.remove(slot);
      this.attachGLB(slot, item, gltf);
    } else if (item) {
      this.attachProcedural(slot, item);
    }
    this.refresh();
    // A backpack on or off moves the slung rifle.
    if (slot === 'costas' && this.pieces.has('weapon_back')) await this.equip('weapon_back', this.itemFor('weapon_back'));
    // Putting a hat on or taking it off swaps the hair for its flat version (or back).
    const hair = this.pieces.get('hair');
    if (slot !== 'hair' && hair && !hair.item.url && !!hair.flat !== this.hatOn()) await this.equip('hair', this.itemFor('hair'));
  }

  /** Something takes the head slot (a hat, or a hood worn from the torso slot). */
  private hatOn(): boolean {
    for (const p of this.pieces.values()) if (catalogItem(p.item.id)?.slots.includes('cabeca')) return true;
    return false;
  }

  private remove(slot: CharSlot) {
    const p = this.pieces.get(slot);
    if (!p) return;
    for (const o of p.objects) o.removeFromParent();
    for (const m of p.materials) m.dispose();
    this.pieces.delete(slot);
  }

  private tints(): CharacterTints {
    return { skin: this.color('skin'), hair: this.color('hair'), eyes: this.color('eyes'), team: this.color('team') };
  }

  private newMaterial(item: ItemDef, doubleSided = false): PaintedMaterial {
    return paintedMaterial({ side: doubleSided ? THREE.DoubleSide : THREE.FrontSide }, this.channelsFor(item), this.tints());
  }

  private skinned(geo: THREE.BufferGeometry, material: THREE.Material): THREE.SkinnedMesh {
    const mesh = new THREE.SkinnedMesh(geo, material);
    // Bound in the canonical space (the skeleton's inverses were computed with the root at the origin).
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.body.add(mesh);
    return mesh;
  }

  private attachProcedural(slot: CharSlot, item: ItemDef) {
    const piece: Piece = { item, objects: [], materials: [], kind: slot === 'body' ? 'body' : slot === 'hair' || slot === 'beard' ? 'hair' : 'piece' };
    if (slot === 'body') {
      const g = buildBody(this.config.sex, this.faceLook());
      const m = this.newMaterial(item);
      piece.objects.push(this.skinned(g.skin, m));
      piece.materials.push(m);
    } else {
      piece.flat = slot === 'hair' && this.hatOn();
      const g = proceduralPiece(item, this.config.sex, piece.flat);
      if (g.skinned) {
        const m = this.newMaterial(item, g.doubleSided);
        piece.objects.push(this.skinned(g.skinned, m));
        piece.materials.push(m);
      }
      if (g.rigid) {
        const m = this.newMaterial(item);
        const mesh = new THREE.Mesh(g.rigid, m);
        mesh.castShadow = true;
        this.placeRigid(item, mesh);
        piece.objects.push(mesh);
        piece.materials.push(m);
      }
    }
    this.pieces.set(slot, piece);
  }

  /** A rigid item on its socket, with the item's grip (mirrored to the left hand when the right is missing). */
  private placeRigid(item: ItemDef, obj: THREE.Object3D) {
    let socket = item.socket ?? 'head';
    const missing = this.missingParts();
    let rotation = item.grip?.rotation ? new THREE.Quaternion().fromArray(item.grip.rotation) : new THREE.Quaternion();
    let position = new THREE.Vector3(...(item.grip?.position ?? [0, 0, 0]));
    if (socket === 'wrist_L' && missing.handL) socket = 'wrist_R';
    if (socket === 'hand_R' && missing.handR) {
      socket = 'hand_L';
      rotation = LEFT_GRIP.clone();
      position = position.clone().setX(-position.x);
    }
    // The slung rifle goes over a backpack (it would run through it).
    if (item.slot === 'weapon_back' && this.itemFor('costas')) position = position.clone().add(new THREE.Vector3(0, 0.02, 0.17));
    obj.position.copy(position);
    obj.quaternion.copy(rotation);
    this.sockets[socket].add(obj);
  }

  /** GLB item: skinned meshes rebound to the body's bones by name; the rest goes on the socket. */
  private attachGLB(slot: CharSlot, item: ItemDef, gltf: GLTF) {
    const scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    const piece: Piece = { item, objects: [], materials: [], kind: slot === 'hair' || slot === 'beard' ? 'hair' : 'piece' };
    if (slot === 'body') {
      this.adoptBodyGLB(scene, gltf);
      piece.kind = 'body';
    }
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const rigidMeshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(o as THREE.SkinnedMesh);
      else if ((o as THREE.Mesh).isMesh) rigidMeshes.push(o as THREE.Mesh);
    });
    // A GLB painted on the palette atlas has `_TINT`/`_MASK`; otherwise it keeps its own texture or color.
    const material = (mesh: THREE.Mesh) => {
      normalizeAttributes(mesh.geometry);
      const src = mesh.material as THREE.MeshStandardMaterial;
      return mesh.geometry.getAttribute('_tint') ? this.newMaterial(item, src.side === THREE.DoubleSide) : paintedMaterial({ map: src.map, color: src.color, side: src.side }, this.channelsFor(item), this.tints());
    };
    for (const mesh of skinnedMeshes) {
      const m = material(mesh);
      const bones = mesh.skeleton.bones.map((b) => this.bones[b.name] ?? b);
      const skeleton = new THREE.Skeleton(bones, mesh.skeleton.boneInverses);
      mesh.material = m;
      mesh.removeFromParent();
      this.body.add(mesh);
      mesh.bind(skeleton, mesh.bindMatrix);
      mesh.frustumCulled = false;
      piece.objects.push(mesh);
      piece.materials.push(m);
    }
    if (rigidMeshes.length && item.socket) {
      const holder = new THREE.Group();
      for (const mesh of rigidMeshes) {
        const m = material(mesh);
        mesh.material = m;
        piece.materials.push(m);
        holder.add(mesh);
      }
      this.placeRigid(item, holder);
      piece.objects.push(holder);
    }
    this.pieces.set(slot, piece);
  }

  /** A GLB body brings its own skeleton (same bone names): the canonical one is replaced. */
  private adoptBodyGLB(scene: THREE.Group, gltf: GLTF) {
    let skinnedBody: THREE.SkinnedMesh | null = null;
    scene.traverse((o) => {
      if (!skinnedBody && (o as THREE.SkinnedMesh).isSkinnedMesh) skinnedBody = o as THREE.SkinnedMesh;
    });
    if (!skinnedBody) return;
    const skel = (skinnedBody as THREE.SkinnedMesh).skeleton;
    const oldRoot = this.bones.root;
    const newRoot = skel.bones.find((b) => !(b.parent as THREE.Bone | null)?.isBone) ?? skel.bones[0];
    // Sockets move to the new bones.
    for (const [name, s] of Object.entries(SOCKETS)) {
      const nb = skel.bones.find((b) => b.name === s.bone);
      if (nb) nb.add(this.sockets[name as SocketName]);
    }
    oldRoot.removeFromParent();
    this.body.add(newRoot);
    for (const k of Object.keys(this.bones)) delete this.bones[k];
    for (const b of skel.bones) this.bones[b.name] = b;
    this.skeleton = skel;
    this.clips = gltf.animations;
    this.mixer = this.clips.length ? new THREE.AnimationMixer(this.body) : null;
    // Pieces equipped before now were bound to the old bones: rebind them by name.
    for (const [slot, p] of this.pieces) {
      if (slot === 'body') continue;
      for (const o of p.objects) {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) continue;
        const bones = sm.skeleton.bones.map((b) => this.bones[b.name] ?? b);
        sm.bind(new THREE.Skeleton(bones, sm.skeleton.boneInverses), sm.bindMatrix);
      }
    }
  }

  /** Plays a clip of a GLB body (crossfading), if it has one with that name. */
  play(name: string, fade = 0.25): boolean {
    const clip = this.clips.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!clip || !this.mixer) return false;
    const action = this.mixer.clipAction(clip);
    this.mixer.stopAllAction();
    action.reset().fadeIn(fade).play();
    return true;
  }

  // --- Colors, eyes, build, hands, PCD ------------------------------------------------------------------------

  private color(key: string, fallback = '#888888') {
    return this.config.colors[key] ?? DEFAULT_COLORS[key] ?? fallback;
  }

  private channelsFor(item: ItemDef): Channels {
    const key = item.slot === 'body' ? 'skin' : item.slot === 'hair' || item.slot === 'beard' ? 'hair' : item.slot;
    const primary = this.color(key);
    const d = item.channels;
    return {
      primary,
      secondary: this.config.colors[`${key}.secondary`] ?? (d.secondary === 'shade' ? shadeHex(primary, d.shade ?? 0.72) : d.secondary),
      detail: this.config.colors[`${key}.detail`] ?? d.detail,
    };
  }

  /** Channel colors: 'skin', 'hair', 'eyes', 'team', '<slot>' (primary), '<slot>.secondary', '<slot>.detail'. */
  setColor(channel: string, hex: string) {
    this.config.colors[channel] = hex;
    this.unbake();
    const tints = this.tints();
    for (const p of this.pieces.values()) {
      const c = this.channelsFor(p.item);
      for (const m of p.materials) {
        setChannels(m, c);
        setTints(m, tints);
      }
    }
    this.refreshStumps();
  }

  /** Eye style (the face is part of the body: the body is rebuilt) and color (a tint). */
  setEyes(style: EyeStyle, color?: string) {
    if (color) this.setColor('eyes', color);
    if (style !== this.config.eyes.style) {
      this.config.eyes.style = style;
      void this.equip('body', this.itemFor('body'));
    }
  }

  /** The face's features (the body is rebuilt; pieces over the face follow its shape by morphs). */
  setFace(face: Partial<Face>) {
    const next = sanitizeFace({ ...this.face(), ...face });
    if (JSON.stringify(next) === JSON.stringify(this.face())) return;
    this.config.face = next;
    void this.equip('body', this.itemFor('body'));
  }

  private face(): Face {
    return this.config.face ?? DEFAULT_FACE;
  }

  private faceLook() {
    return { ...this.face(), eyes: this.config.eyes.style };
  }

  setBuild(height: Height, build: Build) {
    this.config.build = { height, build };
    this.unbake();
    this.applyBuild();
  }

  /** How closed each hand is: 0 relaxed (fingers curled like a staircase) … 1 a fist (holding a weapon). */
  setGrip(left: number, right: number) {
    if (left === this.grip.L && right === this.grip.R) return;
    this.grip = { L: left, R: right };
    this.applyMorphs();
  }

  setPcd(braco: ArmLoss, perna: LegLoss) {
    this.config.pcd = { braco, perna };
    this.unbake();
    // Rigid items may change socket (bracelet, rifle).
    for (const slot of ['pulsoE', 'pulsoD', 'weapon_R'] as CharSlot[]) void this.equip(slot, this.itemFor(slot));
    this.refresh();
  }

  private applyBuild() {
    this.body.scale.setScalar(EFFECTS.heightScale[this.config.build.height] ?? 1);
    this.applyMorphs();
  }

  private applyMorphs() {
    const build = this.config.build.build;
    const values: Record<string, number> = {
      gordo: build === 'gordo' ? 1 : 0,
      magro: build === 'magro' ? 1 : 0,
      punho_L: this.grip.L,
      punho_R: this.grip.R,
    };
    // Face shape: pieces over the face carry one morph per shape (the oval is their rest shape).
    for (const shape of FACE_SHAPES) if (shape !== 'oval') values[`rosto_${shape}`] = this.face().formato === shape ? 1 : 0;
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.morphTargetDictionary || !m.morphTargetInfluences) return;
      for (const [name, v] of Object.entries(values)) {
        const i = m.morphTargetDictionary[name];
        if (i !== undefined) m.morphTargetInfluences[i] = v;
      }
    });
  }

  missingParts() {
    const { braco, perna } = this.config.pcd;
    return {
      armL: braco === 'bracoEsq',
      armR: braco === 'bracoDir',
      handL: braco === 'bracoEsq' || braco === 'maoEsq',
      handR: braco === 'bracoDir' || braco === 'maoDir',
      legL: perna === 'pernaEsq',
      legR: perna === 'pernaDir',
    };
  }

  private pcdRegions(): RegionName[] {
    const m = this.missingParts();
    const out: RegionName[] = [];
    if (m.armL) out.push('upperArm_L', 'forearm_L');
    if (m.armR) out.push('upperArm_R', 'forearm_R');
    if (m.handL) out.push('hand_L');
    if (m.handR) out.push('hand_R');
    if (m.legL) out.push('thigh_L', 'shin_L', 'ankle_L', 'foot_L');
    if (m.legR) out.push('thigh_R', 'shin_R', 'ankle_R', 'foot_R');
    return out;
  }

  /** Recomputes hidden regions, build morphs and stumps after any change of equipment. */
  private refresh() {
    const pcd = regionBits(this.pcdRegions());
    let cover = 0;
    let hatOn = false;
    for (const [slot, p] of this.pieces) {
      if (slot === 'body') continue;
      const bits = AssetRegistry.hiddenBits(p.item);
      if (p.item.hides?.includes('hairTop')) hatOn = true;
      cover |= bits & ~regionBits(['hairTop']);
    }
    const hairTop = hatOn ? regionBits(['hairTop']) : 0;
    for (const [slot, p] of this.pieces) {
      // Pieces hide what other pieces worn with them cover (`over`: boots over the pants' hem, a jacket over
      // the shirt's sleeves, a mask over the beard).
      let others = 0;
      // Only on pieces in a lower layer: a jacket hides the shirt's sleeves, not the elbow pads worn over it.
      for (const [s2, p2] of this.pieces) if (s2 !== slot && s2 !== 'body' && layerOf(s2) > layerOf(slot)) others |= regionBits(p2.item.over ?? []);
      const mask = p.kind === 'body' ? cover | pcd : p.kind === 'hair' ? pcd | hairTop | others : pcd | others;
      for (const m of p.materials) m.userData.uniforms.uHidden.value = mask;
    }
    this.refreshStumps();
    this.applyBuild();
  }

  /** PCD: rounded ends where a limb is missing, painted like what covers that spot. */
  private refreshStumps() {
    for (const s of this.stumps) s.removeFromParent();
    for (const m of this.stumpMaterials) m.dispose();
    this.stumps = [];
    this.stumpMaterials = [];
    const m = this.missingParts();
    const sleeved = (slot: CharSlot) => {
      const sleeve = catalogItem(this.itemFor(slot) ?? '')?.sleeve;
      return !!sleeve && sleeve !== 'nenhuma';
    };
    const sleeves: CharSlot | null = sleeved('sobreposicao') ? 'sobreposicao' : sleeved('tronco') ? 'tronco' : null;
    const legs = catalogItem(this.itemFor('baixo') ?? '');
    const legCovered = !!legs && (legs.category === 'calca' || (legs.category === 'short' && !legs.id.startsWith('saia')));
    const add = (where: 'shoulder' | 'wrist' | 'thigh', side: -1 | 1, coveredBy: CharSlot | null) => {
      const key = `${where}|${side}|${this.config.sex}|${coveredBy ? 1 : 0}`;
      let g = stumpCache.get(key);
      if (!g) {
        g = buildStump(where, side, this.config.sex, coveredBy ? 0.013 : 0, coveredBy ? PRIMARY : SKIN);
        stumpCache.set(key, g);
      }
      const color = coveredBy ? this.color(coveredBy) : this.color('skin');
      const mat = paintedMaterial({}, { primary: color, secondary: color, detail: color }, this.tints());
      this.stumps.push(this.skinned(g, mat));
      this.stumpMaterials.push(mat);
    };
    if (m.armL) add('shoulder', -1, sleeves);
    else if (m.handL) add('wrist', -1, null);
    if (m.armR) add('shoulder', 1, sleeves);
    else if (m.handR) add('wrist', 1, null);
    if (m.legL) add('thigh', -1, legCovered ? 'baixo' : null);
    if (m.legR) add('thigh', 1, legCovered ? 'baixo' : null);
    this.applyBuild();
  }

  /** Objects of a slot (e.g. to show or hide the rifle). */
  objectsOf(slot: CharSlot): THREE.Object3D[] {
    return this.pieces.get(slot)?.objects ?? [];
  }

  // --- Bake ------------------------------------------------------------------------------------------------

  /**
   * Merges the body, skinned pieces, stumps and rigid accessories into ONE SkinnedMesh with the final colors
   * in vertex colors (palette cell × tint × occlusion) and hidden regions removed (one shared material). The
   * weapons stay separate (visibility toggled by the game). The closed-hand morphs survive the bake. Any
   * later change unbakes automatically. Three levels of detail are baked (the pieces rebuilt with less
   * detail) and switched by distance (LOD_DISTANCES).
   */
  bake() {
    if (this.baked) return;
    // Rest pose for the bake, then back to the current pose.
    const saved = this.skeleton.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
    const bodyQ = this.body.quaternion.clone();
    this.body.quaternion.identity();
    this.skeleton.pose();
    this.root.updateMatrixWorld(true);
    const rootBone = this.skeleton.bones[0];
    const toCanonical = new THREE.Matrix4().copy(rootBone.parent!.matrixWorld).invert();
    const boneIdx = new Map(this.skeleton.bones.map((b, i) => [b, i]));
    let parts: BakePart[] = [];
    const baked: THREE.Object3D[] = [];
    const color = new THREE.Color();

    const addMesh = (mesh: THREE.Mesh, material: PaintedMaterial, rigidBone: THREE.Bone | null) => {
      const src = mesh.geometry;
      const g = src.index ? src.toNonIndexed() : src.clone();
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      // Build morphs baked into the positions; the hands' morphs kept as morphs.
      const dict = mesh.morphTargetDictionary ?? {};
      const infl = mesh.morphTargetInfluences;
      const morphs = g.morphAttributes.position ?? [];
      for (const [name, k] of Object.entries(dict)) {
        if ((LIVE_MORPHS as readonly string[]).includes(name) || !infl?.[k] || !morphs[k]) continue;
        const d = morphs[k];
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + d.getX(i) * infl[k], pos.getY(i) + d.getY(i) * infl[k], pos.getZ(i) + d.getZ(i) * infl[k]);
      }
      const n = pos.count;
      const tints = material.userData.uniforms.uTints.value;
      const uvA = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const tintA = g.getAttribute('_tint') as THREE.BufferAttribute | undefined;
      const regA = g.getAttribute('_region') as THREE.BufferAttribute | undefined;
      const aoA = g.getAttribute('color') as THREE.BufferAttribute | undefined;
      const onPalette = !!material.userData.palette && !!tintA;
      const hidden = material.userData.uniforms.uHidden.value;
      const colors = new Float32Array(n * 3);
      const keep = new Uint8Array(Math.floor(n / 3)).fill(1);
      for (let i = 0; i < n; i++) {
        if (onPalette && uvA) {
          const tint = Math.round(tintA!.getX(i));
          const cell = uvToCell(uvA.getX(i), uvA.getY(i));
          paintColor(tint ? (tint << 8) | (cell % 16) : cell, uvToGradient(uvA.getY(i)), tints, color);
        } else color.copy(material.color);
        const ao = aoA ? aoA.getX(i) : 1;
        colors.set([color.r * ao, color.g * ao, color.b * ao], i * 3);
        const region = regA ? Math.round(regA.getX(i)) : 31;
        if (region < 31 && (hidden >> region) & 1) keep[Math.floor(i / 3)] = 0;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      let skinIndex: Float32Array;
      let skinWeight: Float32Array;
      if (rigidBone) {
        // A rigid accessory becomes skinned to its socket's bone, placed where it is at rest.
        const m = new THREE.Matrix4().multiplyMatrices(toCanonical, mesh.matrixWorld);
        g.applyMatrix4(m);
        const bi = boneIdx.get(rigidBone) ?? 0;
        skinIndex = new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? bi : 0));
        skinWeight = new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0));
      } else {
        // Skinned: bone indices of this mesh's skeleton → the body skeleton's.
        const sm = mesh as THREE.SkinnedMesh;
        const si = g.getAttribute('skinIndex') as THREE.BufferAttribute;
        skinIndex = new Float32Array(n * 4);
        for (let i = 0; i < n * 4; i++) skinIndex[i] = boneIdx.get(sm.skeleton.bones[si.array[i] as number]) ?? 0;
        skinWeight = Float32Array.from((g.getAttribute('skinWeight') as THREE.BufferAttribute).array as ArrayLike<number>);
      }
      // Only what the merge needs, all Float32, dropping hidden triangles.
      const kept = keep.reduce((s, k) => s + k, 0) * 3;
      const pick = (a: ArrayLike<number>, size: number) => {
        const arr = new Float32Array(kept * size);
        let o = 0;
        for (let t = 0; t < keep.length; t++) {
          if (!keep[t]) continue;
          for (let v = 0; v < 3; v++) for (let c = 0; c < size; c++) arr[o++] = a[(t * 3 + v) * size + c];
        }
        return arr;
      };
      const attrs: Record<string, Float32Array> = {
        position: pick(pos.array as ArrayLike<number>, 3),
        normal: pick((g.getAttribute('normal') as THREE.BufferAttribute).array as ArrayLike<number>, 3),
        color: pick(colors, 3),
        skinIndex: pick(skinIndex, 4),
        skinWeight: pick(skinWeight, 4),
      };
      const live: Record<string, Float32Array> = {};
      for (const name of LIVE_MORPHS) {
        const k = dict[name];
        live[name] = k !== undefined && morphs[k] ? pick(morphs[k].array as ArrayLike<number>, 3) : new Float32Array(kept * 3);
      }
      g.dispose();
      // Two-sided pieces (skirts, capes): the bake has one front-sided material, so add the back faces
      // (reversed, normals flipped, a little darker: the inside).
      if (kept && material.side === THREE.DoubleSide) {
        const flip = (a: Float32Array, size: number, scale = 1) => {
          const out = new Float32Array(a.length * 2);
          out.set(a);
          for (let t = 0; t < a.length / (3 * size); t++) {
            for (const [v, from] of [[0, 0], [1, 2], [2, 1]]) {
              for (let c = 0; c < size; c++) out[a.length + (t * 3 + v) * size + c] = a[(t * 3 + from) * size + c] * scale;
            }
          }
          return out;
        };
        attrs.position = flip(attrs.position, 3);
        attrs.normal = flip(attrs.normal, 3, -1);
        attrs.color = flip(attrs.color, 3, 0.7);
        attrs.skinIndex = flip(attrs.skinIndex, 4);
        attrs.skinWeight = flip(attrs.skinWeight, 4);
        for (const name of LIVE_MORPHS) live[name] = flip(live[name], 3);
      }
      if (kept) parts.push({ attrs, morphs: live });
    };

    // Level 0 from the live meshes; levels 1 and 2 from the same pieces rebuilt with less detail.
    const merges: THREE.BufferGeometry[] = [];
    for (const lod of LOD_LEVELS) {
      parts = [];
      for (const [slot, p] of this.pieces) {
        if (slot === 'weapon_R' || slot === 'weapon_L' || slot === 'weapon_back') continue;
        for (const obj of p.objects) {
          obj.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mat = mesh.material as PaintedMaterial;
            if (!mat.userData?.uniforms) return;
            const sm = mesh as THREE.SkinnedMesh;
            const rigidBone = sm.isSkinnedMesh ? null : (this.boneAbove(mesh) ?? null);
            addMesh(lod ? this.lodProxy(slot, p, mesh, lod) : mesh, mat, rigidBone);
            if (!lod) baked.push(mesh);
          });
        }
      }
      this.stumps.forEach((s, i) => addMesh(s as THREE.Mesh, this.stumpMaterials[i], null));
      if (parts.length) merges.push(merge(parts));
    }

    // Back to the current pose.
    this.skeleton.bones.forEach((b, i) => {
      b.position.copy(saved[i][0]);
      b.quaternion.copy(saved[i][1]);
      b.scale.copy(saved[i][2]);
    });
    this.body.quaternion.copy(bodyQ);
    if (!merges.length) return;
    // One THREE.LOD: the renderer shows the level for the camera's distance (style guide: LOD1, LOD2).
    const lodObj = new THREE.LOD();
    lodObj.name = 'baked';
    const material = bakedMaterial();
    merges.forEach((g, i) => {
      const mesh = this.skinned(g, material);
      mesh.removeFromParent();
      // Level 0 until the renderer picks by distance.
      mesh.visible = i === 0;
      // 10% hysteresis: no flicker at the boundary.
      lodObj.addLevel(mesh, LOD_DISTANCES[i] ?? 0, 0.1);
    });
    this.body.add(lodObj);
    this.baked = lodObj;
    for (const o of baked) o.visible = false;
    for (const s of this.stumps) s.visible = false;
    this.applyMorphs();
  }

  /**
   * A stand-in for a live mesh at a lower level of detail: the same piece rebuilt with less detail (procedural
   * pieces and the body), on the same skeleton or socket, with the same morph influences. GLB pieces keep
   * their mesh (no LOD of their own yet).
   */
  private lodProxy(slot: CharSlot, p: Piece, mesh: THREE.Mesh, lod: number): THREE.Mesh {
    if (p.item.url) return mesh;
    const sm = mesh as THREE.SkinnedMesh;
    let geo: THREE.BufferGeometry | undefined;
    if (slot === 'body') geo = buildBody(this.config.sex, this.faceLook(), lod).skin;
    else {
      const g = proceduralPiece(p.item, this.config.sex, p.flat, lod);
      geo = sm.isSkinnedMesh ? g.skinned : g.rigid;
    }
    if (!geo) return mesh;
    const proxy = sm.isSkinnedMesh ? new THREE.SkinnedMesh(geo, mesh.material) : new THREE.Mesh(geo, mesh.material);
    if (sm.isSkinnedMesh) (proxy as THREE.SkinnedMesh).skeleton = sm.skeleton;
    proxy.updateMorphTargets();
    const dict = mesh.morphTargetDictionary ?? {};
    for (const [name, k] of Object.entries(proxy.morphTargetDictionary ?? {})) {
      const src = dict[name];
      if (src !== undefined && mesh.morphTargetInfluences) proxy.morphTargetInfluences![k] = mesh.morphTargetInfluences[src];
    }
    proxy.matrixWorld.copy(mesh.matrixWorld);
    return proxy;
  }

  private boneAbove(o: THREE.Object3D): THREE.Bone | null {
    let p = o.parent;
    while (p && !(p as THREE.Bone).isBone) p = p.parent;
    return (p as THREE.Bone) ?? null;
  }

  private unbake() {
    if (!this.baked) return;
    this.baked.removeFromParent();
    for (const l of this.baked.levels) (l.object as THREE.Mesh).geometry.dispose();
    this.baked = null;
    for (const p of this.pieces.values()) for (const o of p.objects) o.traverse((x) => (x.visible = true));
    for (const s of this.stumps) s.visible = true;
  }

  /** Draw calls this character costs (for the debug overlay). */
  drawCalls(): number {
    let n = 0;
    this.root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }

  /** Triangles drawn (for the budget check: style guide, at most 4,500 for a full character). */
  triangles(): number {
    let n = 0;
    this.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      // Baked: only level 0 (the LOD shows one level at a time).
      if (m.isMesh && (!this.baked || m.parent !== this.baked || m === this.baked.levels[0].object)) n += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
    });
    return n;
  }

  /** Shows one baked level whatever the distance (lab), or back to automatic (null). */
  forceLod(level: number | null) {
    if (!this.baked) return;
    this.baked.autoUpdate = level === null;
    this.baked.levels.forEach((l, i) => (l.object.visible = level === null ? i === 0 : i === level));
  }

  /** Triangles of each baked level of detail (empty when not baked). */
  lodTriangles(): number[] {
    return this.baked ? this.baked.levels.map((l) => (l.object as THREE.Mesh).geometry.getAttribute('position').count / 3) : [];
  }

  dispose() {
    this.version++;
    this.unbake();
    for (const slot of [...this.pieces.keys()]) this.remove(slot);
    for (const s of this.stumps) s.removeFromParent();
    for (const m of this.stumpMaterials) m.dispose();
    this.mixer?.stopAllAction();
    this.root.removeFromParent();
    // Geometries are shared caches: they stay.
  }
}

/** A config with every field valid (unknown items dropped). */
export function sanitizeConfig(raw: Partial<CharacterConfig>): CharacterConfig {
  const sex: Sex = raw.sex === 'f' ? 'f' : 'm';
  const items: CharacterConfig['items'] = {};
  for (const slot of CHAR_SLOTS) {
    const id = raw.items?.[slot];
    const item = id ? AssetRegistry.get(id) : undefined;
    items[slot] = item && item.slot === slot && (!item.sexes || item.sexes.includes(sex)) ? id! : null;
  }
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.colors ?? {})) if (/^#[0-9a-f]{6}$/i.test(v)) colors[k] = v.toLowerCase();
  const pick = <T,>(v: unknown, list: readonly T[], fb: T) => (list.includes(v as T) ? (v as T) : fb);
  return {
    v: 1,
    sex,
    items,
    colors,
    eyes: { style: pick(raw.eyes?.style, EYE_STYLES, 'redondo') },
    face: sanitizeFace(raw.face),
    build: { height: pick(raw.build?.height, HEIGHTS, 'medio'), build: pick(raw.build?.build, BUILDS, 'medio') },
    pcd: { braco: pick(raw.pcd?.braco, ARM_LOSSES, ''), perna: pick(raw.pcd?.perna, LEG_LOSSES, '') },
  };
}
