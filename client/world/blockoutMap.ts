// "Rua dos Vizinhos" (section 10): 80 x 60 m, three east-west lanes.
// North: row of enterable two-story houses with gable roofs. Center: the street with cars and the ice cream
// truck. South: fenced yards, empty pool (2 m drop), tree house, 7 m watchtower and a doghouse loaded from
// glTF (public/models/casinha_cachorro.glb) as an example of the Blender pipeline.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PALETTE, toon, toonGradient } from '../render/materials';
import { WORLD_GROUPS, type Physics } from './physics';
import { MapBuilder, stairRun, type Opening, type WallOpening } from './mapBuilder';
import { addGltfToMap, gltfLoader } from './gltfMap';
import { Hydrant, WaterDrops, type HydrantSfx } from './hydrant';
import { PropBus } from './props';
import { surfaceMaterial } from './surfaces';
import { buildCar, buildIceCreamTruck, buildVan } from './vehicles';
import { flamingoGeometry, iceCreamTopper, skyClouds } from './decor';
import { ChowChow, namePlate } from './dog';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface SpawnPoint {
  position: THREE.Vector3;
  yaw: number;
}

export interface DummySpot {
  position: THREE.Vector3;
  /** Facing, same convention as the camera (yaw 0 faces -Z). */
  yaw: number;
  /** Strafe axis and amplitude in meters (omitted = stationary). */
  patrol?: { axis: 'x' | 'z'; amplitude: number; speed: number };
}

export interface MapFrame {
  /** Local player's feet (proximity gags). */
  feet: THREE.Vector3;
  /** Camera position (sound volume by distance). */
  listener: THREE.Vector3;
  /** Throws the local player (hydrant). */
  launch(vx: number, vy: number, vz: number): void;
}

export interface GameMap {
  spawnsA: SpawnPoint[];
  spawnsB: SpawnPoint[];
  /** Neutral spawns spread over the map for free-for-all (section 10: 16-20 of them). */
  spawnsFFA: SpawnPoint[];
  dummies: DummySpot[];
  killY: number;
  stats: MapBuilder['stats'];
  /** Every hole left in a wall (doors and windows), for automated structure checks. */
  openings: WallOpening[];
  /** Gags synchronized between players online. */
  props: PropBus;
  /** Per-frame updates for animated props and proximity gags. */
  update(dt: number, frame: MapFrame): void;
  /** Amora, the doghouse's Chow Chow: bites (kills) anyone who steps in front of her door. */
  dog: ChowChow | null;
}

export interface MapSfx extends HydrantSfx {
  iceCream(): void;
  squeak(): void;
  bark(): void;
  bite(): void;
  ambientBird(): void;
}

export async function buildBlockoutMap(physics: Physics, scene: THREE.Scene, renderer: THREE.WebGLRenderer, sfx: MapSfx): Promise<GameMap> {
  const b = new MapBuilder(physics, scene);
  const P = PALETTE;
  const W = 40; // half extent X
  const D = 30; // half extent Z
  const animated: ((dt: number, frame: MapFrame) => void)[] = [];
  const props = new PropBus();

  // --- Ground with a hole for the pool (x -6..6, z 16..24) -------------------------------------------
  const G = -3;
  const grass = { tint: P.grass, castShadow: false }; // ground receives shadows but never casts them
  b.span(-W, G, -D, W, 0, 16, 'grama', grass);
  b.span(-W, G, 24, W, 0, D, 'grama', grass);
  b.span(-W, G, 16, -6, 0, 24, 'grama', grass);
  b.span(6, G, 16, W, 0, 24, 'grama', grass);
  // Street and sidewalks.
  b.span(-W, 0, -7, W, 0.02, 7, 'asfalto', { tint: P.asphalt, collide: false, castShadow: false });
  b.span(-W, 0, -10, W, 0.15, -7, 'calcada', { tint: P.sidewalk, castShadow: false });
  b.span(-W, 0, 7, W, 0.15, 10, 'calcada', { tint: P.sidewalk, castShadow: false });
  for (let x = -36; x <= 36; x += 6) b.span(x - 1.2, 0.02, -0.12, x + 1.2, 0.03, 0.12, 'pintura', { tint: 0xfff2a8, collide: false, castShadow: false });

  // --- Pool: 2 m deep, ramp on the east end, steps on the west end -----------------------------------
  b.span(-6, -2.3, 16, 6, -2, 24, 'azulejo', { tint: P.poolTile, castShadow: false });
  // Tile lining over the pool walls (they are the sides of the grass blocks, which would show grass).
  const lining = { tint: P.poolTile, collide: false, castShadow: false };
  b.span(-6, -2, 16, -5.97, 0, 24, 'azulejo', lining);
  b.span(5.97, -2, 16, 6, 0, 24, 'azulejo', lining);
  b.span(-6, -2, 16, 6, 0, 16.03, 'azulejo', lining);
  b.span(-6, -2, 23.97, 6, 0, 24, 'azulejo', lining);
  b.span(-6.3, -2, 15.7, 6.3, 0.12, 16, 'concreto', { tint: 0xe8e4da });
  b.span(-6.3, -2, 24, 6.3, 0.12, 24.3, 'concreto', { tint: 0xe8e4da });
  {
    // Ramp: 2 m over 5.5 m (~20 deg), bottom at x=0.5, top at x=6, across z 16..19.
    const run = 5.5;
    const rise = 2;
    const ang = Math.atan2(rise, run);
    b.box(6 - run / 2, -2 + rise / 2 - 0.15, 17.5, Math.hypot(run, rise), 0.3, 3, 'azulejo', { tint: P.poolTile, rot: new THREE.Euler(0, 0, ang) });
  }
  b.stairs('x', -1, -6 + stairRun(2), 21, 24, -2, 2, 'concreto', { tint: 0xe8e4da });

  // --- Perimeter -------------------------------------------------------------------------------------
  const wallH = 4;
  const brick = { tint: P.brick };
  b.span(-W - 1, 0, -D - 1, W + 1, wallH, -D, 'tijolo', brick);
  b.span(-W - 1, 0, D, W + 1, wallH, D + 1, 'tijolo', brick);
  b.span(-W - 1, 0, -D, -W, wallH, D, 'tijolo', brick);
  b.span(W, 0, -D, W + 1, wallH, D, 'tijolo', brick);
  // Concrete cap on top of the wall.
  for (const [x0, z0, x1, z1] of [[-W - 1.1, -D - 1.1, W + 1.1, -D + 0.1], [-W - 1.1, D - 0.1, W + 1.1, D + 1.1], [-W - 1.1, -D, -W + 0.1, D], [W - 0.1, -D, W + 1.1, D]]) {
    b.span(x0, wallH, z0, x1, wallH + 0.12, z1, 'concreto', { tint: 0xd9d4c8, collide: false });
  }

  // --- North lane: three enterable two-story houses --------------------------------------------------
  const houses: [number, number, number][] = [[-18, P.house, 0x8e4b3a], [0, P.houseAlt, 0x4a5a6e], [18, P.houseAlt2, 0x6e4a5a]];
  for (const [cx, wallTint, roofTint] of houses) buildHouse(b, cx, -19, wallTint, roofTint);
  const bushesLater: [number, number, number][] = houses.flatMap(([cx]) => [[cx - 3, -13.85, 2.4], [cx + 4.6, -13.85, 1.6]] as [number, number, number][]);

  // --- Center lane: parked cars, ice cream truck, street props ---------------------------------------
  const car = (x: number, z: number, color: number, rotY = 0) => buildCar(b, x, z, color, rotY);
  car(-24, -5, P.carRed);
  car(-8, 5, P.carYellow);
  car(8, -5.2, P.carGreen);
  car(26, 4.8, P.carRed, Math.PI);
  car(-30, 5, P.carGreen, 0.25);

  // Ice cream truck: breaks the long street sightline and plays a jingle when shot.
  let lastJingle = -10;
  const jingle = () => {
    const now = performance.now() / 1000;
    if (now - lastJingle > 4) {
      lastJingle = now;
      sfx.iceCream();
    }
  };
  const truckShot = props.register('caminhao', jingle);
  buildIceCreamTruck(b, P.truck, P.truckTrim, truckShot);
  scene.add(iceCreamTopper(new THREE.Vector3(1.6, 2.75, 0)));

  // High crates (2.0 m) near the lane ends.
  b.span(-33, 0, -3, -31, 2.0, -1, 'madeira', { tint: P.teamA });
  b.span(31, 0, 1, 33, 2.0, 3, 'madeira', { tint: P.teamB });
  // Fire hydrants on the sidewalks: shoot one and it gushes; stand on it and you fly.
  const drops = new WaterDrops(scene);
  const hydrants: Hydrant[] = [];
  const red = 0xe23b3b;
  [[-12, -8], [12, 8], [28, -8]].forEach(([x, z], hi) => {
    const base = 0.15;
    const hydrant = new Hydrant(scene, new THREE.Vector3(x, base + 0.85, z), drops, sfx);
    hydrants.push(hydrant);
    const onShot = props.register(`hidrante:${hi}`, () => hydrant.burst());
    b.cylinder(x, base, z, 0.2, 0.06, 'metal', { tint: 0xb02a2a, collide: false }); // flange
    b.cylinder(x, base, z, 0.16, 0.66, 'metal', { tint: red, onShot });
    b.addGeometry(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, base + 0.66, z), surfaceMaterial('metal'), red);
    b.cylinder(x, base + 0.78, z, 0.05, 0.08, 'metal', { tint: 0xd8dde3, collide: false }); // cap nut
    for (const side of [-1, 1]) {
      const nozzle = new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8).rotateZ(Math.PI / 2).translate(x + side * 0.2, base + 0.45, z);
      b.addGeometry(nozzle, surfaceMaterial('metal'), 0xd8dde3);
    }
  });
  animated.push((dt, f) => {
    for (const h of hydrants) h.update(dt, f.feet, f.listener, f.launch);
    drops.update(dt);
  });
  for (const [x, z] of [[-20, 8.5], [4, 8.5], [22, -8.5]]) {
    b.span(x - 0.05, 0.15, z - 0.05, x + 0.05, 1.1, z + 0.05, 'madeira', { tint: P.wood, collide: false });
    b.span(x - 0.25, 1.1, z - 0.2, x + 0.25, 1.4, z + 0.2, 'metal', { tint: 0x3a6ee8 }); // mailbox
  }

  // --- South lane: fenced yards ----------------------------------------------------------------------
  const fenceH = 1.8;
  const fenceT = 0.15;
  const wood = { tint: P.wood };
  b.wall('x', 11, -W, W, fenceT, fenceH, 'madeira', [[-30, -27, 0, fenceH], [-12, -9, 0, fenceH], [8, 11, 0, fenceH], [26, 29, 0, fenceH]], 0, wood);
  for (const x of [-22, 13]) b.wall('z', x, 11, D, fenceT, fenceH, 'madeira', [[18, 21, 0, fenceH]], 0, wood);

  // Tree house overlooking the pool: platform at 3 m.
  const th = { x: -15, z: 22 };
  const trunk = { tint: P.trunk };
  b.span(th.x - 2, 2.75, th.z - 2, th.x + 2, 3, th.z + 2, 'piso', wood);
  for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
    b.span(th.x + ox - 0.12, 0, th.z + oz - 0.12, th.x + ox + 0.12, 2.75, th.z + oz + 0.12, 'madeira', trunk);
  }
  b.wall('x', th.z - 2, th.x - 2, th.x + 2, 0.1, 1.0, 'madeira', [], 3, wood);
  b.wall('z', th.x + 2, th.z - 2, th.z + 2, 0.1, 1.0, 'madeira', [[th.z - 0.8, th.z + 0.8, 0, 1]], 3, wood);
  b.stairs('x', 1, th.x - 2 - stairRun(3), th.z + 0.9, th.z + 2, 0, 3, 'madeira', wood);
  b.span(th.x - 2.4, 0, th.z + 3.1, th.x - 1.6, 5, th.z + 3.9, 'madeira', trunk);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 0), toon(P.foliage));
  leaves.position.set(th.x - 2, 6, th.z + 3.5);
  leaves.castShadow = true;
  scene.add(leaves);

  // Watchtower (7 m) in the south-east corner, reached by a long staircase along the south wall.
  const tw = { x0: 30, x1: 33.5, z0: 25.5, z1: D };
  const towerY = 7;
  b.span(tw.x0, towerY - 0.3, tw.z0, tw.x1, towerY, tw.z1, 'piso', wood);
  for (const [x, z] of [[tw.x0, tw.z0], [tw.x1 - 0.25, tw.z0], [tw.x1 - 0.25, tw.z1 - 0.25]]) {
    b.span(x, 0, z, x + 0.25, towerY - 0.3, z + 0.25, 'madeira', wood);
  }
  b.wall('x', tw.z0, tw.x0, tw.x1, 0.12, 1.0, 'madeira', [], towerY, wood);
  b.wall('z', tw.x1, tw.z0, tw.z1, 0.12, 1.0, 'madeira', [], towerY, wood);
  const stairStart = tw.x0 - stairRun(towerY);
  b.stairs('x', 1, stairStart, 28.3, D, 0, towerY, 'madeira', wood);
  // Tall railing standing ON the perimeter wall (not over the stairs, where it would hit players' heads),
  // so nobody falls out of the map from the stairs or platform.
  b.span(stairStart, wallH, D, tw.x1, towerY + 1.0, D + 0.12, 'madeira', wood);
  b.gableRoof(tw.x0, tw.z0, tw.x1, tw.z1, towerY + 2.2, 1.0, 'telhado', { tint: 0x8e4b3a, ridgeAxis: 'x', overhang: 0.3, collide: false });
  for (const [x, z] of [[tw.x0, tw.z0], [tw.x1 - 0.15, tw.z0], [tw.x0, tw.z1 - 0.15], [tw.x1 - 0.15, tw.z1 - 0.15]]) {
    b.span(x, towerY, z, x + 0.15, towerY + 2.2, z + 0.15, 'madeira', wood);
  }

  // Flamingos: spin when shot.
  const flamingoGeo = flamingoGeometry();
  const flamingoMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  [[-30, 14], [-26, 26], [20, 15], [9, 27]].forEach(([x, z], fi) => {
    const pivot = new THREE.Mesh(flamingoGeo, flamingoMat);
    pivot.position.set(x, 0, z);
    pivot.rotation.y = fi * 2.1 + 0.6; // each one looks somewhere else
    pivot.castShadow = true;
    scene.add(pivot);
    let spin = 0;
    const desc = RAPIER.ColliderDesc.cylinder(0.6, 0.25).setTranslation(x, 0.9, z).setCollisionGroups(WORLD_GROUPS);
    const col = physics.world.createCollider(desc, physics.staticBody);
    physics.surfaces.set(col.handle, {
      material: 'wood',
      onShot: props.register(`flamingo:${fi}`, () => {
        spin = Math.min(spin + 18, 40);
        sfx.squeak();
      }),
    });
    animated.push((dt) => {
      pivot.rotation.y += spin * dt;
      spin *= Math.exp(-2.5 * dt);
    });
  });

  // --- Life: street trees, bushes, lamp posts, pun signs, clouds, birds --------------------------------
  const pintura = surfaceMaterial('pintura');
  const tree = (x: number, z: number, scale = 1) => {
    b.cylinder(x, 0, z, 0.2 * scale, 2.6 * scale, 'madeira', { tint: P.trunk, radiusTop: 0.14 * scale, segments: 8 });
    const greens = [0x4fa83a, 0x5dbb45, 0x44962f];
    const blobs: [number, number, number, number][] = [[0, 3.3, 0, 1.5], [0.8, 2.9, 0.4, 1.0], [-0.7, 3.0, -0.4, 1.1], [0.1, 4.1, 0.1, 1.0]];
    blobs.forEach(([ox, oy, oz, r], i) => {
      const g = new THREE.IcosahedronGeometry(r * scale, 0).translate(x + ox * scale, oy * scale, z + oz * scale);
      b.addGeometry(g, pintura, greens[i % greens.length]); // foliage: visual only (bullets pass)
    });
  };
  for (const x of [-27, -9, 9, 27]) tree(x, -12.2);
  for (const [x, z] of [[-33, 12.8], [-4, 12.8], [18, 12.8], [29.5, 12.8]]) tree(x, z, 0.9);

  const bush = (x: number, z: number, w: number) => {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.IcosahedronGeometry(0.45 + (i % 2) * 0.1, 0).scale(1.2, 0.8, 1).translate(x + (i - 1) * w * 0.33, 0.4, z + (i % 2) * 0.1);
      b.addGeometry(g, pintura, i % 2 ? 0x3f8a2e : 0x4e9e38);
    }
  };

  for (const [x, z, w] of bushesLater) bush(x, z, w);

  // Lamp posts along the sidewalks; the glowing heads are merged into one mesh.
  const lampHeads: THREE.BufferGeometry[] = [];
  const lamp = (x: number, z: number, facing: 1 | -1) => {
    b.cylinder(x, 0.15, z, 0.07, 4.2, 'metal', { tint: 0x3a3f47, segments: 8 });
    b.span(x - 0.04, 4.25, z, x + 0.04, 4.33, z + facing * 0.9, 'metal', { tint: 0x3a3f47, collide: false });
    lampHeads.push(new THREE.BoxGeometry(0.36, 0.14, 0.24).translate(x, 4.2, z + facing * 0.9));
  };
  for (const x of [-30, -2, 26]) lamp(x, -9.7, 1);
  for (const x of [-24, 6, 32]) lamp(x, 9.7, -1);
  const heads = mergeGeometries(lampHeads, false)!;
  const headMesh = new THREE.Mesh(heads, new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
  scene.add(headMesh);

  // Pun signs (canvas textures).
  const sign = (lines: string[], x: number, z: number, yaw: number, bg: string, fg: string, height = 1.3) => {
    // Two posts at the board's edges (a single post through the middle covered the text on both faces).
    for (const side of [-1, 1]) {
      const ox = Math.cos(yaw) * side * 0.6;
      const oz = -Math.sin(yaw) * side * 0.6;
      b.cylinder(x + ox, 0, z + oz, 0.045, height + 0.3, 'madeira', { tint: P.wood, segments: 6 });
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
      g.font = i === 0 ? '400 44px "Lilita One", system-ui, sans-serif' : '800 22px Nunito, system-ui, sans-serif';
      g.fillText(line, 128, i === 0 ? 52 : 92 + (i - 1) * 28);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.05), [
      toon(0xb07a45), toon(0xb07a45), toon(0xb07a45), toon(0xb07a45),
      new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() }),
      new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() }),
    ]);
    board.position.set(x, height, z);
    board.rotation.y = yaw;
    board.castShadow = true;
    scene.add(board);
  };
  sign(['VENDE-SE', 'Vizinho barulhento', 'incluso no preço'], 22.6, -12.4, 0, '#fff8ec', '#c0271b');
  sign(['CUIDADO', 'Cão bravo', '(e muito fofo)'], 33.4, 16.6, 0, '#ffd23f', '#1b1530', 2.1);
  sign(['RUA DOS', 'VIZINHOS', 'Proibido estacionar tanque'], -38.6, -9.3, -Math.PI / 2, '#2f7d3a', '#ffffff', 2.4);

  // Clouds drifting across the sky, and a bird now and then.
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

  // --- Spawns: team A (orange) west by the moving van, team B (blue) east by the garage --------------
  buildVan(b, -35.25, -6.9, 0xf2f2f2, P.teamA); // moving van
  b.span(-39.8, 0.01, -2, -37.8, 0.05, 2, 'pintura', { tint: P.teamA, collide: false, castShadow: false });
  b.wall('z', 34, -8, -2, 0.3, 3.2, 'tijolo', [], 0, { tint: P.teamB });
  b.span(34, 3.2, -8.3, W, 3.5, -2, 'metal', { tint: 0x5d6673 });
  b.span(34, 0, -8.3, W, 3.2, -8, 'tijolo', { tint: P.teamB });
  b.span(38, 0.01, -2, 39.8, 0.05, 2, 'pintura', { tint: P.teamB, collide: false, castShadow: false });

  // --- glTF prop: doghouse in the east yard, guarded by Amora -----------------------------------------
  let dog: ChowChow | null = null;
  try {
    const gltf = await gltfLoader(renderer).loadAsync('/models/casinha_cachorro.glb');
    const house = { x: 36, z: 14.5, scale: 1.6 };
    // The model's door faces -Z; turned around so the entrance opens into the yard (+Z), in plain view.
    const markers = addGltfToMap(gltf, b, { position: new THREE.Vector3(house.x, 0, house.z), yaw: Math.PI, scale: house.scale });
    // The door wall is 0.7 m (model units) from the center.
    const doorZ = house.z + 0.7 * house.scale;
    const plate = namePlate('Amora', 0.44 * house.scale, 0.14 * house.scale);
    plate.position.set(house.x, (0.66 + 0.07) * house.scale, doorZ + 0.02 * house.scale + 0.004);
    scene.add(plate);
    // Bite zone: the strip in front of her door, a bit wider than the house and ~2.3 m deep.
    const zone = new THREE.Box3(new THREE.Vector3(house.x - 1.35, -0.5, doorZ - 0.05), new THREE.Vector3(house.x + 1.35, 1.2, doorZ + 2.3));
    dog = new ChowChow(scene, physics, new THREE.Vector3(house.x, 0, doorZ + 0.45), Math.PI, zone, sfx);
    for (const gag of markers.gags) {
      if (gag.name !== 'LATIDO') continue;
      let cooldown = 0;
      animated.push((dt, { feet }) => {
        cooldown -= dt;
        if (cooldown <= 0 && feet.distanceTo(gag.position) < 3.5) {
          cooldown = 4;
          sfx.bark();
        }
      });
    }
  } catch (err) {
    console.warn('[mapa] prop glTF não carregado:', err);
  }

  b.finish();

  const spawn = (x: number, z: number, yaw: number): SpawnPoint => ({ position: new THREE.Vector3(x, 0.2, z), yaw });
  const E = -Math.PI / 2; // facing +X
  const Wd = Math.PI / 2; // facing -X
  const N = Math.PI; // facing +Z (toward the street from the houses)
  return {
    spawnsA: [spawn(-38, 0, E), spawn(-38, 3, E), spawn(-38, -3, E), spawn(-36, 13.5, E), spawn(-36, 20, E)],
    spawnsB: [spawn(38, 0, Wd), spawn(38, 3, Wd), spawn(36, 20, Wd)],
    spawnsFFA: ([
      // Houses: ground floor and upstairs.
      [-15, 0.2, -18], [3, 0.2, -18], [21, 0.2, -18],
      [-15, 3.2, -16], [3, 3.2, -16], [21, 3.2, -16],
      // Gaps between the houses and the strip behind them.
      [-9, 0.2, -19], [9, 0.2, -19], [-30, 0.2, -26], [0, 0.2, -26.5], [30, 0.2, -26],
      // Street ends and sidewalks.
      [-38, 0.2, -3], [38, 0.2, 3], [-20, 0.35, -8.5], [14, 0.35, 8.5],
      // Yards, tree house and tower.
      [-30, 0.2, 21], [-10, 0.2, 27], [8, 0.2, 13], [25, 0.2, 25.5], [-15, 3.2, 22], [31.8, 7.2, 27.5],
    ] as [number, number, number][]).map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z), yaw: Math.atan2(x, z) })),
    dummies: [
      // Street: roughly 20 m and 45 m from the west spawn, to feel the rifle's damage falloff.
      { position: new THREE.Vector3(-18, 0, 1.5), yaw: Wd },
      { position: new THREE.Vector3(7, 0, 3), yaw: Wd },
      { position: new THREE.Vector3(-4, 0, -4.5), yaw: Wd, patrol: { axis: 'z', amplitude: 2.2, speed: 1.3 } },
      { position: new THREE.Vector3(20, 0, 0), yaw: Wd, patrol: { axis: 'z', amplitude: 3.5, speed: 0.9 } },
      { position: new THREE.Vector3(31.5, 0, -4.5), yaw: Wd }, // in front of the garage (x=34 is its wall)
      // Houses (ground floor and upstairs windows).
      { position: new THREE.Vector3(-18, 0, -17), yaw: N },
      { position: new THREE.Vector3(-1, 3, -16), yaw: N },
      { position: new THREE.Vector3(20, 3, -16), yaw: N },
      // Yards, pool, tree house and tower.
      { position: new THREE.Vector3(-2, -2, 20), yaw: Wd, patrol: { axis: 'x', amplitude: 3, speed: 0.7 } },
      { position: new THREE.Vector3(-15, 3, 22), yaw: Wd },
      { position: new THREE.Vector3(31.8, towerY, 27.5), yaw: Wd },
      { position: new THREE.Vector3(24, 0, 20), yaw: Wd, patrol: { axis: 'z', amplitude: 4, speed: 1.1 } },
    ],
    killY: -20,
    stats: b.stats,
    openings: b.openings,
    props,
    update(dt, frame) {
      for (const f of animated) f(dt, frame);
    },
    dog,
  };
}

/**
 * 12 x 9 m two-story house centered at (cx, cz), front facing the street (+Z), with a gable roof.
 * Openings may stack (the front door sits under an upstairs window); the wall builder keeps every hole
 * clear. Ground-floor windows are tall enough to crouch-jump through (section 10: "casas atravessáveis
 * por janelas").
 */
function buildHouse(b: MapBuilder, cx: number, cz: number, wallTint: number, roofTint: number) {
  const hw = 6;
  const hd = 4.5;
  const t = 0.3;
  const floorH = 3;
  const wallH = floorH * 2 + 0.2; // up to the roof, so the siding meets the eaves
  const x0 = cx - hw;
  const x1 = cx + hw;
  const z0 = cz - hd;
  const z1 = cz + hd;
  const DOOR_W = 1.6;
  const DOOR_H = 2.3;
  const door = (c: number): Opening => [c - DOOR_W / 2, c + DOOR_W / 2, 0, DOOR_H];
  const win = (c: number, w: number, bottom: number, top: number): Opening => [c - w / 2, c + w / 2, bottom, top];
  const walls = { tint: wallTint, frame: { tint: 0xf7f3ea } };

  // Front: door, ground window, two upstairs windows (the right one right above the door). Back: door and
  // two upstairs windows. Sides: doors so the row can be crossed lengthwise, plus upstairs side windows.
  const frontDoor = cx + 2;
  const backDoor = cx + 3;
  const sideDoor = cz + 1.5;
  b.wall('x', z1, x0, x1, t, wallH, 'reboco', [door(frontDoor), win(cx - 3, 2.2, 0.9, 2.3), win(cx - 3, 2.4, 3.9, 5.2), win(cx + 3, 2.4, 3.9, 5.2)], 0, walls);
  b.wall('x', z0, x0, x1, t, wallH, 'reboco', [door(backDoor), win(cx - 2, 2, 3.9, 5.2), win(cx + 3, 1.6, 3.9, 5.2)], 0, walls);
  b.wall('z', x0, z0 + t / 2, z1 - t / 2, t, wallH, 'reboco', [door(sideDoor), win(cz - 1.5, 2, 3.9, 5.2)], 0, walls);
  b.wall('z', x1, z0 + t / 2, z1 - t / 2, t, wallH, 'reboco', [door(sideDoor), win(cz - 1.5, 2, 3.9, 5.2)], 0, walls);

  // Door leaves swung open into the house (visual only, never block the doorway).
  const leaf = { tint: 0x8a5a3a, collide: false };
  b.span(frontDoor - DOOR_W / 2, 0, z1 - t / 2 - DOOR_W, frontDoor - DOOR_W / 2 + 0.05, DOOR_H - 0.05, z1 - t / 2, 'madeira', leaf);
  b.span(backDoor + DOOR_W / 2 - 0.05, 0, z0 + t / 2, backDoor + DOOR_W / 2, DOOR_H - 0.05, z0 + t / 2 + DOOR_W, 'madeira', leaf);
  b.span(x0 + t / 2, 0, sideDoor - DOOR_W / 2, x0 + t / 2 + DOOR_W, DOOR_H - 0.05, sideDoor - DOOR_W / 2 + 0.05, 'madeira', leaf);
  b.span(x1 - t / 2 - DOOR_W, 0, sideDoor + DOOR_W / 2 - 0.05, x1 - t / 2, DOOR_H - 0.05, sideDoor + DOOR_W / 2, 'madeira', leaf);

  // Porch step and a small awning over the front door.
  b.span(frontDoor - 1, 0, z1 + t / 2, frontDoor + 1, 0.15, z1 + t / 2 + 0.8, 'concreto', { tint: 0xd6d1c4 });
  b.span(frontDoor - 1.1, DOOR_H + 0.25, z1 + t / 2, frontDoor + 1.1, DOOR_H + 0.35, z1 + t / 2 + 0.9, 'telhado', { tint: roofTint, collide: false });

  // Interior floor, second floor slab with a stair hole along the back wall, ceiling inside the walls.
  const ix0 = x0 + t / 2;
  const ix1 = x1 - t / 2;
  const iz0 = z0 + t / 2;
  const iz1 = z1 - t / 2;
  b.span(ix0, 0, iz0, ix1, 0.02, iz1, 'piso', { tint: 0xc9a27a, collide: false, castShadow: false });
  const hx0 = ix0 + 0.8;
  const hx1 = hx0 + stairRun(floorH);
  const hz1 = iz0 + 1.3;
  const slabY0 = floorH - 0.25;
  const floor = { tint: 0xc9a27a };
  b.span(ix0, slabY0, hz1, ix1, floorH, iz1, 'piso', floor);
  b.span(ix0, slabY0, iz0, hx0, floorH, hz1, 'piso', floor);
  b.span(hx1, slabY0, iz0, ix1, floorH, hz1, 'piso', floor);
  b.stairs('x', 1, hx0, iz0, hz1, 0, floorH, 'madeira', { tint: PALETTE.wood });
  // Railing between the stair hole and the upstairs room.
  b.span(hx0, floorH, hz1, hx1 - 1.2, floorH + 1.0, hz1 + 0.08, 'madeira', { tint: PALETTE.wood });
  b.span(ix0, floorH * 2, iz0, ix1, wallH, iz1, 'concreto', { tint: 0xe8e4da });

  // Gable roof with the ridge along the street, and a brick chimney.
  b.gableRoof(x0, z0, x1, z1, wallH, 2.2, 'telhado', { tint: roofTint, ridgeAxis: 'x', gableSurface: 'reboco', gableTint: wallTint });
  b.span(cx + 3, wallH, cz + 0.6, cx + 3.8, wallH + 3.0, cz + 1.4, 'tijolo', { tint: PALETTE.brick, collide: false });
}
