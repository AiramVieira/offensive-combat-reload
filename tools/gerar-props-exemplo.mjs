// Generates two sample files that follow the Blender conventions from docs/MAPAS.md, standing in for files
// exported from Blender so the glTF pipeline can be tested without any art yet:
//   public/models/casinha_cachorro.glb  prop: MAT_ library materials, COL_ collision, GAG_ trigger
//   public/maps/arena_teste.glb         full map: ground, walls, ramp, crates, SPAWN_/DUMMY_/KILLVOLUME
//                                       (open with ?mapa=/maps/arena_teste.glb)
//
//   bun run exemplos:glb
import { Document, NodeIO } from '@gltf-transform/core';
import { writeFile, mkdir } from 'node:fs/promises';

const doc = new Document();
const buffer = doc.createBuffer();

/** sRGB hex → linear RGBA (glTF base colors are linear). */
const linear = (hex) => [16, 8, 0].map((s) => ((hex >> s) & 255) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).concat(1);
const material = (name, hex) => doc.createMaterial(name).setBaseColorFactor(linear(hex)).setRoughnessFactor(1).setMetallicFactor(0);

class MeshData {
  pos = [];
  nor = [];
  idx = [];
  quad(a, b, c, d) {
    const u = a.map((v, i) => b[i] - v);
    const w = a.map((v, i) => d[i] - v);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(...p);
      this.nor.push(...n.map((v) => v / len));
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c) {
    const u = a.map((v, i) => b[i] - v);
    const w = a.map((v, i) => c[i] - v);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    const base = this.pos.length / 3;
    for (const p of [a, b, c]) {
      this.pos.push(...p);
      this.nor.push(...n.map((v) => v / len));
    }
    this.idx.push(base, base + 1, base + 2);
  }
  /** Axis-aligned box from min/max corners, outward-facing (counter-clockwise). */
  box([x0, y0, z0], [x1, y1, z1]) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); // +y
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // -y
  }
  /** Wedge on [x0,x1]x[z0,z1] rising from y0 at x0 to y1 at x1 (a ramp). */
  ramp([x0, y0, z0], [x1, y1, z1]) {
    this.quad([x0, y0, z1], [x1, y1, z1], [x1, y1, z0], [x0, y0, z0]); // slope
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // bottom
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // back (+x)
    this.tri([x0, y0, z1], [x1, y0, z1], [x1, y1, z1]); // side +z
    this.tri([x1, y0, z0], [x0, y0, z0], [x1, y1, z0]); // side -z
  }
  primitive(mat) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    return doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(this.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(this.nor)))
      .setIndices(acc('SCALAR', new Uint16Array(this.idx)))
      .setMaterial(mat);
  }
}

// Dimensions (meters). The prop faces -Z (its door), like every marker in the game.
const W = 1.2, D = 1.4, H = 0.9, T = 0.06, DOOR_W = 0.5, DOOR_H = 0.62, OH = 0.12, RIDGE = 0.5;
const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;

const walls = new MeshData();
walls.box([x0, 0, z1 - T], [x1, H, z1]); // back
walls.box([x0, 0, z0], [x0 + T, H, z1]); // left
walls.box([x1 - T, 0, z0], [x1, H, z1]); // right
walls.box([x0, 0, z0], [-DOOR_W / 2, H, z0 + T]); // front, left of the door
walls.box([DOOR_W / 2, 0, z0], [x1, H, z0 + T]); // front, right of the door
walls.box([-DOOR_W / 2, DOOR_H, z0], [DOOR_W / 2, H, z0 + T]); // lintel
walls.box([x0, 0, z0], [x1, 0.04, z1]); // floor
// Gable triangles, both windings so they show from inside and out.
for (const z of [z0, z1]) {
  walls.tri([x0, H, z], [x1, H, z], [0, H + RIDGE, z]);
  walls.tri([x1, H, z], [x0, H, z], [0, H + RIDGE, z]);
}

// Gable roof, ridge along Z, with overhang.
const roof = new MeshData();
const eave = H - OH * (RIDGE / (W / 2));
const rz0 = z0 - OH, rz1 = z1 + OH, ex = W / 2 + OH;
for (const side of [-1, 1]) {
  const e0 = [side * ex, eave, rz0], e1 = [side * ex, eave, rz1], r1 = [0, H + RIDGE, rz1], r0 = [0, H + RIDGE, rz0];
  if (side === 1) roof.quad(e0, r0, r1, e1);
  else roof.quad(e1, r1, r0, e0);
  const down = (p) => [p[0], p[1] - 0.05, p[2]];
  if (side === 1) roof.quad(down(e1), down(r1), down(r0), down(e0));
  else roof.quad(down(e0), down(r0), down(r1), down(e1));
}

// Name plate over the door and a food bowl, in flat paint.
const trim = new MeshData();
trim.box([-0.22, DOOR_H + 0.04, z0 - 0.02], [0.22, DOOR_H + 0.18, z0]);
trim.box([0.35, 0, z0 - 0.45], [0.55, 0.07, z0 - 0.25]);

const mesh = doc.createMesh('casinha')
  .addPrimitive(walls.primitive(material('MAT_madeira', 0xc0392b)))
  .addPrimitive(roof.primitive(material('MAT_telhado', 0x5b3a29)))
  .addPrimitive(trim.primitive(material('MAT_pintura', 0xf4f1e8)));

// Collision: one box around the body (the prop is too small to walk inside) plus the bowl ignored.
const col = new MeshData();
col.box([x0 - 0.02, 0, z0], [x1 + 0.02, H + RIDGE, z1]);
const colMesh = doc.createMesh('COL_casinha_BOX').addPrimitive(col.primitive(material('MAT_madeira', 0xffffff)));

const scene = doc.createScene('casinha_cachorro');
scene.addChild(doc.createNode('casinha').setMesh(mesh));
scene.addChild(doc.createNode('COL_casinha_BOX').setMesh(colMesh));
// Gag marker at the door: the map code makes the dog bark when a player walks by.
scene.addChild(doc.createNode('GAG_LATIDO').setTranslation([0, 0.4, z0 - 0.6]));
doc.getRoot().setDefaultScene(scene);

await mkdir('public/models', { recursive: true });
await writeFile('public/models/casinha_cachorro.glb', await new NodeIO().writeBinary(doc));
console.log('public/models/casinha_cachorro.glb gerado');

// --- Test arena: every visible mesh gets automatic triangle-mesh collision (no COL_ objects) ------------
{
  const doc = new Document();
  const buf = doc.createBuffer();
  const mat = (name, hex) => doc.createMaterial(name).setBaseColorFactor(linear(hex)).setRoughnessFactor(1).setMetallicFactor(0);
  const prim = (data, m) => {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    return doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', new Float32Array(data.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(data.nor)))
      .setIndices(acc('SCALAR', new Uint32Array(data.idx)))
      .setMaterial(m);
  };
  const scene = doc.createScene('arena_teste');
  const add = (name, data, m) => scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim(data, m))));
  const R = 18;

  const ground = new MeshData();
  ground.box([-R, -1, -R], [R, 0, R]);
  add('chao', ground, mat('MAT_grama', 0x7cc750));

  const walls = new MeshData();
  walls.box([-R - 0.5, 0, -R - 0.5], [R + 0.5, 3, -R]);
  walls.box([-R - 0.5, 0, R], [R + 0.5, 3, R + 0.5]);
  walls.box([-R - 0.5, 0, -R], [-R, 3, R]);
  walls.box([R, 0, -R], [R + 0.5, 3, R]);
  add('muros', walls, mat('MAT_tijolo', 0xc8663d));

  // Central platform (2 m) with a ramp on each side.
  const plat = new MeshData();
  plat.box([-3, 0, -3], [3, 2, 3]);
  plat.ramp([-9, 0, -1.5], [-3, 2, 1.5]);
  add('plataforma', plat, mat('MAT_concreto', 0xd6d1c4));
  const rampE = new MeshData();
  rampE.ramp([-9, 0, -1.5], [-3, 2, 1.5]);
  scene.addChild(doc.createNode('rampa_leste').setMesh(doc.createMesh('rampa_leste').addPrimitive(prim(rampE, mat('MAT_concreto', 0xd6d1c4)))).setRotation([0, 1, 0, 0]));

  const crates = new MeshData();
  for (const [x, z] of [[-12, 8], [-12, -8], [12, 8], [12, -8], [0, 12], [0, -12]]) crates.box([x - 1, 0, z - 1], [x + 1, 1.2, z + 1]);
  add('caixotes', crates, mat('MAT_madeira', 0xff7a1a));

  // Markers (empties). Facing uses the game convention: yaw 0 looks toward -Z.
  const yawQ = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  scene.addChild(doc.createNode('SPAWN_A_01').setTranslation([-15, 0.2, -3]).setRotation(yawQ(-Math.PI / 2)));
  scene.addChild(doc.createNode('SPAWN_A_02').setTranslation([-15, 0.2, 3]).setRotation(yawQ(-Math.PI / 2)));
  scene.addChild(doc.createNode('SPAWN_B_01').setTranslation([15, 0.2, 0]).setRotation(yawQ(Math.PI / 2)));
  scene.addChild(doc.createNode('DUMMY_01').setTranslation([0, 2, 0]).setRotation(yawQ(Math.PI / 2)));
  scene.addChild(doc.createNode('DUMMY_02').setTranslation([10, 0, 0]).setRotation(yawQ(Math.PI / 2)).setExtras({ eixo: 'z', amplitude: 4, velocidade: 1 }));
  scene.addChild(doc.createNode('DUMMY_03').setTranslation([12, 1.2, 8]).setRotation(yawQ(Math.PI / 2)));
  scene.addChild(doc.createNode('KILLVOLUME').setTranslation([0, -10, 0]));
  doc.getRoot().setDefaultScene(scene);

  await mkdir('public/maps', { recursive: true });
  await writeFile('public/maps/arena_teste.glb', await new NodeIO().writeBinary(doc));
  console.log('public/maps/arena_teste.glb gerado');
}
