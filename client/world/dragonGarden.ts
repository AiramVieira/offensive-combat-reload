// "Jardim do Dragão": 80 x 60 m Chinese garden, the same size as "Rua dos Vizinhos".
// North: the two-story tea house (paper walls, a balcony on three sides, the gong inside), the three-story
// pagoda (NW) and a two-story pavilion (NE). Center: the koi pond with the dragon fountain on its island,
// two zigzag bridges, an arched bridge and stepping stones. West: spawn court behind the paifang gate.
// East: spawn court behind the moon gate. South: a rock hill with a pavilion on top, cloud pines, bamboo,
// a tiered fountain, the covered corridor with paper screens and a two-story pavilion (SE).
// Paper walls are shot through; lanterns swing, the gong booms and the dragon breathes fire when shot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, toonGradient } from '../render/materials';
import type { Physics } from './physics';
import { MapBuilder, stairRun } from './mapBuilder';
import { WaterDrops } from './hydrant';
import { PropBus } from './props';
import { surfaceMaterial } from './surfaces';
import { skyClouds } from './decor';
import { bamboo, bonsai, column, curvedRoof, dragonGeometry, dragonMaterial, FireBreath, Gong, Koi, Lanterns, moonGateWall, ORIENTAL as C, paperWall, pavilion, pine, railing, rock, seeded, stoneLantern, wallCap, type DragonColors } from './oriental';
import type { GameMap, MapFrame, SpawnPoint } from './blockoutMap';

export interface GardenSfx {
  gong(): void;
  roar(): void;
  lanternTap(): void;
  ambientBird(): void;
}

const JADE: DragonColors = { body: 0x2fae7a, bodyDark: 0x23895f, belly: 0xf2d98a, spikes: 0xe7b847, horns: 0xf2d98a };
const CRIMSON: DragonColors = { body: 0xd33a2c, bodyDark: 0xa82a20, belly: 0xf2d98a, spikes: 0xe7b847, horns: 0xf2d98a };

export async function buildDragonGardenMap(physics: Physics, scene: THREE.Scene, sfx: GardenSfx): Promise<GameMap> {
  const b = new MapBuilder(physics, scene);
  const W = 40; // half extent X
  const D = 30; // half extent Z
  const animated: ((dt: number, frame: MapFrame) => void)[] = [];
  const props = new PropBus();
  const lanterns = new Lanterns();
  const glow: THREE.BufferGeometry[] = [];
  // Same seed on every client: rocks and trees collide identically online.
  const rand = seeded(8128);
  const stoneFloor = { tint: C.stone, collide: false, castShadow: false };

  // --- Ground with the pond (x -15..13, z -9..9, 0.8 m deep) -----------------------------------------
  const POND = { x0: -15, x1: 13, z0: -9, z1: 9 };
  const G = -3;
  const grass = { tint: 0x86c45a, castShadow: false };
  b.span(-W, G, -D, W, 0, POND.z0, 'grama', grass);
  b.span(-W, G, POND.z1, W, 0, D, 'grama', grass);
  b.span(-W, G, POND.z0, POND.x0, 0, POND.z1, 'grama', grass);
  b.span(POND.x1, G, POND.z0, W, 0, POND.z1, 'grama', grass);
  b.span(POND.x0, -1.1, POND.z0, POND.x1, -0.8, POND.z1, 'pedra', { tint: 0x6f7d6a, castShadow: false });
  const lining = { tint: 0x7d8178, collide: false, castShadow: false };
  b.span(POND.x0, -0.8, POND.z0, POND.x0 + 0.03, 0, POND.z1, 'pedra', lining);
  b.span(POND.x1 - 0.03, -0.8, POND.z0, POND.x1, 0, POND.z1, 'pedra', lining);
  b.span(POND.x0, -0.8, POND.z0, POND.x1, 0, POND.z0 + 0.03, 'pedra', lining);
  b.span(POND.x0, -0.8, POND.z1 - 0.03, POND.x1, 0, POND.z1, 'pedra', lining);
  // Stone coping around the edge, and steps out of the water (jumping out works too).
  const cope = { tint: C.stone };
  b.span(POND.x0 - 0.5, 0, POND.z0 - 0.5, POND.x1 + 0.5, 0.12, POND.z0, 'pedra', cope);
  b.span(POND.x0 - 0.5, 0, POND.z1, POND.x1 + 0.5, 0.12, POND.z1 + 0.5, 'pedra', cope);
  b.span(POND.x0 - 0.5, 0, POND.z0, POND.x0, 0.12, POND.z1, 'pedra', cope);
  b.span(POND.x1, 0, POND.z0, POND.x1 + 0.5, 0.12, POND.z1, 'pedra', cope);
  b.stairs('z', -1, POND.z0 + stairRun(0.8), 6, 8, -0.8, 0.8, 'pedra', cope);
  b.stairs('z', 1, POND.z1 - stairRun(0.8), -8, -6, -0.8, 0.8, 'pedra', cope);
  const waterMat = new THREE.MeshToonMaterial({ color: 0x3fa49c, transparent: true, opacity: 0.72, gradientMap: toonGradient() });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(POND.x1 - POND.x0, POND.z1 - POND.z0).rotateX(-Math.PI / 2), waterMat);
  water.position.set((POND.x0 + POND.x1) / 2, -0.25, (POND.z0 + POND.z1) / 2);
  water.receiveShadow = true;
  scene.add(water);

  // Lily pads and lotus flowers.
  const paint = surfaceMaterial('pintura');
  const pads: [number, number, boolean][] = [
    [-12, -6, true], [-10.5, -7.3, false], [-8.2, 6.6, true], [-11.5, 5, false], [-13.2, 2.8, false], [-9, 3.4, true], [-6.6, -5.2, false],
    [6, 5.6, false], [8.3, 7.1, true], [10.6, 3.1, false], [11.6, -5, true], [9.1, -7.3, false], [5.5, -6.9, true], [11.8, 6.8, false],
  ];
  for (const [x, z, flower] of pads) {
    const pad = new THREE.CylinderGeometry(0.42, 0.42, 0.02, 12, 1, false, 0.4, Math.PI * 2 - 0.8).translate(x, -0.235, z);
    b.addGeometry(pad, paint, 0x4f9e3a, false);
    if (flower) b.addGeometry(new THREE.ConeGeometry(0.13, 0.2, 6).translate(x + 0.1, -0.14, z), paint, 0xff8fb8, false);
  }
  const koi = new Koi(scene, [[-10, -4.5, 2.5], [-9, 4.5, 2], [-12.5, -1, 1.4], [8.5, -5, 2.6], [9, 5, 2.2], [6.5, -6.6, 1.2]], -0.5, rand);
  animated.push((dt) => koi.update(dt));

  // --- Island with the dragon fountain ---------------------------------------------------------------
  const ISLAND = { x0: -4, x1: 4, z0: -3, z1: 3 };
  b.span(ISLAND.x0, -0.8, ISLAND.z0, ISLAND.x1, 0.3, ISLAND.z1, 'pedra', { tint: C.stone });
  const trim = { tint: C.stoneDark, collide: false, castShadow: false };
  b.span(ISLAND.x0 - 0.05, 0.16, ISLAND.z0 - 0.05, ISLAND.x1 + 0.05, 0.28, ISLAND.z0 + 0.3, 'pintura', trim);
  b.span(ISLAND.x0 - 0.05, 0.16, ISLAND.z1 - 0.3, ISLAND.x1 + 0.05, 0.28, ISLAND.z1 + 0.05, 'pintura', trim);
  b.span(ISLAND.x0 - 0.05, 0.16, ISLAND.z0, ISLAND.x0 + 0.3, 0.28, ISLAND.z1, 'pintura', trim);
  b.span(ISLAND.x1 - 0.3, 0.16, ISLAND.z0, ISLAND.x1 + 0.05, 0.28, ISLAND.z1, 'pintura', trim);
  // Round basin: a ring of stone blocks you can wade into.
  const basin = { r: 2.0, y0: 0.3, h: 0.55, water: 0.72 };
  const ring = (cx: number, cz: number, r: number, y0: number, h: number, segs: number) => {
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      b.box(cx + Math.cos(a) * r, y0 + h / 2, cz + Math.sin(a) * r, 0.35, h, ((2 * Math.PI * r) / segs) * 1.08, 'pedra', { tint: C.stone, rot: new THREE.Euler(0, -a, 0) });
    }
    const cap = new THREE.TorusGeometry(r, 0.21, 5, segs * 2).rotateX(Math.PI / 2).translate(cx, y0 + h, cz);
    b.addGeometry(cap, surfaceMaterial('pedra'), C.stone);
    cap.dispose();
  };
  const pool = (cx: number, cz: number, r: number, y: number) => {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2), waterMat);
    disc.position.set(cx, y, cz);
    scene.add(disc);
  };
  ring(0, 0, basin.r, basin.y0, basin.h, 18);
  pool(0, 0, basin.r - 0.1, basin.water);
  b.cylinder(0, basin.y0, 0, 0.32, 2.2, 'pedra', { tint: C.stoneDark, segments: 10 });

  // The dragon coils up the pillar and looks north, toward the tea house.
  const coil: THREE.Vector3[] = [];
  const turns = 1.6;
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    const a = u * turns * Math.PI * 2;
    coil.push(new THREE.Vector3(Math.cos(a) * 0.75, 0.55 + u * 1.9, Math.sin(a) * 0.75));
  }
  const aEnd = turns * Math.PI * 2;
  const look = aEnd + 1.2;
  coil.push(
    new THREE.Vector3(Math.cos(aEnd + 0.6) * 0.8, 2.85, Math.sin(aEnd + 0.6) * 0.8),
    new THREE.Vector3(Math.cos(look) * 0.3, 3.35, Math.sin(look) * 0.3),
    new THREE.Vector3(Math.cos(look) * 0.65, 3.45, Math.sin(look) * 0.65),
  );
  const fountain = dragonGeometry(coil, 0.2, JADE);
  const dragon = new THREE.Mesh(fountain.geo, dragonMaterial());
  dragon.castShadow = true;
  scene.add(dragon);
  // Shoot it and it roars fire; the rest of the time it spits water into the basin.
  const fire = new FireBreath(scene);
  const dragonShot = props.register('dragao', () => {
    if (!fire.active) sfx.roar();
    fire.start(fountain.mouth, fountain.forward.clone().setY(0.12));
  });
  b.cuboidCollider(new THREE.Vector3(0, 1.45, 0), new THREE.Vector3(0.95, 1.15, 0.95), new THREE.Quaternion(), 'concrete', dragonShot);
  b.ballCollider(fountain.mouth.clone().addScaledVector(fountain.forward, -0.35), 0.45, 'concrete', dragonShot);
  const drops = new WaterDrops(scene);
  let spout = 0;
  animated.push((dt) => {
    fire.update(dt);
    if (!fire.active) {
      spout += dt * 40;
      const f = fountain.forward;
      while (spout >= 1) {
        spout--;
        // A short arc up and out that falls back inside the basin.
        drops.emit(fountain.mouth, f.x * 0.4 + (Math.random() - 0.5) * 0.25, 2.6 + Math.random() * 0.8, f.z * 0.4 + (Math.random() - 0.5) * 0.25, basin.water);
      }
    }
  });

  // Rocks on the island corners and around the pond, some half in the water.
  for (const [x, z] of [[-3.3, -2.4], [3.3, -2.4], [3.3, 2.4], [-3.3, 2.4]]) rock(b, x, 0.3, z, 0.55, 0.6, 0.5, rand);
  for (const [x, z, s] of [
    [-12, -8.9, 1.3], [-6.5, -9.1, 1.0], [4, -9, 1.1], [10.6, -8.8, 1.4],
    [-12, 9, 1.2], [-4.4, 9.1, 0.9], [5, 9, 1.3], [10.2, 8.9, 1.0],
    [-15, -6, 1.1], [-15.1, 5, 1.3], [13, -6, 1.2], [13.1, 5.6, 1.0],
  ]) {
    rock(b, x, -0.6, z, s, s * 0.8, s * 0.75, rand);
  }

  // --- Bridges and stepping stones -------------------------------------------------------------------
  const deck = (x0: number, z0: number, x1: number, z1: number) => {
    b.span(x0, 0.15, z0, x1, 0.3, z1, 'madeira', { tint: C.wood });
    for (const [x, z] of [[x0 + 0.1, z0 + 0.1], [x1 - 0.1, z0 + 0.1], [x1 - 0.1, z1 - 0.1], [x0 + 0.1, z1 - 0.1]]) {
      b.cylinder(x, -0.8, z, 0.08, 0.95, 'madeira', { tint: C.woodDark, collide: false, segments: 6 });
    }
  };
  // Zigzag bridges, north (pond edge -> island) and its mirror south.
  for (const m of [1, -1]) {
    const seg = (x0: number, z0: number, x1: number, z1: number) => deck(Math.min(x0 * m, x1 * m), Math.min(z0 * m, z1 * m), Math.max(x0 * m, x1 * m), Math.max(z0 * m, z1 * m));
    seg(-2, -10.2, -0.2, -7);
    seg(-2, -7, 2, -5.2);
    seg(0.2, -5.2, 2, -2.6);
    const rail = (axis: 'x' | 'z', fixed: number, a: number, end: number) => railing(b, axis, fixed * m, Math.min(a * m, end * m), Math.max(a * m, end * m), 0.3, { h: 0.85 });
    rail('z', -1.95, -9, -5.2);
    rail('z', -0.25, -9, -7);
    rail('x', -6.95, -0.2, 2);
    rail('z', 1.95, -7, -3);
    rail('x', -5.25, -2, 0.2);
    rail('z', 0.25, -5.2, -3);
  }
  // Arched stone bridge, island -> east bank.
  const ramp = (xa: number, ya: number, xb: number, yb: number) => {
    const ang = Math.atan2(yb - ya, xb - xa);
    const len = Math.hypot(xb - xa, yb - ya) + 0.1;
    const mx = (xa + xb) / 2;
    const my = (ya + yb) / 2;
    const rot = new THREE.Euler(0, 0, ang);
    b.box(mx + 0.15 * Math.sin(ang), my - 0.15 * Math.cos(ang), 0, len, 0.3, 2.2, 'pedra', { tint: C.stone, rot });
    for (const z of [-1.03, 1.03]) b.box(mx - 0.35 * Math.sin(ang), my + 0.35 * Math.cos(ang), z, len, 0.7, 0.16, 'pedra', { tint: C.stoneDark, rot });
  };
  ramp(4, 0.3, 7.7, 1.7);
  ramp(9.3, 1.7, 14.2, 0);
  b.span(7.7, 1.4, -1.1, 9.3, 1.7, 1.1, 'pedra', { tint: C.stone });
  for (const z of [-1.03, 1.03]) b.span(7.65, 1.7, z - 0.08, 9.35, 2.4, z + 0.08, 'pedra', { tint: C.stoneDark });
  for (const z of [-1.0, 1.0]) {
    const arch = new THREE.TorusGeometry(3.2, 0.28, 6, 24, Math.PI).translate(9, -1.8, z);
    b.addGeometry(arch, surfaceMaterial('pedra'), C.stoneDark, false);
    arch.dispose();
  }
  // Stepping stones, west bank -> island.
  for (let k = 0; k <= 8; k++) {
    const x = -14.4 + k * 1.225;
    b.cylinder(x, -0.8, 0.35 * Math.sin(k * 1.3), 0.55, 0.85, 'pedra', { tint: C.stoneDark, segments: 9 });
  }

  // --- Perimeter: plaster wall with a tiled cap ------------------------------------------------------
  const wallH = 4.5;
  const plaster = { tint: C.plaster };
  b.span(-W - 1, 0, -D - 1, W + 1, wallH, -D, 'concreto', plaster);
  b.span(-W - 1, 0, D, W + 1, wallH, D + 1, 'concreto', plaster);
  b.span(-W - 1, 0, -D, -W, wallH, D, 'concreto', plaster);
  b.span(W, 0, -D, W + 1, wallH, D, 'concreto', plaster);
  wallCap(b, -W - 1, -D - 1, W + 1, -D, wallH);
  wallCap(b, -W - 1, D, W + 1, D + 1, wallH);
  wallCap(b, -W - 1, -D, -W, D, wallH);
  wallCap(b, W, -D, W + 1, D, wallH);
  const skirting = { tint: C.stoneDark, collide: false, castShadow: false };
  b.span(-W, 0, -D, W, 0.5, -D + 0.04, 'pedra', skirting);
  b.span(-W, 0, D - 0.04, W, 0.5, D, 'pedra', skirting);
  b.span(-W, 0, -D, -W + 0.04, 0.5, D, 'pedra', skirting);
  b.span(W - 0.04, 0, -D, W, 0.5, D, 'pedra', skirting);

  // --- North: the tea house --------------------------------------------------------------------------
  b.span(-13.5, 0, -16.6, 13.5, 0.03, POND.z0 - 0.5, 'pedra', stoneFloor);
  const hall = pavilion(b, {
    cx: 0,
    cz: -23,
    plinth: { h: 0.6, margin: 2.5, steps: ['s', 'e', 'w'] },
    stories: [
      {
        hw: 11, hd: 4, h: 3.4, style: 'papel', sideStyle: { n: 'estuque' },
        doors: { s: [-6.5, 0, 6.5], e: [0], w: [0], n: [-2.6, 2.6] },
        stairs: [{ side: 'n', dir: 1, from: 4.6 }, { side: 'n', dir: -1, from: -4.6 }],
      },
      {
        hw: 11, hd: 4, h: 3.4, style: 'papel', sideStyle: { n: 'estuque' },
        doors: { s: [-6.5, 0, 6.5], e: [0], w: [0] },
        windows: { n: [-8, 0, 8] },
        balcony: { depth: 2.2, sides: ['s', 'e', 'w'] },
        skirt: 1.1,
      },
    ],
    roof: { overhang: 1.6, rise: 3.2, curl: 0.9 },
  });
  // Paper partitions: tea room (west), the gong hall (center), the east room. Same upstairs.
  for (const x of [-4, 4]) {
    paperWall(b, 'z', x, -26.85, -19.03, 3.15, hall.floors[0], [-23]);
    paperWall(b, 'z', x, -26.85, -19.03, 3.2, hall.floors[1], [-23]);
  }
  const gong = new Gong(scene, b, 0, hall.floors[0], -25.4, props, () => sfx.gong());
  animated.push((dt) => gong.update(dt));
  const table = (x: number, y: number, z: number, w: number, d: number) => {
    b.span(x - w / 2, y + 0.38, z - d / 2, x + w / 2, y + 0.46, z + d / 2, 'madeira', { tint: C.woodDark, collide: false });
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.span(x + sx * (w / 2 - 0.1) - 0.05, y, z + sz * (d / 2 - 0.1) - 0.05, x + sx * (w / 2 - 0.1) + 0.05, y + 0.38, z + sz * (d / 2 - 0.1) + 0.05, 'madeira', { tint: C.woodDark, collide: false });
    b.cuboidCollider(new THREE.Vector3(x, y + 0.23, z), new THREE.Vector3(w / 2, 0.23, d / 2), new THREE.Quaternion(), 'wood');
    for (const [ox, oz] of [[0, -d / 2 - 0.35], [0, d / 2 + 0.35], [-w / 2 - 0.35, 0], [w / 2 + 0.35, 0]]) {
      b.span(x + ox - 0.25, y, z + oz - 0.25, x + ox + 0.25, y + 0.1, z + oz + 0.25, 'pintura', { tint: 0xb8322a, collide: false, castShadow: false });
    }
    bonsai(b, x, y + 0.46, z, 0.7, rand);
  };
  table(-8, hall.floors[0], -23.2, 1.4, 0.8);
  table(-7.5, hall.floors[1], -22, 1.4, 0.8);
  table(7.5, hall.floors[1], -21.6, 1.4, 0.8);
  b.box(10.4, hall.floors[0] + 0.9, -20.3, 0.6, 1.8, 1.2, 'madeira', { tint: C.lacquerDark });
  for (const x of [-9, -3, 3, 9]) lanterns.hang(new THREE.Vector3(x, 7.3, -16.4), 1.6);
  // Crimson dragons guarding the front steps.
  const guard = dragonGeometry(
    [new THREE.Vector3(0, 0.2, -0.7), new THREE.Vector3(0.35, 0.35, -0.35), new THREE.Vector3(-0.3, 0.45, 0), new THREE.Vector3(0.25, 0.65, 0.3), new THREE.Vector3(0, 1.0, 0.45), new THREE.Vector3(0, 1.25, 0.62)],
    0.14,
    CRIMSON,
  );
  const guardMat = dragonMaterial();
  for (const [x, yaw] of [[-3.4, -0.35], [3.4, 0.35]]) {
    b.box(x, 0.45, -15.4, 1.2, 0.9, 1.6, 'pedra', { tint: C.stone });
    b.span(x - 0.65, 0.9, -16.25, x + 0.65, 1.0, -14.55, 'pintura', { tint: C.stoneDark, collide: false });
    const statue = new THREE.Mesh(guard.geo, guardMat);
    statue.position.set(x, 0.95, -15.4);
    statue.rotation.y = yaw;
    statue.castShadow = true;
    scene.add(statue);
    b.cuboidCollider(new THREE.Vector3(x, 1.65, -15.4), new THREE.Vector3(0.45, 0.7, 0.6), new THREE.Quaternion(), 'concrete');
  }

  // --- North-west: three-story pagoda ----------------------------------------------------------------
  const pagoda = pavilion(b, {
    cx: -33,
    cz: -23,
    stories: [
      { hw: 3.5, hd: 3.5, h: 3.6, style: 'estuque', doors: { e: [0], s: [0] }, windows: { w: [0] }, stairs: [{ side: 'n', dir: 1, from: -2.6, inset: 0.6 }] },
      { hw: 3, hd: 3, h: 3.4, style: 'madeira', doors: { e: [0], w: [0] }, balcony: { depth: 1.2, sides: ['n', 's', 'e', 'w'] }, skirt: 0.9, stairs: [{ side: 's', dir: -1, from: 2.4, inset: 0.5 }] },
      { hw: 2.5, hd: 2.5, h: 3.2, style: 'madeira', doors: { n: [0], e: [0], w: [0] }, windows: { s: [-1.2, 1.2] }, balcony: { depth: 1.2, sides: ['n', 's', 'e', 'w'] }, skirt: 0.9 },
    ],
    roof: { overhang: 1.2, rise: 3.0, curl: 0.9 },
  });

  // --- North-east: two-story pavilion, balcony over the passage --------------------------------------
  const ne = pavilion(b, {
    cx: 26,
    cz: -23.5,
    stories: [
      { hw: 6, hd: 3.5, h: 3.4, style: 'estuque', doors: { s: [-3, 3], w: [0], e: [0] }, windows: { s: [0], n: [3.5] }, stairs: [{ side: 'n', dir: 1, from: -5.4 }] },
      { hw: 6, hd: 3.5, h: 3.2, style: 'papel', sideStyle: { n: 'madeira' }, doors: { s: [-3, 3], w: [0], e: [0] }, windows: { n: [-3, 3] }, balcony: { depth: 1.8, sides: ['s', 'w', 'e'] }, skirt: 0.8 },
    ],
    roof: { overhang: 1.4, rise: 2.6, curl: 0.8 },
  });

  // --- South-east: two-story pavilion --------------------------------------------------------------
  const se = pavilion(b, {
    cx: 23,
    cz: 23,
    stories: [
      { hw: 6, hd: 4, h: 3.4, style: 'madeira', doors: { n: [-3, 3], w: [0], e: [0], s: [-3] }, windows: { n: [0] }, stairs: [{ side: 's', dir: -1, from: 5.4 }] },
      { hw: 6, hd: 4, h: 3.2, style: 'papel', doors: { n: [-3, 3], w: [0], e: [0] }, balcony: { depth: 1.8, sides: ['n', 'w'] }, skirt: 0.8 },
    ],
    roof: { overhang: 1.4, rise: 2.6, curl: 0.8 },
  });
  for (const p of [hall, pagoda, ne, se]) for (const h of p.hooks) lanterns.hang(h, 0.85);

  // --- West: spawn court behind the paifang gate -----------------------------------------------------
  const courtWallH = 3.4;
  const leak = { tint: C.plaster, frame: { surface: 'pintura' as const, tint: C.stoneDark, width: 0.12 } };
  b.wall('z', -27, -14, -4.8, 0.4, courtWallH, 'concreto', [[-10.3, -8.7, 0.9, 2.3]], 0, leak);
  b.wall('z', -27, 4.8, 14, 0.4, courtWallH, 'concreto', [[8.7, 10.3, 0.9, 2.3]], 0, leak);
  wallCap(b, -27.2, -14, -26.8, -4.8, courtWallH);
  wallCap(b, -27.2, 4.8, -26.8, 14, courtWallH);
  {
    const gx = -27;
    for (const z of [-4.3, -1.5, 1.5, 4.3]) {
      b.box(gx, 0.35, z, 0.9, 0.7, 0.9, 'pedra', { tint: C.stone });
      column(b, gx, z, 0.7, 5.2, 0.26);
    }
    b.span(gx - 0.25, 4.6, -4.7, gx + 0.25, 5.1, 4.7, 'pintura', { tint: C.beam });
    b.span(gx - 0.27, 4.6, -4.7, gx + 0.27, 4.68, 4.7, 'pintura', { tint: C.gold, collide: false });
    b.span(gx - 0.2, 3.7, -1.5, gx + 0.2, 4.0, 1.5, 'pintura', { tint: C.lacquer });
    for (const s of [-1, 1]) b.span(gx - 0.18, 3.3, Math.min(s * 1.5, s * 4.3), gx + 0.18, 3.55, Math.max(s * 1.5, s * 4.3), 'pintura', { tint: C.lacquer });
    plaque(scene, '龍園', gx, 4.3, 0, Math.PI / 2, 2.2, 0.55);
    for (const h of curvedRoof(b, { outer: { x0: gx - 1.1, x1: gx + 1.1, z0: -2.3, z1: 2.3 }, top: { x0: gx, x1: gx, z0: -1.2, z1: 1.2 }, eaveY: 5.1, topY: 6.1, curl: 0.5, ridges: true, collide: false })) lanterns.hang(h, 0.7);
    for (const s of [-1, 1]) {
      curvedRoof(b, { outer: { x0: gx - 0.9, x1: gx + 0.9, z0: Math.min(s * 1.9, s * 5.0), z1: Math.max(s * 1.9, s * 5.0) }, top: { x0: gx, x1: gx, z0: Math.min(s * 2.8, s * 4.1), z1: Math.max(s * 2.8, s * 4.1) }, eaveY: 4.6, topY: 5.35, curl: 0.4, ridges: true, collide: false });
    }
    lanterns.hang(new THREE.Vector3(gx, 3.7, -0.8), 0.85);
    lanterns.hang(new THREE.Vector3(gx, 3.7, 0.8), 0.85);
  }

  // --- East: spawn court behind the moon gate --------------------------------------------------------
  moonGateWall(b, 'z', 27, -14, 14, 0.4, courtWallH, 0, 1.5, [[-7.8, -6.2, 0.9, 2.3], [6.2, 7.8, 0.9, 2.3]]);
  wallCap(b, 26.8, -14, 27.2, 14, courtWallH);
  for (const side of [-1, 1]) {
    for (const z of [-2.3, 2.3]) {
      b.span(27 + side * 0.2, 3.0, z - 0.04, 27 + side * 0.75, 3.08, z + 0.04, 'pintura', { tint: C.lacquer, collide: false });
      lanterns.hang(new THREE.Vector3(27 + side * 0.7, 3.0, z), 0.75);
    }
  }

  // --- South: rock hill with a pavilion on top -------------------------------------------------------
  {
    const hx = -12;
    const hz = 17;
    const top = 2.4;
    b.span(hx - 3, 0, hz - 3, hx + 3, top, hz + 3, 'pedra', { tint: 0x9d9a90 });
    b.stairs('x', -1, hx + 3 + stairRun(top), hz - 1.8, hz - 0.2, 0, top, 'pedra', { tint: C.stone });
    b.stairs('z', -1, hz + 3 + stairRun(top), hx - 1.5, hx, 0, top, 'pedra', { tint: C.stone });
    for (const [x, z, sx, sy, sz] of [
      [hx - 2, hz - 3.1, 1.4, 1.8, 0.9], [hx + 0.4, hz - 3.2, 1.2, 1.4, 0.9], [hx + 2.4, hz - 2.9, 1.0, 2.0, 0.9],
      [hx - 3.1, hz - 1.2, 0.9, 1.6, 1.3], [hx - 3.2, hz + 1.6, 0.9, 1.9, 1.2],
      [hx + 3.1, hz + 1.8, 0.9, 1.5, 1.2], [hx + 2.2, hz + 3.1, 1.0, 1.7, 0.8], [hx - 2.5, hz + 3.1, 0.8, 1.2, 0.8],
    ]) {
      rock(b, x, 0, z, sx, sy, sz, rand);
    }
    const tingY = top;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) column(b, hx + sx * 2.2, hz + sz * 2.2, tingY, tingY + 2.6, 0.15);
    for (const h of curvedRoof(b, { outer: { x0: hx - 3.2, x1: hx + 3.2, z0: hz - 3.2, z1: hz + 3.2 }, top: { x0: hx, x1: hx, z0: hz, z1: hz }, eaveY: tingY + 2.6, topY: tingY + 4.3, curl: 0.7, ridges: true })) lanterns.hang(h, 0.8);
    const low = { h: 0.7 };
    railing(b, 'x', hz - 2.94, hx - 3, hx + 3, top, low);
    railing(b, 'z', hx - 2.94, hz - 3, hz + 3, top, low);
    railing(b, 'x', hz + 2.94, hx - 3, hx - 1.5, top, low);
    railing(b, 'x', hz + 2.94, hx, hx + 3, top, low);
    railing(b, 'z', hx + 2.94, hz - 3, hz - 1.8, top, low);
    railing(b, 'z', hx + 2.94, hz - 0.2, hz + 3, top, low);
  }

  // --- South: covered corridor along the wall, with paper screens ------------------------------------
  {
    const x0 = -26;
    const x1 = 12;
    const zf = 25.8;
    const floorY = 0.3;
    b.span(x0, 0, 25.5, x1, floorY, D, 'pedra', { tint: C.stone });
    const bays = 10;
    const bay = (x1 - x0) / bays;
    for (let k = 0; k <= bays; k++) column(b, x0 + k * bay, zf, floorY, 3.2, 0.15);
    b.span(x0, 2.85, zf - 0.18, x1, 3.2, zf + 0.18, 'pintura', { tint: C.beam, collide: false });
    for (const k of [1, 2, 4, 6, 7]) paperWall(b, 'x', zf, x0 + k * bay + 0.15, x0 + (k + 1) * bay - 0.15, 2.55, floorY);
    paperWall(b, 'z', -7, zf + 0.15, D, 2.55, floorY, [27.9]);
    curvedRoof(b, { outer: { x0: x0 - 0.8, x1: x1 + 0.8, z0: 24.9, z1: D }, top: { x0: x0 - 0.8 + 2.55, x1: x1 + 0.8 - 2.55, z0: 27.45, z1: 27.45 }, eaveY: 3.2, topY: 4.4, curl: 0.5, ridges: true });
    for (let k = 0; k < bays; k++) lanterns.hang(new THREE.Vector3(x0 + (k + 0.5) * bay, 4.1, 27.45), 0.85);
  }

  // --- South-west: tiered fountain and bamboo ----------------------------------------------------------
  const jet = new THREE.Vector3(-33, 2.35, 22);
  {
    const { x, z } = jet;
    b.span(x - 2, 0, z - 2, x + 2, 0.05, z + 2, 'pedra', { tint: C.stoneDark, collide: false, castShadow: false });
    ring(x, z, 2.2, 0, 0.6, 18);
    pool(x, z, 2.1, 0.45);
    b.cylinder(x, 0, z, 0.25, 1.25, 'pedra', { tint: C.stone, segments: 10 });
    b.cylinder(x, 1.2, z, 0.4, 0.35, 'pedra', { tint: C.stone, radiusTop: 1.0, segments: 16 });
    pool(x, z, 0.92, 1.53);
    b.cylinder(x, 1.55, z, 0.15, 0.6, 'pedra', { tint: C.stone, segments: 8 });
    b.cylinder(x, 2.1, z, 0.25, 0.2, 'pedra', { tint: C.stone, radiusTop: 0.55, segments: 12, collide: false });
    pool(x, z, 0.48, 2.28);
  }
  let jetAcc = 0;
  animated.push((dt) => {
    jetAcc += dt * 32;
    while (jetAcc >= 1) {
      jetAcc--;
      drops.spawn(jet, 5.5, 0.55, 0.45);
    }
    drops.update(dt);
  });
  bamboo(b, -37.6, 17, 7, 1.5, rand);
  bamboo(b, -38, 27.3, 8, 1.4, rand);
  bamboo(b, -29.5, 28.4, 6, 1.1, rand);
  bamboo(b, 36.6, -27.2, 7, 1.5, rand);
  bamboo(b, 37.4, 27, 6, 1.2, rand);

  // --- Gardens: paths, pines, blossoms, rocks, stone lanterns, bonsai ---------------------------------
  b.span(-27, 0, -1.3, POND.x0 - 0.5, 0.03, 1.3, 'pedra', stoneFloor);
  b.span(14.2, 0, -1.3, 27, 0.03, 1.3, 'pedra', stoneFloor);
  b.span(0, 0, POND.z1 + 0.5, 2.2, 0.03, 25.5, 'pedra', stoneFloor);
  b.span(-26, 0, 20.2, 16, 0.03, 21.8, 'pedra', stoneFloor);
  b.span(-38, 0, -2, -27.2, 0.03, 2, 'pedra', stoneFloor);
  b.span(27.2, 0, -2, 38, 0.03, 2, 'pedra', stoneFloor);
  for (const [x, z, s] of [[-20, -11, 1.15], [-20.5, 12, 1.0], [18, -11, 1.05], [19.5, 11.5, 1.1], [-4.5, 14, 0.95], [6, 19, 1.1], [11, 13.5, 0.9], [35, 17.5, 1.0], [-24, -22, 1.3], [-18, -26.5, 1.0], [-21, 17.5, 0.9]]) {
    pine(b, x, 0, z, s, rand);
  }
  const blossom = { greens: [0xf7a8c4, 0xf2c1d6, 0xee8fb4], trunk: 0x5a3b2a };
  for (const [x, z, s] of [[-5.5, 18.5, 0.9], [12.5, 22.6, 0.85], [-26, 10.5, 0.8], [34, -13.5, 0.9]]) pine(b, x, 0, z, s, rand, blossom);
  for (const [x, z, sx, sy, sz] of [
    [-31, -10, 1.3, 1.1, 1.0], [-31, 10.5, 1.2, 1.2, 1.1], [31, -10, 1.3, 1.0, 1.1], [31, 10.5, 1.2, 1.3, 1.0],
    [-20, 4.5, 1.1, 1.2, 0.9], [-21, -5, 1.0, 1.0, 1.2], [19, -4.5, 1.2, 1.1, 1.0], [20, 5, 1.0, 1.3, 1.1],
    [5, 15, 1.1, 1.0, 1.2], [-7, 12.5, 0.9, 1.1, 0.8], [8, 23.5, 1.0, 0.9, 1.0], [-18, 23.3, 1.1, 1.0, 0.9],
    [-24.5, -17.5, 1.0, 1.2, 1.0], [16, -15.5, 1.1, 1.0, 1.0], [-36, 15.5, 1.0, 1.2, 1.0], [14, 16.5, 0.9, 0.9, 0.9],
  ]) {
    rock(b, x, 0, z, sx, sy, sz, rand);
  }
  for (const [x, z] of [[-24, 2.3], [-24, -2.3], [24, 2.3], [24, -2.3], [-5, -12], [5, -12], [2.6, 12.5], [-2.6, 12.5], [-28.5, 24], [14.5, 24.5], [-15.8, -12.5], [14.5, -12.5]]) {
    stoneLantern(b, x, z, 0, glow);
  }
  const pedestal = (x: number, z: number) => {
    b.box(x, 0.35, z, 0.9, 0.7, 0.7, 'pedra', { tint: C.stone });
    bonsai(b, x, 0.7, z, 1, rand, rand() < 0.5 ? 0x2f5d8a : 0x8a4a2f);
  };
  for (const [x, z] of [[-38.5, -10], [-38.5, 12], [-30, 3.6], [38.5, -10], [38.5, 12], [30.5, -3.6], [-14.5, -14.5], [14.8, 14.5]]) pedestal(x, z);

  // Lantern posts at the bridge ends.
  const lanternPost = (x: number, z: number, ax: number, az: number) => {
    column(b, x, z, 0, 3.3, 0.09);
    b.box(x + ax * 0.42, 3.22, z + az * 0.42, ax ? 0.9 : 0.08, 0.08, az ? 0.9 : 0.08, 'pintura', { tint: C.lacquer, collide: false });
    lanterns.hang(new THREE.Vector3(x + ax * 0.78, 3.18, z + az * 0.78), 0.75);
  };
  lanternPost(-2.6, -10.1, -1, 0);
  lanternPost(0.4, -10.1, 1, 0);
  lanternPost(2.6, 10.1, 1, 0);
  lanternPost(-0.4, 10.1, -1, 0);
  lanternPost(14.7, -1.8, 0, -1);
  lanternPost(14.7, 1.8, 0, 1);

  // Signs.
  signBoard(b, scene, ['JARDIM DO', 'DRAGÃO', 'Não alimente o dragão'], -39.2, -7, -Math.PI / 2, '#c0352b', '#ffe9a8', 2.2);
  signBoard(b, scene, ['CUIDADO', 'Paredes de papel', 'Não confie nelas'], 9, -11.6, 0, '#fff8ec', '#c0271b', 1.3);
  signBoard(b, scene, ['PROIBIDO', 'acordar o dragão', '(ele cospe fogo)'], 39.2, 7, Math.PI / 2, '#ffd23f', '#1b1530', 2.2);

  // Glowing stone-lantern cores: one unlit mesh.
  if (glow.length) {
    const merged = new THREE.Mesh(mergeGeometries(glow, false)!, new THREE.MeshBasicMaterial({ color: 0xffe6a0 }));
    scene.add(merged);
  }
  lanterns.finish(scene, b, props, () => sfx.lanternTap());
  animated.push((dt) => lanterns.update(dt));

  // Sky.
  const clouds = skyClouds(scene);
  let birdTimer = 4;
  animated.push((dt) => {
    clouds(dt);
    birdTimer -= dt;
    if (birdTimer <= 0) {
      birdTimer = 6 + Math.random() * 9;
      sfx.ambientBird();
    }
  });

  b.finish();

  const at = (x: number, y: number, z: number, yaw: number): SpawnPoint => ({ position: new THREE.Vector3(x, y, z), yaw });
  const E = -Math.PI / 2; // facing +X
  const Wd = Math.PI / 2; // facing -X
  const S = Math.PI; // facing +Z
  return {
    spawnsA: [at(-37, 0.2, 0, E), at(-37, 0.2, 4, E), at(-37, 0.2, -4, E), at(-34, 0.2, 8.5, E), at(-34, 0.2, -8.5, E)],
    spawnsB: [at(37, 0.2, 0, Wd), at(37, 0.2, 4, Wd), at(37, 0.2, -4, Wd), at(34, 0.2, 8.5, Wd), at(34, 0.2, -8.5, Wd)],
    spawnsFFA: ([
      // Tea house: the three rooms, upstairs and the balcony; the alley behind it.
      [-6.5, 0.8, -20.8], [7, 0.8, -20.8], [0, 0.8, -21], [-6, 4.2, -22], [6, 4.2, -22], [0, 4.2, -17.8], [-8, 0.8, -28.3],
      // Pagoda (ground, first balcony, top floor) and the pavilions.
      [-33, 0.2, -21], [-33, 3.8, -26.7], [-33, 7.2, -23.5], [28.5, 0.2, -22], [28, 3.6, -23], [20, 0.2, 22], [20, 3.6, 22],
      // Corridor halves, island, rock hill, south-west fountain.
      [-18, 0.5, 27.5], [4, 0.5, 27.5], [-3, 0.5, 2.3], [-12, 2.6, 17], [-33, 0.2, 26.5],
      // Gardens and the courts.
      [16, 0.2, -12], [-23, 0.2, -15], [8, 0.2, 16], [-36, 0.2, -11], [36, 0.2, 11],
    ] as [number, number, number][]).map(([x, y, z]) => at(x, y, z, Math.atan2(x, z))),
    dummies: [
      // From the west court: along the path, on the bridges, in the buildings.
      { position: new THREE.Vector3(-20, 0, 2.5), yaw: Wd },
      { position: new THREE.Vector3(-1, 0.3, -6.1), yaw: Wd, patrol: { axis: 'x', amplitude: 1.2, speed: 0.9 } },
      { position: new THREE.Vector3(8.5, 1.7, 0), yaw: Wd },
      { position: new THREE.Vector3(1.1, 0, 14), yaw: Wd, patrol: { axis: 'z', amplitude: 3, speed: 0.8 } },
      { position: new THREE.Vector3(33, 0, 0), yaw: Wd },
      // Behind paper: the tea room's front wall and a corridor screen (shoot through them).
      { position: new THREE.Vector3(-7.5, 0.6, -21), yaw: S },
      { position: new THREE.Vector3(-9, 0.3, 27.4), yaw: 0 },
      // Up high: balconies, pagoda top, rock hill.
      { position: new THREE.Vector3(-3, 4, -17.5), yaw: S },
      { position: new THREE.Vector3(-33, 7, -19.7), yaw: S },
      { position: new THREE.Vector3(-12, 2.4, 17), yaw: Wd },
      { position: new THREE.Vector3(22, 3.4, 17.8), yaw: Wd },
      { position: new THREE.Vector3(28, 3.4, -18.8), yaw: S },
    ],
    killY: -20,
    stats: b.stats,
    openings: b.openings,
    props,
    update(dt, frame) {
      for (const f of animated) f(dt, frame);
    },
    dog: null,
  };
}

/** Hanging plaque with big characters on both faces (the paifang's name board). */
function plaque(scene: THREE.Scene, text: string, x: number, y: number, z: number, yaw: number, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f3d6b';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#e7b847';
  g.lineWidth = 10;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#f2c94c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(c.height * 0.62)}px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", serif`;
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const face = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() });
  const edge = toon(0xe7b847);
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [edge, edge, edge, edge, face, face]);
  board.position.set(x, y, z);
  board.rotation.y = yaw;
  scene.add(board);
}

/** Pun sign on two posts, readable from both sides. */
function signBoard(b: MapBuilder, scene: THREE.Scene, lines: string[], x: number, z: number, yaw: number, bg: string, fg: string, height: number) {
  for (const side of [-1, 1]) {
    const ox = Math.cos(yaw) * side * 0.6;
    const oz = -Math.sin(yaw) * side * 0.6;
    b.cylinder(x + ox, 0, z + oz, 0.045, height + 0.3, 'pintura', { tint: C.lacquer, segments: 6 });
  }
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#1b1530';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 150);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    g.font = i === 0 ? '400 40px "Lilita One", system-ui, sans-serif' : i === 1 ? '400 30px "Lilita One", system-ui, sans-serif' : '800 18px Nunito, system-ui, sans-serif';
    g.fillText(line, 128, i === 0 ? 44 : i === 1 ? 84 : 122);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const wood = toon(0x8a5432);
  const face = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.05), [wood, wood, wood, wood, face, face]);
  board.position.set(x, height, z);
  board.rotation.y = yaw;
  board.castShadow = true;
  scene.add(board);
}
