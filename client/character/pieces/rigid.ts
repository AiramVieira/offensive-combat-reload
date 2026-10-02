// Rigid items on sockets: hats and glasses (head), bracelets (wrist), the rifle (hand, back). Hats and
// glasses are built over the head's surface in character space and moved into the head bone's space, so
// they fit the face they sit on.
import * as THREE from 'three';
import type { Sex } from '@shared/protocol';
import type { PieceGeometry } from '.';
import { headShape, headShell } from '../body';
import { FacetBuilder, M, RigidBuilder } from '../builder';
import { darker, DETAIL, fixed, PRIMARY, SECONDARY } from '../palette';
import { restPosition } from '../rig';

const deg = (d: number) => (d * Math.PI) / 180;
const FRONT = Math.PI / 2;

/** Moves a character-space build into the head bone's space and drops the skinning. */
export function toHeadSpace(b: FacetBuilder, sex: Sex): THREE.BufferGeometry {
  const g = b.build();
  g.morphAttributes = {};
  const head = restPosition('head', sex);
  g.translate(-head.x, -head.y, -head.z);
  return g;
}

/** Hats, in the head bone's space. */
export function hat(id: string, sex: Sex): PieceGeometry {
  const h = headShape(sex);
  const b = new FacetBuilder(id.length * 53 + 2);
  if (id === 'bone') {
    // Cap: 6-panel crown over the skull, a curved bill to the front, a button on top.
    headShell(b, h, { y0: 1.705, y1: 1.79, rows: 3, cols: 12, d: (y) => 0.025 + (y - 1.705) * 0.04, paint: (_y, a) => (Math.sin(a * 3) > 0.94 ? darker(PRIMARY, 1) : PRIMARY), region: 'none', closeTop: true, rim: 0.006 });
    const front = h.point(1.712, FRONT, 0.026);
    // Bill: a curved plate (two rows bent down at the sides).
    const rows = [0, 0.045, 0.085];
    const cols = 7;
    const ids: number[][] = [];
    for (const r of rows) {
      const line: number[] = [];
      for (let i = 0; i < cols; i++) {
        const u = i / (cols - 1) - 0.5;
        const p = new THREE.Vector3(u * (0.15 - r * 0.25), front.y - Math.abs(u) * 0.022 - r * 0.12, front.z - r - (r === 0 ? -0.012 : 0) + Math.abs(u) * 0.02);
        line.push(b.vertex(p, [['head', 1]]));
      }
      ids.push(line);
    }
    for (let j = 0; j < rows.length - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        // Top of the bill faces up; the underside (a copy below) faces down, darker.
        b.quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i], SECONDARY, 'none');
        b.quad(ids[j][i], ids[j + 1][i], ids[j + 1][i + 1], ids[j][i + 1], darker(SECONDARY, 3), 'none', -1);
      }
    }
    const topP = h.point(1.79, FRONT, 0.022);
    b.append(new THREE.SphereGeometry(0.012, 5, 3), M(0, topP.y + 0.012, 0.012), [['head', 1]], 'none', SECONDARY);
  } else if (id === 'palha') {
    // Straw hat: wide brim, tall crown, a band in the secondary color.
    b.append(new THREE.CylinderGeometry(0.25, 0.26, 0.012, 14), M(0, 1.735, 0.006), [['head', 1]], 'none', PRIMARY);
    b.append(new THREE.CylinderGeometry(0.105, 0.125, 0.11, 10), M(0, 1.795, 0.006), [['head', 1]], 'none', PRIMARY);
    b.append(new THREE.CylinderGeometry(0.127, 0.127, 0.028, 10), M(0, 1.756, 0.006), [['head', 1]], 'none', SECONDARY);
    b.append(new THREE.CylinderGeometry(0.06, 0.104, 0.02, 10), M(0, 1.858, 0.006), [['head', 1]], 'none', PRIMARY);
  } else {
    // Beanie: a thick shell with a folded cuff and a pompom.
    headShell(b, h, { y0: 1.69, y1: 1.79, rows: 3, cols: 12, d: (y) => 0.025 + (y - 1.69) * 0.06, paint: PRIMARY, region: 'none', closeTop: true });
    headShell(b, h, { y0: 1.672, y1: 1.712, rows: 1, cols: 12, d: () => 0.03, paint: SECONDARY, region: 'none', rim: 0.008 });
    b.append(new THREE.SphereGeometry(0.036, 6, 4), M(0, 1.845, 0.01), [['head', 1]], 'none', DETAIL);
  }
  return { rigid: toHeadSpace(b, sex) };
}

/** Glasses, in the head bone's space: lenses in front of the eyes, temples back to the ears. */
export function glasses(id: string, sex: Sex): PieceGeometry {
  const h = headShape(sex);
  const b = new FacetBuilder(id.length * 59 + 4);
  const y = 1.672;
  const lensZ = h.point(y, FRONT + deg(18), 0).z - 0.014;
  const frame = PRIMARY;
  for (const s of [-1, 1]) {
    const x = s * 0.034;
    if (id === 'escuros') {
      b.append(new THREE.BoxGeometry(0.05, 0.03, 0.005), M(x, y, lensZ, 0, s * 0.12, 0), [['head', 1]], 'none', fixed('lensDark'));
      b.append(new THREE.BoxGeometry(0.054, 0.006, 0.007), M(x, y + 0.016, lensZ, 0, s * 0.12, 0), [['head', 1]], 'none', frame);
    } else if (id === 'redondos') {
      // Clear lenses: just the frame (an opaque lens would read as a white disc).
      b.append(new THREE.TorusGeometry(0.019, 0.003, 4, 10), M(x, y, lensZ, 0, s * 0.12, 0), [['head', 1]], 'none', frame);
    } else {
      // Aviators: teardrop lenses and a double bridge.
      b.append(new THREE.SphereGeometry(1, 8, 4), M(x, y - 0.004, lensZ, 0, s * 0.12, 0, 0.025, 0.021, 0.004), [['head', 1]], 'none', SECONDARY);
      b.append(new THREE.TorusGeometry(0.023, 0.0022, 4, 10), M(x, y - 0.004, lensZ - 0.001, 0, s * 0.12, 0, 1, 0.86, 1), [['head', 1]], 'none', frame);
    }
    // Temple back to the ear.
    const ear = h.point(1.665, s < 0 ? deg(180) : 0, 0.004);
    const from = new THREE.Vector3(s * 0.062, y + 0.006, lensZ + 0.008);
    const mid = from.clone().lerp(ear, 0.5);
    const len = from.distanceTo(ear);
    b.append(new THREE.BoxGeometry(0.004, 0.004, len), new THREE.Matrix4().lookAt(from, ear, new THREE.Vector3(0, 1, 0)).setPosition(mid), [['head', 1]], 'none', frame);
  }
  b.append(new THREE.BoxGeometry(0.02, 0.004, 0.004), M(0, y + 0.006, lensZ - 0.003), [['head', 1]], 'none', frame);
  return { rigid: toHeadSpace(b, sex) };
}

/** Bracelets, in the wrist socket's space (the forearm runs along X). */
export function bracelet(id: string): PieceGeometry {
  const r = new RigidBuilder(id.length * 61);
  if (id === 'micangas') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      r.add(new THREE.SphereGeometry(0.0075, 4, 3), M(0, Math.cos(a) * 0.035, Math.sin(a) * 0.035), i % 2 ? PRIMARY : DETAIL);
    }
  } else {
    r.add(new THREE.TorusGeometry(0.034, id === 'relogio' ? 0.005 : 0.0065, 4, 10), M(0, 0, 0, 0, Math.PI / 2, 0));
    if (id === 'relogio') {
      // Watch face on the back of the wrist (up in T-pose).
      r.add(new THREE.CylinderGeometry(0.014, 0.014, 0.007, 8), M(0, 0.037, 0), SECONDARY);
      r.add(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 8), M(0, 0.041, 0), DETAIL);
    }
  }
  return { rigid: r.build() };
}

/** The rifle: barrel along -Z, grip at the origin (model space; the item's grip places it in the hand). */
export function rifle(): PieceGeometry {
  const r = new RigidBuilder(97);
  r.add(new THREE.BoxGeometry(0.045, 0.07, 0.34), M(0, 0.035, -0.09));
  r.add(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), M(0, 0.05, -0.4, Math.PI / 2, 0, 0), fixed('gunmetal'));
  r.add(new THREE.BoxGeometry(0.05, 0.055, 0.16), M(0, 0.03, -0.24), SECONDARY);
  r.add(new THREE.BoxGeometry(0.04, 0.085, 0.18), M(0, 0.015, 0.16, 0.12, 0, 0), SECONDARY);
  r.add(new THREE.BoxGeometry(0.034, 0.08, 0.04), M(0, -0.035, 0.005, 0.25, 0, 0), SECONDARY);
  r.add(new THREE.BoxGeometry(0.03, 0.1, 0.05), M(0, -0.045, -0.1, -0.15, 0, 0), fixed('gunmetal'));
  r.add(new THREE.BoxGeometry(0.012, 0.02, 0.1), M(0, 0.08, -0.06), DETAIL);
  return { rigid: r.build() };
}
