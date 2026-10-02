// Aim assist (client/gameplay/aimAssist.ts): slows the look over a body, follows a moving target only while the
// player is aiming, ignores what's off to the side and the dead.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AimAssist, ASSIST } from '../gameplay/aimAssist';

const eye = new THREE.Vector3(0, 1.6, 0);
const target = (x: number, z: number, dead = false) => ({ position: new THREE.Vector3(x, 0, z), dead });

describe('assistência de mira', () => {
  it('desacelera a mira sobre um inimigo à frente', () => {
    const r = new AimAssist().update(eye, 0, 0, [target(0, -20)], 1 / 60, true);
    expect(r.slow).toBeCloseTo(ASSIST.slow, 2);
  });

  it('não faz nada com um inimigo fora da mira ou morto', () => {
    expect(new AimAssist().update(eye, 0, 0, [target(8, -20)], 1 / 60, true).slow).toBe(1);
    expect(new AimAssist().update(eye, 0, 0, [target(0, -20, true)], 1 / 60, true).slow).toBe(1);
  });

  it('acompanha um alvo que anda para o lado só enquanto o jogador mira', () => {
    const a = new AimAssist();
    const t = target(0, -20);
    a.update(eye, 0, 0, [t], 1 / 60, true);
    t.position.x += 0.05; // walking to the right (+X): the view must turn right (negative yaw)
    const r = a.update(eye, 0, 0, [t], 1 / 60, true);
    expect(r.dYaw).toBeLessThan(0);
    const idle = new AimAssist();
    const t2 = target(0, -20);
    idle.update(eye, 0, 0, [t2], 1 / 60, false);
    t2.position.x += 0.05;
    expect(idle.update(eye, 0, 0, [t2], 1 / 60, false).dYaw).toBe(0);
  });

  it('nunca puxa a mira de longe até um inimigo', () => {
    const a = new AimAssist();
    const t = target(5, -20);
    a.update(eye, 0, 0, [t], 1 / 60, true);
    t.position.x += 0.05;
    expect(a.update(eye, 0, 0, [t], 1 / 60, true).dYaw).toBe(0);
  });
});
