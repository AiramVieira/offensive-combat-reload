// Pooled combat effects (section 3: never create/destroy per shot): bullet decals, particles, tracers, muzzle light.
import * as THREE from 'three';

const MAX_DECALS = 160;
/** Marks stay this long, then fade out over DECAL_FADE seconds (bullet holes / explosion scorches). */
const DECAL_LIFE = 14;
const SCORCH_LIFE = 24;
const DECAL_FADE = 4;
const MAX_PARTICLES = 480;
const MAX_TRACERS = 16;
const TRACER_SPEED = 450;
const TRACER_LENGTH = 6;

export type ParticleKind = 'debris' | 'spark' | 'confetti' | 'star';

const CONFETTI_COLORS = [0xff4f9a, 0xffd23f, 0x3fd3ff, 0x7dff5a, 0xb27dff, 0xff7a1a].map((c) => new THREE.Color(c));

export class Effects {
  private decals: THREE.InstancedMesh;
  private decalCursor = 0;
  private decalBorn = new Float32Array(MAX_DECALS).fill(-1e9);
  private decalLife = new Float32Array(MAX_DECALS);
  private decalFade: THREE.InstancedBufferAttribute;
  private time = 0;

  private particles: THREE.InstancedMesh;
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pMaxLife = new Float32Array(MAX_PARTICLES);
  private pSize = new Float32Array(MAX_PARTICLES * 3);
  private pSpin = new Float32Array(MAX_PARTICLES);
  private pDrag = new Float32Array(MAX_PARTICLES);
  private pCursor = 0;

  private tracers: { mesh: THREE.Mesh; start: THREE.Vector3; dir: THREE.Vector3; dist: number; age: number; active: boolean }[] = [];
  readonly muzzleLight: THREE.PointLight;
  private muzzleT = 0;
  // Explosions: pooled fireballs, smoke puffs and ground shockwaves, plus one flash light.
  private fireballs: { mesh: THREE.Mesh; t: number; size: number; delay: number; life: number }[] = [];
  private smoke: { mesh: THREE.Mesh; t: number; life: number; vel: THREE.Vector3; size: number }[] = [];
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private boomLight: THREE.PointLight;
  private boomT = 0;

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private e = new THREE.Euler();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene) {
    // Per-instance fade (0..1) multiplies the decal's alpha, so each mark disappears on its own schedule
    // while all of them stay one draw call.
    const decalGeo = new THREE.PlaneGeometry(0.13, 0.13);
    this.decalFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS), 1);
    decalGeo.setAttribute('aFade', this.decalFade);
    const decalMat = new THREE.MeshBasicMaterial({
      map: holeTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    decalMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vFade;');
    };
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
    this.decals.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, this.m);
    scene.add(this.decals);

    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_PARTICLES);
    this.particles.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.setMatrixAt(i, this.m);
      this.particles.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    scene.add(this.particles);

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, start: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, age: 0, active: false });
    }

    this.muzzleLight = new THREE.PointLight(0xffc36b, 0, 9, 2);
    scene.add(this.muzzleLight);

    const sphere = new THREE.IcosahedronGeometry(1, 1);
    // Opaque, flat-shaded puffs read better as cartoon fire than additive glow (which washes out on sky).
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false }));
      mesh.visible = false;
      scene.add(mesh);
      this.fireballs.push({ mesh, t: 1, size: 1, delay: 0, life: 0.3 });
    }
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(sphere, new THREE.MeshToonMaterial({ color: 0x9a9a9a, transparent: true, depthWrite: false }));
      mesh.visible = false;
      scene.add(mesh);
      this.smoke.push({ mesh, t: 1, life: 1, vel: new THREE.Vector3(), size: 1 });
    }
    const ringGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, t: 1 });
    }
    this.boomLight = new THREE.PointLight(0xffa640, 0, 22, 2);
    scene.add(this.boomLight);
  }

  /** Cartoon explosion: fireball, smoke puffs, shockwave ring, flash, sparks, debris and a scorch mark. */
  explosion(pos: THREE.Vector3, ground: { point: THREE.Vector3; normal: THREE.Vector3 } | null, radius: number) {
    // Three puffs popping in sequence, slightly offset, sized from the blast radius.
    let puffs = 0;
    for (const fb of this.fireballs) {
      if (fb.t < 1 || puffs >= 3) continue;
      fb.t = 0;
      fb.delay = puffs * 0.04;
      fb.life = 0.28 + puffs * 0.05;
      fb.size = radius * (0.13 + Math.random() * 0.05) * (puffs === 0 ? 1.2 : 0.9);
      fb.mesh.position.set(pos.x + (Math.random() - 0.5) * 0.8, pos.y + 0.3 + puffs * 0.35, pos.z + (Math.random() - 0.5) * 0.8);
      fb.mesh.scale.setScalar(0.01);
      fb.mesh.visible = true;
      puffs++;
    }
    let spawned = 0;
    for (const s of this.smoke) {
      if (s.t < s.life || spawned >= 12) continue;
      spawned++;
      s.t = 0;
      s.life = 1.2 + Math.random() * 0.9;
      s.size = 0.5 + Math.random() * 0.6;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).normalize();
      s.mesh.position.copy(pos).addScaledVector(dir, 0.4);
      s.vel.copy(dir).multiplyScalar(2 + Math.random() * 3);
      s.mesh.visible = true;
      (s.mesh.material as THREE.MeshToonMaterial).color.setScalar(0.45 + Math.random() * 0.3);
    }
    if (ground) {
      const ring = this.rings.find((r) => r.t >= 1) ?? this.rings[0];
      ring.t = 0;
      ring.mesh.position.copy(ground.point).addScaledVector(ground.normal, 0.05);
      ring.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ground.normal);
      ring.mesh.visible = true;
      this.decal(ground.point, ground.normal, 9, SCORCH_LIFE);
    }
    const up = new THREE.Vector3(0, 1, 0);
    this.burst('spark', pos, up, 30);
    this.burst('debris', pos, up, 24, 0x5a4a3a);
    this.boomLight.position.copy(pos).y += 0.5;
    this.boomT = 0.25;
  }

  decal(point: THREE.Vector3, normal: THREE.Vector3, size = 1, life = DECAL_LIFE) {
    this.q.setFromUnitVectors(this.zAxis, normal);
    const roll = new THREE.Quaternion().setFromAxisAngle(this.zAxis, Math.random() * Math.PI * 2);
    this.q.multiply(roll);
    const sc = (0.8 + Math.random() * 0.5) * size;
    this.v.copy(point).addScaledVector(normal, 0.004);
    this.m.compose(this.v, this.q, this.s.set(sc, sc, sc));
    this.decals.setMatrixAt(this.decalCursor, this.m);
    this.decals.instanceMatrix.needsUpdate = true;
    this.decalBorn[this.decalCursor] = this.time;
    this.decalLife[this.decalCursor] = life;
    this.decalFade.setX(this.decalCursor, 1);
    this.decalFade.needsUpdate = true;
    this.decalCursor = (this.decalCursor + 1) % MAX_DECALS;
  }

  burst(kind: ParticleKind, point: THREE.Vector3, normal: THREE.Vector3, count: number, tint?: THREE.ColorRepresentation) {
    const tintColor = tint !== undefined ? new THREE.Color(tint) : null;
    for (let n = 0; n < count; n++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
      const rnd = () => Math.random() * 2 - 1;
      let speed = 3;
      let life = 0.5;
      let size = 0.04;
      let drag = 1;
      let color: THREE.Color;
      switch (kind) {
        case 'spark':
          speed = 7;
          life = 0.12 + Math.random() * 0.1;
          size = 0.025;
          color = new THREE.Color(0xfff0a0);
          break;
        case 'debris':
          speed = 3.5;
          life = 0.5 + Math.random() * 0.4;
          size = 0.035 + Math.random() * 0.03;
          color = tintColor ? tintColor.clone().multiplyScalar(0.6 + Math.random() * 0.3) : new THREE.Color(0x777777);
          break;
        case 'confetti':
          speed = 4.5;
          life = 1.2 + Math.random() * 0.8;
          size = 0.07;
          drag = 3.5;
          color = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0];
          break;
        case 'star':
          speed = 3;
          life = 0.5 + Math.random() * 0.3;
          size = 0.09;
          drag = 2;
          color = new THREE.Color(0xffe14d);
          break;
      }
      const dx = normal.x + rnd() * 0.8;
      const dy = normal.y + rnd() * 0.8 + 0.4;
      const dz = normal.z + rnd() * 0.8;
      const len = Math.hypot(dx, dy, dz) || 1;
      const sp = speed * (0.5 + Math.random() * 0.7);
      this.pPos.set([point.x, point.y, point.z], i * 3);
      this.pVel.set([(dx / len) * sp, (dy / len) * sp, (dz / len) * sp], i * 3);
      const flat = kind === 'confetti' ? [size, size * 0.12, size * 0.7] : kind === 'star' ? [size, size, size * 0.3] : [size, size, size];
      this.pSize.set(flat, i * 3);
      this.pLife[i] = life;
      this.pMaxLife[i] = life;
      this.pSpin[i] = rnd() * 14;
      this.pDrag[i] = drag;
      this.particles.setColorAt(i, color);
    }
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers.find((x) => !x.active) ?? this.tracers[0];
    t.start.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 1) return;
    t.dir.divideScalar(t.dist);
    t.age = 0;
    t.active = true;
    t.mesh.visible = true;
  }

  flash(position: THREE.Vector3) {
    this.muzzleLight.position.copy(position);
    this.muzzleT = 0.05;
  }

  update(dt: number) {
    this.time += dt;
    // Fade marks out once they outlive their time; fully faded ones collapse so they cost nothing.
    let fadeChanged = false;
    let matrixChanged = false;
    for (let i = 0; i < MAX_DECALS; i++) {
      const cur = this.decalFade.getX(i);
      if (cur <= 0) continue;
      const age = this.time - this.decalBorn[i];
      const next = age <= this.decalLife[i] ? 1 : Math.max(0, 1 - (age - this.decalLife[i]) / DECAL_FADE);
      if (next !== cur) {
        this.decalFade.setX(i, next);
        fadeChanged = true;
        if (next <= 0) {
          this.m.makeScale(0, 0, 0);
          this.decals.setMatrixAt(i, this.m);
          matrixChanged = true;
        }
      }
    }
    if (fadeChanged) this.decalFade.needsUpdate = true;
    if (matrixChanged) this.decals.instanceMatrix.needsUpdate = true;

    // Particles.
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      const k = i * 3;
      if (this.pLife[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.particles.setMatrixAt(i, this.m);
        continue;
      }
      const drag = Math.exp(-this.pDrag[i] * dt);
      this.pVel[k] *= drag;
      this.pVel[k + 2] *= drag;
      this.pVel[k + 1] = this.pVel[k + 1] * drag - 12 * dt / this.pDrag[i];
      this.pPos[k] += this.pVel[k] * dt;
      this.pPos[k + 1] += this.pVel[k + 1] * dt;
      this.pPos[k + 2] += this.pVel[k + 2] * dt;
      const age = this.pMaxLife[i] - this.pLife[i];
      const fade = Math.min(1, this.pLife[i] / (this.pMaxLife[i] * 0.4));
      this.e.set(age * this.pSpin[i], age * this.pSpin[i] * 0.7, age * this.pSpin[i] * 0.3);
      this.q.setFromEuler(this.e);
      this.s.set(this.pSize[k] * fade, this.pSize[k + 1] * fade, this.pSize[k + 2] * fade);
      this.m.compose(this.v.set(this.pPos[k], this.pPos[k + 1], this.pPos[k + 2]), this.q, this.s);
      this.particles.setMatrixAt(i, this.m);
    }
    if (any) this.particles.instanceMatrix.needsUpdate = true;

    // Tracers: a short bright segment racing from the muzzle to the impact point.
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.age += dt;
      const travel = t.age * TRACER_SPEED;
      const head = Math.min(t.dist, travel);
      const tail = Math.max(0, travel - TRACER_LENGTH);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      this.v.copy(t.start).addScaledVector(t.dir, tail);
      t.mesh.position.copy(this.v);
      this.v.addScaledVector(t.dir, 1);
      t.mesh.lookAt(this.v);
      t.mesh.scale.set(0.025, 0.025, Math.max(0.01, head - tail));
    }

    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.muzzleLight.intensity = this.muzzleT > 0 ? 30 * (this.muzzleT / 0.05) : 0;

    // Explosions.
    for (const f of this.fireballs) {
      if (f.t >= 1) continue;
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.t = Math.min(1, f.t + dt / f.life);
      const grow = 1 - Math.pow(1 - f.t, 3);
      f.mesh.scale.setScalar(f.size * (0.4 + grow * 0.8));
      const m = f.mesh.material as THREE.MeshBasicMaterial;
      // White-hot → yellow → orange → sooty, fading out at the end.
      const c = f.t < 0.15 ? [1, 1, 0.85] : f.t < 0.5 ? [1, 0.82 - (f.t - 0.15), 0.25] : [0.55 - (f.t - 0.5) * 0.4, 0.35 - (f.t - 0.5) * 0.3, 0.2];
      m.color.setRGB(c[0], c[1], c[2]);
      m.opacity = f.t < 0.6 ? 1 : 1 - (f.t - 0.6) / 0.4;
      if (f.t >= 1) f.mesh.visible = false;
    }
    for (const s of this.smoke) {
      if (s.t >= s.life) continue;
      s.t += dt;
      s.vel.multiplyScalar(Math.exp(-2.5 * dt));
      s.vel.y += 0.6 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      const k = s.t / s.life;
      s.mesh.scale.setScalar(s.size * (0.6 + k * 1.4));
      (s.mesh.material as THREE.MeshToonMaterial).opacity = 0.75 * (1 - k);
      if (s.t >= s.life) s.mesh.visible = false;
    }
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.4);
      r.mesh.scale.setScalar(0.5 + r.t * 3.5);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - r.t);
      if (r.t >= 1) r.mesh.visible = false;
    }
    this.boomT = Math.max(0, this.boomT - dt);
    this.boomLight.intensity = this.boomT > 0 ? 400 * (this.boomT / 0.25) : 0;
  }
}

function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grd.addColorStop(0, 'rgba(20,16,12,1)');
  grd.addColorStop(0.45, 'rgba(40,32,26,0.9)');
  grd.addColorStop(0.7, 'rgba(60,50,40,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
