// Third-person character: the local player during humiliations, every remote player online, bots, corpses
// and the profile preview. Stylized low poly (big head, painted anime face, chunky faceted hair, slim limbs,
// chunky shoes), built in code from lathed and tapered pieces on pivot groups so poses are animated
// procedurally and every piece follows the player's Appearance (shared/appearance.ts): body, skin, eyes,
// hair, the eight clothing slots and the PCD mode.
import * as THREE from 'three';
import { bodyStats, type Appearance } from '@shared/appearance';
import type { Sex } from '@shared/protocol';
import { toon } from '../render/materials';

export interface AvatarPose {
  /** Horizontal speed (m/s), drives the walk cycle. */
  speed: number;
  crouch: boolean;
  slide?: boolean;
  /** View pitch (radians): the torso and rifle follow it. */
  pitch: number;
  ads: boolean;
  reload: boolean;
  knife: boolean;
  cook: boolean;
}

type MeshFn = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x?: number, y?: number, z?: number) => THREE.Mesh;

const DARK = 0x222226;
const WHITE = 0xf4f1ea;
/** Radial segments: few on purpose, for the low poly look. */
const SEG = 8;
const HEAD_R = 0.27;

/** A darker (k < 1) or lighter (k > 1) shade of a color: collars, cuffs, soles, shadows in the face. */
const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k).getHex();
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** Faceted: every face gets its own normal, so the toon shading shows the low poly planes. */
function facet<T extends THREE.BufferGeometry>(g: T): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
}

/** A body segment turned around the Y axis from a (radius, y) profile, oval in section (x wide, z deep). */
function lathe(profile: [number, number][], sx: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
  g.scale(sx, 1, sz);
  return g;
}

/** A limb segment hanging down from its top: radius r0 at the top, r1 at the bottom. */
function taper(r0: number, r1: number, len: number, seg = 7): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.translate(0, -len / 2, 0);
  return g;
}

/** A low poly lock of hair: a 4-5 sided cone hanging from its base (point down before rotation). */
function lock(r: number, len: number, sides = 4): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, sides);
  g.rotateX(Math.PI);
  g.translate(0, -len / 2, 0);
  return facet(g);
}

// --- Painted face -----------------------------------------------------------------------------------------

const faceCache = new Map<string, THREE.CanvasTexture>();

/**
 * Anime face on a transparent canvas: big eyes with the iris color and highlights, lashes, brows in the
 * hair color, a hint of a nose, the mouth and blush. Mapped on a patch of sphere over the front of the head.
 */
function faceTexture(sex: Sex, eyes: string, brows: string, skin: string): THREE.CanvasTexture {
  const key = `${sex}|${eyes}|${brows}|${skin}`;
  let tex = faceCache.get(key);
  if (tex) return tex;
  const W = 512;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const female = sex === 'f';
  const lineCol = css(shade(brows, 0.55));
  const eyeY = H * 0.53;
  for (const side of [-1, 1]) {
    const ex = W / 2 + side * W * 0.19;
    const ew = W * 0.095;
    const eh = H * (female ? 0.17 : 0.15);
    // White of the eye.
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(ex, eyeY, ew, eh, 0, 0, Math.PI * 2);
    g.fill();
    // Iris: two tones, darker on top (the lid's shadow), pupil and two highlights.
    g.save();
    g.beginPath();
    g.ellipse(ex, eyeY, ew, eh, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = css(shade(eyes, 0.7));
    g.beginPath();
    g.ellipse(ex - side * ew * 0.08, eyeY + eh * 0.12, ew * 0.72, eh * 0.9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = eyes;
    g.beginPath();
    g.ellipse(ex - side * ew * 0.08, eyeY + eh * 0.3, ew * 0.62, eh * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#16121c';
    g.beginPath();
    g.ellipse(ex - side * ew * 0.08, eyeY + eh * 0.2, ew * 0.28, eh * 0.38, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.ellipse(ex - side * ew * 0.3, eyeY - eh * 0.15, ew * 0.2, eh * 0.18, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(ex + side * ew * 0.18, eyeY + eh * 0.45, ew * 0.1, eh * 0.09, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Upper lid line (thick, with a flick to the outside for lashes) and a thin lower line.
    g.strokeStyle = '#1b1422';
    g.lineCap = 'round';
    g.lineWidth = female ? 11 : 8;
    g.beginPath();
    g.ellipse(ex, eyeY + eh * 0.05, ew * 1.05, eh * 1.02, 0, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
    if (female) {
      g.lineWidth = 7;
      g.beginPath();
      const ox = ex + side * ew * 1.0;
      g.moveTo(ox, eyeY - eh * 0.45);
      g.lineTo(ox + side * ew * 0.35, eyeY - eh * 0.75);
      g.stroke();
    }
    g.lineWidth = 3;
    g.strokeStyle = lineCol;
    g.beginPath();
    g.ellipse(ex, eyeY, ew * 0.9, eh * 0.98, 0, Math.PI * 0.25, Math.PI * 0.75);
    g.stroke();
    // Brow: thicker for the masculine face.
    g.strokeStyle = brows;
    g.lineWidth = female ? 7 : 12;
    g.beginPath();
    g.moveTo(ex - side * ew * 0.9, eyeY - eh * 1.55);
    g.quadraticCurveTo(ex, eyeY - eh * (female ? 1.95 : 1.75), ex + side * ew * 1.05, eyeY - eh * 1.45);
    g.stroke();
    // Blush.
    g.fillStyle = 'rgba(240,110,110,0.22)';
    g.beginPath();
    g.ellipse(ex + side * ew * 0.35, eyeY + eh * 1.5, ew * 0.7, eh * 0.35, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Nose: a small shadow tick.
  g.strokeStyle = css(shade(skin, 0.78));
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(W / 2 + 4, H * 0.75);
  g.lineTo(W / 2 - 3, H * 0.79);
  g.stroke();
  // Mouth: small, lips tinted on the feminine face.
  g.strokeStyle = female ? '#c4505e' : '#7a3b36';
  g.lineWidth = female ? 7 : 5;
  g.beginPath();
  g.moveTo(W / 2 - W * 0.035, H * 0.88);
  g.quadraticCurveTo(W / 2, H * 0.9, W / 2 + W * 0.035, H * 0.875);
  g.stroke();
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  return tex;
}

const insideMats = new Map<number, THREE.MeshToonMaterial>();
/** Back faces only (the inside of a skirt), cached per color like toon(). */
function insideMaterial(color: number) {
  let m = insideMats.get(color);
  if (!m) {
    m = toon(color).clone();
    m.side = THREE.BackSide;
    insideMats.set(color, m);
  }
  return m;
}

const faceMats = new Map<string, THREE.MeshToonMaterial>();
function faceMaterial(sex: Sex, look: Appearance) {
  const key = `${sex}|${look.olhos}|${look.cabelo.cor}|${look.pele}`;
  let m = faceMats.get(key);
  if (!m) {
    m = toon(0xffffff).clone();
    m.map = faceTexture(sex, look.olhos, look.cabelo.cor, look.pele);
    m.transparent = true;
    m.alphaTest = 0.2;
    m.depthWrite = false;
    faceMats.set(key, m);
  }
  return m;
}

/**
 * Frees an avatar's geometry. Materials are shared caches (toon(), faces, skirt insides): never dispose
 * them here, other characters use them.
 */
export function disposeAvatar(a: Avatar) {
  a.root.removeFromParent();
  a.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

export class Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private rifleHands = new THREE.Group();
  private rifleBack: THREE.Mesh;
  private walkPhase = 0;

  constructor(
    scene: THREE.Object3D,
    readonly look: Appearance,
    readonly sex: Sex = 'm',
  ) {
    const female = sex === 'f';
    const stats = bodyStats(look);
    const w = stats.width;
    // Limbs and depth follow the build less than the torso width does.
    const limbW = 1 + (w - 1) * 0.55;
    const depth = 1 + (w - 1) * 0.8;
    const { roupas } = look;
    const skin = toon(look.pele);
    const shirt = toon(roupas.camiseta.cor);
    const shirtHem = toon(shade(roupas.camiseta.cor, 0.72));
    const bottom = toon(roupas.baixo.cor);
    const mesh: MeshFn = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    // Height scales the whole body from the feet.
    this.body.scale.setScalar(stats.scale);
    this.hips.position.y = 0.82;
    this.body.add(this.hips);

    const bottomId = roupas.baixo.id;
    const pants = bottomId.startsWith('calca');
    const shorts = bottomId.startsWith('bermuda');
    const skirt = bottomId.startsWith('saia');

    // --- Torso: pelvis, waist and chest lathed from a profile; the feminine one has a waist and hips.
    const sx = (female ? 1.08 : 1.2) * w;
    const sz = 0.72 * depth;
    this.hips.add(this.torso);
    const pelvisProfile: [number, number][] = female
      ? [[0.0, -0.1], [0.12, -0.09], [0.165, -0.04], [0.17, 0.02], [0.14, 0.08]]
      : [[0.0, -0.1], [0.12, -0.09], [0.15, -0.04], [0.15, 0.02], [0.145, 0.08]];
    const waistProfile: [number, number][] = female
      ? [[0.14, 0.08], [0.115, 0.16], [0.125, 0.24]]
      : [[0.145, 0.08], [0.14, 0.16], [0.155, 0.24]];
    const chestProfile: [number, number][] = female
      ? [[0.125, 0.24], [0.16, 0.31], [0.155, 0.38], [0.14, 0.43], [0.07, 0.48], [0.0, 0.49]]
      : [[0.155, 0.24], [0.18, 0.32], [0.185, 0.39], [0.16, 0.44], [0.08, 0.48], [0.0, 0.49]];
    mesh(lathe(pelvisProfile, sx, sz), bottom, this.torso);
    // The heaviest build gets a belly: a deeper waist.
    mesh(lathe(waistProfile, sx, sz * (look.biotipo === 'gordo' ? 1.3 : 1)), shirt, this.torso);
    mesh(lathe(chestProfile, sx, sz), shirt, this.torso);
    // Shirt hem: a band at the bottom of the shirt (like a crop top's), a waistband above the pants.
    mesh(lathe([[0.15, 0.075], [0.152, 0.11]], sx * (female ? 0.98 : 1.0), sz * 1.02), shirtHem, this.torso);
    if (!skirt) mesh(lathe([[female ? 0.172 : 0.155, 0.0], [female ? 0.172 : 0.155, 0.035]], sx, sz * 1.02), toon(shade(roupas.baixo.cor, 0.75)), this.torso);
    // Neck.
    mesh(taper(0.055, 0.06, 0.12), skin, this.torso, 0, 0.56, 0);
    if (roupas.camiseta.id === 'polo') {
      const collar = toon(shade(roupas.camiseta.cor, 0.78));
      mesh(new THREE.TorusGeometry(0.075, 0.03, 4, SEG), collar, this.torso, 0, 0.475, 0).rotation.x = Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.04, 0.1, 0.02), collar, this.torso, 0, 0.41, -0.185 * sz * 1.35);
    }
    if (roupas.camiseta.id === 'regata') {
      // Straps of the tank top over bare shoulders.
      for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.045, 0.025, 0.16 * depth), shirt, this.torso, s * 0.1 * sx, 0.465, 0);
    }
    if (roupas.camiseta.id === 'basica') mesh(new THREE.TorusGeometry(0.07, 0.015, 4, SEG), shirtHem, this.torso, 0, 0.48, 0).rotation.x = Math.PI / 2;
    this.rifleBack = mesh(new THREE.BoxGeometry(0.12, 0.5, 0.07), toon(DARK), this.torso, 0.06, 0.28, 0.2 * depth);
    this.rifleBack.rotation.z = 0.5;

    // --- Legs hang from hip pivots: thigh, shin, shoe. Pants cover both, shorts the top of the thigh.
    const hipX = female ? 0.085 : 0.09;
    const legs = [
      [this.legL, -hipX, stats.missing.legL, -1],
      [this.legR, hipX, stats.missing.legR, 1],
    ] as const;
    for (const [leg, x, missing, side] of legs) {
      leg.position.set(x * w, -0.02, 0);
      this.hips.add(leg);
      const thighMat = pants ? bottom : skin;
      const tr = (female ? 0.088 : 0.082) * limbW;
      if (missing) {
        // PCD: only a short, rounded stump of the thigh.
        mesh(facet(taper(tr, tr * 0.92, 0.12)), thighMat, leg);
        mesh(facet(new THREE.SphereGeometry(tr * 0.92, 7, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), thighMat, leg, 0, -0.12, 0);
        if (shorts) mesh(taper(tr * 1.18, tr * 1.12, 0.12), bottom, leg);
        continue;
      }
      mesh(taper(tr, 0.055 * limbW, 0.4), thighMat, leg);
      mesh(new THREE.SphereGeometry(0.056 * limbW, 7, 5), pants ? bottom : skin, leg, 0, -0.4, 0);
      mesh(taper(0.06 * limbW, 0.042 * limbW, 0.36), pants ? bottom : skin, leg, 0, -0.4, 0);
      if (shorts) mesh(taper(tr * 1.16, tr * 1.08, 0.17), bottom, leg);
      this.legDetail(leg, side, bottomId, roupas.baixo.cor, tr, mesh);
      this.shoe(leg, roupas.sapatos.id, roupas.sapatos.cor, skin, pants, mesh);
    }
    if (skirt) {
      const [bot, len, seg] = bottomId === 'saiaLapis' ? [0.2, 0.42, SEG] : bottomId === 'saiaRodada' ? [0.34, 0.34, 12] : [0.29, 0.34, 10];
      let geo: THREE.BufferGeometry = new THREE.CylinderGeometry(0.175, bot, len, seg, 1, true);
      geo.translate(0, -len / 2 + 0.03, 0);
      geo.scale(sx * 0.95, 1, sz * 1.15);
      // Pleats: faceted sides.
      if (bottomId === 'saiaPregas') geo = facet(geo);
      mesh(geo, bottom, this.torso);
      // Inside of the skirt, a shade darker (seen from below).
      this.torso.add(new THREE.Mesh(geo, insideMaterial(shade(roupas.baixo.cor, 0.55))));
    }

    // --- Arms hang from shoulder pivots: short sleeve (bare with a tank top), upper arm, forearm, fist.
    // PCD removes the whole arm (a rounded stump stays) or only the hand. The bracelet goes on the left
    // wrist, or the right one when the left hand is missing.
    const shoulderX = (female ? 0.19 : 0.22) * (1 + (w - 1) * 0.75);
    const sleeveMat = roupas.camiseta.id === 'regata' ? skin : shirt;
    const braceletLeft = !stats.missing.handL;
    const arms = [
      [this.armL, -shoulderX, stats.missing.armL, stats.missing.handL, true],
      [this.armR, shoulderX, stats.missing.armR, stats.missing.handR, false],
    ] as const;
    for (const [arm, x, noArm, noHand, left] of arms) {
      arm.position.set(x, 0.42, 0);
      this.torso.add(arm);
      const ar = (female ? 0.05 : 0.056) * limbW;
      // Shoulder cap (rounds the joint in every pose).
      mesh(new THREE.SphereGeometry(ar * 1.35, 7, 5), sleeveMat, arm);
      if (noArm) {
        mesh(facet(new THREE.SphereGeometry(ar * 1.2, 7, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), sleeveMat, arm, 0, -0.04, 0);
        continue;
      }
      mesh(taper(ar, ar * 0.85, 0.27), skin, arm);
      if (roupas.camiseta.id !== 'regata') mesh(taper(ar * 1.35, ar * 1.25, 0.12), shirt, arm);
      mesh(new THREE.SphereGeometry(ar * 0.85, 6, 4), skin, arm, 0, -0.27, 0);
      mesh(taper(ar * 0.85, ar * 0.65, 0.23), skin, arm, 0, -0.27, 0);
      if (!noHand) {
        // Low poly fist with a thumb.
        const fist = mesh(facet(new THREE.IcosahedronGeometry(ar * 1.05, 0)), skin, arm, 0, -0.55, -0.005);
        fist.scale.set(0.95, 1.2, 1.0);
        mesh(facet(new THREE.BoxGeometry(ar * 0.55, ar * 0.9, ar * 0.55)), skin, arm, (left ? 1 : -1) * ar * 0.55, -0.52, -ar * 0.6).rotation.z = (left ? -1 : 1) * 0.4;
      } else {
        mesh(facet(new THREE.SphereGeometry(ar * 0.65, 6, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), skin, arm, 0, -0.5, 0);
      }
      if (left === braceletLeft && roupas.pulseira.id) this.bracelet(arm, roupas.pulseira.id, roupas.pulseira.cor, ar * 0.72, mesh);
    }

    // Rifle held in front of the chest (hidden while dancing, when it goes on the back).
    const dark = toon(DARK);
    this.rifleHands.position.set(0.07, 0.3, -0.34);
    mesh(new THREE.BoxGeometry(0.06, 0.09, 0.6), dark, this.rifleHands);
    mesh(new THREE.BoxGeometry(0.028, 0.028, 0.28), dark, this.rifleHands, 0, 0.02, -0.42);
    mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), toon(0x6b5a45), this.rifleHands, 0, -0.09, -0.04);
    this.torso.add(this.rifleHands);

    // --- Head: a big low poly skull with the painted face, ears, hair, then hat and glasses.
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    const skull = new THREE.Group();
    skull.position.y = 0.2;
    this.head.add(skull);
    const headGeo = new THREE.SphereGeometry(HEAD_R, 12, 9);
    headGeo.scale(1, 1.04, 0.96);
    mesh(headGeo, skin, skull);
    // Chin: a slightly pointed jaw.
    mesh(facet(new THREE.ConeGeometry(0.13, 0.12, 6)), skin, skull, 0, -0.21, -0.07).rotation.x = Math.PI + 0.35;
    for (const s of [-1, 1]) mesh(facet(new THREE.SphereGeometry(0.05, 6, 4)), skin, skull, s * HEAD_R * 0.97, -0.02, 0.02).scale.set(0.5, 1, 0.8);
    // Face: a patch of sphere just over the front of the skull, with the painted eyes, brows and mouth.
    const faceGeo = new THREE.SphereGeometry(HEAD_R * 1.006, 16, 12, Math.PI * 1.5 - 0.85, 1.7, Math.PI / 2 - 0.62, 1.3);
    faceGeo.scale(1, 1.04, 0.96);
    const face = mesh(faceGeo, faceMaterial(sex, look), skull);
    face.castShadow = false;
    face.renderOrder = 1;
    this.hair(skull, look.cabelo.id, look.cabelo.cor, !!roupas.chapeu.id, mesh);
    this.hat(skull, roupas.chapeu.id, roupas.chapeu.cor, look.cabelo.id === 'blackPower', mesh);
    this.glasses(skull, roupas.oculos.id, roupas.oculos.cor, mesh);

    this.root.visible = false;
    scene.add(this.root);
  }

  private legDetail(leg: THREE.Group, side: -1 | 1, id: string, cor: string, tr: number, mesh: MeshFn) {
    const darker = toon(shade(cor, 0.72));
    if (id === 'calcaCargo') mesh(facet(new THREE.BoxGeometry(0.05, 0.12, 0.11)), darker, leg, side * tr * 0.95, -0.2, 0);
    if (id === 'calcaMoletom') mesh(taper(0.052, 0.05, 0.05), toon(shade(cor, 1.3)), leg, 0, -0.71, 0);
    if (id === 'calcaJeans') for (const x of [-1, 1]) mesh(new THREE.BoxGeometry(0.006, 0.34, 0.006), toon(shade(cor, 1.4)), leg, x * tr * 0.7, -0.2, -tr * 0.72);
    if (id === 'bermudaPraia') mesh(taper(tr * 1.09, tr * 1.08, 0.03), toon(WHITE), leg, 0, -0.14, 0);
    if (id === 'bermudaJeans') mesh(taper(tr * 1.12, tr * 1.12, 0.035), darker, leg, 0, -0.15, 0);
    if (id === 'bermudaEsportiva') for (const dz of [-0.015, 0.015]) mesh(new THREE.BoxGeometry(0.012, 0.17, 0.008), toon(WHITE), leg, side * tr * 1.13, -0.085, dz);
  }

  private shoe(leg: THREE.Group, id: string, cor: string, skin: THREE.Material, pants: boolean, mesh: MeshFn) {
    const mat = toon(cor);
    if (id === 'bota') {
      mesh(taper(0.056, 0.056, 0.16, 8), mat, leg, 0, -0.62, 0);
      mesh(taper(0.064, 0.062, 0.035, 8), toon(shade(cor, 0.7)), leg, 0, -0.61, 0);
      mesh(facet(new THREE.BoxGeometry(0.12, 0.08, 0.2)), mat, leg, 0, -0.78, -0.04);
      mesh(facet(new THREE.BoxGeometry(0.13, 0.03, 0.22)), toon(shade(cor, 0.5)), leg, 0, -0.815, -0.04);
    } else if (id === 'chinelo') {
      mesh(facet(new THREE.BoxGeometry(0.085, 0.05, 0.17)), skin, leg, 0, -0.785, -0.035);
      mesh(facet(new THREE.BoxGeometry(0.11, 0.022, 0.21)), mat, leg, 0, -0.815, -0.04);
      mesh(new THREE.BoxGeometry(0.09, 0.015, 0.02), mat, leg, 0, -0.77, -0.08);
    } else {
      // Chunky sneakers with a white sole, and a white sock showing under shorts and skirts.
      if (!pants) mesh(taper(0.046, 0.046, 0.05), toon(WHITE), leg, 0, -0.71, 0);
      mesh(facet(new THREE.BoxGeometry(0.12, 0.085, 0.21)), mat, leg, 0, -0.775, -0.035);
      mesh(facet(new THREE.BoxGeometry(0.125, 0.03, 0.225)), toon(WHITE), leg, 0, -0.815, -0.04);
      mesh(new THREE.BoxGeometry(0.06, 0.012, 0.06), toon(WHITE), leg, 0, -0.73, -0.1);
    }
  }

  private bracelet(arm: THREE.Group, id: string, cor: string, r: number, mesh: MeshFn) {
    const y = -0.47;
    if (id === 'micangas') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        mesh(new THREE.OctahedronGeometry(0.016, 0), toon(i % 2 ? cor : WHITE), arm, Math.cos(a) * r * 1.2, y, Math.sin(a) * r * 1.2);
      }
      return;
    }
    mesh(taper(r * 1.25, r * 1.25, id === 'relogio' ? 0.025 : 0.032, 7), toon(cor), arm, 0, y + 0.015, 0);
    if (id === 'relogio') {
      mesh(new THREE.BoxGeometry(0.05, 0.04, 0.016), toon(DARK), arm, 0, y, -r * 1.3);
      mesh(new THREE.BoxGeometry(0.035, 0.028, 0.004), toon(WHITE), arm, 0, y, -r * 1.3 - 0.009);
    }
  }

  /** `hatOn`: a hat hides what would poke through it (the quiff, the bun). */
  private hair(skull: THREE.Group, id: string, cor: string, hatOn: boolean, mesh: MeshFn) {
    const mat = toon(cor);
    const dark = toon(shade(cor, 0.78));
    const R = HEAD_R;
    // Cap: the top and back of the head, faceted, a little bigger than the skull.
    const cap = (drop = 0.62) => {
      // Under a hat only the hair below its brim shows.
      if (hatOn) return;
      const g = facet(new THREE.SphereGeometry(R * 1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI * drop));
      // Tilted back (+X): it covers the crown and the back, leaving the face free.
      const c = mesh(g, mat, skull, 0, 0.01, 0.015);
      c.rotation.x = 0.42;
      c.scale.set(1.02, 1.02, 1.0);
    };
    // Bangs: flattened locks across the forehead, longest in the middle.
    const bangs = (n: number, len: number, spread = 0.9) => {
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        const a = t * spread;
        const l = mesh(lock(0.065, len * (1 - Math.abs(t) * 0.5), 4), i % 2 ? mat : dark, skull, Math.sin(a) * R * 0.95, 0.16, -Math.cos(a) * R * 0.86);
        // The tip leans forward, following the forehead down.
        l.rotation.set(0.3, -a, 0);
        l.scale.z = 0.45;
      }
    };
    // Locks hanging at the sides (in front of the ears) and around the back.
    const sides = (len: number) => {
      for (const s of [-1, 1]) {
        const l = mesh(lock(0.055, len, 4), mat, skull, s * R * 0.98, 0.05, -0.05);
        l.rotation.set(-0.1, 0, s * 0.12);
        l.scale.z = 0.6;
      }
    };
    const back = (n: number, len: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * 2.4;
        const l = mesh(lock(0.085, len, 5), i % 2 ? mat : dark, skull, Math.sin(a) * R * 0.9, 0.06, Math.cos(a) * R * 0.85);
        l.rotation.set(0.18 * Math.cos(a), 0, -0.18 * Math.sin(a));
      }
    };
    switch (id) {
      case 'curto':
        cap(0.55);
        bangs(4, 0.12);
        sides(0.1);
        break;
      case 'topete': {
        cap(0.55);
        if (!hatOn) mesh(lock(0.11, 0.26, 5), mat, skull, 0, 0.26, -0.12).rotation.set(Math.PI - 0.9, 0, 0);
        else bangs(3, 0.1);
        sides(0.08);
        break;
      }
      case 'blackPower':
        // Sits back and up so the forehead and eyes stay clear.
        mesh(facet(new THREE.IcosahedronGeometry(0.37, 1)), mat, skull, 0, 0.13, 0.11).scale.set(1, 0.9, 0.95);
        bangs(3, 0.07, 0.6);
        break;
      case 'longo':
        cap(0.62);
        bangs(5, 0.17);
        sides(0.32);
        back(6, 0.5);
        break;
      case 'coque': {
        cap(0.6);
        bangs(5, 0.15);
        sides(0.2);
        // Bun on top, with a darker band.
        if (!hatOn) {
          mesh(facet(new THREE.IcosahedronGeometry(0.12, 1)), mat, skull, 0, 0.27, 0.12);
          mesh(taper(0.075, 0.075, 0.04, 7), dark, skull, 0, 0.2, 0.1).rotation.x = -0.6;
        }
        break;
      }
      default: {
        // 'rabo': ponytail from the back of the head, tied with a band.
        cap(0.62);
        bangs(5, 0.16);
        sides(0.22);
        mesh(taper(0.05, 0.05, 0.05, 7), dark, skull, 0, 0.07, 0.25).rotation.x = -1.2;
        const tail = mesh(lock(0.1, 0.42, 5), mat, skull, 0, 0.06, 0.29);
        tail.rotation.x = 0.35;
      }
    }
  }

  private hat(skull: THREE.Group, id: string, cor: string, bigHair: boolean, mesh: MeshFn) {
    if (!id) return;
    const hat = new THREE.Group();
    skull.add(hat);
    // Over a black power the hat sits higher and wider.
    if (bigHair) {
      hat.position.set(0, 0.1, 0.04);
      hat.scale.setScalar(1.3);
    }
    const mat = toon(cor);
    const R = HEAD_R;
    if (id === 'bone') {
      // Backwards cap: crown and visor at the back.
      const crown = facet(new THREE.SphereGeometry(R * 1.13, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5));
      mesh(crown, mat, hat, 0, 0.04, 0).scale.y = 0.85;
      mesh(facet(new THREE.BoxGeometry(0.26, 0.022, 0.16)), mat, hat, 0, 0.05, 0.3).rotation.x = -0.12;
      mesh(new THREE.SphereGeometry(0.02, 6, 4), toon(shade(cor, 0.7)), hat, 0, 0.3, 0);
    } else if (id === 'palha') {
      mesh(facet(new THREE.CylinderGeometry(0.46, 0.48, 0.025, 12)), mat, hat, 0, 0.13, 0);
      mesh(facet(new THREE.CylinderGeometry(0.2, 0.25, 0.2, 10)), mat, hat, 0, 0.24, 0);
      mesh(facet(new THREE.CylinderGeometry(0.252, 0.252, 0.045, 10)), toon(shade(cor, 0.5)), hat, 0, 0.17, 0);
    } else {
      // Beanie with a folded brim and a pompom.
      mesh(facet(new THREE.SphereGeometry(R * 1.14, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52)), mat, hat, 0, 0.03, 0);
      mesh(facet(new THREE.CylinderGeometry(R * 1.16, R * 1.16, 0.07, 10)), toon(shade(cor, 0.8)), hat, 0, 0.04, 0);
      mesh(facet(new THREE.IcosahedronGeometry(0.06, 0)), toon(WHITE), hat, 0, 0.33, 0);
    }
  }

  private glasses(skull: THREE.Group, id: string, cor: string, mesh: MeshFn) {
    if (!id) return;
    const mat = toon(cor);
    const z = -HEAD_R * 0.98;
    const y = -0.02;
    if (id === 'escuros') {
      for (const s of [-1, 1]) mesh(facet(new THREE.BoxGeometry(0.12, 0.07, 0.02)), mat, skull, s * 0.07, y, z - 0.005).rotation.y = s * 0.2;
      mesh(new THREE.BoxGeometry(0.04, 0.015, 0.012), mat, skull, 0, y + 0.015, z - 0.02);
    } else {
      for (const s of [-1, 1]) {
        if (id === 'redondos') {
          mesh(new THREE.TorusGeometry(0.052, 0.009, 4, 10), mat, skull, s * 0.085, y, z - 0.01).rotation.y = s * 0.2;
        } else {
          // Aviators: tinted drop lenses with a thin rim.
          const lens = mesh(facet(new THREE.CircleGeometry(0.06, 7)), toon(0x3a4a5a), skull, s * 0.08, y, z - 0.012);
          lens.rotation.set(0, Math.PI + s * 0.2, 0);
          lens.scale.y = 0.85;
          mesh(new THREE.TorusGeometry(0.06, 0.007, 4, 10), mat, skull, s * 0.08, y, z - 0.014).scale.y = 0.85;
        }
      }
      mesh(new THREE.BoxGeometry(0.05, 0.01, 0.01), mat, skull, 0, y + 0.02, z - 0.02);
    }
    // Temples back to the ears.
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.008, 0.01, 0.2), mat, skull, s * HEAD_R * 0.98, y + 0.01, -0.08);
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible() {
    return this.root.visible;
  }

  private resetBody() {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
  }

  /** Alive, armed: walk cycle, crouch, aim pitch, and quick action overrides (reload, knife, grenade). */
  pose(dt: number, s: AvatarPose) {
    this.resetBody();
    this.rifleHands.visible = true;
    this.rifleBack.visible = false;
    const moving = s.speed > 0.4;
    this.walkPhase += dt * (moving ? 3 + s.speed * 1.1 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * Math.min(0.7, 0.2 + s.speed * 0.08) : 0;
    const crouch = s.crouch ? 1 : 0;
    this.hips.position.y = 0.82 - crouch * 0.32 + (moving ? Math.abs(Math.cos(this.walkPhase)) * 0.04 : 0);
    // Rigid legs: crouching swings them forward (sitting-ish) as the hips drop.
    this.legL.rotation.x = swing + crouch * 0.9;
    this.legR.rotation.x = -swing + crouch * 0.9;
    this.torso.rotation.x = -crouch * 0.35 + s.pitch * 0.3;
    this.head.rotation.x = s.pitch * 0.4;

    if (s.slide) {
      // Baseball slide: legs out in front, body leaning back, still aiming.
      this.hips.position.y = 0.32;
      this.legL.rotation.x = 1.35;
      this.legR.rotation.x = 1.1;
      this.torso.rotation.x = 0.45 + s.pitch * 0.3;
    }

    // Arms forward holding the rifle, aimed with the view pitch. (Euler XYZ: the Z swing happens in the
    // hanging frame, then X lifts the arm forward; +X = forward/up for an arm hanging along -Y.)
    const aim = 1.35 + s.pitch * 0.5 + (s.ads ? 0.1 : 0);
    this.armR.rotation.set(aim, 0, -0.12);
    this.armL.rotation.set(aim - 0.1, 0, 0.45);
    this.rifleHands.rotation.x = s.pitch * 0.5;

    if (s.reload) {
      this.armL.rotation.set(0.6, 0, 0.2);
      this.rifleHands.rotation.z = 0.5;
    } else {
      this.rifleHands.rotation.z = 0;
    }
    if (s.knife) this.armR.rotation.set(1.6, 0.5, -0.2);
    if (s.cook) this.armL.rotation.set(2.6, 0, 0.2);
  }

  /** Standing still with the arms relaxed (profile preview); `rifle` shows the rifle slung on the back. */
  idle(rifle = true) {
    this.resetBody();
    this.hips.position.y = 0.82;
    this.rifleHands.visible = false;
    this.rifleBack.visible = rifle;
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0.05, 0, -0.18);
    this.armR.rotation.set(0.05, 0, 0.18);
  }

  /** "Dancinha da Vitória": raise the roof, spin, then disco pointing. `t` in seconds, 150 bpm. */
  dance(t: number) {
    this.resetBody();
    this.rifleHands.visible = false;
    this.rifleBack.visible = true;
    const beat = 0.4;
    const b = t / beat;
    const bounce = Math.abs(Math.sin(b * Math.PI));
    this.hips.position.y = 0.76 + bounce * 0.1;
    this.hips.rotation.z = Math.sin(b * Math.PI) * 0.14;
    this.legL.rotation.x = Math.sin(b * Math.PI) * 0.35;
    this.legR.rotation.x = -Math.sin(b * Math.PI) * 0.35;
    this.torso.rotation.z = -this.hips.rotation.z * 1.4;
    this.head.rotation.x = Math.sin(b * Math.PI * 2) * 0.15;
    this.head.rotation.z = Math.sin(b * Math.PI) * 0.2;

    if (t < 1.6) {
      // Raise the roof: both hands pumping above the head.
      const pump = Math.sin(b * Math.PI * 2) * 0.25;
      this.armL.rotation.set(0, 0, -2.7 - pump);
      this.armR.rotation.set(0, 0, 2.7 + pump);
    } else if (t < 2.4) {
      // Spin with arms out.
      const s = (t - 1.6) / 0.8;
      this.hips.rotation.y = THREE.MathUtils.smootherstep(s, 0, 1) * Math.PI * 2;
      this.armL.rotation.set(0, 0, -1.5);
      this.armR.rotation.set(0, 0, 1.5);
    } else {
      // Disco point: right arm to the sky, left to the floor, swapping every beat.
      const up = Math.floor(b) % 2 === 0;
      this.armR.rotation.set(0, 0, up ? 2.6 : 0.6);
      this.armL.rotation.set(0, 0, up ? -0.6 : -2.6);
    }
  }

  /** Stiff cartoon fall onto the back (`dir` 1) or face (-1), `t` seconds after death. */
  die(t: number, dir: 1 | -1 = 1) {
    this.resetBody();
    this.rifleHands.visible = false;
    this.rifleBack.visible = true;
    this.hips.position.y = 0.82;
    this.armL.rotation.set(0, 0, -0.5);
    this.armR.rotation.set(0, 0, 0.5);
    const k = Math.min(1, t / 0.45);
    const after = t - 0.45;
    const bounce = k < 1 ? k * k : 1 + Math.sin(after * 18) * Math.exp(-after * 7) * 0.06;
    // Fall around the feet: positive X rotation tips the top toward +Z (backward for a -Z facing body).
    this.body.rotation.x = dir * bounce * (Math.PI / 2 - 0.08);
  }
}
