// Third-person character: the local player during humiliations, every remote player online, bots, corpses
// and the profile preview. Built from primitives on pivot groups so poses are animated procedurally until
// real glTF clips exist. Everything it wears comes from the player's Appearance (shared/appearance.ts).
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

/** A darker (k < 1) or lighter (k > 1) shade of a color: collars, cuffs, soles. */
const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k).getHex();

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
    const limbW = 1 + (w - 1) * 0.6;
    const depth = 1 + (w - 1) * 0.8;
    const { roupas } = look;
    const skin = toon(look.pele);
    const shirt = toon(roupas.camiseta.cor);
    const bottom = toon(roupas.baixo.cor);
    const dark = toon(DARK);
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

    // --- Legs hang from hip pivots: thigh, shin, shoe. Pants cover both, shorts the thigh, skirts neither.
    const bottomId = roupas.baixo.id;
    const pants = bottomId.startsWith('calca');
    const shorts = bottomId.startsWith('bermuda');
    const skirt = bottomId.startsWith('saia');
    const legs = [
      [this.legL, -0.14, stats.missing.legL],
      [this.legR, 0.14, stats.missing.legR],
    ] as const;
    for (const [leg, x, missing] of legs) {
      leg.position.set(x, 0, 0);
      this.hips.add(leg);
      const thighMat = skirt ? skin : bottom;
      if (missing) {
        // PCD: only a short stump of the thigh.
        mesh(new THREE.CapsuleGeometry(0.12 * limbW, 0.06, 4, 8), thighMat, leg, 0, -0.1, 0);
        continue;
      }
      mesh(new THREE.CapsuleGeometry((shorts ? 0.128 : 0.12) * limbW, 0.22, 4, 8), thighMat, leg, 0, -0.2, 0);
      mesh(new THREE.CapsuleGeometry(0.11 * limbW, 0.22, 4, 8), pants ? bottom : skin, leg, 0, -0.52, 0);
      this.legDetail(leg, x < 0 ? -1 : 1, bottomId, roupas.baixo.cor, limbW, mesh);
      this.shoe(leg, roupas.sapatos.id, roupas.sapatos.cor, skin, mesh);
    }

    // Pelvis: the waist of pants and shorts, or the skirt.
    if (skirt) {
      const [top, bot, h, y, seg] =
        bottomId === 'saiaLapis' ? [0.27, 0.29, 0.5, -0.17, 16] : bottomId === 'saiaRodada' ? [0.27, 0.42, 0.36, -0.1, 20] : [0.27, 0.4, 0.36, -0.1, 10];
      let geo: THREE.BufferGeometry = new THREE.CylinderGeometry(top * w, bot * w, h, seg);
      if (bottomId === 'saiaPregas') {
        // Pleats: faceted sides (flat normals on every face).
        geo = geo.toNonIndexed();
        geo.computeVertexNormals();
      }
      mesh(geo, bottom, this.hips, 0, y, 0).scale.z = 0.85 * depth;
    } else {
      mesh(new THREE.CylinderGeometry(0.27 * w, 0.26 * w, 0.22, 16), bottom, this.hips, 0, 0.02, 0).scale.z = 0.8 * depth;
      if (bottomId === 'calcaJeans' || bottomId === 'bermudaJeans') mesh(new THREE.BoxGeometry(0.56 * w, 0.045, 0.44 * depth), toon(0x3a2a1a), this.hips, 0, 0.12, 0);
    }

    // --- Torso: the shirt, wider and deeper with the build (and a belly for the heaviest one).
    this.torso.position.y = 0.05;
    this.hips.add(this.torso);
    mesh(new THREE.CapsuleGeometry(0.26, 0.48, 4, 12), shirt, this.torso, 0, 0.28, 0).scale.set((female ? 1.02 : 1.15) * w, 1, 0.8 * depth);
    if (look.biotipo === 'gordo') mesh(new THREE.SphereGeometry(0.28, 14, 10), shirt, this.torso, 0, 0.12, -0.1).scale.set(1.1, 0.95, 0.9);
    if (roupas.camiseta.id === 'polo') {
      const collarMat = toon(shade(roupas.camiseta.cor, 0.75));
      mesh(new THREE.TorusGeometry(0.13, 0.035, 6, 14), collarMat, this.torso, 0, 0.66, 0).rotation.x = Math.PI / 2;
      mesh(new THREE.BoxGeometry(0.05, 0.14, 0.02), collarMat, this.torso, 0, 0.55, -0.21 * depth);
    }
    this.rifleBack = mesh(new THREE.BoxGeometry(0.14, 0.5, 0.08), dark, this.torso, 0.1, 0.35, 0.26 * depth);
    this.rifleBack.rotation.z = 0.5;

    // --- Arms hang from shoulder pivots: sleeve (bare with a tank top), forearm, hand. PCD removes the
    // whole arm (a stump stays) or only the hand. The bracelet goes on the left wrist, or the right one
    // when the left hand is missing.
    const shoulder = (female ? 0.33 : 0.36) * (1 + (w - 1) * 0.7);
    const sleeve = roupas.camiseta.id === 'regata' ? skin : shirt;
    const braceletLeft = !stats.missing.handL;
    const arms = [
      [this.armL, -shoulder, stats.missing.armL, stats.missing.handL, true],
      [this.armR, shoulder, stats.missing.armR, stats.missing.handR, false],
    ] as const;
    for (const [arm, x, noArm, noHand, left] of arms) {
      arm.position.set(x, 0.55, 0);
      this.torso.add(arm);
      if (noArm) {
        mesh(new THREE.CapsuleGeometry(0.09 * limbW, 0.04, 4, 8), sleeve, arm, 0, -0.06, 0);
        continue;
      }
      mesh(new THREE.CapsuleGeometry(0.088 * limbW, 0.16, 4, 8), sleeve, arm, 0, -0.14, 0);
      mesh(new THREE.CapsuleGeometry(0.078 * limbW, 0.18, 4, 8), skin, arm, 0, -0.37, 0);
      if (!noHand) mesh(new THREE.SphereGeometry(0.1 * limbW, 10, 8), skin, arm, 0, -0.55, 0);
      if (left === braceletLeft && roupas.pulseira.id) this.bracelet(arm, roupas.pulseira.id, roupas.pulseira.cor, limbW, mesh);
    }

    // Rifle held in front of the chest (hidden while dancing, when it goes on the back).
    this.rifleHands.position.set(0.08, 0.42, -0.36);
    mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark, this.rifleHands);
    mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), dark, this.rifleHands, 0, 0.02, -0.44);
    mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), toon(0x6b5a45), this.rifleHands, 0, -0.1, -0.05);
    this.torso.add(this.rifleHands);

    // --- Head: skin, hair, lipstick, then hat and glasses on top.
    this.head.position.y = 0.78;
    this.torso.add(this.head);
    mesh(new THREE.SphereGeometry(0.25, 16, 12), skin, this.head, 0, 0.02, 0);
    this.hair(look.cabelo.id, toon(look.cabelo.cor), mesh);
    if (female) mesh(new THREE.BoxGeometry(0.09, 0.025, 0.02), toon(0xd9606e), this.head, 0, -0.11, -0.238);
    this.hat(roupas.chapeu.id, roupas.chapeu.cor, look.cabelo.id === 'blackPower', mesh);
    this.glasses(roupas.oculos.id, roupas.oculos.cor, mesh);

    this.root.visible = false;
    scene.add(this.root);
  }

  private legDetail(leg: THREE.Group, side: -1 | 1, id: string, cor: string, limbW: number, mesh: MeshFn) {
    if (id === 'calcaCargo') mesh(new THREE.BoxGeometry(0.06, 0.12, 0.14), toon(shade(cor, 0.7)), leg, side * 0.12 * limbW, -0.24, 0);
    if (id === 'calcaMoletom') mesh(new THREE.TorusGeometry(0.1 * limbW, 0.03, 6, 12), toon(shade(cor, 1.35)), leg, 0, -0.68, 0).rotation.x = Math.PI / 2;
    if (id === 'bermudaPraia' || id === 'bermudaJeans') {
      const hem = toon(id === 'bermudaPraia' ? WHITE : shade(cor, 0.7));
      mesh(new THREE.TorusGeometry(0.125 * limbW, 0.025, 6, 12), hem, leg, 0, -0.31, 0).rotation.x = Math.PI / 2;
    }
    if (id === 'bermudaEsportiva') mesh(new THREE.BoxGeometry(0.02, 0.24, 0.05), toon(WHITE), leg, side * 0.128 * limbW, -0.2, 0);
  }

  private shoe(leg: THREE.Group, id: string, cor: string, skin: THREE.Material, mesh: MeshFn) {
    const mat = toon(cor);
    if (id === 'bota') {
      mesh(new THREE.BoxGeometry(0.22, 0.24, 0.3), mat, leg, 0, -0.7, -0.03);
      mesh(new THREE.BoxGeometry(0.23, 0.04, 0.32), toon(shade(cor, 0.6)), leg, 0, -0.8, -0.03);
    } else if (id === 'chinelo') {
      mesh(new THREE.BoxGeometry(0.15, 0.07, 0.26), skin, leg, 0, -0.76, -0.05);
      mesh(new THREE.BoxGeometry(0.19, 0.025, 0.3), mat, leg, 0, -0.81, -0.05);
      mesh(new THREE.BoxGeometry(0.16, 0.02, 0.03), mat, leg, 0, -0.73, -0.1);
    } else {
      mesh(new THREE.BoxGeometry(0.2, 0.1, 0.3), mat, leg, 0, -0.76, -0.04);
      mesh(new THREE.BoxGeometry(0.21, 0.03, 0.31), toon(WHITE), leg, 0, -0.81, -0.04);
    }
  }

  private bracelet(arm: THREE.Group, id: string, cor: string, limbW: number, mesh: MeshFn) {
    const y = -0.45;
    const r = 0.085 * limbW;
    if (id === 'micangas') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        mesh(new THREE.SphereGeometry(0.022, 6, 5), toon(i % 2 ? cor : WHITE), arm, Math.cos(a) * r, y, Math.sin(a) * r);
      }
      return;
    }
    mesh(new THREE.TorusGeometry(r, id === 'relogio' ? 0.018 : 0.022, 6, 14), toon(cor), arm, 0, y, 0).rotation.x = Math.PI / 2;
    if (id === 'relogio') {
      mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), toon(DARK), arm, 0, y, -r - 0.005);
      mesh(new THREE.BoxGeometry(0.05, 0.035, 0.005), toon(WHITE), arm, 0, y, -r - 0.017);
    }
  }

  private hair(id: string, mat: THREE.Material, mesh: MeshFn) {
    // Top cap shared by most styles: the upper half of a sphere, tilted back so it covers more of the back.
    const cap = () => {
      const c = mesh(new THREE.SphereGeometry(0.265, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat, this.head, 0, 0, 0.02);
      c.rotation.x = -0.35;
      c.scale.set(1.04, 1, 1.04);
    };
    switch (id) {
      case 'curto':
        cap();
        break;
      case 'topete':
        cap();
        mesh(new THREE.SphereGeometry(0.12, 10, 8), mat, this.head, 0, 0.23, -0.12).scale.set(1.4, 0.8, 1.2);
        break;
      case 'blackPower':
        mesh(new THREE.SphereGeometry(0.36, 16, 12), mat, this.head, 0, 0.12, 0.06);
        break;
      case 'longo':
        cap();
        mesh(new THREE.BoxGeometry(0.46, 0.5, 0.12), mat, this.head, 0, -0.22, 0.2);
        for (const x of [-0.235, 0.235]) mesh(new THREE.CapsuleGeometry(0.05, 0.3, 3, 8), mat, this.head, x, -0.14, -0.04);
        break;
      case 'coque':
        cap();
        mesh(new THREE.SphereGeometry(0.11, 12, 10), mat, this.head, 0, 0.22, 0.17);
        break;
      default: {
        // 'rabo': hair over the back and sides, locks framing the face and a ponytail.
        mesh(new THREE.SphereGeometry(0.262, 16, 12), mat, this.head, 0, 0, 0.05).scale.set(1.03, 0.95, 0.96);
        for (const x of [-0.225, 0.225]) mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), mat, this.head, x, -0.08, -0.07);
        mesh(new THREE.CapsuleGeometry(0.075, 0.28, 4, 8), mat, this.head, 0, -0.14, 0.33).rotation.x = 0.45;
      }
    }
  }

  private hat(id: string, cor: string, bigHair: boolean, mesh: MeshFn) {
    if (!id) return;
    const hat = new THREE.Group();
    this.head.add(hat);
    // Over a black power the hat sits higher and wider.
    if (bigHair) {
      hat.position.set(0, 0.14, 0.04);
      hat.scale.setScalar(1.3);
    }
    const mat = toon(cor);
    if (id === 'bone') {
      // Backwards cap.
      mesh(new THREE.CylinderGeometry(0.255, 0.26, 0.14, 16), mat, hat, 0, 0.16, 0);
      mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), mat, hat, 0, 0.1, 0.3);
    } else if (id === 'palha') {
      mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.02, 20), mat, hat, 0, 0.14, 0);
      mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.18, 16), mat, hat, 0, 0.24, 0);
      mesh(new THREE.CylinderGeometry(0.242, 0.242, 0.04, 16), toon(shade(cor, 0.5)), hat, 0, 0.18, 0);
    } else {
      // Beanie with a pompom.
      mesh(new THREE.SphereGeometry(0.275, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat, hat, 0, 0.04, 0);
      mesh(new THREE.TorusGeometry(0.265, 0.035, 6, 18), toon(shade(cor, 0.8)), hat, 0, 0.05, 0).rotation.x = Math.PI / 2;
      mesh(new THREE.SphereGeometry(0.065, 10, 8), toon(WHITE), hat, 0, 0.33, 0);
    }
  }

  private glasses(id: string, cor: string, mesh: MeshFn) {
    if (!id) return;
    const mat = toon(cor);
    if (id === 'escuros') {
      mesh(new THREE.BoxGeometry(0.36, 0.08, 0.04), mat, this.head, 0, 0.05, -0.235);
      return;
    }
    for (const x of [-0.085, 0.085]) {
      if (id === 'redondos') {
        mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 14), mat, this.head, x, 0.05, -0.245);
      } else {
        // Aviators: tinted drop lenses with a thin rim.
        mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(0x3a4a5a), this.head, x, 0.045, -0.235).scale.set(1, 0.8, 0.3);
        mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 14), mat, this.head, x, 0.045, -0.245).scale.y = 0.8;
      }
    }
    mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), mat, this.head, 0, 0.06, -0.25);
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

  /** Standing still with the rifle on the back and the arms relaxed (profile preview). */
  idle() {
    this.resetBody();
    this.hips.position.y = 0.82;
    this.rifleHands.visible = false;
    this.rifleBack.visible = true;
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
