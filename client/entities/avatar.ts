// Third-person character for the game: the local player during humiliations, remote players, bots, corpses
// and the editor. A thin adapter over the modular Character system (client/character): it turns the
// player's saved Appearance into a CharacterConfig, bakes the result for the game (a few draw calls per
// character) and animates it procedurally (CharacterAnimator).
import * as THREE from 'three';
import { sanitizeFace, type Appearance, type ItemChoice } from '@shared/appearance';
import { catalogItem, type Slot } from '@shared/catalog';
import type { Sex } from '@shared/protocol';
import { bodyStats } from '@shared/appearance';
import { DEFAULT_LOADOUT, type Loadout } from '@shared/progression';
import { CharacterAnimator, type AvatarPose } from '../character/animator';
import { Character, type CharacterConfig } from '../character/character';
import { heldGrenade, heldKnife, heldRifle } from './heldWeapons';

export type { AvatarPose };

/**
 * The saved look (Appearance, validated by the server) as a Character config: every item in its slot, its
 * colors as '<slot>' (primary), '<slot>.secondary' and '<slot>.detail'.
 */
export function appearanceToConfig(look: Appearance, sex: Sex): CharacterConfig {
  const items: CharacterConfig['items'] = { hair: look.cabelo.id, beard: look.barba || null, weapon_R: 'rifle', weapon_back: 'rifle_costas' };
  const colors: Record<string, string> = { skin: look.pele, eyes: look.olhos, hair: look.cabelo.cor };
  for (const [slot, c] of Object.entries(look.itens) as [Slot, ItemChoice][]) {
    items[slot] = c.id;
    const it = catalogItem(c.id);
    it?.channels.forEach((ch, i) => {
      const key = ch === 'P' ? slot : `${slot}.${ch === 'S' ? 'secondary' : 'detail'}`;
      if (c.cores[i]) colors[key] = c.cores[i];
    });
  }
  return {
    v: 1,
    sex,
    items,
    colors,
    eyes: { style: look.olhosEstilo },
    // Looks saved before the face's features have none: the defaults.
    face: sanitizeFace(look.rosto),
    build: { height: look.altura, build: look.biotipo },
    pcd: { braco: look.pcd.braco, perna: look.pcd.perna },
  };
}

/** Animation LOD (style guide): the camera the game renders with, and its frustum this frame. */
const lodCam = { pos: new THREE.Vector3(), frustum: new THREE.Frustum(), active: false };
const lodSphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
const lodM = new THREE.Matrix4();

export class Avatar {
  readonly character: Character;
  readonly root: THREE.Group;
  private animator: CharacterAnimator;
  private lodFrame = 0;
  private lodDt = 0;
  /** The equipped levels' models in the hands (rifle in the hands and on the back, knife, grenade). */
  private held: THREE.Object3D[] = [];
  private knife: THREE.Object3D | null = null;
  private grenade: THREE.Object3D | null = null;

  /**
   * The game's camera, once per frame: avatars past 30 m update their pose every 2 frames, past 60 m every
   * 4, and not at all outside the view (style guide, animation LOD). Without it, every pose runs.
   */
  static setCamera(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    lodCam.pos.setFromMatrixPosition(camera.matrixWorld);
    lodCam.frustum.setFromProjectionMatrix(lodM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    lodCam.active = true;
  }

  /** The time to animate by now, or null to skip this frame (the skipped time is caught up later). */
  private lod(dt: number): number | null {
    if (!lodCam.active) return dt;
    this.lodDt += dt;
    lodSphere.center.copy(this.root.position).y += 0.9;
    if (!lodCam.frustum.intersectsSphere(lodSphere)) return null;
    const d = this.root.position.distanceTo(lodCam.pos);
    const every = d > 60 ? 4 : d > 30 ? 2 : 1;
    if (++this.lodFrame % every !== 0) return null;
    const out = Math.min(0.25, this.lodDt);
    this.lodDt = 0;
    return out;
  }

  constructor(
    scene: THREE.Object3D,
    readonly look: Appearance,
    readonly sex: Sex = 'm',
    /** Merge into one mesh (the game). The editor keeps it live to change it piece by piece. */
    opts: { bake?: boolean } = {},
  ) {
    this.character = new Character(appearanceToConfig(look, sex));
    this.root = this.character.root;
    this.animator = new CharacterAnimator(this.character);
    this.animator.idle();
    if (opts.bake ?? true) this.character.bake();
    this.setLoadout(DEFAULT_LOADOUT);
    this.root.visible = false;
    scene.add(this.root);
  }

  /**
   * The weapons of a loadout (equipped levels): the rifle model replaces the generic one in the hands and on
   * the back; the knife and the grenade wait in the hands, shown only while used. Other players see exactly
   * what this player equipped.
   */
  setLoadout(lo: Loadout) {
    for (const o of this.held) o.removeFromParent();
    this.held = [];
    for (const slot of ['weapon_R', 'weapon_back'] as const) {
      for (const o of this.character.objectsOf(slot)) {
        // The generic rifle stays as the holder (grip, PCD hand swap, visibility); it just isn't drawn.
        o.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (mesh.isMesh) (mesh.material as THREE.Material).visible = false;
        });
        const rifle = heldRifle(lo);
        o.add(rifle);
        this.held.push(rifle);
      }
    }
    const missing = bodyStats(this.look).missing;
    const knifeHand = missing.handR || missing.armR ? 'hand_L' : 'hand_R';
    const grenadeHand = missing.handL || missing.armL ? 'hand_R' : 'hand_L';
    this.knife = heldKnife(lo);
    this.knife.position.set(knifeHand === 'hand_R' ? 0.01 : -0.01, 0, 0);
    this.character.sockets[knifeHand].add(this.knife);
    this.grenade = heldGrenade();
    this.grenade.position.set(grenadeHand === 'hand_L' ? 0.01 : -0.01, -0.03, 0);
    this.character.sockets[grenadeHand].add(this.grenade);
    this.held.push(this.knife, this.grenade);
    this.showHeld(false, false);
  }

  private showHeld(knife: boolean, grenade: boolean) {
    if (this.knife) this.knife.visible = knife;
    if (this.grenade) this.grenade.visible = grenade;
  }

  /** A grenade thrown (the left arm swings it forward). */
  throwGrenade() {
    this.animator.throwGrenade();
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  get visible() {
    return this.root.visible;
  }

  /** Rifle in the hands (armed) or slung on the back. */
  private rifle(inHands: boolean) {
    for (const o of this.character.objectsOf('weapon_R')) o.visible = inHands;
    for (const o of this.character.objectsOf('weapon_back')) o.visible = !inHands;
  }

  /** Alive, armed: locomotion, aim offset, rifle in both hands, action layers (reload, knife, grenade). */
  pose(dt: number, s: AvatarPose) {
    // Knife: the rifle goes on the back and the knife comes out in the hand.
    this.rifle(!s.knife);
    const step = this.lod(dt);
    if (step !== null) this.animator.pose(step, s);
    this.showHeld(s.knife, this.animator.grenadeInHand);
  }

  /** A shot (recoil on the next poses). */
  fire() {
    this.animator.fire();
  }

  /** Hit by a bullet coming from `from` (world): the torso jerks along its path. */
  hitReact(from: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(this.root.position, from).setY(0);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
    this.animator.hitReact(dir);
  }

  /** "Dancinha da Vitória". */
  dance(t: number) {
    this.rifle(false);
    this.showHeld(false, false);
    this.animator.dance(t);
  }

  /** Stiff cartoon fall onto the back (`dir` 1) or face (-1). */
  die(t: number, dir: 1 | -1 = 1) {
    this.rifle(false);
    this.showHeld(false, false);
    this.animator.die(t, dir);
  }

  /** Standing still (profile preview); `rifle` shows it slung on the back. */
  idle(rifle = true, t = 0) {
    this.rifle(false);
    this.showHeld(false, false);
    for (const o of this.character.objectsOf('weapon_back')) o.visible = rifle;
    this.animator.idle(t);
  }

  /** Unarmed walk or run (editor preview). */
  walk(dt: number, speed: number) {
    this.rifle(false);
    this.showHeld(false, false);
    for (const o of this.character.objectsOf('weapon_back')) o.visible = false;
    this.animator.walk(dt, speed);
  }

  dispose() {
    this.character.dispose();
  }
}

export function disposeAvatar(a: Avatar) {
  a.dispose();
}
